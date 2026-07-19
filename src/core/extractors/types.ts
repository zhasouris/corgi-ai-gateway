import type {
  FeatureScore,
  ModelDescriptor,
  RequestAnalysis,
  RoutingRequest,
} from "../../types.js";

/**
 * A scoring rule (ADR 0003): extracts a normalized signal from the request
 * (Stage 1), then scores a candidate model against that signal (Stage 2).
 * Option (b) — each rule owns both halves, so adding a criterion is one drop-in.
 */
export interface FeatureRule {
  readonly name: string;
  extract(req: RoutingRequest, analysis: RequestAnalysis): FeatureScore;
  scoreModel(model: ModelDescriptor, signal: FeatureScore): number;
}

/** Clamp to the 0..1 range weighted scoring requires (invariant #8). */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
