import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./secret";

// Short-lived, HMAC-signed claims: upload permission, streaming access, downloads.

const secret = sessionSecret;

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

/**
 * Proof that /api/storage/upload issued this storage location to this wallet, so reviews and
 * listings can't point at a URL the uploader controls (and could swap after the originality check).
 */
export type UploadRefClaim = { kind: "upload-ref"; addr: string; contentId: string; playbackUrl: string; exp: number };
const UPLOAD_REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const signUploadRef = (c: Pick<UploadRefClaim, "addr" | "contentId" | "playbackUrl">) =>
  signClaim<UploadRefClaim>({ ...c, kind: "upload-ref", exp: Date.now() + UPLOAD_REF_TTL_MS });

/** Was this upload's location issued by us to `addr`? IPFS (Pinata) needs no ref: a CID can't be swapped. */
export function uploadIsIssued(addr: string, contentId: string, playbackUrl: string, ref: unknown): boolean {
  const gateway = process.env.PINATA_GATEWAY;
  if (gateway && /^[A-Za-z0-9]{20,100}$/.test(contentId) && playbackUrl === `https://${gateway}/ipfs/${contentId}`) return true;
  if (typeof ref !== "string") return false;
  const c = verifyClaim<UploadRefClaim>(ref);
  return !!c && c.kind === "upload-ref" && c.addr === addr.toLowerCase() && c.contentId === contentId && c.playbackUrl === playbackUrl;
}

/**
 * Access to one media file for a while: streaming (player), a one-off download, or an encrypted
 * HLS playlist and its segment keys (file = the content id).
 */
export type MediaClaim = { kind: "stream" | "download" | "hls"; file: string; viewer: string; exp: number };
export const signMedia = (claim: MediaClaim) => signClaim(claim);
export const verifyMedia = (token: string, kind: MediaClaim["kind"]) => {
  const c = verifyClaim<MediaClaim>(token);
  return c && c.kind === kind ? c : null;
};
