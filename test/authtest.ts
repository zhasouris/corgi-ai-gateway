/**
 * Test helpers for OAuth JWT auth (ADR 0015). Generates an RSA keypair once,
 * exposes the public half as a local JWKS resolver, and mints signed tokens —
 * so the auth path is exercised for real, hermetically, with no network.
 */

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { KeyResolver } from "../src/auth.js";

export const TEST_ISSUER = "https://issuer.test/";
export const TEST_AUDIENCE = "api://corgi-ai-gateway-test";
export const TEST_SCOPE = "router.invoke";
const KID = "test-key-1";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let cached: { kp: KeyPair; resolver: KeyResolver } | null = null;

async function keys() {
  if (!cached) {
    const kp = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(kp.publicKey)), kid: KID, alg: "RS256", use: "sig" };
    cached = { kp, resolver: createLocalJWKSet({ keys: [jwk] }) as KeyResolver };
  }
  return cached;
}

/** The local JWKS resolver to pass as `deps.authKeyResolver`. */
export async function authResolver(): Promise<KeyResolver> {
  return (await keys()).resolver;
}

export interface MintOptions {
  scope?: string;
  audience?: string;
  issuer?: string;
  clientId?: string;
  expired?: boolean;
}

/** Mint a signed JWT. Defaults produce a valid token for the test issuer/audience. */
export async function mintToken(opts: MintOptions = {}): Promise<string> {
  const { kp } = await keys();
  return new SignJWT({ scope: opts.scope ?? TEST_SCOPE, azp: opts.clientId ?? "test-client" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? TEST_ISSUER)
    .setAudience(opts.audience ?? TEST_AUDIENCE)
    .setExpirationTime(opts.expired ? "-5m" : "1h")
    .sign(kp.privateKey);
}

/** `Authorization` header with a fresh valid token. */
export async function bearer(opts: MintOptions = {}): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await mintToken(opts)}` };
}

/**
 * Point the config's auth block at the test issuer/audience/scope via env
 * overrides. Deliberately does NOT set `AUTH_ENABLED` — whether auth is on is
 * left to the config (the real config enables it; the fixture disables it), so
 * one helper serves both the "auth on" and "auth off" test paths.
 */
export function useTestAuthEnv(requiredScope = ""): void {
  process.env.AUTH_ISSUER = TEST_ISSUER;
  process.env.AUTH_AUDIENCE = TEST_AUDIENCE;
  process.env.AUTH_REQUIRED_SCOPE = requiredScope;
}
