# llm-model-router (TypeScript)

An **OpenAI-compatible LLM routing proxy**. Point your OpenAI SDK at it instead of
`api.openai.com`; it inspects each request, picks the best model for the work, forwards
to the right provider, and streams the response back — no client code changes beyond the
base URL.

> This is the **TypeScript** implementation. A Python implementation of the same design
> lives on the `feature/python-implementation` branch. Design rationale (shared by both)
> is in [`docs/decisions/`](docs/decisions).

## How it works

```
request ─▶ detect ─▶ (bypass?) ─▶ analyze ─▶ filter (hard constraints) ─▶ weighted score ─▶ forward
```

- **Routing is on by default.** The body `model` is ignored unless bypassed.
- **Control it with headers** (never the body, so it stays OpenAI-schema-valid):
  - `X-Router-Strategy: cost | quality | latency | balanced`
  - `X-Router-Bypass: true` — skip routing, use the body `model` verbatim
  - `X-Router-Max-Cost: <usd per 1k>` — cost ceiling
- **See what it did** via response headers `X-Router-Model` and `X-Router-Reason`.

## Stack

Hono (+ `@hono/node-server`), Zod for config validation, the `openai` SDK for the
classifier call, global `fetch` for streaming passthrough, `gpt-tokenizer` for token
counting, OpenTelemetry, run via `tsx`. See
[ADR 0004](docs/decisions/0004-stack-and-project-layout.md).

## Configuration

| File | Holds |
|---|---|
| `.env` | Secrets — provider keys + proxy bearer tokens (gitignored; copy from `.env.example`) |
| `config/server.yaml` | Classifier, OTel, auth, provider endpoints |
| `config/models.yaml` | Model catalog (cost, context, capabilities, tier) |
| `config/strategies.yaml` | Strategy → weight vectors |

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
npm test          # vitest
npm run typecheck # tsc --noEmit
```

Testing rules and invariants are in [`docs/TESTING.md`](docs/TESTING.md).

## Status

v1: OpenAI-compatible surface; OpenAI native + Claude via Anthropic's OpenAI-compat
endpoint. Native multi-provider translation (canonical IR), self-hosted/Ollama backends,
and the offline ML module are documented TODOs — see the ADRs.
