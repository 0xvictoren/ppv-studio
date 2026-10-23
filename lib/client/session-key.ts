"use client";

import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { env } from "../env";

// Browser session keys. Generated locally, authorized onchain by the viewer, and used to
// sign receipts without a wallet popup. Scoped per (chain, contract, viewer).

export type StoredSessionKey = { privateKey: Hex; address: Address; expiry: number; spendCap: string; createdAt: number };

const storageKey = (viewer: string) => `ppw:sk:${env.chainId}:${env.ppwAddress.toLowerCase()}:${viewer.toLowerCase()}`;

export function listSessionKeys(viewer: string): StoredSessionKey[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(viewer)) ?? "[]");
  } catch {
    return [];
  }
}

function save(viewer: string, keys: StoredSessionKey[]) {
  try {
    localStorage.setItem(storageKey(viewer), JSON.stringify(keys));
  } catch {
    /* storage unavailable; key lives only for this page */
  }
}

/** Newest key that hasn't expired locally. Onchain status is checked separately. */
export function currentSessionKey(viewer: string): StoredSessionKey | null {
  const now = Date.now() / 1000;
  return listSessionKeys(viewer)
    .filter((k) => k.expiry > now + 60)
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

/** Create a key (not yet authorized onchain). Call `rememberSessionKey` once the tx confirms. */
export function newSessionKey(spendCap: bigint, ttlSeconds = 24 * 3600): StoredSessionKey {
  const privateKey = generatePrivateKey();
  return {
    privateKey,
    address: privateKeyToAccount(privateKey).address,
    expiry: Math.floor(Date.now() / 1000) + ttlSeconds,
    spendCap: spendCap.toString(),
    createdAt: Date.now(),
  };
}

export function rememberSessionKey(viewer: string, key: StoredSessionKey) {
  save(viewer, [...listSessionKeys(viewer).filter((k) => k.address !== key.address), key]);
}

export function forgetSessionKey(viewer: string, address: string) {
  save(viewer, listSessionKeys(viewer).filter((k) => k.address.toLowerCase() !== address.toLowerCase()));
}
