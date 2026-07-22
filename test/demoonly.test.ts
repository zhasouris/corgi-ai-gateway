/**
 * Demo-only posture: publish the decision inspector and nothing else.
 *
 * The deployment achieves this by shipping a classifier key, no provider keys,
 * and *no* ROUTER_API_KEYS. That last part is load-bearing and non-obvious —
 * an empty key set does not disable auth, it means no bearer token can ever
 * match, so the whole /v1 surface answers 401 while /demo and
 * /v1/router/explain keep working because they are registered ahead of the
 * auth middleware.
 *
 * If that ordering is ever changed, a demo-only deployment silently becomes
 * either useless (inspector 401s) or dangerous (chat completions open).
 */

import { beforeEach, describe, expect, it } from "vitest";

// Deliberately empty — the entire point of this suite.
process.env.ROUTER_API_KEYS = "";

import { createApp, type AppDeps } from "../src/app.js";
import { getConfig, resetConfigCache } from "../src/config.js";
import { makeAnalyze } from "../src/core/analysis.js";
import { Router } from "../src/core/router.js";
import { HeuristicSignalProvider } from "../src/core/signal.js";
import type { UpstreamResponse } from "../src/providers/forwarder.js";

function deps(): AppDeps {
  const config = getConfig();
  return {
    config,
    router: new Router(config, makeAnalyze(new HeuristicSignalProvider())),
    forwarder: {
      async forward(): Promise<UpstreamResponse> {
        throw new Error("forwarding must never be reached in a demo-only deployment");
      },
    },
  };
}

beforeEach(() => {
  process.env.ROUTER_API_KEYS = "";
  resetConfigCache();
});

describe("demo-only deployment", () => {
  it("has no usable proxy tokens", () => {
    expect(getConfig().secrets.routerApiKeys.size).toBe(0);
    // Auth is still ON — that is why the empty set closes the surface.
    expect(getConfig().server.auth.enabled).toBe(true);
  });

  it("serves the inspector page", async () => {
    const res = await createApp(deps()).request("/demo");
    expect(res.status).toBe(200);
  });

  it("points the root at the inspector", async () => {
    const res = await createApp(deps()).request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/demo");
  });

  it("answers /v1/router/explain unauthenticated", async () => {
    const res = await createApp(deps()).request("/v1/router/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Say hi" }] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { decision: { model: string } | null };
    expect(json.decision).not.toBeNull();
  });

  it("closes /v1/chat/completions to everyone", async () => {
    const res = await createApp(deps()).request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("closes /v1/chat/completions even to a plausible token", async () => {
    const res = await createApp(deps()).request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer anything-at-all",
      },
      body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("closes /v1/models", async () => {
    expect((await createApp(deps()).request("/v1/models")).status).toBe(401);
  });

  it("still serves /healthz for the platform probes", async () => {
    expect((await createApp(deps()).request("/healthz")).status).toBe(200);
  });

  // With the inspector off there is nothing human-facing left, so the root
  // falls back to the API docs rather than redirecting to a route that would
  // 404. The redirect must stay temporary for this reason.
  it("falls back to the docs when the inspector is off", async () => {
    process.env.DEMO_ENABLED = "false";
    resetConfigCache();
    try {
      const res = await createApp(deps()).request("/");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/docs");
      expect((await createApp(deps()).request("/demo")).status).toBe(404);
    } finally {
      delete process.env.DEMO_ENABLED;
      resetConfigCache();
    }
  });
});
