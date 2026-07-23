/**
 * The eight feature rules (ADR 0003). Each extracts a normalized 0..1 signal
 * and scores models against it. Scores may be any monotonic value ("higher is
 * better"); the scoring engine min-max normalizes them across candidates —
 * except for rules marked `fixedScale`, whose output is already 0..1 and whose
 * magnitude would be destroyed by min-max (see FeatureRule.fixedScale).
 */

import { COMPETENCY_TASKS, supports, type FeatureScore, type ModelDescriptor } from "../../types.js";
import { clamp01, type FeatureRule } from "./types.js";

const LARGE_PROMPT_TOKENS = 128_000;
const LARGE_OUTPUT_TOKENS = 8_192;
/** Tier normalization denominator for the competency fallback (ADR 0010). */
const MAX_TIER = 6;
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
  extract(_req, analysis) {
    const v = clamp01(analysis.classifier.complexity);
    return f("complexity", v, v);
  },
  scoreModel(model, signal) {
    // High complexity -> favor higher tier; low complexity -> favor lower tier.
    return model.tier * (2 * signal.value - 1);
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
    return f("task_type", COMPETENCY_TASKS.has(task) ? 1 : 0, task, { task });
  },
  scoreModel(model, signal) {
    if (!signal.value) return 0;
    const task = String(signal.raw);
    // Seeded competency for this task if we have it, else a tier-derived fallback
    // so a model with no competency data is treated exactly as before (by tier).
    return model.competency?.[task] ?? model.tier / MAX_TIER;
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
