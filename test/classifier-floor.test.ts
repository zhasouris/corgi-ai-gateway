/**
 * Regression: the LLM classifier occasionally collapses a hard prompt to
 * task_type=conversation / reasoning_depth=0 (gpt-4.1-nano is non-deterministic
 * even at temperature 0). Un-floored, that flattens the capability score and
 * lets `best` route a rigorous proof to a cheap general model (observed live:
 * `best` picking llama-3.1-8b-instant for the sqrt-2 proof). `floorSignal()`
 * recovers the deterministic heuristic's reading in exactly that case.
 *
 * Runs against the fixed gold catalog so the routing expectations stay provable
 * as the real catalog grows.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.ROUTER_CONFIG_DIR = join(process.cwd(), "test", "fixtures", "gold");

import { getConfig, resetConfigCache } from "../src/config.js";
import { makeAnalyze } from "../src/core/analysis.js";
import { Router } from "../src/core/router.js";
import { HeuristicSignalProvider, floorSignal, type SignalProvider } from "../src/core/signal.js";
import type { ClassifierResult, RoutingRequest } from "../src/types.js";

const SQRT2 =
  "Prove rigorously that the square root of 2 is irrational using proof by contradiction, and derive each step.";

function request(content: string): RoutingRequest {
  return {
    body: { messages: [{ role: "user", content }] },
    options: { strategy: "best", bypass: false, maxCost: null, warnings: [] },
    requiresVision: false,
    requiresTools: false,
    requiresStructuredOutput: false,
    requiresAudio: false,
  };
}

/** A SignalProvider that returns a fixed reading — stands in for a specific
 *  (possibly misfired) classifier output without any network call. */
class FixedSignal implements SignalProvider {
  readonly name = "fixed";
  constructor(private readonly result: ClassifierResult) {}
  async analyze(): Promise<ClassifierResult> {
    return this.result;
  }
}

describe("classifier heuristic floor", () => {
  it("passes a non-collapsed reading through untouched (no global inflation)", () => {
    const reasoning: ClassifierResult = {
      complexity: 0.4,
      expectedOutputTokens: 512,
      reasoningDepth: 0.7,
      taskType: "reasoning",
      dataSensitivity: 0,
      degraded: false,
    };
    // Even with a "harder" heuristic, a non-conversation reading is left as-is.
    const heur: ClassifierResult = { ...reasoning, complexity: 0.9, taskType: "math" };
    expect(floorSignal(reasoning, heur)).toEqual(reasoning);
  });

  it("recovers difficulty when the classifier collapses to conversation", () => {
    const collapsed: ClassifierResult = {
      complexity: 0.5,
      expectedOutputTokens: 512,
      reasoningDepth: 0,
      taskType: "conversation",
      dataSensitivity: 0,
      degraded: false,
    };
    const heur: ClassifierResult = { ...collapsed, complexity: 0.85, reasoningDepth: 0.7, taskType: "math" };
    const floored = floorSignal(collapsed, heur);
    expect(floored.taskType).toBe("math");
    expect(floored.reasoningDepth).toBe(0.7);
    expect(floored.complexity).toBe(0.85);
  });

  it("leaves a genuine conversation as conversation", () => {
    const trivial: ClassifierResult = {
      complexity: 0.2,
      expectedOutputTokens: 64,
      reasoningDepth: 0,
      taskType: "conversation",
      dataSensitivity: 0,
      degraded: false,
    };
    expect(floorSignal(trivial, { ...trivial })).toEqual(trivial);
  });

  it("under `best`, a floored collapse routes the sqrt-2 proof like the correct reading", async () => {
    resetConfigCache();
    const config = getConfig();
    const req = request(SQRT2);

    // The correct reading is what the deterministic heuristic produces for this
    // prompt (math, high difficulty). The collapse zeroes it to conversation.
    const correct = await new HeuristicSignalProvider().analyze(req);
    const collapsed: ClassifierResult = { ...correct, taskType: "conversation", reasoningDepth: 0, complexity: 0.5 };
    const floored = floorSignal(collapsed, correct);

    const route = async (r: ClassifierResult) =>
      (await new Router(config, makeAnalyze(new FixedSignal(r))).decide(req)).decision.modelId;

    const mCorrect = await route(correct);
    const mCollapsed = await route(collapsed);
    const mFloored = await route(floored);

    // The bug: an un-floored collapse routes elsewhere (a cheap general model).
    expect(mCollapsed).not.toBe(mCorrect);
    // The fix: flooring recovers the correct route.
    expect(mFloored).toBe(mCorrect);
  });
});
