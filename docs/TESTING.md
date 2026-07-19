# Testing Strategy

Living checklist of the rules the test suite holds to. Rationale for the hermetic +
deterministic-core approach is in the ADRs (0001–0005). Tests use **vitest**.

## Ground rules (how we test)

1. **Hermetic** — no real network, no real LLM calls, no real keys. Stub the upstream
   `fetch` and inject a stubbed `analyze` (the classifier wrapper) / fake forwarder.
2. **The pure core is deterministic and tested in isolation.** Feature extraction +
   constraint filtering + weighted scoring are pure functions tested with the classifier
   output and runtime signal injected as fixtures.
3. **Three tiers, separated by concern:** pure (extractors/constraints/scoring) →
   pipeline (`Router` with stubbed analyze) → endpoint (`app.request()` with fake forwarder).
4. **Config is fixtures**, never the real catalog files (see `test/helpers.ts`).

## Invariants (what we assert)

### Constraint filtering (safety)
5. A model failing a hard constraint is **never** selected — across **all** strategies.
6. Context-window fit: request exceeding `input + expectedOutput` is filtered; test the boundary.

### Scoring & strategy
7. Each strategy biases as advertised (cost→cheapest viable, quality→strongest,
   latency→fastest, balanced→between); table-driven golden cases.
8. Normalization bounded to `0..1` for all inputs incl. edge cases; raw kept in metadata.
9. Ties break deterministically (lower blended cost, then id).

### Bypass & header contract
10. `X-Router-Bypass: true` short-circuits routing **and never calls analyze/the classifier**.
11. `X-Router-*` control headers are stripped before forwarding upstream.
12. `X-Router-Model` / `X-Router-Reason` always present on routed responses.
13. Unknown strategy fails soft → falls back to default + sets `X-Router-Warning`; never 400.

### Passthrough fidelity
14. Request body forwarded unchanged except `model`.
15. Streaming is relayed incrementally, not buffered; `[DONE]` passes through; stream ends cleanly.

### Graceful degradation
16. Classifier failure never 500s the client — degrades to deterministic-only scoring.
17. Provider error → failover to next-best; total failure returns an OpenAI-shaped error.

### Config & auth
18. Malformed config fails fast at startup, not at request time.
19. Auth: missing/invalid bearer → 401; valid → through; disabled-mode works for local dev.

### Observability
20. OTel spans exist for analysis/scoring/forward with decision attributes; test via an
    in-memory span exporter.

## Tent-pole tests

The three that fail silently and expensively — keep these green above all:

- **#5** — constraint safety across all strategies (`test/constraintSafety.test.ts`)
- **#10** — bypass really bypasses the classifier (`test/bypass.test.ts`)
- **#15** — streaming actually streams (`test/streaming.test.ts`)
