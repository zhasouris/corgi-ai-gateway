# ADR 0005 — Offline ML as a Separate Telemetry-Fed Module

- **Status:** Accepted
- **Date:** 2026-07-19
- **Context repo:** `corgi-ai-gateway`

## Context

ADR 0003 leaves room for *learned* routing signal — historical model quality on
similar requests, and eventually a trained difficulty/expected-output model rather than
a per-request classifier LLM call. The open question was **where** that ML lives relative
to the request path.

Two ways it could go:

1. **Inline/online** — train or score models inside the runtime proxy. Pulls a data/ML
   stack into the hot path, couples the proxy's language/runtime to ML tooling, and adds
   latency and failure surface to every request.
2. **Offline/out-of-band** — the runtime only *emits telemetry* and *consumes* the
   artifacts ML produces (a scoring table, weights, a small exported model). All training
   and heavy evaluation happen in a separate module on the telemetry data.

## Decision

**ML capabilities are handled offline from the runtime, as a separate targeted module.**

- The **runtime proxy** stays lean: it makes routing decisions from the model catalog,
  the rule/scoring engine, and (optionally) a cheap classifier call. It emits rich
  telemetry (chosen model, reason, features, outcome, latency, cost, and any downstream
  quality signal) via OpenTelemetry (ADR 0003 operational scores, ADR 0004 OTel).
- A **separate offline module** consumes that telemetry to do the ML-heavy work:
  training difficulty/quality models, computing historical model-fit tables, running
  eval harnesses. It is not on the request path and can be written in whatever stack
  suits ML (almost certainly Python) regardless of the runtime's language.
- The offline module's **output is an artifact** the runtime loads as data — e.g. an
  updated scoring table, tuned strategy weights, or a small exported model behind the
  existing feature-rule interface. Loading it is a config/data change, not a code change.

This depends on **having enough telemetry** to learn from, which the OTel-everywhere
requirement is already accumulating.

## Consequences

**Positive**
- The runtime stays language-agnostic and light — no ML stack in the hot path, no added
  per-request latency or failure surface. This is part of why the runtime can be TypeScript
  even though the ML is Python.
- ML iterates on its own cadence against historical data; the runtime consumes results
  through the existing pluggable rule/catalog seam.
- Clean separation of concerns: serving vs. learning.

**Negative / accepted tradeoffs**
- Learned signal is **not real-time** — it lags telemetry collection and the offline
  training cadence. Acceptable: routing quality improves batch-over-batch, not instantly.
- Requires a telemetry pipeline / store and an artifact hand-off contract between the
  offline module and the runtime (to be specified when the module is built).

## Follow-ups / TODO

- [ ] Define the telemetry schema the offline module needs (features + outcome labels).
- [ ] Define the artifact contract (format + how the runtime loads a learned scorer).
- [ ] Decide the downstream quality signal (explicit feedback, heuristic, or eval score).

## Related

- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md)
- [ADR 0004 — Stack & Project Layout](0004-stack-and-project-layout.md)
