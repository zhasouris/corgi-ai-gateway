/**
 * Phase 2 — quality-derived ground truth (eval-harness spec).
 *
 * For each prompt we call a weak and a strong model, then ask a judge whether
 * the strong answer is *meaningfully* better. That yields a ground-truth label
 * ("was a strong model actually needed?") derived from real outputs — not
 * opinion — against which we score the router's difficulty judgment.
 *
 * The model caller and judge are injected so the logic is unit-testable without
 * network (invariant #1).
 */

export interface ModelCaller {
  complete(model: string, prompt: string): Promise<string>;
}

export interface Judge {
  strongBetter(prompt: string, weak: string, strong: string): Promise<{ strongBetter: boolean; margin: number }>;
}

export interface GroundTruth {
  strongNeeded: boolean;
  margin: number;
}

export async function deriveGroundTruth(
  prompt: string,
  weakModel: string,
  strongModel: string,
  caller: ModelCaller,
  judge: Judge,
): Promise<GroundTruth> {
  const [weak, strong] = await Promise.all([
    caller.complete(weakModel, prompt),
    caller.complete(strongModel, prompt),
  ]);
  const { strongBetter, margin } = await judge.strongBetter(prompt, weak, strong);
  return { strongNeeded: strongBetter, margin };
}

export type Outcome = "correct-strong" | "correct-weak" | "over-route" | "under-route";

/** Compare the router's chosen tier against the quality-derived ground truth. */
export function classify(
  routedTier: number,
  strongTierThreshold: number,
  gt: GroundTruth,
): Outcome {
  const routedStrong = routedTier >= strongTierThreshold;
  if (routedStrong && gt.strongNeeded) return "correct-strong";
  if (!routedStrong && !gt.strongNeeded) return "correct-weak";
  if (routedStrong && !gt.strongNeeded) return "over-route"; // wasted money
  return "under-route"; // quality loss
}

export interface JudgeSummary {
  n: number;
  accuracy: number;
  overRouteRate: number;
  underRouteRate: number;
  counts: Record<Outcome, number>;
}

export function summarize(outcomes: Outcome[]): JudgeSummary {
  const counts: Record<Outcome, number> = {
    "correct-strong": 0,
    "correct-weak": 0,
    "over-route": 0,
    "under-route": 0,
  };
  for (const o of outcomes) counts[o]++;
  const n = outcomes.length || 1;
  return {
    n: outcomes.length,
    accuracy: (counts["correct-strong"] + counts["correct-weak"]) / n,
    overRouteRate: counts["over-route"] / n,
    underRouteRate: counts["under-route"] / n,
    counts,
  };
}
