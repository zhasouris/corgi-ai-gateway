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

function jwksUrl(auth: AppConfig["server"]["auth"]): string {
  if (auth.jwks_uri) return auth.jwks_uri;
  if (!auth.issuer) return "";
  // Standard OIDC JWKS location relative to the issuer.
  return `${auth.issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
}

/** True when the token's `scope` (space-delimited) or `scp` claim contains `required`. */
function hasScope(payload: JWTPayload, required: string): boolean {
  if (!required) return true;
  const raw = payload["scope"] ?? payload["scp"];
  const scopes =
    typeof raw === "string" ? raw.split(" ") : Array.isArray(raw) ? raw.map(String) : [];
  return scopes.includes(required);
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

  // Build the remote JWKS once; jose caches keys and refreshes on unknown kid.
  let keys: KeyResolver | null = resolver ?? null;
  if (!keys && auth.enabled) {
    const url = jwksUrl(auth);
    if (url) keys = createRemoteJWKSet(new URL(url));
  }

  return async function requireAuth(c: Context, next: Next): Promise<Response | void> {
    if (!auth.enabled) return next();

    // Fail closed: enabled but nothing to validate against.
    if (!keys || !auth.issuer) {
      return unauthorized(c, "authentication is not configured");
    }

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
