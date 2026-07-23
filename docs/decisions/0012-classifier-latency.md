# ADR 0012 — Reducing Classifier Latency on the Hot Path

- **Status:** Partially accepted — Layer 3 (per-strategy signal selection) implemented; Layers 1, 2, 4 proposed
- **Date:** 2026-07-22
- **Context repo:** `corgi-gateway`

## Context

`X-Router-Duration-Ms` ([ADR 0002](0002-router-header-contract.md)) reports the time the
router spends deciding, excluding the upstream call. Measured across a normal day's traffic
on this deployment:

| Path | Duration |
|---|---|
| Bypass (routing skipped entirely) | **0–2 ms** |
| Routed, heuristic signal | **~0–2 ms** (deterministic, no network) |
| Routed, RouteLLM sidecar | **~250 ms** (container-to-container) |
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

### Layer 3 — Choose the signal provider per strategy — **implemented**

7. **The `latency` strategy no longer uses the LLM classifier.** Spending ~1 s to choose
   between models whose latency differs by a few hundred ms is self-defeating — and
   `latency` weights the classifier-derived signals at only 0.3–0.5 (the deterministic
   `latency` rule dominates at 3.0), so the expensive call barely moves the result. It now
   uses a fast provider instead:

   - **RouteLLM (~250 ms)** when a sidecar is configured — a real trained difficulty signal,
   - **the offline heuristic (~0 ms)** otherwise (e.g. an inspector-only deployment with no
     sidecar) — never the classifier.

   The mechanism is a per-strategy override on the `SignalProvider` seam: the `Router` takes
   an optional `{ strategy → analyzeFn }` map and falls back to the default for any strategy
   not listed. Every other strategy keeps the classifier, where complexity/reasoning carry
   real weight. `signalProvider` is surfaced in `/v1/router/explain` and the demo so a
   decision can be traced to the signal that produced it.

   > **Measurement correction.** An earlier draft of this ADR reported RouteLLM at ~2.2 s and
   > concluded it was too slow for this path. That number was a **Windows Docker Desktop
   > artifact** — measured through the published host port, whose vpnkit proxy adds ~2 s per
   > connection. The path the router actually uses is container-to-container over the Docker
   > network, measured at **~250 ms** (the win-rate computation itself is 0.16–0.39 s, and
   > `/score` from inside the container is ~0.2 s). RouteLLM is a *fast* signal source, ~4×
   > quicker than the classifier; the sidecar never needed fixing. The lesson is banked in
   > the negatives below: benchmark the path production takes, not the one that is convenient
   > to `curl`.

   A future refinement — a per-request `X-Router-Signal: heuristic` header — remains open, so
   a caller can force the fast path on any strategy. The header contract (ADR 0002) already
   has room for it.

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
- **Layer 3 changes routing for `latency` requests**: a different signal provider can rank
  differently. In practice the change is small because `latency` down-weights those signals,
  but it is a real behaviour change and belongs in the eval before/after, not asserted.
- **Measure the path production takes.** RouteLLM was nearly written off as ~2.2 s when the
  real figure was ~250 ms — the 2.2 s was a Windows host port-forward artifact. A convenient
  benchmark measured the wrong hop. Any future latency claim must be taken on the
  container-to-container / in-process path, never through Docker Desktop's published port.
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
- [x] Per-strategy signal selection; `latency` → RouteLLM (if configured) or heuristic,
      never the classifier. Surfaced as `signalProvider` in explain + demo.
- [ ] `X-Router-Signal` header for per-request override (ADR 0002 contract update).
- [ ] Benchmark RouteLLM vs. the classifier on judged accuracy — if RouteLLM's ~250 ms
      signal is close, it is a candidate to become the default provider everywhere, not just
      for `latency` (ties into the open [ADR 0006](0006-leveraging-learned-routing.md) shadow-eval).

## Related

- [ADR 0002 — Router Header Contract](0002-router-header-contract.md) (`X-Router-Duration-Ms`,
  and where a signal-selection header would live)
- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md) (the `SignalProvider` seam)
- [ADR 0005 — Offline ML Module](0005-offline-ml-module.md) (what makes Layer 4 viable)
- [ADR 0006 — Leveraging Learned Routing](0006-leveraging-learned-routing.md) (RouteLLM is a
  signal provider too, and has its own latency profile)
- [ADR 0013 — RouteLLM Sidecar Transport](0013-routellm-sidecar-transport.md) (why RouteLLM's
  ~250 ms is the embedding call, not the transport — and why a CLI would not help)
- [ADR 0008 — Observability](0008-observability.md) (measuring the improvement)
