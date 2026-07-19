/**
 * Tent-pole test #10 — X-Router-Bypass short-circuits routing AND never calls
 * the classifier (here: never calls analyze, which is what wraps the classifier).
 */

import { describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config.js";
import { Router } from "../src/core/router.js";
import { makeRequest } from "./helpers.js";

describe("bypass", () => {
  it("skips analyze entirely when bypassing", async () => {
    const analyzeSpy = vi.fn(async () => {
      throw new Error("analyze must not run when bypassing");
    });
    const router = new Router(getConfig(), analyzeSpy);

    const req = makeRequest({ bypass: true, body: { model: "gpt-4.1-nano", messages: [] } });
    const decision = await router.route(req);

    expect(analyzeSpy).not.toHaveBeenCalled();
    expect(decision.bypassed).toBe(true);
    expect(decision.modelId).toBe("gpt-4.1-nano");
    expect(decision.provider).toBe("openai");
    expect(decision.reason).toBe("bypass");
  });

  it("infers provider by prefix for a catalog-unknown model", async () => {
    const analyzeSpy = vi.fn(async () => {
      throw new Error("analyze must not run when bypassing");
    });
    const router = new Router(getConfig(), analyzeSpy);

    const req = makeRequest({ bypass: true, body: { model: "claude-sonnet-5", messages: [] } });
    const decision = await router.route(req);

    expect(decision.provider).toBe("anthropic");
  });
});
