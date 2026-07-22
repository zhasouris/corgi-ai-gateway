# TODO / backlog

The single place for open work. Decisions that are settled live in
[`decisions/`](decisions) as ADRs; unresolved design threads live in
[`discussions/`](discussions). This file is what's *queued*.

---

## Queued

### 1. Code coverage badge ✅ done

- [x] Coverage via `@vitest/coverage-v8` (`npm run coverage`), excluding the process
      entrypoint and the static demo page.
- [x] Thresholds set at the measured baseline and ratcheted up as coverage improved —
      now statements 85 / branches 64 / functions 87 / lines 87. CI fails below them.
- [x] `telemetry.ts` taken from **0% → 100%** (statements, branches, functions); it was
      the single largest hole. Includes the ADR 0008/0009 egress guard: the Azure Monitor
      exporter is never constructed without a connection string.
- [x] `ci.yml` workflow runs typecheck + tests + coverage on every push/PR (previously
      nothing ran the tests in CI at all) and uploads the report as an artifact.
- [x] README badge shows **88% lines**.

**Follow-up (open):** the badge number is currently static, kept honest by the enforced
floor — it can under-report if coverage improves, but never over-report. Swap it for a
live badge when convenient:
- [ ] shields.io **endpoint badge** backed by a gist updated from CI (needs a gist +
      a PAT secret), or **Codecov** (tokenless for public repos, adds a third party).
- [ ] Raise **branch coverage (64%)** — still the weakest metric. The remaining gap is
      concentrated in four files: `providers/adapters/anthropic.ts` (62 uncovered
      branches), `core/signal.ts` (26), `app.ts` (16), `report.ts` (11).
      Note that v8 counts every `??`/`?.` as a branch pair — `anthropic.ts` alone has 46
      of them in 288 lines — so a defensive codebase structurally lags here. A 90% branch
      target would mostly mean testing fallbacks that cannot occur; ~80% is the honest
      ceiling worth chasing. Statements/lines/functions are the metrics to push to 90%.

### 2. Sensitive-data routing — ADR written ✅, implementation open

The plan is written up as
**[ADR 0009 — Routing Sensitive Data to Approved Providers](decisions/0009-sensitive-data-routing.md)**
(status: *Proposed*). Core decision: data-handling policy is a **hard constraint, never a
score**, and it **fails closed** — with `policy > bypass > strategy` precedence.

Implementation queue (from the ADR's follow-ups):

- [ ] Catalog schema: `data_classes`, `region`, `retention`, `trains_on_data`, `self_hosted`.
- [ ] Policy config schema (global + per-key/tenant), fail-fast validated at startup.
- [ ] Deterministic detector library (PII/PAN/secrets/internal markers) — offline, unit-tested.
- [ ] `DataPolicyConstraint` implementing `ConstraintRule`; wire into the filter stage.
- [ ] Apply policy to the bypass path (currently a one-header hole through any control).
- [ ] Dry-run/report mode — log what *would* be refused before enforcing.
- [ ] Gold tests: a restricted request never routes to an unapproved provider, across **all**
      strategies and with bypass set.
- [ ] Blocked on the self-hosted/Ollama backend for a genuinely local target to route to.

---

### 3. Document `/v1/router/explain` in the OpenAPI spec

The demo endpoint is absent from `src/openapi.ts` entirely, so it never appears on the
Swagger page even though it is a public, unauthenticated part of the surface. It now also
emits the `X-Router-Model` / `X-Router-Reason` / `X-Router-Warning` response headers, which
should be documented the same way the `/v1/chat/completions` ones are.

Also missing: `X-Router-Duration-Ms` is documented on `/v1/chat/completions` but the explain
endpoint has no spec entry to document it on.

---

### 4. Advisory-mode client SDK — decide here, call the vendor there

Today the router is a **data plane**: the caller's prompt passes through it, and it forwards
to the vendor on the caller's behalf. The alternative is a **control plane** — a thin client
library that asks the router *which model to use*, then makes the vendor call itself, in the
caller's own process.

```
  proxy mode:    client → router → vendor          (router sees the prompt, holds the keys)
  advisory mode: client → router  (decision only)
                 client → vendor  (the actual call)
```

The pieces already exist: `/v1/router/explain` returns the full decision without running a
completion, and now emits the decision headers too. What's missing is the client side and a
serious look at what inverts.

**Why it's attractive**

- [ ] **One less hop on the hot path.** The router adds ~1s today, nearly all of it the
      classifier call (`X-Router-Duration-Ms`). Advisory mode doesn't remove that cost, but
      it does remove the proxy from the *response* path entirely — no re-streaming of tokens
      through a middlebox, and vendor SDK features work natively rather than through our
      translation layer ([ADR 0001](decisions/0001-multi-provider-translation-strategy.md)).
- [ ] **The blast radius shrinks.** A router outage degrades to "pick a default model"
      instead of taking down every LLM call in the estate.
- [ ] **Decisions become cacheable client-side** — a repeated prompt shape need not re-ask.

**What inverts, and needs deciding before any code**

- [ ] **Credentials move to the client.** [ADR 0007](decisions/0007-per-model-api-keys.md)
      holds vendor keys centrally so clients never see them, which is a large part of the
      proxy's value. Advisory mode hands every client a vendor key. That is the single
      biggest trade and probably decides whether this ships at all.
- [ ] **Policy stops being enforceable.** [ADR 0009](decisions/0009-sensitive-data-routing.md)
      only works because the router is *in the path* — it can refuse. An advisory client can
      ignore the answer, so a hard constraint becomes a recommendation. Likely resolution:
      advisory mode is available only for data classes where refusal isn't required, and
      restricted traffic must use proxy mode.
- [ ] **The prompt still has to reach the classifier**, so advisory mode does *not* by itself
      keep content in the caller's process — unless classification runs client-side too
      (heuristic provider locally, LLM classifier remotely). Worth being precise about this:
      it's easy to oversell "the prompt never leaves" and be wrong.
- [ ] **Telemetry becomes the client's job.** Cost, latency, and outcome data all currently
      come from the forwarding path; without them the offline ML router
      ([ADR 0005](decisions/0005-offline-ml-module.md)) has no training signal. The client
      would need to report back, which is a second endpoint and a privacy question of its own.
- [ ] **Two code paths to keep honest.** The proxy path and the advisory path must not drift
      in what they decide — the gold corpus should run against both.

**Sketch**

- [ ] `POST /v1/router/decide` — a lean sibling of `explain` (no ranked table, no excluded
      list), sized for the hot path, plus a cache hint.
- [ ] A TypeScript client that wraps the official vendor SDKs: `route(request)` → decision →
      dispatch to the right SDK, with a configurable fallback model for when the router is
      unreachable.
- [ ] A Python client, since that's where most LLM application code lives.

This is a fork in the architecture rather than a feature, so it should get its own ADR before
implementation — including the decision on whether both modes are supported long-term or
advisory mode is a niche for latency-sensitive, low-sensitivity traffic.

---

## Carried over

Already tracked elsewhere; listed here so this file is the single view.

- [ ] **RouteLLM shadow-eval → promotion** — the sidecar and `SignalProvider` are built;
      the accuracy lift vs. the heuristic is not yet benchmarked through the judge
      ([ADR 0006](decisions/0006-leveraging-learned-routing.md)).
- [ ] **Native transformers for the remaining vendors** (Gemini, Cohere, …) — they work
      today over OpenAI-compatible endpoints; native adapters are a fidelity upgrade
      ([transformers checklist](transformers.md)).
- [ ] **Self-hosted / Ollama backend** — also unblocks the sensitive-data work above, since
      it provides a genuinely local "trusted provider".
- [ ] **Offline, telemetry-fed ML router** ([ADR 0005](decisions/0005-offline-ml-module.md)).
- [ ] **Automatic cross-provider failover.**
- [ ] **Eval harness Phase 2/3** — larger judged dataset, then telemetry-sourced
      ([eval-harness spec](eval-harness.md)).
