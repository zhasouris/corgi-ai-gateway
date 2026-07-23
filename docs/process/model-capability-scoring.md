# Process — Model Capability Scoring & Competency Merge

How we turn public benchmarks into the router's per-task **competency** signal
(ADR 0010), and how to regenerate it. This is the reusable runbook behind
[`config/competency.yaml`](../../config/competency.yaml) and
[`docs/process/model-scores.json`](model-scores.json).

## Pipeline

```
docs/prompts/model-capability-ranking.md   (the generation prompt)
        │  run by an AI analyst WITH WEB ACCESS (here: 6 parallel vendor agents)
        ▼
docs/process/model-scores.json             (static inventory: per-category 0-100 scores,
        │                                    composite, cost, sources, confidence, nulls)
        │  distill: category score / 100, category → taskType (1:1), add provenance
        ▼
config/competency.yaml                      (sparse 0-1 per-task scores, source + updated)
        │  loaded by src/config.ts onto each ModelDescriptor.competency
        ▼
task_type scoring rule (src/core/extractors/rules.ts)
        competency(model, task) ?? tier / MAX_TIER      (fixedScale)
```

The assembly from raw research → both files is deterministic
(`scratchpad/assemble.mjs` at generation time; keep a copy with the run).

## Category ↔ task alignment

The benchmark categories **are** the router's task taxonomy — they were aligned
deliberately (ADR 0010) so competency maps 1:1 with no lossy re-mapping:

| Benchmark category | taskType | Seed benchmarks |
|---|---|---|
| reasoning | `reasoning` | GPQA-Diamond, MMLU-Pro |
| coding | `coding` | SWE-bench Verified, LiveCodeBench |
| math | `math` | AIME, MATH |
| knowledge_qa | `knowledge_qa` | MMLU (SimpleQA where present) |
| instruction_following | `instruction_following` | IFEval, LMArena Elo (normalized) |
| long_context | `long_context` | RULER, MRCR |
| — | `conversation` | none — generic default, tier fallback |

Both classifiers emit these values: the LLM classifier system prompt
(`src/core/signal.ts` `CLASSIFIER_SYSTEM`) and the heuristic keyword detector.

## How scoring uses it

`taskTypeRule` (ADR 0010) is `fixedScale` and gated:

- `conversation`/unknown task → score `0` (neutral — quality isn't pushed toward
  big models on trivial chat, preserving the old `tier × hard` easy-prompt behavior).
- Any benchmark-eligible task → `competency[task]` if present, else `tier / MAX_TIER`.

Because it is an **absolute** judgement it is not min-max normalized (a 0.95 vs
0.93 gap must stay small, not fill the range).

## Regenerating

1. Run [`docs/prompts/model-capability-ranking.md`](../prompts/model-capability-ranking.md)
   with web access; list the catalog's model ids under CONFIGURE. Save the JSON to
   `docs/process/model-scores.json`.
2. Distill to `config/competency.yaml`: `score = category.score / 100`, keyed by
   **catalog model id** (not `model_name`), `source`/`updated` **required** per entry.
3. `npm test` (the gold suite runs against a fixed fixture with no competency, so it
   proves the tier-fallback path is unchanged) and re-probe the live catalog.
4. Bump each entry's `updated`. Telemetry-corrected entries (ADR 0005) override
   benchmark-seeded ones over time.

## Gaps & caveats (read before trusting a number)

These are **called out, not hidden** — the merge is honest about where it is thin.

1. **Null-heavy 2026 flagships.** Claude Opus 4.8 / Sonnet 5, Gemini 3.x, and Grok 4
   publish few classic benchmarks, so their competency is sparse (Opus: only
   `reasoning` + `coding`) and their `composite.partial = true`. A partial composite
   averages only the *reported* (often best) categories, so it reads high — Opus tops
   `by_composite` on 2 of 6 categories. Do not read composites as fully comparable.
2. **Tier fallback can beat proven specialists.** A model with a high `tier` but no
   competency for a task falls back to `tier / MAX_TIER`. Opus (tier 6, no `math`
   data) therefore scores `1.0` on `math` and can out-rank `grok-3-mini` (measured
   `math` 0.958) under `quality`. This is expected (Opus is strong at math in reality,
   just unpublished) but it is **tier-driven, not data-driven** — telemetry correction
   is the intended fix, and it only affects `quality` (cost/balanced still prefer the
   cheap specialist).
3. **`instruction_following` and `long_context` are weak as task types.** They are
   capability axes more than prompt kinds; the heuristic detects them by keyword only,
   and long-context is arguably better derived from input token count. Treat their
   routing as approximate.
4. **Cross-vendor scores are only approximate.** Benchmark variants differ (SWE-bench
   Verified vs Pro, AIME 2024 vs 2025, extended-thinking vs standard), and LMArena Elo
   was normalized slightly differently across research passes. Within-category
   cross-vendor comparison is soft.
5. **Catalog prices/context are NOT updated by this process.** The research found the
   live catalog's `cost`/`context` are placeholders that diverge from reality (e.g.
   Opus 4.8 is 1M-context at ~$5/$25, not the catalog's 200k / $15/$75). We changed
   only competency here; the real figures live in `model-scores.json` for a future
   reconciliation. Cost/latency/balanced routing still uses the catalog placeholders.
6. **Volatile endpoints.** DeepSeek `deepseek-chat`/`deepseek-reasoner` remap to
   `deepseek-v4-flash` on 2026-07-24 (scores pinned to V3.2-Exp / R1-0528); several
   xAI/Gemini catalog ids are already superseded. Cohere Command R/R+ scores are
   largely `estimated` (no modern suite published).

## Related

- [ADR 0010 — Per-Task Model Competency Scores](../decisions/0010-per-task-competency-scores.md)
- [ADR 0003 — Rule & Scoring Engine](../decisions/0003-rule-and-scoring-engine.md) (`fixedScale`)
- [docs/prompts/model-capability-ranking.md](../prompts/model-capability-ranking.md) (the generation prompt)
