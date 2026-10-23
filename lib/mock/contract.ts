import "server-only";
import { getAddress, keccak256, recoverTypedDataAddress, toHex, type Address, type Hex } from "viem";
import { eip712Domain, REFERRAL_BPS, receiptTypes, ZERO_ADDRESS, type PpwEvent, type Receipt } from "../contract";
import { MAX_PRICE_PER_HOUR, ONE_USDC } from "../money";

// In-memory simulation of PayPerWatch + USDC. Mirrors the contract's rules so the
// whole app (including server-side receipt checks and the hourly cron) runs end to end
// without a chain. State lives on globalThis so every route handler shares it.

type Video = { creator: Address; pricePerHour: bigint; active: boolean };
type SessionKey = { expiry: bigint; spendCap: bigint; spent: bigint };
type Withdrawal = { amount: bigint; availableAt: bigint };

type State = {
  block: bigint;
  feeBps: bigint;
  feeRecipient: Address;
  /** v4: platform fees accrue here and are pulled with withdrawFees(). */
  feesAccrued: bigint;
  videos: Map<Hex, Video>;
  balanceOf: Map<Address, bigint>;
  settled: Map<string, bigint>; // viewer:creator:referrer
  paidTo: Map<string, bigint>; // viewer:creator
  sessionKeys: Map<string, SessionKey>;
  pendingWithdrawal: Map<Address, Withdrawal>;
  usdc: Map<Address, bigint>;
  allowance: Map<string, bigint>;
  events: PpwEvent[];
};

const FAUCET = 50n * ONE_USDC;
export const WITHDRAW_DELAY = 86_400n; // v4 default: 24 hours

const g = globalThis as unknown as { __ppwMock?: State };
function state(): State {
  if (!g.__ppwMock) {
    g.__ppwMock = {
      block: 1n,
      feeBps: 500n,
      feeRecipient: "0x000000000000000000000000000000000000fEE0",
      feesAccrued: 0n,
      videos: new Map(),
      balanceOf: new Map(),
      settled: new Map(),
      paidTo: new Map(),
      sessionKeys: new Map(),
      pendingWithdrawal: new Map(),
      usdc: new Map(),
      allowance: new Map(),
      events: [],
    };
  }
  return g.__ppwMock;
}

export class MockRevert extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

const now = () => BigInt(Math.floor(Date.now() / 1000));
const pair = (a: Address, b: Address) => `${a.toLowerCase()}:${b.toLowerCase()}`;
const triple = (a: Address, b: Address, c: Address) => `${pair(a, b)}:${c.toLowerCase()}`;
const addr = (a: unknown) => getAddress(String(a));

function usdcOf(s: State, a: Address) {
  // Every new mock wallet gets test USDC so the demo works out of the box.
  if (!s.usdc.has(a)) s.usdc.set(a, FAUCET);
  return s.usdc.get(a)!;
}

function newTx(s: State): { hash: Hex; block: bigint } {
  s.block += 1n;
  const hash = keccak256(toHex(`mock-tx-${s.block}-${Math.random()}`));
  return { hash, block: s.block };
}

function emit(s: State, tx: { hash: Hex; block: bigint }, name: string, args: Record<string, unknown>) {
  const json: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(args)) json[k] = typeof v === "boolean" ? v : String(v);
  s.events.push({ name, args: json, txHash: tx.hash, blockNumber: tx.block.toString(), timestamp: Number(now()) });
}

// ---------------------------------------------------------------- reads

export function read(fn: string, args: unknown[]): unknown {
  const s = state();
  switch (fn) {
    case "videos": {
      const v = s.videos.get(String(args[0]).toLowerCase() as Hex);
      return v ? [v.creator, v.pricePerHour, v.active] : ["0x0000000000000000000000000000000000000000", 0n, false];
    }
    case "balanceOf":
      return s.balanceOf.get(addr(args[0])) ?? 0n;
    case "settled":
      return s.settled.get(triple(addr(args[0]), addr(args[1]), addr(args[2] ?? ZERO_ADDRESS))) ?? 0n;
    case "paidTo":
      return s.paidTo.get(pair(addr(args[0]), addr(args[1]))) ?? 0n;
    case "pendingWithdrawal": {
      const w = s.pendingWithdrawal.get(addr(args[0]));
      return w ? [w.amount, w.availableAt] : [0n, 0n];
    }
    case "sessionKeys": {
      const k = s.sessionKeys.get(pair(addr(args[0]), addr(args[1])));
      return k ? [k.expiry, k.spendCap, k.spent] : [0n, 0n, 0n];
    }
    case "feeBps":
      return s.feeBps;
    case "feesAccrued":
      return s.feesAccrued;
    case "WITHDRAW_DELAY":
      return WITHDRAW_DELAY;
    case "usdc.balanceOf":
      return usdcOf(s, addr(args[0]));
    case "usdc.allowance":
      return s.allowance.get(pair(addr(args[0]), addr(args[1]))) ?? 0n;
    default:
      throw new MockRevert(`Unknown read ${fn}`);
  }
}

// ---------------------------------------------------------------- writes

export function write(fn: string, args: unknown[], fromRaw: string): Hex {
  const s = state();
  const from = addr(fromRaw);
  const tx = newTx(s);

  const authorize = (key: Address, expiry: bigint, cap: bigint) => {
    if (expiry <= now()) throw new MockRevert("SessionKeyExpired");
    // v4: re-authorizing a key keeps what it already spent, so a re-auth can't reset the cap.
    const spent = s.sessionKeys.get(pair(from, key))?.spent ?? 0n;
    s.sessionKeys.set(pair(from, key), { expiry, spendCap: cap, spent });
    emit(s, tx, "SessionKeyAuthorized", { viewer: from, key, expiry, spendCap: cap });
  };
  const deposit = (amount: bigint) => {
    if (amount <= 0n) throw new MockRevert("InvalidAmount");
    const allowance = s.allowance.get(pair(from, from)) ?? 0n; // spender is the contract; one per owner in the mock
    if (allowance < amount) throw new MockRevert("ERC20InsufficientAllowance");
    const bal = usdcOf(s, from);
    if (bal < amount) throw new MockRevert("ERC20InsufficientBalance");
    s.usdc.set(from, bal - amount);
    s.allowance.set(pair(from, from), allowance - amount);
    s.balanceOf.set(from, (s.balanceOf.get(from) ?? 0n) + amount);
    emit(s, tx, "Deposited", { viewer: from, amount });
  };
  const ownVideo = (id: Hex) => {
    const v = s.videos.get(id.toLowerCase() as Hex);
    if (!v) throw new MockRevert("NotCreator");
    if (v.creator !== from) throw new MockRevert("NotCreator");
    return v;
  };

  switch (fn) {
    case "usdc.approve":
      s.allowance.set(pair(from, from), BigInt(args[1] as bigint));
      break;
    case "registerVideo": {
      const id = String(args[0]).toLowerCase() as Hex;
      const price = BigInt(args[1] as bigint);
      if (s.videos.has(id)) throw new MockRevert("VideoAlreadyExists");
      if (price === 0n || price > MAX_PRICE_PER_HOUR) throw new MockRevert("InvalidPrice");
      s.videos.set(id, { creator: from, pricePerHour: price, active: true });
      emit(s, tx, "VideoRegistered", { videoId: id, creator: from, pricePerHour: price });
      break;
    }
    case "updatePrice": {
      const v = ownVideo(args[0] as Hex);
      const price = BigInt(args[1] as bigint);
      if (price === 0n || price > MAX_PRICE_PER_HOUR) throw new MockRevert("InvalidPrice");
      v.pricePerHour = price;
      emit(s, tx, "PriceUpdated", { videoId: args[0], newPrice: price });
      break;
    }
    case "setVideoActive": {
      const v = ownVideo(args[0] as Hex);
      v.active = Boolean(args[1]);
      emit(s, tx, "VideoActiveSet", { videoId: args[0], active: v.active });
      break;
    }
    case "deposit":
      deposit(BigInt(args[0] as bigint));
      break;
    case "depositAndAuthorize":
      deposit(BigInt(args[0] as bigint));
      authorize(addr(args[1]), BigInt(args[2] as bigint), BigInt(args[3] as bigint));
      break;
    case "authorizeSessionKey":
      authorize(addr(args[0]), BigInt(args[1] as bigint), BigInt(args[2] as bigint));
      break;
    case "revokeSessionKey": {
      const key = addr(args[0]);
      s.sessionKeys.delete(pair(from, key));
      emit(s, tx, "SessionKeyRevoked", { viewer: from, key });
      break;
    }
    case "requestWithdraw": {
      const amount = BigInt(args[0] as bigint);
      if (amount === 0n) throw new MockRevert("InvalidAmount");
      if (amount > (s.balanceOf.get(from) ?? 0n)) throw new MockRevert("InsufficientBalance");
      const availableAt = now() + WITHDRAW_DELAY;
      s.pendingWithdrawal.set(from, { amount, availableAt });
      emit(s, tx, "WithdrawRequested", { viewer: from, amount, availableAt });
      break;
    }
    case "withdraw": {
      const w = s.pendingWithdrawal.get(from);
      if (!w || w.amount === 0n) throw new MockRevert("InvalidAmount");
      if (now() < w.availableAt) throw new MockRevert("WithdrawDelayNotMet");
      const bal = s.balanceOf.get(from) ?? 0n;
      const pay = w.amount < bal ? w.amount : bal;
      s.pendingWithdrawal.delete(from);
      s.balanceOf.set(from, bal - pay);
      s.usdc.set(from, usdcOf(s, from) + pay);
      emit(s, tx, "Withdrawn", { viewer: from, amount: pay });
      break;
    }
    case "withdrawFees": {
      if (s.feesAccrued === 0n) throw new MockRevert("InvalidAmount");
      const amount = s.feesAccrued;
      s.feesAccrued = 0n;
      s.usdc.set(s.feeRecipient, usdcOf(s, s.feeRecipient) + amount);
      emit(s, tx, "FeesWithdrawn", { recipient: s.feeRecipient, amount });
      break;
    }
    case "cancelWithdraw":
      s.pendingWithdrawal.delete(from);
      emit(s, tx, "WithdrawCancelled", { viewer: from });
      break;
    default:
      throw new MockRevert(`Unknown function ${fn}`);
  }
  return tx.hash;
}

/** Demo-only: make a pending withdrawal claimable now instead of waiting a day. */
export function fastForwardWithdrawal(viewer: string) {
  const w = state().pendingWithdrawal.get(addr(viewer));
  if (w) w.availableAt = now();
}

// ---------------------------------------------------------------- settlement

export async function settleBatch(rs: Receipt[], sigs: Hex[]): Promise<Hex> {
  const s = state();
  const tx = newTx(s);
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    try {
      await settleOne(s, tx, r, sigs[i]);
    } catch (e) {
      emit(s, tx, "SettlementSkipped", { index: i, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return tx.hash;
}

async function settleOne(s: State, tx: { hash: Hex; block: bigint }, r: Receipt, sig: Hex) {
  if (now() > r.deadline) throw new MockRevert("ReceiptExpired");
  const viewer = addr(r.viewer);
  const creator = addr(r.creator);
  const referrer = addr(r.referrer ?? ZERO_ADDRESS);
  const signer = await recoverTypedDataAddress({
    domain: eip712Domain,
    types: receiptTypes,
    primaryType: "Receipt",
    message: r,
    signature: sig,
  });
  let key: SessionKey | undefined;
  if (signer !== viewer) {
    key = s.sessionKeys.get(pair(viewer, signer));
    if (!key) throw new MockRevert("InvalidSignature");
    if (key.expiry <= now()) throw new MockRevert("SessionKeyExpired");
  }
  const prev = s.settled.get(triple(viewer, creator, referrer)) ?? 0n;
  if (r.cumulativeAmount <= prev) return; // stale: no-op
  const requested = r.cumulativeAmount - prev;
  const bal = s.balanceOf.get(viewer) ?? 0n;
  const delta = requested <= bal ? requested : bal;
  // Same as the contract: cap is checked against the signed delta, spent grows by what's paid.
  if (key) {
    if (key.spent + requested > key.spendCap) throw new MockRevert("SessionCapExceeded");
    key.spent += delta;
  }
  if (delta < requested) emit(s, tx, "PartialSettlement", { viewer, creator, actualDelta: delta, requestedDelta: requested });
  const fee = (delta * s.feeBps) / 10_000n;
  // Same rule as the contract: the referrer must already have paid this creator, and can't be the viewer or creator.
  const validRef =
    referrer !== ZERO_ADDRESS && referrer !== viewer && referrer !== creator && (s.paidTo.get(pair(referrer, creator)) ?? 0n) > 0n;
  const referralAmount = validRef ? (delta * REFERRAL_BPS) / 10_000n : 0n;
  s.settled.set(triple(viewer, creator, referrer), prev + delta);
  s.paidTo.set(pair(viewer, creator), (s.paidTo.get(pair(viewer, creator)) ?? 0n) + delta);
  s.balanceOf.set(viewer, bal - delta);
  s.usdc.set(creator, usdcOf(s, creator) + delta - fee - referralAmount);
  s.feesAccrued += fee;
  if (referralAmount > 0n) s.usdc.set(referrer, usdcOf(s, referrer) + referralAmount);
  emit(s, tx, "Settled", { viewer, creator, referrer, delta, fee, referralAmount, cumulativeAmount: r.cumulativeAmount });
}

export function events(): PpwEvent[] {
  return state().events;
}
