/**
 * Constraint rules — hard capability filters (ADR 0003).
 *
 * A model that fails a constraint is removed before any weighted scoring runs.
 * Constraints are never weighted and apply regardless of strategy (invariant #5).
 */

import {
  supports,
  type ModelDescriptor,
  type RequestAnalysis,
  type RoutingRequest,
} from "../types.js";

export interface ConstraintRule {
  readonly name: string;
  admits(model: ModelDescriptor, req: RoutingRequest, analysis: RequestAnalysis): boolean;
}

export const visionConstraint: ConstraintRule = {
  name: "vision",
  admits: (model, req) => (req.requiresVision ? supports(model, "vision") : true),
};

export const toolsConstraint: ConstraintRule = {
  name: "tools",
  admits: (model, req) => (req.requiresTools ? supports(model, "tools") : true),
};

export const structuredOutputConstraint: ConstraintRule = {
  name: "structured_output",
  admits: (model, req) =>
    req.requiresStructuredOutput ? supports(model, "structured_output") : true,
};

export const audioConstraint: ConstraintRule = {
  name: "audio",
  admits: (model, req) => (req.requiresAudio ? supports(model, "audio") : true),
};

/**
 * Generation-parameter compatibility (ADR 0003): a request that sets a non-default
 * `temperature` must not route to a model that only accepts temperature=1 (the
 * OpenAI o-series 400s on anything else). Keyed on the explicit `fixedTemperature`
 * catalog flag — NOT on the `reasoning` capability, because non-OpenAI reasoning
 * models (Claude, Gemini, DeepSeek, Grok) accept a custom temperature fine.
 */
export const temperatureConstraint: ConstraintRule = {
  name: "temperature",
  admits: (model, req) =>
    req.requiresCustomTemperature ? !model.fixedTemperature : true,
};

/** The bridge filter (ADR 0003): input + expected output must fit. */
export const contextWindowConstraint: ConstraintRule = {
  name: "context_window",
  admits: (model, _req, analysis) => {
    const expected = analysis.classifier.expectedOutputTokens;
    if (expected > model.maxOutputTokens) return false;
    return analysis.inputTokens + expected <= model.contextWindow;
  },
};

export const ALL_CONSTRAINTS: ConstraintRule[] = [
  visionConstraint,
  toolsConstraint,
  structuredOutputConstraint,
  audioConstraint,
  temperatureConstraint,
  contextWindowConstraint,
];
