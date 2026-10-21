"use client";

import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { viewerAuthMessage } from "../viewer-auth";
import type { StoredSessionKey } from "./session-key";

/**
 * Headers that prove a request comes from `viewer`, signed by their browser session key
 * (no wallet popup). Without a session key, the SIWE cookie is used instead (empty headers).
 */
export async function viewerAuthHeaders(viewer: Address | undefined, key: StoredSessionKey | null): Promise<Record<string, string>> {
  if (!viewer || !key) return {};
  const ts = Math.floor(Date.now() / 1000);
  const sig = await privateKeyToAccount(key.privateKey).signMessage({ message: viewerAuthMessage(viewer, ts) });
  return { "x-ppw-auth": `${ts}.${sig}` };
}
