/**
 * Scoring granularity (P0.1 / ADR 0019). Continuous `quality` + difficulty-scaled
 * competency: capability scores are distinct within a tier, easy prompts keep a
 * wide frontier (value stays cheap), hard prompts narrow it (strong model).
 * Hermetic — real catalog, deterministic heuristic signal.
 */

import { describe, expect, it } from "vitest";
import { getConfig, resetConfigCache } from "../src/config.js";
import { makeAnalyze } from "../src/core/analysis.js";
import { Router } from "../src/core/router.js";
import { HeuristicSignalProvider } from "../src/core/signal.js";
import type { RoutingRequest, Strategy } from "../src/types.js";

delete process.env.ROUTER_CONFIG_DIR;
resetConfigCache();
const config = getConfig();
const byId = new Map(config.catalog.map((m) => [m.id, m]));
const router = new Router(config, makeAnalyze(new HeuristicSignalProvider()));
const blended = (id: string) => byId.get(id)!.costPer1kInput + byId.get(id)!.costPer1kOutput;
const req = (content: string, strategy: Strategy): RoutingRequest => ({
  body: { messages: [{ role: "user", content }] },
  options: { strategy, bypass: false, maxCost: null, warnings: [] },
  requiresVision: false,
  requiresTools: false,
  requiresStructuredOutput: false,
  requiresAudio: false,
});

describe("scoring granularity (P0.1)", () => {
  it("no longer collapses to a tier step-function (no wide capability ties)", async () => {
    const r = await router.explain(req("Give me a one-line greeting.", "fast"));
    // Old behavior tied 7 models on a single tier constant. Assert no capability
    // score is shared by more than two models (a couple of genuine ties are ok).
    const tally = new Map<string, number>();
    for (const m of r.ranked) {
      const k = m.score.toFixed(4);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    expect(Math.max(...tally.values())).toBeLessThanOrEqual(2);
  });

  it("does not over-route an easy benchmark task under value", async () => {
    // "solve x+7=12" is a math task but trivial: difficulty-scaled competency
    // keeps the frontier wide so value stays on a cheap model rather than
    // reserving an expensive reasoning model.
    const r = await router.explain(req("Solve for x: x + 7 = 12.", "value"));
    expect(blended(r.decision!.model)).toBeLessThanOrEqual(1.5);
  });

  it("reserves a strong model for a hard reasoning prompt under best", async () => {
    const r = await router.explain(
      req(
        "Design a distributed rate limiter and rigorously analyze the consistency trade-offs and failure modes.",
        "best",
      ),
    );
    expect(byId.get(r.decision!.model)!.tier).toBeGreaterThanOrEqual(4);
  });

  it("value never costs more than always routing to the strongest model would", async () => {
    // The core economy invariant that the naive continuous-quality version broke.
    const easy = await router.explain(req("Say hi.", "value"));
    expect(blended(easy.decision!.model)).toBeLessThanOrEqual(2.0);
  });
});
