import type { ModelDescriptor, RequestAnalysis } from "../../src/types.js";

/** Estimated USD cost of one request on a model, from tokens + catalog pricing. */
export function estimateCost(model: ModelDescriptor, analysis: RequestAnalysis): number {
  const inTokens = analysis.inputTokens;
  const outTokens = analysis.classifier.expectedOutputTokens;
  return (inTokens / 1000) * model.costPer1kInput + (outTokens / 1000) * model.costPer1kOutput;
}
