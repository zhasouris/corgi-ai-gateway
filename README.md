# llm-model-router

**An OpenAI-compatible proxy that picks the best model for every request — automatically.**

Point your existing OpenAI SDK at it instead of `api.openai.com`. It inspects each
request, decides which model best fits the work (by cost, quality, latency, or a blend),
forwards to the right provider, and streams the response straight back. No client changes
beyond the base URL.

```
your app ──(OpenAI SDK)──▶ llm-model-router ──▶ the right model, this time
                                │
                    detect → classify → filter → score → forward
```

---

## Why this project exists

The open-source LLM tooling world is split into two halves that rarely meet:

- **Routing brains** — projects like [RouteLLM](https://github.com/lm-sys/routellm) and
  [LLMRouter](https://github.com/ulab-uiuc/LLMRouter) are excellent at *deciding* which
  model should answer a prompt (easy prompts → cheap model, hard prompts → strong model).
  But they're research/serving frameworks for the **decision itself** — not something you
  can drop in front of an app.
- **Gateways** — projects like [LiteLLM](https://github.com/BerriAI/litellm) and Portkey
  are outstanding **proxies**: one OpenAI-format endpoint over 100+ providers, with keys,
  budgets, fallbacks, and logging. But their routing is coarse — load-balancing and
  failover, not "pick the *best* model for *this* request."

**Almost nothing open-source combines the two.** If you want a real drop-in proxy *and*
a genuine per-request model decision, you generally end up reaching for commercial
products (Martian, Not Diamond, Unify).

`llm-model-router` is that missing intersection:

> **A drop-in OpenAI-compatible proxy with a pluggable difficulty/cost/quality scoring
> engine and a clean header-based control surface — self-hosted, and yours.**

It's deliberately designed so the routing *brain* and the *gateway* are separable:
the runtime stays lean and forwards fast, while the expensive ML that learns from your
traffic runs **offline** and feeds results back in as data — so a trained router
(RouteLLM-style) can slot in behind the same interface without touching the hot path.

---

## Where it's useful

- **Cut inference spend without hand-tuning model choice.** Stop hard-coding `gpt-4.1`
  everywhere. Let easy requests fall to a cheap/fast model and reserve the expensive model
  for the work that needs it — per request, not per app.
- **One endpoint, many providers.** OpenAI and Claude today (Claude via its
  OpenAI-compatible endpoint); self-hosted / Ollama on the roadmap. Your app speaks
  OpenAI and never changes.
- **Per-call control without breaking the schema.** A team can ask for `cost` on a batch
  job and `quality` on a customer-facing path — via a header, with the request body still
  a pristine OpenAI payload.
- **A foundation you own.** Self-hosted, config-driven, OpenTelemetry throughout. The
  catalog, strategies, and classifier are all configuration; adding a model is an edit,
  not a deploy.
- **A place to put a learned router.** Already collecting telemetry? The offline module is
  designed to consume it and improve routing over time.
- **Per-model cost breakdown.** Give each model its own vendor API key (`api_key_env` in
  the catalog) and the vendor's own billing dashboard attributes spend per model — no
  custom metering (see [ADR 0007](docs/decisions/0007-per-model-api-keys.md)).
- **It measures its own routing.** A built-in eval harness scores routing quality against
  provable gold cases *and* quality-judged ground truth — so "is it any good?" is a number,
  not a hope (see [below](#measuring-the-routing)).

Not the right tool if you just want a passive multi-provider gateway with failover — a
mature gateway like LiteLLM already does that well, and can even sit *underneath* this as
the provider-translation layer.

---

## How it works

```
request ─▶ detect ─▶ (bypass?) ─▶ analyze ─▶ filter (hard constraints) ─▶ weighted score ─▶ forward
```

1. **Detect** deterministic facts (token count, vision/tools/audio, JSON mode).
2. **Analyze** — a pluggable **signal provider** estimates the subjective signals
   (complexity, expected output size, reasoning depth, task type, data sensitivity). Ships
   with a deterministic heuristic and a cheap-LLM classifier; a **RouteLLM sidecar** (a
   trained difficulty model) drops in behind the same `SignalProvider` interface. Degrades
   gracefully — if the signal source fails, routing continues on deterministic signals.
3. **Filter** the model catalog by hard capability constraints (a vision request never
   routes to a non-vision model, ever).
4. **Score** every surviving model with strategy-weighted, normalized rules and pick the
   winner.
5. **Forward** to the chosen provider and stream the response back unchanged.

### Control it with headers (never the body)

| Header | Effect |
|---|---|
| `X-Router-Strategy: cost \| quality \| latency \| balanced` | Which objective to optimize |
| `X-Router-Bypass: true` | Skip routing; use the body's `model` verbatim |
| `X-Router-Max-Cost: <usd per 1k>` | Cost ceiling |

And it tells you what it did, on every response:

| Response header | Meaning |
|---|---|
| `X-Router-Model` | The model it chose |
| `X-Router-Reason` | Why |
| `X-Router-Warning` | Soft warnings (e.g. classifier degraded, unknown strategy) |

The design rationale for every one of these choices lives in
[`docs/decisions/`](docs/decisions) as ADRs.

---

## Measuring the routing

A router is only as good as its decisions, so the project ships an **evaluation harness**
that turns "is it any good?" into numbers — two ways, each honest about what it proves:

- **Provable gold cases** (`test/gold.test.ts`) — requests whose correct target is
  *objectively determinable* (a vision request must go to a vision model; a pure-`cost`
  request must go to the cheapest; bypass must be verbatim; an audio request must error).
  **Current: 11/11.**
- **Quality-judged accuracy** (`npm run eval:judge`) — for each prompt it calls a weak and
  a strong model, an LLM judge decides whether the strong answer was *meaningfully* better,
  and the router's choice is scored against that ground truth. **Current (balanced): 83%
  accuracy, 0% over-routing, 17% under-routing** on a 12-prompt set.

```bash
npm run eval          # dry-run: strategies vs. baselines + estimated cost (hermetic)
npm run eval:judge    # quality-judged accuracy (makes real model calls; spends)
```

Honest caveats: the judged number is a small set with a single judge model, and the
default signal is a coarse heuristic — closing the gap is exactly what the RouteLLM signal
is for. The harness is the feedback loop that will *prove* whether it helps. Spec:
[`docs/eval-harness.md`](docs/eval-harness.md).

---

## Implementations

The primary runtime is **TypeScript** (this repo, `main`). A **Python** runtime (FastAPI)
with equivalent behavior lives on the `feature/python-implementation` branch. ADRs
0001–0003 and 0005–0007 are shared by both; ADR 0004 documents each stack.

## Stack (TypeScript)

Hono (+ `@hono/node-server`), Zod for config validation, the `openai` SDK for the
classifier call, global `fetch` for streaming passthrough, `gpt-tokenizer` for token
counting, OpenTelemetry, run via `tsx`. The signal source is a pluggable `SignalProvider`
(heuristic / LLM classifier / RouteLLM sidecar). See
[ADR 0004](docs/decisions/0004-stack-and-project-layout.md).

## Configuration

| File | Holds |
|---|---|
| `.env` | Secrets — provider keys, optional per-model keys, proxy bearer tokens (gitignored; copy from `.env.example`) |
| `config/server.yaml` | Classifier, OTel, auth, provider endpoints |
| `config/models.yaml` | Model catalog (cost, context, capabilities, tier, optional `api_key_env`) |
| `config/strategies.yaml` | Strategy → weight vectors |
| `sidecar/` | Optional RouteLLM signal sidecar (Python) — see its README |

**Per-model keys** (optional): a model in `models.yaml` may set `api_key_env` to
authenticate its own calls with a dedicated vendor key; otherwise it falls back to the
provider default. This is how per-model cost breakdown works.

## Run

### Local

```bash
npm install
cp .env.example .env        # then fill in keys
npm start                   # serves on :8000
```

### Docker

```bash
docker compose up --build   # reads .env, serves on :8000
```

### Interactive testing

Open **`http://localhost:8000/docs`** — a Swagger UI documenting the endpoints, the
`X-Router-*` control headers, and bearer auth, so you can try requests in the browser.
The raw spec is at `/openapi.json`.

### Call it

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Router-Strategy: cost" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hello"}]}' -i
```

## Tests

```bash
npm test          # vitest — 51 tests incl. gold routing + judging logic (hermetic)
npm run typecheck # tsc --noEmit
npm run eval      # dry-run routing eval (strategies vs. baselines)
npm run eval:judge# quality-judged accuracy (spends — real model calls)
```

Testing rules and invariants are in [`docs/TESTING.md`](docs/TESTING.md).

---

## Status & roadmap

**Now:** OpenAI-compatible surface; OpenAI native + Claude via Anthropic's OpenAI-compat
endpoint; pluggable signal (heuristic / LLM classifier / RouteLLM sidecar); strategy-
weighted scoring; header control; streaming; per-model API keys; OpenTelemetry; Docker;
evaluation harness (dry-run + provable gold + quality-judged accuracy).

**In progress / deferred (documented in the ADRs):**
- **RouteLLM shadow-eval → promotion** (ADR 0006): the sidecar + `SignalProvider` are
  built; the accuracy lift vs. the heuristic is not yet benchmarked through the judge.
- Canonical intermediate representation + native multi-provider translation (ADR 0001) —
  or routing provider translation through a mature gateway like LiteLLM instead.
- Self-hosted / Ollama backends.
- Offline, telemetry-fed ML router (ADR 0005).
- Automatic cross-provider failover.

## Related & prior art

- Routing brains: [RouteLLM](https://github.com/lm-sys/routellm),
  [LLMRouter](https://github.com/ulab-uiuc/LLMRouter),
  [vLLM Semantic Router](https://vllm-semantic-router.com/)
- Gateways: [LiteLLM](https://github.com/BerriAI/litellm), Portkey, OpenRouter,
  Cloudflare AI Gateway

This project's niche is the **overlap** of those two lists.
