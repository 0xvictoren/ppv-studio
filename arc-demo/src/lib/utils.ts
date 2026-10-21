import { USDC_DECIMALS, CUSTOM_ERRORS, explorerTx } from './contract'

// ── Money ──────────────────────────────────────────────────────────────────
const SCALE = 10n ** BigInt(USDC_DECIMALS) // 1_000_000n

/** Parse a human "$0.50" string into raw USDC base-units bigint */
export function parseUsdc(human: string): bigint {
  const trimmed = human.replace(/[^0-9.]/g, '')
  if (!trimmed) return 0n
  const [intPart = '0', fracPart = ''] = trimmed.split('.')
  const frac = fracPart.padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS)
  return BigInt(intPart) * SCALE + BigInt(frac)
}

/** Format raw USDC base-units bigint → "$1.23 USDC" */
export function formatUsdc(raw: bigint, suffix = ' USDC'): string {
  const negative = raw < 0n
  const abs = negative ? -raw : raw
  const int = abs / SCALE
  const frac = abs % SCALE
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').slice(0, 2)
  return `${negative ? '-' : ''}$${int.toLocaleString()}.${fracStr}${suffix}`
}

/** Format a USDC bigint as a bare number string e.g. "1.23" */
export function formatUsdcBare(raw: bigint): string {
  const int = raw / SCALE
  const frac = (raw % SCALE).toString().padStart(USDC_DECIMALS, '0').slice(0, 2)
  return `${int}.${frac}`
}

// ── Address ────────────────────────────────────────────────────────────────
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ── Error parsing ──────────────────────────────────────────────────────────
export function parseContractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (lower.includes('user rejected') || lower.includes('denied') || lower.includes('rejected')) {
    return 'Transaction cancelled.'
  }

  // Try custom error selectors from revert data
  for (const [selector, human] of Object.entries(CUSTOM_ERRORS)) {
    if (msg.includes(selector)) return human
  }

  // Try matching error name by text
  const nameMap: Record<string, string> = {
    InsufficientBalance: 'Not enough USDC in escrow.',
    WithdrawDelayNotMet: 'Withdrawal delay not met. Please wait 1 hour after requesting.',
    ReceiptExpired: 'Receipt has expired.',
    SessionCapExceeded: 'Session key spend cap exceeded.',
    SessionKeyExpired: 'Session key has expired.',
    InvalidSignature: 'Invalid signature.',
    VideoAlreadyExists: 'Video ID already registered.',
    NotCreator: 'You are not the creator of this video.',
    InvalidPrice: 'Price must be > 0 and ≤ $100/hr.',
    FeeTooHigh: 'Fee must be ≤ 10%.',
    InvalidAmount: 'Invalid amount.',
    EnforcedPause: 'Contract is paused.',
    ZeroAddress: 'Zero address not allowed.',
  }
  for (const [name, human] of Object.entries(nameMap)) {
    if (msg.includes(name)) return human
  }

  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return 'Insufficient USDC. Get test USDC from the sidebar faucet.'
  }
  if (lower.includes('allowance')) {
    return 'USDC allowance too low. Approve more first.'
  }
  if (lower.includes('reverted')) return 'Transaction reverted.'
  if (lower.includes('network') || lower.includes('timeout')) return 'Network error. Please retry.'
  return 'Transaction failed. Please try again.'
}

// ── Tx link ────────────────────────────────────────────────────────────────
export { explorerTx }

// ── Countdown ─────────────────────────────────────────────────────────────
export function fmtCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return '0:00'
  const m = Math.floor(secondsLeft / 60)
  const s = secondsLeft % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Time ──────────────────────────────────────────────────────────────────
export function nowSecs(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

export function tsToDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleTimeString()
}
