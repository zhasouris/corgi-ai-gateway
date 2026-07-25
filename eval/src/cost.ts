import type { ModelDescriptor, RequestAnalysis } from "../../src/types.js";

/** Estimated USD cost of one request on a model, from tokens + catalog pricing. */
export function estimateCost(model: ModelDescriptor, analysis: RequestAnalysis): number {
  const inTokens = analysis.inputTokens;
  const outTokens = analysis.classifier.expectedOutputTokens;
  // `costPer1k*` fields hold USD per 1,000,000 tokens (legacy name; ADR 0018).
  return (inTokens / 1_000_000) * model.costPer1kInput + (outTokens / 1_000_000) * model.costPer1kOutput;
}
