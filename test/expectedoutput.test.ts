/**
 * Heuristic expected-output estimation — explicit length constraints (P1.3).
 *
 * The task-based estimate ignored phrasing like "one line" / "briefly" / "in N
 * words", so the demo's own default prompt ("Give me a one-line greeting.")
 * predicted ~386 output tokens. These assert the brevity clamp overrides it.
 */

import { describe, expect, it } from "vitest";
import { HeuristicSignalProvider } from "../src/core/signal.js";
import { makeRequest } from "./helpers.js";

const heuristic = new HeuristicSignalProvider();
const estimate = async (content: string): Promise<number> =>
  (await heuristic.analyze(makeRequest({ body: { messages: [{ role: "user", content }] } })))
    .expectedOutputTokens;

describe("heuristic expected-output length constraints", () => {
  it("clamps the demo's default one-line prompt under 50 tokens", async () => {
    expect(await estimate("Give me a one-line greeting.")).toBeLessThan(50);
  });

  it.each([
    "Answer in one sentence: what is a monad?",
    "Reply with yes or no: is 7 prime?",
    "Give me a tl;dr of the water cycle.",
    "Describe the sky in a word.",
  ])("hard-caps an explicit one-liner constraint: %s", async (prompt) => {
    expect(await estimate(prompt)).toBeLessThanOrEqual(20);
  });

  it("honors an explicit word budget", async () => {
    const tokens = await estimate("Summarize the French Revolution in 10 words.");
    expect(tokens).toBeGreaterThan(4);
    expect(tokens).toBeLessThanOrEqual(30);
  });

  it("softly caps 'briefly' without collapsing to a one-liner", async () => {
    const tokens = await estimate("Briefly explain how TCP congestion control works.");
    expect(tokens).toBeGreaterThan(20);
    expect(tokens).toBeLessThanOrEqual(120);
  });

  it("leaves unconstrained prompts on the task-based estimate", async () => {
    // No length constraint → the multiplier-based estimate, well above the caps.
    expect(await estimate("Write an essay about the history of jazz.")).toBeGreaterThan(120);
  });
});
