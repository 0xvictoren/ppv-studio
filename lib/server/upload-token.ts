import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Short-lived, HMAC-signed claims: upload permission, streaming access, downloads.

const secret = () => process.env.SESSION_SECRET ?? "dev-only-insecure-session-secret-change-me-please";

export function signClaim<T extends { exp: number }>(claim: T): string {
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyClaim<T extends { exp: number }>(token: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return claim.exp > Date.now() ? claim : null;
  } catch {
    return null;
  }
}

export type UploadClaim = { kind?: "upload"; id: string; ext: string; addr: string; exp: number };
export const signUpload = (claim: UploadClaim) => signClaim({ ...claim, kind: "upload" as const });
export const verifyUpload = (token: string) => {
  const c = verifyClaim<UploadClaim>(token);
  return c && c.kind === "upload" ? c : null;
};

/** Access to one local media file for a while: streaming (player) or a one-off download. */
export type MediaClaim = { kind: "stream" | "download"; file: string; viewer: string; exp: number };
export const signMedia = (claim: MediaClaim) => signClaim(claim);
export const verifyMedia = (token: string, kind: MediaClaim["kind"]) => {
  const c = verifyClaim<MediaClaim>(token);
  return c && c.kind === kind ? c : null;
};
