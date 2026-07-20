import type { ChatCompletionRequest } from "../../src/types.js";

/** One labeled row in an eval dataset. */
export interface Scenario {
  id: string;
  request: ChatCompletionRequest;
  tags?: string[];
  /** The catalog tier we'd expect a good router to pick (optional label). */
  expectedTier?: number;
}

/** The outcome of routing one scenario under one group (strategy or baseline). */
export interface RunResult {
  id: string;
  group: string; // e.g. "strategy:cost" or "baseline:always-cheapest"
  provider: string;
  model: string;
  tier: number;
  estCost: number;
  expectedTier: number | null;
  correct: boolean | null;
  degraded: boolean;
}
