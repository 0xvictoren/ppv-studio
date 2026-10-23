import "server-only";
import { getAddress, isAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { viewerAuthMessage } from "../viewer-auth";
import { isActiveSessionKey } from "./chain";
import { sessionAddress } from "./session";

const MAX_SKEW_S = 300;

/**
 * Prove a request comes from `viewer` without a wallet popup:
 *  - a SIWE session cookie for that wallet, or
 *  - header `x-ppw-auth: <unix-ts>.<signature>` where the signature over
 *    viewerAuthMessage(viewer, ts) is by the viewer or one of their active session keys.
 * Returns how the viewer was authenticated, or null. The header is checked first: a signed-in
 * viewer who also sends a session-key signature must come back as "session-key", since paid
 * streaming needs a key that can bill.
 */
export async function authViewer(req: Request, viewer: string): Promise<"siwe" | "session-key" | "wallet" | null> {
  if (!isAddress(viewer)) return null;
  const v = getAddress(viewer);
  const signed = await headerAuth(req, v);
  if (signed) return signed;
  return (await sessionAddress()) === v.toLowerCase() ? "siwe" : null;
}

async function headerAuth(req: Request, v: Address): Promise<"session-key" | "wallet" | null> {
  const header = req.headers.get("x-ppw-auth");
  if (!header) return null;
  const [tsStr, sig] = header.split(".");
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_S || !sig) return null;
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message: viewerAuthMessage(v, ts), signature: sig as Hex });
  } catch {
    return null;
  }
  if (signer === v) return "wallet";
  return (await isActiveSessionKey(v, signer)) ? "session-key" : null;
}
