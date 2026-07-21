/**
 * Phase 2 judging logic — hermetic (stubbed caller + judge, no network).
 */

import { describe, expect, it } from "vitest";
import {
  classify,
  deriveGroundTruth,
  summarize,
  type Judge,
  type ModelCaller,
  type Outcome,
} from "../eval/src/judge.js";

const caller: ModelCaller = {
  async complete(model) {
    return model.includes("nano") ? "short weak answer" : "detailed strong answer";
  },
};

// Judge says the strong model is needed only for prompts mentioning "prove".
const judge: Judge = {
  async strongBetter(prompt) {
    const needed = prompt.toLowerCase().includes("prove");
    return { strongBetter: needed, margin: needed ? 0.7 : 0.1 };
  },
};

describe("deriveGroundTruth", () => {
  it("labels a hard prompt as needing the strong model", async () => {
    const gt = await deriveGroundTruth("Prove X is irrational", "gpt-4.1-nano", "gpt-4.1", caller, judge);
    expect(gt.strongNeeded).toBe(true);
  });

  it("labels a trivial prompt as not needing the strong model", async () => {
    const gt = await deriveGroundTruth("What is 2+2?", "gpt-4.1-nano", "gpt-4.1", caller, judge);
    expect(gt.strongNeeded).toBe(false);
  });
});

describe("classify", () => {
  const T = 4;
  it("correct when routing matches need", () => {
    expect(classify(5, T, { strongNeeded: true, margin: 0.7 })).toBe("correct-strong");
    expect(classify(2, T, { strongNeeded: false, margin: 0.1 })).toBe("correct-weak");
  });
  it("over-routes when strong not needed but chosen", () => {
    expect(classify(5, T, { strongNeeded: false, margin: 0.1 })).toBe("over-route");
  });
  it("under-routes when strong needed but weak chosen", () => {
    expect(classify(2, T, { strongNeeded: true, margin: 0.7 })).toBe("under-route");
  });
});

describe("summarize", () => {
  it("computes accuracy and error rates", () => {
    const outcomes: Outcome[] = ["correct-strong", "correct-weak", "over-route", "under-route"];
    const s = summarize(outcomes);
    expect(s.accuracy).toBeCloseTo(0.5, 6);
    expect(s.overRouteRate).toBeCloseTo(0.25, 6);
    expect(s.underRouteRate).toBeCloseTo(0.25, 6);
  });
});
