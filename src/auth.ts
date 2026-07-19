/**
 * Proxy authentication (ADR 0004).
 *
 * Clients present a bearer token; it must match one of ROUTER_API_KEYS. When
 * auth is disabled in server.yaml, all requests pass (local dev). Invariant #19.
 */

import type { Context, Next } from "hono";
import type { AppConfig } from "./config.js";

export function makeAuth(config: AppConfig) {
  return async function requireAuth(c: Context, next: Next): Promise<Response | void> {
    if (!config.server.auth.enabled) return next();

    const valid = config.secrets.routerApiKeys;
    const header = c.req.header("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

    if (valid.size === 0 || !valid.has(token)) {
      return c.json(
        { error: { message: "invalid or missing proxy API key", type: "invalid_request_error" } },
        401,
        { "WWW-Authenticate": "Bearer" },
      );
    }
    return next();
  };
}
