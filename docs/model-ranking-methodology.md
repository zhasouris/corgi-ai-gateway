# Model Ranking Methodology

How this project decides **how good a model is** — the capability signal the router
ranks on. It is benchmark-seeded, provenanced per number, and deliberately honest about
where it is thin. Nothing here is a vibe: every score traces to a cited source and date,
and where the web turned up nothing we store `null` rather than guess.

This article is the *why*; the maintainer runbook (how to regenerate) is
[`docs/process/model-capability-scoring.md`](process/model-capability-scoring.md), and the
research prompt is [`docs/prompts/model-capability-ranking.md`](prompts/model-capability-ranking.md).

---

## Two signals, one source

The router reads two capability signals off each model, both distilled from the same
benchmark inventory:

| Signal | Range | What it means | Where it lives |
| --- | --- | --- | --- |
| **`quality`** | 0–1 | overall capability composite | `config/models.yaml` ([ADR 0019](decisions/0019-continuous-capability-and-difficulty-scaled-competency.md)) |
| **`competency`** | 0–1, sparse per task | how good at *this task type* | `config/competency.yaml` ([ADR 0010](decisions/0010-per-task-competency-scores.md)) |

Both come from [`docs/process/model-scores.json`](process/model-scores.json) — a static
inventory of per-category benchmark scores, a composite, cost, and a `source`/`confidence`
on every value.

## 1. Sourcing the benchmarks

The inventory is produced by an AI analyst **with web access**, fanned across parallel
per-vendor agents running the [generation prompt](prompts/model-capability-ranking.md). Its
ground rules are the methodology:

- **Search the web for every number — never memory.** Priority sources: the vendor's own
  model/pricing pages (context window, max output, price), then aggregators (Artificial
  Analysis, Epoch AI, Stanford HELM, LMArena, HF Open LLM Leaderboard, llm-stats), then the
  original benchmark paper/leaderboard (MMLU, GPQA, SWE-bench, AIME, …).
- **Record provenance on every value** — a `source` and a `confidence` of `verified` (found on
  a cited page) or `estimated` (inferred/interpolated).
- **`null`, never a silent guess.** A score with no source found is left null and excluded from
  the math.
- **Same benchmark variant across models** wherever possible (all MMLU-Pro, or all standard
  MMLU), with any differing test conditions noted in `benchmark_notes`.

## 2. From benchmarks to a number

- **Per-category score** = the **mean of the available normalized (0–100) benchmarks** for that
  category (e.g. `coding` blends SWE-bench Verified + LiveCodeBench).
- **Composite** = a **weighted average of the available categories**, weights
  `reasoning 0.25 · coding 0.25 · math 0.15 · knowledge_qa 0.15 · instruction_following 0.10 ·
  long_context 0.10`. Any **missing** category's weight is redistributed across the ones present,
  and the composite is flagged `partial: true` so a null-heavy model is never mistaken for a
  fully-measured one.
- The benchmark **categories *are* the router's task taxonomy** — aligned 1:1 on purpose
  ([ADR 0010](decisions/0010-per-task-competency-scores.md)) so a category score maps directly to
  a `competency` for the detected task with no lossy re-mapping.

## 3. How the router ranks per request

The ranking is **per request**, not a fixed leaderboard. The quality-family rules — `complexity`
(tilts `quality` by difficulty), `reasoning_depth`, `task_type` (per-task `competency`), and
`data_sensitivity`, but **not** cost or latency — sum to a capability score **`Q`**
([ADR 0017](decisions/0017-frontier-then-optimize-strategies.md),
[ADR 0019](decisions/0019-continuous-capability-and-difficulty-scaled-competency.md)):

- **Continuous `quality`** makes `Q` distinct *within* a tier — the ranking no longer collapses
  to a handful of tier constants.
- **Difficulty scaling**: an easy prompt barely separates models (wide frontier → a cheap model
  is "good enough"); a hard prompt widens the spread (narrow frontier → the strong model is
  reserved). Competency's influence likewise shrinks toward neutral on easy prompts, so a trivial
  task in a hard class doesn't reserve the best-at-task model.
- The strategy then optimises cost or latency **within** that frontier, and `X-Router-Reason`
  names the runner-up and the deciding attribute so the pick is legible.

## 4. Limitations — read before trusting a number

These are **called out, not hidden**:

- **Cross-vendor comparison is approximate.** Vendors publish different benchmark variants
  (agentic SWE suites vs. classic academic sets, differing MRCR needle counts), so a category
  score is comparable *within* a vendor family more than across.
- **Saturation / contamination.** MMLU/HumanEval-class suites may be saturated or contaminated;
  treat near-ceiling scores with suspicion.
- **Partial composites read high.** Several 2026 flagships publish few classic benchmarks, so
  their composite averages only the (often best) reported categories — `partial: true` flags this.
- **Tier fallback can beat proven specialists.** A model with a high `tier` but no competency for a
  task falls back to `tier / MAX_TIER`, which can out-rank a measured specialist. Seed the data to
  fix it.
- **Some values are `estimated`, not `verified`.** Check the `confidence` field before leaning on
  one number.

The honest summary: this is a **defensible, provenanced starting point — directional, not
authoritative.** Because it is all config, correcting it is an edit, and live telemetry-corrected
scores ([ADR 0005](decisions/0005-offline-ml-module.md)) override benchmark-seeded ones over time.

## 5. Regenerating

Re-run the [prompt](prompts/model-capability-ranking.md) with web access, save
`docs/process/model-scores.json`, distill to `competency.yaml` (`score = category/100`, keyed by
catalog model id) and inject `quality` (`composite/100`) into `models.yaml`, then `npm test`. Full
steps and caveats: [`docs/process/model-capability-scoring.md`](process/model-capability-scoring.md).
