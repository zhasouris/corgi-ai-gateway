/**
 * Proxy authentication — OAuth 2.0 client-credentials resource-server validation
 * (ADR 0015).
 *
 * Callers are machines: they obtain a JWT access token from an OIDC identity
 * provider (client_credentials grant) and present it as `Authorization: Bearer
 * <jwt>`. This gateway validates the token — it never issues one. Validation is
 * provider-agnostic: signature against the issuer's JWKS, matching `iss`/`aud`,
 * not expired, and (if configured) carrying the required scope.
 *
 * Fail-closed: with auth enabled but no issuer configured, nothing can validate,
 * so every request is 401 — which is how the demo-only deployment stays closed.
 * `auth.enabled: false` opens the surface for local dev only.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Context, Next } from "hono";
import type { AppConfig } from "./config.js";
import { logWarn } from "./logger.js";

/** The key resolver jose uses to verify a token. Injectable so tests can supply
 *  a local JWKS instead of fetching a remote one. */
export type KeyResolver = JWTVerifyGetKey;

/**
 * Resolve the JWKS URL. An explicit `jwks_uri` wins; otherwise discover it the
 * standard OIDC way — fetch `<issuer>/.well-known/openid-configuration` and read
 * its `jwks_uri`. Providers don't share a fixed JWKS path (Entra uses
 * `/discovery/v2.0/keys`, Auth0 `/.well-known/jwks.json`, …), so guessing one
 * only works by luck; discovery is what makes issuer-alone config portable.
 */
async function discoverJwksUri(auth: AppConfig["server"]["auth"]): Promise<string> {
  if (auth.jwks_uri) return auth.jwks_uri;
  if (!auth.issuer) return "";
  const base = auth.issuer.replace(/\/$/, "");
  const res = await fetch(`${base}/.well-known/openid-configuration`);
  if (!res.ok) {
    throw new Error(`OIDC discovery returned ${res.status} for ${base}/.well-known/openid-configuration`);
  }
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) throw new Error(`no jwks_uri in the discovery document for ${base}`);
  return doc.jwks_uri;
}

/**
 * True when the required scope/role is present. Delegated (user) tokens carry it
 * in `scope`/`scp` (space-delimited); app-only client-credentials tokens on
 * Entra ID carry it in `roles` (an array of app roles). Accept any of them, so
 * the check is provider-agnostic.
 */
function hasScope(payload: JWTPayload, required: string): boolean {
  if (!required) return true;
  const collect = (v: unknown): string[] =>
    typeof v === "string" ? v.split(" ") : Array.isArray(v) ? v.map(String) : [];
  const claims = [
    ...collect(payload["scope"]),
    ...collect(payload["scp"]),
    ...collect(payload["roles"]),
  ];
  return claims.includes(required);
}

function unauthorized(c: Context, detail: string): Response {
  return c.json(
    { error: { message: detail, type: "invalid_request_error" } },
    401,
    { "WWW-Authenticate": `Bearer error="invalid_token"` },
  );
}

/**
 * Build the `/v1/*` auth middleware.
 *
 * @param resolver optional key resolver (tests inject a local JWKS); by default
 *        a cached remote JWKS is built from the configured issuer/jwks_uri.
 */
export function makeAuth(config: AppConfig, resolver?: KeyResolver) {
  const auth = config.server.auth;

  // Resolve the JWKS lazily and once — discovery needs an async fetch, and jose
  // then caches the keys and refreshes on an unknown kid. An injected resolver
  // (tests) short-circuits discovery. On failure the cache is cleared so the
  // next request retries rather than staying wedged.
  let keysPromise: Promise<KeyResolver | null> | null = resolver ? Promise.resolve(resolver) : null;
  function loadKeys(): Promise<KeyResolver | null> {
    if (!keysPromise) {
      keysPromise = discoverJwksUri(auth)
        .then((url) => (url ? (createRemoteJWKSet(new URL(url)) as KeyResolver) : null))
        .catch((err) => {
          logWarn("jwks resolution failed", { reason: (err as Error).message });
          keysPromise = null;
          return null;
        });
    }
    return keysPromise;
  }

  return async function requireAuth(c: Context, next: Next): Promise<Response | void> {
    if (!auth.enabled) return next();

    // Fail closed: enabled but no issuer means nothing can validate.
    if (!auth.issuer) return unauthorized(c, "authentication is not configured");
    const keys = await loadKeys();
    if (!keys) return unauthorized(c, "authentication is not configured");

    const header = c.req.header("authorization") ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) {
      return unauthorized(c, "missing bearer token");
    }
    const token = header.slice(7).trim();

    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: auth.issuer,
        audience: auth.audience || undefined,
      });
      if (!hasScope(payload, auth.required_scope)) {
        return unauthorized(c, `token missing required scope '${auth.required_scope}'`);
      }
      // Which application called — for per-client audit (ADR 0008). Never log the token.
      const clientId = (payload["azp"] ?? payload["client_id"] ?? payload.sub) as string | undefined;
      if (clientId) c.set("clientId", clientId);
      return next();
    } catch (err) {
      logWarn("token validation failed", { reason: (err as Error).message });
      return unauthorized(c, "invalid or expired token");
    }
  };
}
