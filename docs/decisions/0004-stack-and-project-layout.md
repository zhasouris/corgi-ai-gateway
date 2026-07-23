# ADR 0004 — Stack & Project Layout (TypeScript)

- **Status:** Accepted
- **Date:** 2026-07-19
- **Context repo:** `corgi-gateway` (branch: `feature/typescript-implementation`)

## Context

With the routing behavior, header contract, translation strategy, and scoring engine
settled (ADRs 0001–0003, 0005), the remaining decision is implementation. This branch
implements the router in **TypeScript**.

> A parallel Python implementation exists on `feature/python-implementation` with its own
> ADR 0004. The two are alternative runtimes of the same language-agnostic design; the
> ADRs 0001–0003 and 0005 are shared.

### Why TypeScript for the runtime

- The hardest future problem is the **canonical IR** (ADR 0001) — a modeling problem TS's
  discriminated unions + exhaustiveness checking are well suited to (every provider's
  streaming-event variant is handled at compile time).
- A proxy is **I/O-bound glue**; Node's event loop and web-standard streaming primitives
  (`ReadableStream`, `fetch`) fit streaming passthrough naturally.
- The wire formats are JSON, and the ecosystem is JS-first.
- The ML-heavy work is kept **offline** (ADR 0005), so the runtime does not need Python's
  data stack; it only emits telemetry and consumes artifacts.

## Decision

### Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **Node.js ≥ 20** | Global `fetch`, web streams |
| Language | **TypeScript** (strict) | Run via `tsx`; no build step for the scaffold |
| Web framework | **Hono** + `@hono/node-server` | Minimal, web-standard, first-class streaming |
| API docs | **`@hono/swagger-ui`** at `/docs` | Documents `X-Router-*` headers for testing |
| Config validation | **Zod** | Fail-fast schema validation of YAML + env |
| Config format | **YAML** (`yaml`) + `.env` (`dotenv`) | Env for secrets; YAML for catalog/strategies/server |
| Token counting | **`gpt-tokenizer`** | Pure-JS, offline; char-estimate fallback |
| Classifier call | **`openai`** SDK | Structured classifier call; base URL configurable |
| Forwarding | **global `fetch`** (undici) | Byte/stream relay without re-serialization |
| Telemetry | **OpenTelemetry** (`sdk-trace-node` + OTLP http) | Console + configurable OTLP |
| Tests | **vitest** | `app.request()`, stubbed `fetch`, injected fakes |
| Container | **Docker** (+ compose) | `node:20-slim`, runs `tsx` |

### Forwarding vs. classifier clients

- **Forward path** uses the global `fetch` for transparent streaming (relay the
  `ReadableStream` without parsing).
- **Classifier call** uses the `openai` SDK for convenient structured output; its base
  URL/model are configurable, so a Claude model via the OpenAI-compat endpoint can serve.

### Dependency injection for testability

`Router` accepts an injectable `analyze` function and `createApp(deps)` accepts an
injectable forwarder — so tests supply a stubbed classifier and a fake forwarder without
touching the network (invariant #1, and the bypass tent-pole #10).

### Auth, classifier config, OTel, keys

Same decisions as the Python branch: central provider keys + client bearer tokens from
`ROUTER_API_KEYS`; classifier model configured in `server.yaml`; OTel console + optional
OTLP; keys live in repo-root `.env`.

### Project layout

```
corgi-gateway/
├── docs/decisions/          # ADRs
├── package.json  tsconfig.json  vitest.config.ts
├── config/                  # server.yaml, models.yaml, strategies.yaml
├── src/
│   ├── index.ts             # entrypoint (serve + OTel bootstrap)
│   ├── app.ts               # Hono app factory (routes + Swagger UI)
│   ├── config.ts  types.ts  headers.ts  auth.ts  telemetry.ts  openapi.ts
│   ├── core/
│   │   ├── analysis.ts  router.ts  scoring.ts  constraints.ts  detect.ts
│   │   └── extractors/      # types.ts, rules.ts
│   └── providers/forwarder.ts
├── test/                    # vitest specs + helpers
├── Dockerfile  docker-compose.yml
```

## Consequences

**Positive**
- Web-standard streaming and JSON handling fit the proxy; strict TS guards the future IR.
- Swagger UI at `/docs` makes the proxy testable in-browser, headers included.
- Injectable deps keep tests hermetic and fast.

**Negative / accepted tradeoffs**
- Two HTTP paths (`fetch` for forwarding, `openai` SDK for the classifier) — deliberate.
- Running via `tsx` (no compiled artifact) is fine for a scaffold; a `tsc`/bundle build
  step is a later hardening task.
- `.js` import specifiers (Node-ESM correct) need a small vitest resolver to map to `.ts`.

## Follow-ups / TODO

- [ ] Add a production build (`tsc`/bundle) and run `node` instead of `tsx`.
- [ ] Wire OTel operational scores once telemetry is emitting.
- [ ] Build the canonical IR + native provider adapters (ADR 0001).

## Related

- [ADR 0001 — Multi-Provider Translation Strategy](0001-multi-provider-translation-strategy.md)
- [ADR 0002 — Router Header Contract](0002-router-header-contract.md)
- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md)
- [ADR 0005 — Offline ML as a Separate Module](0005-offline-ml-module.md)
