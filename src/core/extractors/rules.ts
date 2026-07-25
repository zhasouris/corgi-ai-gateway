/**
 * The eight feature rules (ADR 0003). Each extracts a normalized 0..1 signal
 * and scores models against it. Scores may be any monotonic value ("higher is
 * better"); the scoring engine min-max normalizes them across candidates —
 * except for rules marked `fixedScale`, whose output is already 0..1 and whose
 * magnitude would be destroyed by min-max (see FeatureRule.fixedScale).
 */

import { COMPETENCY_TASKS, MAX_TIER, supports, type FeatureScore, type ModelDescriptor } from "../../types.js";
import { clamp01, type FeatureRule } from "./types.js";

const LARGE_PROMPT_TOKENS = 128_000;
const LARGE_OUTPUT_TOKENS = 8_192;
const LOCAL_PROVIDERS = new Set(["ollama", "local", "self_hosted"]);

const f = (name: string, value: number, raw?: FeatureScore["raw"], metadata?: Record<string, unknown>): FeatureScore => ({
  name,
  value,
  raw,
  metadata,
});

export const inputTokensRule: FeatureRule = {
  name: "input_tokens",
  extract(_req, analysis) {
    return f("input_tokens", clamp01(analysis.inputTokens / LARGE_PROMPT_TOKENS), analysis.inputTokens);
  },
  scoreModel(model, signal) {
    // Larger prompts weight cheap input pricing more heavily.
    return -model.costPer1kInput * (0.5 + signal.value);
  },
};

export const expectedOutputRule: FeatureRule = {
  name: "expected_output",
  extract(_req, analysis) {
    const tokens = analysis.classifier.expectedOutputTokens;
    return f("expected_output", clamp01(tokens / LARGE_OUTPUT_TOKENS), tokens);
  },
  scoreModel(model, signal) {
    return -model.costPer1kOutput * (0.5 + signal.value);
  },
};

export const complexityRule: FeatureRule = {
  name: "complexity",
  // fixedScale on purpose: the MAGNITUDE of the spread must be preserved. On an
  // easy prompt capability barely separates models, so the spread stays small and
  // the frontier stays WIDE (value can reach a genuinely cheap model); on a hard
  // prompt the spread widens and the frontier narrows to strong models. min-max
  // would erase that by always stretching the spread to fill 0..1 — which starves
  // value of cheap options on easy prompts (it gets trapped on the lowest-quality
  // model, which isn't the cheapest).
  fixedScale: true,
  extract(_req, analysis) {
    const v = clamp01(analysis.classifier.complexity);
    return f("complexity", v, v);
  },
  scoreModel(model, signal) {
    // Centered on 0.5: high complexity tilts toward high capability, low toward
    // low. Continuous `quality` (benchmark composite) keeps scores distinct
    // *within* a tier so Q is no longer a tier step-function (ADR 0003 / 0017);
    // tier/MAX_TIER is the fallback when a model has no quality score.
    const capability = model.quality ?? model.tier / MAX_TIER;
    return 0.5 + (capability - 0.5) * (2 * signal.value - 1);
  },
};

export const reasoningDepthRule: FeatureRule = {
  name: "reasoning_depth",
  // Already 0..1, and the magnitude matters: a prompt needing 10% reasoning
  // should hand a reasoning-capable model a tenth of the bonus, not all of it.
  fixedScale: true,
  extract(_req, analysis) {
    const v = clamp01(analysis.classifier.reasoningDepth);
    return f("reasoning_depth", v, v);
  },
  scoreModel(model, signal) {
    return signal.value * (supports(model, "reasoning") ? 1 : 0);
  },
};

export const taskTypeRule: FeatureRule = {
  name: "task_type",
  // Competency is an ABSOLUTE judgement (0.95 = "excellent at this"), not a
  // best-of-set ranking, so it must not be min-max rescaled (ADR 0010, 0003).
  fixedScale: true,
  extract(_req, analysis) {
    const task = analysis.classifier.taskType;
    // value gates the rule: 1 for a benchmark-eligible task, 0 for the generic
    // `conversation` default (which stays neutral, as under the old tier×hard rule).
    // Carry complexity so competency can be scaled by how hard the prompt is.
    return f("task_type", COMPETENCY_TASKS.has(task) ? 1 : 0, task, {
      task,
      complexity: clamp01(analysis.classifier.complexity),
    });
  },
  scoreModel(model, signal) {
    if (!signal.value) return 0;
    const task = String(signal.raw);
    // Seeded competency for this task if we have it, else a tier-derived fallback
    // so a model with no competency data is treated exactly as before (by tier).
    const competency = model.competency?.[task]?.score ?? model.tier / MAX_TIER;
    // Competency matters in proportion to DIFFICULTY: a trivial prompt in a
    // benchmark category (e.g. "solve x+7=12") doesn't need the best-at-task
    // model, so the spread shrinks toward neutral (0.5) and the frontier widens
    // — keeping value/fast on a cheap model. A hard prompt (c->1) restores the
    // full competency spread, reserving the strong model.
    const c = typeof signal.metadata?.complexity === "number" ? signal.metadata.complexity : 0.5;
    return 0.5 + (competency - 0.5) * c;
  },
};

export const dataSensitivityRule: FeatureRule = {
  name: "data_sensitivity",
  // Same shape as reasoning_depth: 0..1, magnitude meaningful.
  fixedScale: true,
  extract(_req, analysis) {
    const v = clamp01(analysis.classifier.dataSensitivity);
    return f("data_sensitivity", v, v);
  },
  scoreModel(model, signal) {
    // Sensitive data biases toward local providers (none in v1 -> neutral).
    return signal.value * (LOCAL_PROVIDERS.has(model.provider) ? 1 : 0);
  },
};

export const costRule: FeatureRule = {
  name: "cost",
  extract() {
    return f("cost", 0.5, null);
  },
  scoreModel(model: ModelDescriptor) {
    return -(model.costPer1kInput + model.costPer1kOutput);
  },
};

export const latencyRule: FeatureRule = {
  name: "latency",
  extract() {
    return f("latency", 0.5, null);
  },
  scoreModel(model: ModelDescriptor) {
    return -model.avgLatencyMs;
  },
};

export const ALL_RULES: FeatureRule[] = [
  inputTokensRule,
  expectedOutputRule,
  complexityRule,
  reasoningDepthRule,
  taskTypeRule,
  dataSensitivityRule,
  costRule,
  latencyRule,
];
