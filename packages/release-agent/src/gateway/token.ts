/**
 * The web app's access tokens, checked by the gateway.
 *
 * The Release Console web app signs a short-lived JWT (EdDSA / Ed25519) for a
 * signed-in user and one of their machines; the browser sends it with every
 * request to that machine's gateway. The gateway holds only the app's public
 * key (saved at pairing), so a leaked gateway can't mint tokens, and a token
 * for another machine or another user is refused even when signed correctly.
 */

import { createPublicKey, verify, type KeyObject } from "node:crypto";

export interface TokenClaims {
  /** The web app's origin, e.g. https://release.example.com */
  iss: string;
  /** "machine:<machine id>" */
  aud: string;
  /** The user id the token was issued to. */
  sub: string;
  iat: number;
  exp: number;
  /** The signed-in user's email, for logs. */
  email?: string;
  /**
   * "full" (the default) goes in the Authorization header and can do
   * anything the console allows. "read" is for URLs (event streams, file
   * views, downloads, images), where a header can't be sent: it only works
   * for GET requests, so a leaked link can't start or approve anything.
   */
  scope: "full" | "read";
}

/** What a token must match: the app, this machine, and its owner. */
export interface TokenExpectation {
  issuer: string;
  machineId: string;
  ownerId: string;
  publicKey: KeyObject | string;
  /** Seconds since the epoch; tests pass their own clock. */
  now?: number;
}

/** No token may live longer than this, whatever it claims. */
export const MAX_TOKEN_SECONDS = 10 * 60;
/** Read-only URL tokens may live longer, since a page keeps its links for a while. */
export const MAX_READ_TOKEN_SECONDS = 35 * 60;
const SKEW = 30;

export class TokenError extends Error {}

const b64url = (s: string) => Buffer.from(s, "base64url");

function json(part: string): Record<string, unknown> {
  try {
    const value = JSON.parse(b64url(part).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new TokenError("Malformed token.");
}

export function publicKeyFrom(pem: string): KeyObject {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new TokenError("The app's key must be Ed25519.");
  return key;
}

/** The claims, if the token is genuine and meant for this machine and its owner right now. Throws TokenError otherwise. */
export function verifyToken(token: string, expect: TokenExpectation): TokenClaims {
  if (typeof token !== "string" || token.length > 4096) throw new TokenError("Malformed token.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new TokenError("Malformed token.");
  const [h, p, s] = parts;

  const header = json(h);
  // Only EdDSA: never "none", and never an HMAC that would treat the public key as a secret.
  if (header.alg !== "EdDSA") throw new TokenError("Unsupported token algorithm.");

  const key = typeof expect.publicKey === "string" ? publicKeyFrom(expect.publicKey) : expect.publicKey;
  if (!verify(null, Buffer.from(`${h}.${p}`), key, b64url(s))) throw new TokenError("Bad token signature.");

  const claims = json(p);
  const now = expect.now ?? Math.floor(Date.now() / 1000);
  const { iss, aud, sub, iat, exp } = claims;
  if (iss !== expect.issuer) throw new TokenError("Token is from another app.");
  if (aud !== `machine:${expect.machineId}`) throw new TokenError("Token is for another machine.");
  if (sub !== expect.ownerId) throw new TokenError("Token is for another user.");
  if (typeof iat !== "number" || typeof exp !== "number") throw new TokenError("Malformed token.");
  if (iat > now + SKEW) throw new TokenError("Token is from the future.");
  if (exp <= now - SKEW) throw new TokenError("Token expired.");
  const scope = claims.scope === undefined ? "full" : claims.scope;
  if (scope !== "full" && scope !== "read") throw new TokenError("Unknown token scope.");
  if (exp - iat > (scope === "read" ? MAX_READ_TOKEN_SECONDS : MAX_TOKEN_SECONDS)) throw new TokenError("Token lives too long.");

  return { iss, aud, sub, iat, exp, scope, email: typeof claims.email === "string" ? claims.email : undefined } as TokenClaims;
}
