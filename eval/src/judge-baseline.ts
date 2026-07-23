/**
 * Lens 3 (ADR 0018): validate the offline accuracy proxy with real outputs.
 * For each sampled prompt where the router disagreed with the base, generate
 * BOTH answers and have the judge decide — directionally by change type:
 *   upgrade   → "did the stronger pick actually answer better?" (payoff)
 *   downgrade → "did the cheaper pick lose quality?"            (safety)
 * Reuses the injected ModelCaller/Judge, so it's unit-testable without network.
 */

import type { Change } from "./baseline.js";
import type { Judge, ModelCaller } from "./judge.js";

export interface JudgeItem {
  id: string;
  prompt: string;
  change: Change;
  routerModel: string;
}

export type Verdict = "upgrade-paid-off" | "upgrade-no-gain" | "downgrade-safe" | "downgrade-lost";

export interface JudgedResult {
  id: string;
  change: Change;
  routerModel: string;
  margin: number;
  verdict: Verdict;
}

export interface JudgedSummary {
  n: number;
  upgrades: { n: number; paidOff: number };
  downgrades: { n: number; safe: number; lost: number };
  results: JudgedResult[];
}

/** Judge a set of base-vs-router disagreements. `items` should already be sampled. */
export async function judgeBaseline(
  items: JudgeItem[],
  base: string,
  caller: ModelCaller,
  judge: Judge,
): Promise<JudgedSummary> {
  const results: JudgedResult[] = [];

  for (const it of items) {
    if (it.change === "unchanged") continue;
    const [baseAns, routerAns] = await Promise.all([
      caller.complete(base, it.prompt),
      caller.complete(it.routerModel, it.prompt),
    ]);
    // A model with no key (or a failed call) returns "" — can't judge it fairly.
    if (!baseAns.trim() || !routerAns.trim()) continue;

    let verdict: Verdict;
    let margin: number;
    if (it.change === "downgrade") {
      // Is the BASE (B) meaningfully better than the cheaper router pick (A)?
      const j = await judge.strongBetter(it.prompt, routerAns, baseAns);
      margin = j.margin;
      verdict = j.strongBetter ? "downgrade-lost" : "downgrade-safe";
    } else {
      // upgrade / forced-upgrade: is the ROUTER pick (B) better than the base (A)?
      const j = await judge.strongBetter(it.prompt, baseAns, routerAns);
      margin = j.margin;
      verdict = j.strongBetter ? "upgrade-paid-off" : "upgrade-no-gain";
    }
    results.push({ id: it.id, change: it.change, routerModel: it.routerModel, margin, verdict });
  }

  const up = results.filter((r) => r.verdict.startsWith("upgrade"));
  const down = results.filter((r) => r.verdict.startsWith("downgrade"));
  return {
    n: results.length,
    upgrades: { n: up.length, paidOff: up.filter((r) => r.verdict === "upgrade-paid-off").length },
    downgrades: {
      n: down.length,
      safe: down.filter((r) => r.verdict === "downgrade-safe").length,
      lost: down.filter((r) => r.verdict === "downgrade-lost").length,
    },
    results,
  };
}
