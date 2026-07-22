# ADR 0012 — Reducing Classifier Latency on the Hot Path

- **Status:** Proposed (plan; not yet implemented)
- **Date:** 2026-07-22
- **Context repo:** `llm-model-router`

## Context

`X-Router-Duration-Ms` ([ADR 0002](0002-router-header-contract.md)) reports the time the
router spends deciding, excluding the upstream call. Measured across a normal day's traffic
on this deployment:

| Path | Duration |
|---|---|
| Bypass (routing skipped entirely) | **0–2 ms** |
| Routed, LLM classifier | **802 / 947 / 1199 / 1433 / 1947 / 2081 ms** |

The gap is the whole story. Detection, constraint filtering, scoring and tie-breaking are
local work over a 33-model catalog and cost **under a millisecond** — the bypass figure is
effectively a measurement of everything *except* the classifier. So the router's overhead is
not "the pipeline", it is **one network round trip to a language model**, on the critical
path of every non-bypass request.

That cost is worth paying when it buys a better decision. It is worth reducing wherever it
buys nothing, and there are several places where it currently buys nothing at all:

- The same prompt is re-classified from scratch every time. There is no cache.
- The classifier response is a five-field JSON object of roughly 40 tokens, but no
  `max_tokens` is set, so nothing bounds generation (`src/core/signal.ts`).
- A new `OpenAI` client is constructed inside `analyze()` on every request rather than once.
- A request that explicitly asked for `X-Router-Strategy: latency` still pays ~1s to be
  classified — which can exceed the latency difference between the models being chosen
  between.

This also lands on the public demo, where the classifier round trip *is* the page's
perceived speed.

## Decision

**Attack it in four layers, cheapest and safest first. Do not trade signal quality for
speed without the eval harness arbitrating.**

### Layer 1 — Free wins (no quality trade)

1. **Cache classifications.** Key on a hash of the truncated prompt text. At
   `temperature: 0` an identical input cannot legitimately produce a different
   classification, so a cache hit is not an approximation — it is the same answer, sooner.
   TTL'd and bounded.
2. **Set `max_tokens`** (~80). The schema is small and fixed; generation time scales with
   tokens produced.
3. **Construct the client once.** Configuration cannot change per request.

### Layer 2 — Configuration trade-offs (measure, don't assume)

4. **Point the classifier at a faster model.** `classifier.provider` / `classifier.model`
   are already pluggable in `server.yaml`. A 200 ms class model in place of a ~900 ms one
   removes most of the remaining cost. **This is a quality trade**: today's judged eval
   showed that weak signals cost accuracy directly — both under-routes in the 12-prompt set
   were prompts the *heuristic* mis-read ([TODO item 4](../TODO.md)). Any swap must be
   validated with `npm run eval:judge` before and after, not argued from latency alone.
5. **Reduce `max_input_chars`** from 8000. Complexity and task type are usually settled by
   the first paragraph; fewer prompt tokens means a faster time-to-first-token. A/B against
   the eval set.
6. **Lower `timeout_seconds`** from 8. This does not improve the median at all — it bounds
   the tail. Eight seconds is a long time to wait before falling back to a heuristic that
   would have answered instantly.

### Layer 3 — Let the caller opt out

7. **A signal-selection header**, e.g. `X-Router-Signal: heuristic`, and/or automatically
   skipping the LLM classifier for `strategy: latency`. Spending ~1 s of wall clock to
   choose between models whose latencies differ by a few hundred milliseconds is
   self-defeating; the caller is better placed than we are to make that call, and the header
   contract already exists to express it.

### Layer 4 — Take it off the hot path entirely

8. **Classify asynchronously.** Route immediately on deterministic signals, run the
   classifier in the background, and use the result to inform *subsequent* decisions rather
   than the current one. Router overhead collapses to ~1 ms.

   The cost is real: the first request of a given shape is routed on heuristics, which today
   are demonstrably weaker. This only becomes attractive once there is a mechanism to
   accumulate and reuse that signal — which is precisely what the offline module in
   [ADR 0005](0005-offline-ml-module.md) is for. Recorded here as the endgame, not as
   something to build next.

## Consequences

**Positive**

- Layers 1 and 3 reduce latency with no effect on routing quality whatsoever.
- Every change is directly observable: `X-Router-Duration-Ms` already reports exactly the
  quantity being optimised, so before/after needs no new instrumentation.
- Caching also cuts classifier *spend*, which on the public demo is the only cost the
  deployment can incur.
- The layered order means the risky changes are only reached if the free ones prove
  insufficient.

**Negative / accepted trade-offs**

- **A cache can serve a stale classification** if the catalog or classifier model changes
  underneath it. The key should incorporate classifier model and prompt version so a config
  change invalidates rather than lingers.
- **Layer 2 trades accuracy for speed**, and the evidence that this is a real risk is
  already in hand rather than hypothetical.
- **Layer 3 lets callers silently opt into worse routing**, and a header that makes things
  faster will get set by default in someone's client wrapper and never revisited.
- **Layer 4 changes the semantics of a routing decision** — from "informed by this request"
  to "informed by requests like it". That is a different product, and should be an ADR of
  its own if seriously pursued.

## Follow-ups / TODO

- [ ] Classification cache keyed on `(hash(truncated prompt), classifier model, prompt version)`.
- [ ] `max_tokens` on the classifier call; hoist the client to the constructor.
- [ ] Record classifier duration as its own span attribute so it can be separated from total
      routing time in Application Insights ([ADR 0008](0008-observability.md)).
- [ ] Benchmark alternative classifier models on **both** latency and judged accuracy.
- [ ] Sweep `max_input_chars` (8000 → 2000 → 1000) against the eval set.
- [ ] `X-Router-Signal` header (ADR 0002 contract update).
- [ ] Decide whether `strategy: latency` should imply heuristic signals by default.

## Related

- [ADR 0002 — Router Header Contract](0002-router-header-contract.md) (`X-Router-Duration-Ms`,
  and where a signal-selection header would live)
- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md) (the `SignalProvider` seam)
- [ADR 0005 — Offline ML Module](0005-offline-ml-module.md) (what makes Layer 4 viable)
- [ADR 0006 — Leveraging Learned Routing](0006-leveraging-learned-routing.md) (RouteLLM is a
  signal provider too, and has its own latency profile)
- [ADR 0008 — Observability](0008-observability.md) (measuring the improvement)
