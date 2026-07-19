/**
 * Scoring & strategy bias (invariants #7, #8, #9).
 */

import { describe, expect, it } from "vitest";
import { ALL_RULES } from "../src/core/extractors/rules.js";
import { scoreModels } from "../src/core/scoring.js";
import { defaultClassifierResult, type ClassifierResult, type ModelDescriptor } from "../src/types.js";
import { fixtureCatalog, makeAnalysis, makeModel } from "./helpers.js";

function rank(
  catalog: ModelDescriptor[],
  weights: Record<string, number>,
  classifier?: ClassifierResult,
) {
  const analysis = makeAnalysis({ classifier: classifier ?? defaultClassifierResult() });
  return scoreModels(catalog, ALL_RULES, analysis.features, weights);
}

describe("scoring", () => {
  it("cost strategy prefers the cheapest", () => {
    const ranked = rank(fixtureCatalog(), { cost: 3.0, input_tokens: 1.0, expected_output: 1.0 });
    expect(ranked[0]!.model.id).toBe("cheap-nano");
  });

  it("quality strategy prefers the strongest on complex work", () => {
    const ranked = rank(
      fixtureCatalog(),
      { complexity: 3.0, reasoning_depth: 2.0, task_type: 1.5 },
      { ...defaultClassifierResult(), complexity: 0.95 },
    );
    expect(ranked[0]!.model.tier).toBe(5);
  });

  it("latency strategy prefers the fastest", () => {
    const ranked = rank(fixtureCatalog(), { latency: 3.0 });
    expect(ranked[0]!.model.id).toBe("cheap-nano");
  });

  it("extractors emit normalized 0..1 signals for extreme inputs", () => {
    const analysis = makeAnalysis({
      inputTokens: 10_000_000,
      classifier: { ...defaultClassifierResult(), complexity: 5.0, reasoningDepth: -3.0 },
    });
    for (const score of Object.values(analysis.features)) {
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(1);
    }
  });

  it("ties break deterministically by cost then id", () => {
    const a = makeModel("bbb", { costIn: 1.0, costOut: 1.0 });
    const b = makeModel("aaa", { costIn: 1.0, costOut: 1.0 });
    const ranked = rank([a, b], { cost: 1.0 });
    expect(ranked[0]!.model.id).toBe("aaa");
  });
});
