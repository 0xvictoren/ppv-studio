/**
 * PayPerWatch contract config — Arc Testnet
 */
import type { Abi } from 'viem'

export const PPW_ADDRESS = '0x5ce5d5b34a09a0406b4b9c2e9da7ffafb006d51d' as const
export const CHAIN_ID = 5042002
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const USDC_DECIMALS = 6
export const EXPLORER_BASE = 'https://explorer.testnet.arc.io'

export function explorerTx(hash: string) {
  return `${EXPLORER_BASE}/tx/${hash}`
}
export function explorerAddr(addr: string) {
  return `${EXPLORER_BASE}/address/${addr}`
}

// EIP-712 domain
export const EIP712_DOMAIN = {
  name: 'PayPerWatch',
  version: '1',
  chainId: BigInt(CHAIN_ID),
  verifyingContract: PPW_ADDRESS,
} as const

export const RECEIPT_TYPES = {
  Receipt: [
    { name: 'viewer',           type: 'address' },
    { name: 'creator',          type: 'address' },
    { name: 'cumulativeAmount', type: 'uint256' },
    { name: 'deadline',         type: 'uint64'  },
  ],
} as const

// Custom-error selector → human message
export const CUSTOM_ERRORS: Record<string, string> = {
  '0x7939f424': 'Video already registered.',
  '0xe0213be7': 'Invalid price.',
  '0x21c37055': 'You are not the creator of this video.',
  '0x8baa579f': 'Invalid signature.',
  '0x6d35a8b4': 'Receipt has expired.',
  '0x3e7d9fc9': 'Session key spend cap exceeded.',
  '0xd66b8c5b': 'Session key has expired.',
  '0x41f5817f': 'Withdrawal delay not met. Please wait.',
  '0x6f17d3a7': 'Insufficient USDC in escrow.',
  '0xd92e233d': 'Zero address not allowed.',
  '0x8b55c716': 'Fee too high (max 10%).',
  '0x2c5211c6': 'Invalid amount.',
}

export const PPW_ABI = [
  // Constructor
  { "type": "constructor", "inputs": [{ "name": "usdc_", "type": "address" }, { "name": "feeBps_", "type": "uint16" }, { "name": "feeRecipient_", "type": "address" }, { "name": "initialOwner_", "type": "address" }], "stateMutability": "nonpayable" },
  // Functions
  { "type": "function", "name": "registerVideo", "inputs": [{ "name": "videoId", "type": "bytes32" }, { "name": "pricePerHour", "type": "uint128" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "updatePrice", "inputs": [{ "name": "videoId", "type": "bytes32" }, { "name": "newPrice", "type": "uint128" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "setVideoActive", "inputs": [{ "name": "videoId", "type": "bytes32" }, { "name": "active", "type": "bool" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "deposit", "inputs": [{ "name": "amount", "type": "uint256" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "depositAndAuthorize", "inputs": [{ "name": "amount", "type": "uint256" }, { "name": "key", "type": "address" }, { "name": "expiry", "type": "uint64" }, { "name": "spendCap", "type": "uint128" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "authorizeSessionKey", "inputs": [{ "name": "key", "type": "address" }, { "name": "expiry", "type": "uint64" }, { "name": "spendCap", "type": "uint128" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "revokeSessionKey", "inputs": [{ "name": "key", "type": "address" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "requestWithdraw", "inputs": [{ "name": "amount", "type": "uint256" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "withdraw", "inputs": [], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "cancelWithdraw", "inputs": [], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "settle", "inputs": [{ "name": "r", "type": "tuple", "components": [{ "name": "viewer", "type": "address" }, { "name": "creator", "type": "address" }, { "name": "cumulativeAmount", "type": "uint256" }, { "name": "deadline", "type": "uint64" }] }, { "name": "sig", "type": "bytes" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "settleBatch", "inputs": [{ "name": "rs", "type": "tuple[]", "components": [{ "name": "viewer", "type": "address" }, { "name": "creator", "type": "address" }, { "name": "cumulativeAmount", "type": "uint256" }, { "name": "deadline", "type": "uint64" }] }, { "name": "sigs", "type": "bytes[]" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "setFee", "inputs": [{ "name": "bps", "type": "uint16" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "setFeeRecipient", "inputs": [{ "name": "recipient", "type": "address" }], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "pause", "inputs": [], "outputs": [], "stateMutability": "nonpayable" },
  { "type": "function", "name": "unpause", "inputs": [], "outputs": [], "stateMutability": "nonpayable" },
  // Views
  { "type": "function", "name": "balanceOf", "inputs": [{ "name": "", "type": "address" }], "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view" },
  { "type": "function", "name": "settled", "inputs": [{ "name": "", "type": "address" }, { "name": "", "type": "address" }], "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view" },
  { "type": "function", "name": "pendingWithdrawal", "inputs": [{ "name": "", "type": "address" }], "outputs": [{ "name": "amount", "type": "uint128" }, { "name": "availableAt", "type": "uint64" }], "stateMutability": "view" },
  { "type": "function", "name": "sessionKeys", "inputs": [{ "name": "", "type": "address" }, { "name": "", "type": "address" }], "outputs": [{ "name": "expiry", "type": "uint64" }, { "name": "spendCap", "type": "uint128" }, { "name": "spent", "type": "uint128" }], "stateMutability": "view" },
  { "type": "function", "name": "videos", "inputs": [{ "name": "", "type": "bytes32" }], "outputs": [{ "name": "creator", "type": "address" }, { "name": "pricePerHour", "type": "uint128" }, { "name": "active", "type": "bool" }], "stateMutability": "view" },
  { "type": "function", "name": "getVideo", "inputs": [{ "name": "videoId", "type": "bytes32" }], "outputs": [{ "name": "", "type": "tuple", "components": [{ "name": "creator", "type": "address" }, { "name": "pricePerHour", "type": "uint128" }, { "name": "active", "type": "bool" }] }], "stateMutability": "view" },
  { "type": "function", "name": "hashReceipt", "inputs": [{ "name": "r", "type": "tuple", "components": [{ "name": "viewer", "type": "address" }, { "name": "creator", "type": "address" }, { "name": "cumulativeAmount", "type": "uint256" }, { "name": "deadline", "type": "uint64" }] }], "outputs": [{ "name": "", "type": "bytes32" }], "stateMutability": "view" },
  { "type": "function", "name": "DOMAIN_SEPARATOR", "inputs": [], "outputs": [{ "name": "", "type": "bytes32" }], "stateMutability": "view" },
  { "type": "function", "name": "feeBps", "inputs": [], "outputs": [{ "name": "", "type": "uint16" }], "stateMutability": "view" },
  { "type": "function", "name": "feeRecipient", "inputs": [], "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view" },
  { "type": "function", "name": "usdc", "inputs": [], "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view" },
  { "type": "function", "name": "paused", "inputs": [], "outputs": [{ "name": "", "type": "bool" }], "stateMutability": "view" },
  { "type": "function", "name": "owner", "inputs": [], "outputs": [{ "name": "", "type": "address" }], "stateMutability": "view" },
  { "type": "function", "name": "MAX_BATCH", "inputs": [], "outputs": [{ "name": "", "type": "uint256" }], "stateMutability": "view" },
  { "type": "function", "name": "WITHDRAW_DELAY", "inputs": [], "outputs": [{ "name": "", "type": "uint64" }], "stateMutability": "view" },
  { "type": "function", "name": "_settleEntry", "inputs": [{ "name": "r", "type": "tuple", "components": [{ "name": "viewer", "type": "address" }, { "name": "creator", "type": "address" }, { "name": "cumulativeAmount", "type": "uint256" }, { "name": "deadline", "type": "uint64" }] }, { "name": "sig", "type": "bytes" }], "outputs": [], "stateMutability": "nonpayable" },
  // Events
  { "type": "event", "name": "VideoRegistered", "inputs": [{ "name": "videoId", "type": "bytes32", "indexed": true }, { "name": "creator", "type": "address", "indexed": true }, { "name": "pricePerHour", "type": "uint128", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "PriceUpdated", "inputs": [{ "name": "videoId", "type": "bytes32", "indexed": true }, { "name": "newPrice", "type": "uint128", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "VideoActiveSet", "inputs": [{ "name": "videoId", "type": "bytes32", "indexed": true }, { "name": "active", "type": "bool", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "Deposited", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }, { "name": "amount", "type": "uint256", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "SessionKeyAuthorized", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }, { "name": "key", "type": "address", "indexed": true }, { "name": "expiry", "type": "uint64", "indexed": false }, { "name": "spendCap", "type": "uint128", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "SessionKeyRevoked", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }, { "name": "key", "type": "address", "indexed": true }], "anonymous": false },
  { "type": "event", "name": "WithdrawRequested", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }, { "name": "amount", "type": "uint256", "indexed": false }, { "name": "availableAt", "type": "uint64", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "WithdrawCancelled", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }], "anonymous": false },
  { "type": "event", "name": "Withdrawn", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }, { "name": "amount", "type": "uint256", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "Settled", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }, { "name": "creator", "type": "address", "indexed": true }, { "name": "delta", "type": "uint256", "indexed": false }, { "name": "fee", "type": "uint256", "indexed": false }, { "name": "cumulativeAmount", "type": "uint256", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "PartialSettlement", "inputs": [{ "name": "viewer", "type": "address", "indexed": true }, { "name": "creator", "type": "address", "indexed": true }, { "name": "actualDelta", "type": "uint256", "indexed": false }, { "name": "requestedDelta", "type": "uint256", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "SettlementSkipped", "inputs": [{ "name": "index", "type": "uint256", "indexed": true }, { "name": "reason", "type": "bytes4", "indexed": false }], "anonymous": false },
  { "type": "event", "name": "FeeUpdated", "inputs": [{ "name": "bps", "type": "uint16", "indexed": false }], "anonymous": false },
  // Errors
  { "type": "error", "name": "VideoAlreadyExists", "inputs": [] },
  { "type": "error", "name": "InvalidPrice", "inputs": [] },
  { "type": "error", "name": "NotCreator", "inputs": [] },
  { "type": "error", "name": "InvalidSignature", "inputs": [] },
  { "type": "error", "name": "ReceiptExpired", "inputs": [] },
  { "type": "error", "name": "SessionCapExceeded", "inputs": [] },
  { "type": "error", "name": "SessionKeyExpired", "inputs": [] },
  { "type": "error", "name": "WithdrawDelayNotMet", "inputs": [] },
  { "type": "error", "name": "InsufficientBalance", "inputs": [] },
  { "type": "error", "name": "ZeroAddress", "inputs": [] },
  { "type": "error", "name": "FeeTooHigh", "inputs": [] },
  { "type": "error", "name": "InvalidAmount", "inputs": [] },
  { "type": "error", "name": "EnforcedPause", "inputs": [] },
  { "type": "error", "name": "ExpectedPause", "inputs": [] },
  { "type": "error", "name": "ReentrancyGuardReentrantCall", "inputs": [] },
] as const satisfies Abi
