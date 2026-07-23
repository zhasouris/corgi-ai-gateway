# ADR 0018 — Base-Model Delta Report: Cost & Targeted-Accuracy KPIs

- **Status:** Accepted (implemented)
- **Date:** 2026-07-23
- **Context repo:** `corgi-ai-gateway`

## Context

A router's value is hard to state to an adopter. The status quo it replaces is concrete —
*"we just default to one model"* (e.g. `gpt-4.1-mini` everywhere) — and that default trades
away **cost** on the easy prompts and **accuracy** on the hard ones, but silently. The existing
eval harness ([spec](../eval-harness.md)) reports aggregate cost and a blended routing
accuracy, which doesn't answer the question a buyer actually asks: *vs. what I do today, what
did routing save, and where did it get sharper?*

Crucially those are **two different questions** and must not be blended into one score — a
router that is "10% cheaper" could be quietly dumber, and a single number hides it. The value
of routing is: **downgrade the easy** (save cost, lose no accuracy that matters) and **upgrade
the hard** (buy accuracy where it counts). Each half deserves its own KPI.

## Decision

**A base-model delta report: pick the status-quo default, diff every router pick against
always-base across `best`/`value`/`fast`, and report two distinct KPIs — cost and targeted
accuracy — never blended.** (`npm run eval:baseline`, [eval/src/baseline.ts](../../eval/src/baseline.ts).)

### 1. Classify each pick vs the base

Per prompt, compare the router's pick to always-base by **per-task competency** (ADR 0010):

- **upgrade** — router picked a more capable model (base was too weak here),
- **downgrade** — router picked a cheaper/weaker one (base was overkill),
- **forced-upgrade** — base *can't serve* the prompt at all (e.g. no vision on an image
  prompt) — the single-model app would have failed or mis-served it,
- **unchanged** — router agreed with base.

### 2. Two KPIs, reported separately

- **Cost** — total vs always-base (net %), split into cost Δ on downgrades vs upgrades.
  The routed total **includes the per-request classifier-call overhead** (ADR 0003) that
  always-base never pays — routing's fixed per-request tax, modeled from the classifier
  model's price and the prompt size. `best`/`value` pay it (the LLM classifier); `fast` uses
  the free heuristic signal ([ADR 0012](0012-classifier-latency.md)) and pays none. Leaving it
  out overstates the savings — and on trivial prompts the overhead can *exceed* what routing
  saves, which is exactly the kind of thing the KPI must not hide.
- **Targeted accuracy** — router − base, **segmented by whether the prompt needed accuracy**
  (hard, `complexity ≥ 0.5`) vs not. "Accuracy where you need it" is the headline: the mean
  delta on the hard, benchmark-relevant prompts. Conversation/chat prompts (no benchmark) are
  excluded from accuracy — they only ever move the cost KPI.

### 3. Three lenses on accuracy

Accuracy has no single ground truth offline, so three complementary lenses:

1. **Per-task competency** (0–1) — the ADR 0010 signal that already drives routing.
2. **Task-appropriate benchmark** (0–100) — the *right* benchmark for the detected task
   (SWE-bench Verified for coding, AIME for math, GPQA for reasoning, MMLU for knowledge, …),
   from [`model-scores.json`](../process/model-capability-scoring.md). The most tangible number
   — "on the coding prompts, base → routed went 24 → 89."
3. **LLM-judged** (opt-in, spends) — for a sample, generate the **base** and the **router's**
   answers and have a judge decide which is meaningfully better. This is the only lens grounded
   in real outputs; it **validates the offline proxies**. Directional to match the change:
   upgrades ask "did the stronger pick actually answer better?" (payoff); downgrades ask "did
   the cheaper pick lose quality?" (safety). Reuses [judge.ts](../../eval/src/judge.js).

Lenses 1–2 run in the hermetic dry-run; lens 3 is gated behind `--judge N` (real model calls).

### 4. The base sets the story

The report is only meaningful relative to a chosen default, and the choice is the point:

- a **weak** default (`gpt-4.1-mini`) shows the router is cheaper **and** sharper almost
  everywhere — the default left both on the table;
- a **strong** default (`o3`) shows large savings with a small, *measured* accuracy give-up on
  hard prompts — the exact trade-off, made visible (and it says: if those points matter, use
  `best`, not `value`).

## Consequences

**Positive**

- States routing's value as an adopter frames it: cost saved and accuracy-where-you-need-it,
  as independent numbers that can't hide each other.
- The judged lens keeps the offline proxies honest — a cheap, deterministic dry-run for CI,
  validated against real outputs on demand.
- Reuses the whole stack (router, competency, `model-scores.json`, judge) — thin new surface.

**Negative / accepted trade-offs**

- **Competency and the task-benchmark lens share a source** (`model-scores.json`), so they
  largely agree; they are two *views* (0–1 vs raw points), not independent evidence. The judge
  is the independent one.
- **The benchmark lens uses the category aggregate**, not the single raw benchmark value
  (those were not emitted into `model-scores.json`); regenerating it with per-benchmark raws
  would sharpen lens 2 but is null-heavy for the 2026 flagships.
- **Absolute cost is illustrative** — the catalog's `cost_per_1k_*` fields hold per-1M values
  (legacy naming), so the report's dollar figures are on a fixed scale; the **ratios/percentages
  are the meaningful output**.
- **The judged lens spends** and is noisy (judge variance), so it runs on a sample, opt-in.
- **`complexity ≥ 0.5` as "needs accuracy"** is a heuristic threshold; a poorly-labeled hard
  prompt lands in the wrong segment.

## Follow-ups / TODO

- [x] Cost + competency + task-benchmark lenses; upgrade/downgrade/forced classification.
- [x] Include the per-request classifier-call overhead in the routed cost (routing's tax).
- [x] LLM-judged lens (`--judge N`), base-vs-router, directional per change type.
- [ ] Emit per-benchmark raw scores into `model-scores.json` to sharpen lens 2.
- [ ] Larger, difficulty-labeled dataset so the hard/easy segmentation is robust.
- [ ] Fix the `cost_per_1k_*` per-1M naming so absolute costs read true (separate cleanup).

## Related

- [ADR 0010 — Per-Task Competency](0010-per-task-competency-scores.md) (the accuracy signal)
- [ADR 0017 — Frontier-Then-Optimize Strategies](0017-frontier-then-optimize-strategies.md) (best/value/fast)
- [Eval harness spec](../eval-harness.md) · [model scoring process](../process/model-capability-scoring.md)
