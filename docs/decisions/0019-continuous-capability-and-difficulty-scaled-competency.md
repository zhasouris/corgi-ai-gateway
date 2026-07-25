# ADR 0019 — Continuous Capability Index + Difficulty-Scaled Competency

- **Status:** Accepted (implementing)
- **Date:** 2026-07-25
- **Context repo:** `corgi-ai-gateway`

## Context

Capability score `Q` ([ADR 0017](0017-frontier-then-optimize-strategies.md)) was driven by a
`complexity` rule that scored models by their integer **`tier`** (`tier × (2·complexity − 1)`,
min-max normalized). Two problems followed:

1. **`Q` collapsed to a tier step-function.** For a low-complexity prompt with a generic
   `conversation` task type (the demo's own default), `task_type` is neutral and `complexity`
   is the only live quality signal — so `Q` took one of a handful of tier-derived constants and
   **seven models tied at exactly `2.25`**. A reviewer opening the ranked table sees a scorer
   that cannot separate seven candidates, and the actual pick (a 12× cost spread) falls to an
   unshown tie-break. This is the single most attackable thing in the routing story.

2. **Easy benchmark tasks over-routed.** `task_type` applied a model's full **competency** spread
   regardless of how hard the *specific* prompt was, so "solve x+7=12" — a `math` task — reserved
   a math-genius model even though any cheap model handles it.

The naive fix (swap `tier` for a continuous `quality` composite, min-max as before) un-tied the
scores but **broke the `value` economy invariant**: min-max always stretches the spread to fill
0..1, so the easy-prompt frontier stayed narrow and centred on the *lowest-quality* model — which
is not the *cheapest*. `value` got trapped on `command-r` ($0.75/1M) while `llama-3.1-8b` ($0.13)
missed the frontier by 0.003. Making `complexity` `fixedScale` fixed that but then let `task_type`
dominate, over-routing easy math to `o4-mini`. Each one-knob change traded one invariant for
another — the calibration is the point.

## Decision

**1. Continuous `quality` replaces integer `tier` in the capability rules.** A per-model
`quality` ∈ [0,1] (the benchmark **composite** from `docs/process/model-scores.json`, injected into
`config/models.yaml`) makes `Q` vary *within* a tier. Models without a `quality` value fall back to
`tier / MAX_TIER`, so the gold fixture (and any un-scored model) is unchanged.

**2. `complexity` is `fixedScale`, centred on 0.5:** `0.5 + (quality − 0.5)·(2·complexity − 1)`.
Because it is no longer min-max normalized, the **magnitude** of the spread is preserved: an easy
prompt barely separates models (small spread → **wide frontier** → `value`/`fast` reach a genuinely
cheap model), a hard prompt widens the spread (**narrow frontier** → strong model). min-max would
erase exactly this signal.

**3. `task_type` competency is scaled by difficulty:** `0.5 + (competency − 0.5)·complexity`. A
trivial prompt in a benchmark category no longer needs the best-at-task model, so the frontier
widens and `value` stays cheap; a hard prompt (`complexity → 1`) restores the full competency
spread and reserves the strong model.

## Consequences

- **The tie is gone.** The demo's default prompt now yields **33/33 distinct** capability scores.
- **`value` is economical again.** On the eval set it now runs **17% cheaper than always-strongest**
  (was −7%, i.e. it used to cost *more*); `best` tier-accuracy rose **27% → 53%**.
- **Every provable gold case still holds (17/17)** and the `value ≤ always-strongest` invariant passes.
- **Legibility** is covered by [P0.2](../../src/core/scoring.ts) — the reason names the runner-up and
  the deciding attribute (cost/latency), so a within-frontier pick is explained even where capability
  is close.
- **Provenance:** `quality` is derived deterministically from the same benchmark JSON that seeds
  `competency.yaml` (ADR 0010); re-run the injection when that file is regenerated.
