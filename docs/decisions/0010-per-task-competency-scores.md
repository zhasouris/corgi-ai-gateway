# ADR 0010 — Per-Task Model Competency Scores

- **Status:** Proposed (plan; not yet implemented)
- **Date:** 2026-07-22
- **Context repo:** `corgi-gateway`

## Context

The catalog describes a model's strength with a single scalar, `tier: 1..5`, and the scoring
engine uses it bluntly. `taskTypeRule` scores `model.tier × signal.value`, where the signal
is `1` for a "hard" task (coding, math, reasoning, analysis) and `0` otherwise. So the router
knows only **hard vs. not hard** — never *which* hard task.

That throws away the most useful thing about a multi-vendor catalog: models are not
uniformly better or worse, they are **differently** better. A model that leads on code
generation may trail on mathematical reasoning; a cheap model may be entirely adequate at
summarisation while being hopeless at multi-step proofs. Collapsing that into one number
means the router systematically overpays on tasks where a cheaper model is genuinely
competitive, and under-serves tasks where an expensive model is only *nominally* stronger.

The mechanism to fix this is trivial — a vector instead of a scalar. **The data is the whole
problem**, and this ADR is mostly about the data.

## Decision

**Competency is a sparse, provenanced override layer on top of `tier` — seeded from public
benchmarks and corrected by our own telemetry.**

### 1. Where the numbers come from

Three sources were considered:

| Source | Available | Honest | Decays |
|---|---|---|---|
| Public benchmarks (SWE-bench, HumanEval, MATH, MMLU, …) | now | measures the vendor's claim, not your traffic | fast, silently |
| Own telemetry (ADR 0005) | no — needs outcome labels | yes | self-correcting |
| **Benchmark-seeded, telemetry-corrected** | **now** | **improves over time** | **visible** |

We take the third. Benchmarks give a usable starting point today; telemetry replaces them
entry by entry as real outcome data accumulates. Nothing is blocked on the ML work, and
nothing stays permanently dependent on a leaderboard.

### 2. Sparse, not dense

A dense matrix is 32 models × ~6 tasks ≈ **190 hand-maintained numbers**, and adding a 33rd
model would mean filling six cells before it could be routed to at all. So:

- `task_scores` are **optional per model and per task**.
- A missing entry falls back to the model's `tier`, normalised to the same 0..1 scale.
- Adding a model with no competency data therefore changes nothing about how it is treated.

### 3. A separate, provenanced file

Competency lives in **`config/competency.yaml`**, keyed by model id — not inline in
`models.yaml`. That keeps the catalog readable, and more importantly it makes **staleness
visible** rather than implicit:

```yaml
models:
  claude-sonnet-5:
    coding:    { score: 0.94, source: "SWE-bench Verified", updated: 2026-06-01 }
    math:      { score: 0.81, source: "MATH-500",           updated: 2026-06-01 }
  gpt-4.1-nano:
    coding:    { score: 0.55, source: "telemetry:judge",    updated: 2026-07-18 }
```

`source` and `updated` are **required** on every entry. An entry with no provenance is a
number someone invented, and there is no way to tell later.

### 4. How it scores

Rather than add a ninth rule, the existing `task_type` rule is refined: it uses the
competency score for the detected task when one exists, and a tier-derived value otherwise.

```
scoreModel(model, signal) =
  competency(model, signal.task)          // 0..1, if present
  ?? model.tier / MAX_TIER                // 0..1, fallback
```

Adding a *separate* competency rule instead would double-count quality — a strong model
would collect both the tier bonus and the competency bonus — and would require retuning
every strategy's weights. Refining the existing rule keeps `config/strategies.yaml` valid
as written.

The rule is marked **`fixedScale: true`** ([ADR 0003](0003-rule-and-scoring-engine.md)).
Competency is an absolute judgement: `0.95` means "excellent at this", not "the best of
whatever happens to be in this candidate set". Min-max normalising it would stretch a
0.95-vs-0.93 difference to fill the whole range and make near-equals look decisive — the
exact bug fixed for `reasoning_depth`.

### 5. Degraded signal falls back to tier

Competency is only as good as the `taskType` signal. When the signal provider is degraded,
or the task is `unknown`, the rule uses the tier fallback rather than a competency score for
a task we are not confident about.

## Consequences

**Positive**

- Genuinely better selection: a cheap model that is strong at summarisation stops being
  passed over on tier alone, and an expensive model stops winning tasks it is only
  nominally better at.
- Sparse and additive — no flag day, no retuning, no change for models without data.
- Provenance makes the weakest part of the design *inspectable*: you can ask when a number
  was last true and where it came from.
- The telemetry path means the catalog gets more accurate with use rather than less.

**Negative / accepted trade-offs**

- **A new maintenance surface that decays quietly.** Even sparse, this is a table of numbers
  that were true on a date. `source`/`updated` make decay visible; they do not prevent it.
- **Benchmarks are gamed and saturated.** Seeding from them imports their bias, including
  vendors optimising for the benchmark rather than the task.
- **It amplifies dependence on `taskType`** — see the blocking prerequisite below. Routing
  by task competency when the task label is wrong is worse than not routing by task at all,
  because the error is confident and specific rather than coarse.
- **Refining `task_type` changes scoring for every model**, including those with no
  competency data, because the rule moves from `tier × signal` (min-max) to a 0..1 fixed
  scale. That must be measured before and after, exactly as the `fixedScale` change was.

**Blocking prerequisite**

This must not ship before the `taskType` signal is trustworthy.
[TODO item 4](../TODO.md) records that the heuristic provider labels *"Write a thread-safe
LRU cache in Rust"* as `taskType: conversation`. Competency scoring built on that label
would confidently select the best **conversation** model for a systems-programming question.
The heuristic is also the degraded fallback when the classifier is unavailable, so this is
not merely an eval-harness concern.

## Follow-ups / TODO

- [ ] Fix `taskType` detection in the heuristic provider (**blocking**, TODO item 4).
- [ ] `config/competency.yaml` schema + Zod validation; fail fast on a missing `source`/`updated`.
- [ ] Agree the task taxonomy. It must match the classifier's `taskType` values exactly, or
      entries silently never match.
- [ ] Refine `taskTypeRule` to the competency-or-tier form; mark `fixedScale`.
- [ ] Seed competency for the highest-traffic models only — resist filling the matrix.
- [ ] Before/after eval run, since this changes scoring for every model (see ADR 0003).
- [ ] Surface competency and its provenance in `/v1/router/explain` and the demo, so a
      decision can be traced to the number that drove it.
- [ ] Telemetry correction loop: outcome labels → per-task scores (ADR 0005).
- [ ] Staleness report: warn on entries older than N months.

## Related

- [ADR 0003 — Rule & Scoring Engine](0003-rule-and-scoring-engine.md) (`fixedScale`, rule contract)
- [ADR 0005 — Offline ML Module](0005-offline-ml-module.md) (the telemetry correction path)
- [ADR 0011 — Lexicographic Tie-Break](0011-lexicographic-tie-break.md) (what to do when
  competency scores come out near-equal)
- [TODO item 4](../TODO.md) (the blocking `taskType` weakness)
