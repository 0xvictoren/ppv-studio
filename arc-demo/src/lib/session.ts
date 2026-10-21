/**
 * Browser session-key and receipt persistence
 * All state is keyed per viewer address.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'

export interface SessionKeyData {
  privateKey: Hex
  address: Address
  expiry: number   // unix seconds
  spendCap: bigint // USDC raw
}

export interface StoredReceipt {
  viewer: Address
  creator: Address
  cumulativeAmount: bigint
  deadline: bigint
  signature: Hex
}

// ── Storage keys ───────────────────────────────────────────────────────────
function skKey(viewer: Address) { return `ppw_sk_${viewer.toLowerCase()}` }
function receiptKey(viewer: Address, creator: Address) {
  return `ppw_receipt_${viewer.toLowerCase()}_${creator.toLowerCase()}`
}

// ── Session key ────────────────────────────────────────────────────────────
export function getOrCreateSessionKey(viewer: Address, spendCapRaw: bigint): SessionKeyData {
  const existing = loadSessionKey(viewer)
  if (existing && existing.expiry > Math.floor(Date.now() / 1000) + 60) {
    return existing
  }
  return createNewSessionKey(viewer, spendCapRaw)
}

export function createNewSessionKey(viewer: Address, spendCapRaw: bigint): SessionKeyData {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  const expiry = Math.floor(Date.now() / 1000) + 86400 // 24 hours
  const data: SessionKeyData = {
    privateKey,
    address: account.address,
    expiry,
    spendCap: spendCapRaw,
  }
  localStorage.setItem(skKey(viewer), JSON.stringify({
    ...data,
    spendCap: spendCapRaw.toString(),
  }))
  return data
}

export function loadSessionKey(viewer: Address): SessionKeyData | null {
  try {
    const raw = localStorage.getItem(skKey(viewer))
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      privateKey: Hex
      address: Address
      expiry: number
      spendCap: string
    }
    return { ...parsed, spendCap: BigInt(parsed.spendCap) }
  } catch {
    return null
  }
}

export function clearSessionKey(viewer: Address) {
  localStorage.removeItem(skKey(viewer))
}

// ── Cumulative receipts ────────────────────────────────────────────────────
export function loadReceipt(viewer: Address, creator: Address): StoredReceipt | null {
  try {
    const raw = localStorage.getItem(receiptKey(viewer, creator))
    if (!raw) return null
    const p = JSON.parse(raw) as {
      viewer: Address
      creator: Address
      cumulativeAmount: string
      deadline: string
      signature: Hex
    }
    return {
      ...p,
      cumulativeAmount: BigInt(p.cumulativeAmount),
      deadline: BigInt(p.deadline),
    }
  } catch {
    return null
  }
}

export function saveReceipt(r: StoredReceipt) {
  const key = receiptKey(r.viewer, r.creator)
  localStorage.setItem(key, JSON.stringify({
    ...r,
    cumulativeAmount: r.cumulativeAmount.toString(),
    deadline: r.deadline.toString(),
  }))
}

export function allStoredReceipts(viewer: Address): StoredReceipt[] {
  const results: StoredReceipt[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(`ppw_receipt_${viewer.toLowerCase()}_`)) continue
    try {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const p = JSON.parse(raw) as {
        viewer: Address
        creator: Address
        cumulativeAmount: string
        deadline: string
        signature: Hex
      }
      results.push({
        ...p,
        cumulativeAmount: BigInt(p.cumulativeAmount),
        deadline: BigInt(p.deadline),
      })
    } catch {
      // skip corrupt entry
    }
  }
  return results
}
