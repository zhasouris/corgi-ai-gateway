/**
 * Required-scope enforcement (ADR 0015). The check must accept the scope in
 * either a delegated `scope`/`scp` claim or an Entra app-only `roles` claim —
 * so a token minted by the app-registration setup script (which grants an app
 * role) is honoured.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { authResolver, bearer, TEST_SCOPE, useTestAuthEnv } from "./authtest.js";
useTestAuthEnv(TEST_SCOPE); // require the scope

import { createApp, type AppDeps } from "../src/app.js";
import { getConfig, resetConfigCache } from "../src/config.js";
import { makeAnalyze } from "../src/core/analysis.js";
import { Router } from "../src/core/router.js";
import { HeuristicSignalProvider } from "../src/core/signal.js";
import type { KeyResolver } from "../src/auth.js";
import type { UpstreamResponse } from "../src/providers/forwarder.js";

let resolver: KeyResolver;

function deps(): AppDeps {
  const config = getConfig();
  return {
    config,
    router: new Router(config, makeAnalyze(new HeuristicSignalProvider())),
    forwarder: { async forward(): Promise<UpstreamResponse> {
      return { status: 200, headers: {}, body: "{}" };
    } },
    authKeyResolver: resolver,
  };
}

async function call(headers: Record<string, string>) {
  return createApp(deps()).request("/v1/models", { headers });
}

beforeAll(async () => {
  resetConfigCache();
  resolver = await authResolver();
});

describe("required scope", () => {
  it("accepts the scope in a delegated `scope` claim", async () => {
    expect((await call(await bearer({ scope: TEST_SCOPE }))).status).toBe(200);
  });

  it("accepts the scope in an Entra app-only `roles` claim", async () => {
    // No scope claim at all — only the app role, as Entra client-credentials sends.
    expect((await call(await bearer({ scope: "", roles: [TEST_SCOPE] }))).status).toBe(200);
  });

  it("rejects a valid token that lacks the required scope/role", async () => {
    expect((await call(await bearer({ scope: "some.other" }))).status).toBe(401);
  });

  it("rejects a token with an empty scope and no roles", async () => {
    expect((await call(await bearer({ scope: "" }))).status).toBe(401);
  });
});
