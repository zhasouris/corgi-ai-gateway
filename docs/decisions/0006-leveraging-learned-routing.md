# ADR 0006 — Leveraging Learned Routing (RouteLLM) as a Signal Provider

- **Status:** Accepted
- **Date:** 2026-07-20
- **Context repo:** `llm-model-router`
- **Graduates:** [discussion — learned routing & cascade](../discussions/learned-routing-and-cascade.md)

## Context

We evaluated adopting open-source learned routers ([RouteLLM](https://github.com/lm-sys/routellm),
[LLMRouter](https://github.com/ulab-uiuc/LLMRouter)). Findings (see the discussion note):

- RouteLLM's decision is **trained and empirically validated**; its recommended `mf`
  router makes **no generative LLM call at decision time** (cheap).
- But it is **binary** (strong vs. weak) and **Python**, while our engine is **N-model,
  multi-provider, multi-signal** and (on `main`) **TypeScript**.
- Our routing intelligence is **unvalidated** (hand-tuned weights, a generic classifier
  prompt) and pays a **per-request LLM tax** for that classifier.

The question this ADR settles: *how* do we leverage a learned router without giving up the
gateway's value or trusting it on faith.

## Decision

Leverage RouteLLM (and, later, alternatives) as a **learned signal provider behind a
stable internal contract** — not as "the router," and not bolted on directly.

1. **Signal, not decision.** RouteLLM supplies a trained **difficulty signal** (its
   win-rate). Our N-model weighted scorer keeps ownership of the final model choice across
   the full catalog (cost/latency/capability/provider). We keep the chassis; it supplies a
   better engine input.

2. **A versioned `SignalProvider` contract.** Define an internal interface
   `SignalProvider.score(prompt) → { winRate, confidence, version }`. RouteLLM is one
   *implementation*. This decouples the proxy from RouteLLM's API and lets us later swap in
   LLMRouter, a self-trained model, or the offline-retrained artifact
   ([ADR 0005](0005-offline-ml-module.md)) **without touching the proxy**.

3. **Co-located Python sidecar.** RouteLLM runs as a small FastAPI service (wrapping its
   `Controller`, `mf` router) co-located with the proxy to minimize the hop. The TS proxy
   calls it from the `analyze` stage via the `SignalProvider` contract.

4. **Replace the per-request classifier on the fast path.** The RouteLLM signal replaces
   our `gpt-4.1-nano` classifier call for the common case, removing the LLM tax. The LLM
   classifier is **demoted to opt-in escalation only** (and only if later proven — see
   open question below).

5. **Shadow-eval before promotion.** We do **not** trust it on faith. It runs in **shadow
   mode** first (compute both the RouteLLM and classifier signals, log both with outcomes,
   act on neither) and is promoted only once the eval harness shows it is at least as good
   *and* cheaper on representative traffic.

6. **Prerequisite: the evaluation harness.** Steps 3–5 depend on the harness (spec:
   [`../eval-harness.md`](../eval-harness.md)). It is the first thing we build.

## Sequencing

1. Build the **eval harness** (dry-run decisions + cost; then live quality).
2. Stand up the **RouteLLM sidecar** (`mf`) behind `SignalProvider`; add a `RouteLLMRule`;
   run **shadow**.
3. **Promote** RouteLLM to the default difficulty signal if it wins; demote the classifier.
4. Add a **cascade/confidence gate** only if shadow data shows an ambiguous band worth
   escalating (escalation target still open — see below).
5. **Offline loop:** calibrate/retrain on our telemetry; export the artifact the sidecar
   loads (ADR 0005).

## Open questions (deliberately deferred, not decided here)

- **Cascade escalation target.** If we add a confidence gate, does the unconfident branch
  go to the strong model directly, a heavier RouteLLM router (`causal_llm`), or the LLM
  classifier? Decide only after shadow-eval — escalating to the *unvalidated* classifier
  on the hardest cases is suspect.
- **Fast-path signal completeness.** RouteLLM covers difficulty only; task-type/sensitivity
  are absent when we skip the classifier. Decide whether difficulty-only fast-path routing
  is acceptable or whether cheap deterministic backfill is needed.

## Consequences

**Positive**
- Removes the per-request LLM tax for the common case.
- Gains a trained, validated difficulty signal while keeping N-model/multi-provider routing.
- The `SignalProvider` contract keeps us uncoupled from any single vendor/library.
- Additive: slots behind the existing `FeatureRule` seam; scoring/forwarding unchanged.

**Negative / accepted tradeoffs**
- Reintroduces Python into the request path as a sidecar (isolated; co-located to limit
  latency; pulls HuggingFace weights).
- Real benefit is unproven until the eval harness confirms it (hence shadow mode).

## Related

- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md)
- [ADR 0005 — Offline ML as a Separate Module](0005-offline-ml-module.md)
- [Eval-harness spec](../eval-harness.md)
- [Discussion — learned routing & cascade](../discussions/learned-routing-and-cascade.md)
