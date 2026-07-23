# Model Capability Ranking — Generation Prompt

This is the prompt run (by an AI analyst with web access) to produce the static
`model-scores.json` capability inventory that seeds our routing quality signal.
Process and merge steps: see [docs/process/model-capability-scoring.md](../process/model-capability-scoring.md).
Do not edit the schema casually — the merge step parses it.

---

You are an AI benchmarking analyst. Your job is to produce a single, valid JSON
object that inventories a set of large language models and ranks them by
capability, using CURRENT data from the web.

## GROUND RULES
1. SEARCH THE WEB for every numeric value. Do not rely on memory. Prefer primary
   or authoritative aggregators in this priority order:
   (a) the model vendor's own model/pricing pages (for context window, max output
       tokens, and price per million tokens),
   (b) Artificial Analysis, Epoch AI, Stanford HELM, LMArena, Hugging Face Open
       LLM Leaderboard, Vellum, llm-stats.com (for benchmark scores),
   (c) the original benchmark paper/leaderboard (MMLU, GPQA, SWE-bench, AIME, etc.).
2. For EVERY value, record where it came from in `sources` and set a
   `confidence` of "verified" (found on a cited page) or "estimated" (inferred or
   interpolated). If a value cannot be found, use null — never guess silently.
3. Use the SAME benchmark variant across models wherever possible (e.g. all
   MMLU-Pro, or all standard MMLU) and state which variant in `benchmark_notes`.
   If models were measured under different conditions, note it.
4. Prices are USD per 1,000,000 tokens. If a model has tiered/context-dependent
   pricing, use standard tier and note it.
5. Output ONLY the JSON object. No prose before or after. It must parse with a
   strict JSON parser (no comments, no trailing commas).

## >> CONFIGURE — MODELS TO RANK
Rank the following models. If a listed model has been superseded, use its latest
stable version and note the exact version string you used.
[ e.g.
  - OpenAI GPT-5.x (flagship)
  - Anthropic Claude Opus / Sonnet (latest)
  - Google Gemini 2.x/3.x Pro
  - xAI Grok (latest)
  - Meta Llama (latest, open weights)
  - DeepSeek (latest)
  - Mistral (latest)
  - Qwen (latest)
]
If this list is empty, include the ~15 most capable generally-available models as
of today, spanning both closed and open-weight vendors.

## >> CONFIGURE — COMPOSITE WEIGHTS
Compute each model's composite score (0–100) as a weighted average of its
per-category scores using these weights (they must sum to 1.0):
  reasoning:      0.25
  coding:         0.25
  math:           0.15
  knowledge_qa:   0.15
  instruction_following: 0.10
  long_context:   0.10
Normalize every underlying benchmark to a 0–100 scale before averaging. If a
category has no available benchmark for a model, redistribute that category's
weight proportionally across the model's remaining categories and set
`composite.partial` to true for that model.

## TASK-TYPE CATEGORIES → SUGGESTED BENCHMARKS
  reasoning:              GPQA Diamond, MMLU-Pro, BIG-Bench Hard, ARC-AGI
  coding:                 SWE-bench Verified, LiveCodeBench, HumanEval, Aider
  math:                   AIME, MATH, GSM8K
  knowledge_qa:           MMLU, SimpleQA, GPQA
  instruction_following:  IFEval, MT-Bench, LMArena (Elo, normalized)
  long_context:           MRCR, RULER, LongBench, needle-in-a-haystack
Use whichever are currently reported; list what you used per category.

## OUTPUT SCHEMA (produce exactly this shape)
{
  "meta": {
    "generated_on": "YYYY-MM-DD",
    "methodology": "one-paragraph summary of how scores were sourced and composite computed",
    "composite_weights": { "reasoning": 0.25, "coding": 0.25, "math": 0.15, "knowledge_qa": 0.15, "instruction_following": 0.10, "long_context": 0.10 },
    "benchmark_notes": "which benchmark variants were used and any comparability caveats",
    "caveats": ["benchmark saturation", "possible contamination", "differing test conditions", "..."]
  },
  "models": [
    {
      "rank": 1,
      "model_name": "string (exact version used)",
      "vendor": "string",
      "release_date": "YYYY-MM-DD or null",
      "weights_access": "closed | open",
      "modality": ["text", "image", "audio", "video"],
      "composite": { "score": 0.0, "partial": false },
      "categories": {
        "reasoning":             { "score": 0.0, "rank": 0, "benchmarks": { "GPQA_Diamond": 0.0, "MMLU_Pro": 0.0 } },
        "coding":                { "score": 0.0, "rank": 0, "benchmarks": { "SWE_bench_Verified": 0.0, "LiveCodeBench": 0.0 } },
        "math":                  { "score": 0.0, "rank": 0, "benchmarks": { "AIME": 0.0, "MATH": 0.0 } },
        "knowledge_qa":          { "score": 0.0, "rank": 0, "benchmarks": { "MMLU": 0.0, "SimpleQA": 0.0 } },
        "instruction_following": { "score": 0.0, "rank": 0, "benchmarks": { "IFEval": 0.0, "LMArena_Elo": 0.0 } },
        "long_context":          { "score": 0.0, "rank": 0, "benchmarks": { "RULER": 0.0, "MRCR": 0.0 } }
      },
      "context": { "max_context_tokens": 0, "max_output_tokens": 0 },
      "cost": {
        "input_per_million_usd": 0.0,
        "output_per_million_usd": 0.0,
        "blended_per_million_usd": 0.0,
        "cost_efficiency": 0.0
      },
      "confidence": "verified | estimated | mixed",
      "sources": [ { "field": "cost.input_per_million_usd", "url": "https://...", "accessed": "YYYY-MM-DD" } ]
    }
  ],
  "rankings": {
    "by_composite":     ["model_name", "..."],
    "by_reasoning":     ["model_name", "..."],
    "by_coding":        ["model_name", "..."],
    "by_math":          ["model_name", "..."],
    "by_knowledge_qa":  ["model_name", "..."],
    "by_instruction_following": ["model_name", "..."],
    "by_long_context":  ["model_name", "..."],
    "by_cost_efficiency": ["model_name", "..."]
  }
}

## DEFINITIONS
- blended_per_million_usd = (3 * input_per_million_usd + output_per_million_usd) / 4
  (a 3:1 input:output ratio; adjust if you have a better usage assumption and note it).
- cost_efficiency = composite.score / blended_per_million_usd
  (higher = more capability per dollar; null if price unknown).
- Each `rankings` array is model_name strings sorted best-first for that dimension.
- `models` array MUST be sorted by composite score, best first, and `rank` set to match.

Produce the JSON now.
