# PayPerWatch — Contract README (v4)

## Overview

PayPerWatch is an escrow-and-settle contract on Arc (Circle's USDC-native chain). Viewers deposit USDC once, watch videos with per-second billing tracked off-chain, and a settler relayer submits signed EIP-712 receipts hourly. Creators receive payment automatically at settlement. Unused USDC can be withdrawn after an adjustable delay (default 24 hours).

v4 applies all audit findings from the v3 security review: OOG-safe batch settlement, adjustable withdraw delay, pull-payment fees, timelocked fee changes, and preserved session-key spend accounting on re-authorization.

---

## What Changed in v4 (vs v3)

| Finding | Fix |
|---|---|
| M-1 OOG silent skip | `gasleft() < GAS_PER_ENTRY + BATCH_GAS_OVERHEAD` reverts `InsufficientGasForBatch` before each entry |
| M-2 Withdraw race | `WITHDRAW_DELAY` now owner-adjustable, default 24 h, bounds [1 h, 7 d] via `setWithdrawDelay` |
| M-3 Blocklisted feeRecipient | Fees accrue in `feesAccrued`; pulled via `withdrawFees()`. Creator and referrer still receive direct push. |
| M-4 Retroactive fee changes | `setFee` / `setReferralBps` now queue a proposal applied after 48 h via `applyFee` / `applyReferralBps`; `feeBps + referralBps <= 1500` enforced at proposal time |
| L-2 spent reset on re-auth | `_authorizeSessionKey` preserves existing `spent` when re-authorizing an unexpired key |
| L-1, L-3, L-5, L-6 | NatSpec documentation; no code change |

---

## Flow

```
1. Viewer approves USDC → deposit() or depositAndAuthorize()
   → USDC moves into contract escrow (balanceOf[viewer] increases)

2. Browser generates a temp session key (private key in localStorage)
   → authorizeSessionKey(key, expiry=now+24h, spendCap=depositAmount)
   depositAndAuthorize() does steps 1 + 2 in one transaction.

3. Viewer watches. Frontend tracks seconds × pricePerHour / 3600.
   Every 60s and on pause/exit, the session key signs an EIP-712 Receipt:
     { viewer, creator, referrer, cumulativeAmount, deadline }
   cumulativeAmount = all-time cumulative owed by this viewer to this creator
   under this specific referrer (one lane per referrer value).
   Receipt is POSTed to the API server (stores only the latest per lane).

4. Hourly cron: settler reads the latest receipt per (viewer, creator, referrer),
   filters those with cumulativeAmount > settled(viewer, creator, referrer),
   sorts no-referrer (0x0) receipts first so a referrer's own viewing settles
   before any receipt that depends on their paidTo eligibility,
   calls settleBatch(receipts, sigs).
   → settled[viewer][creator][referrer] advances; creator + referrer receive USDC.
   → Platform fee accrues in feesAccrued (pull via withdrawFees()).

5. Viewer calls requestWithdraw(amount), waits withdrawDelay (default 24h), calls withdraw().
   → Unused USDC returned.

6. Platform calls withdrawFees() at any time to pull accrued platform fees to feeRecipient.
```

---

## Referral Rules

### Split at settlement

For each `actualDelta` (viewer's actual payment, capped at their balance):

```
fee             = actualDelta * feeBps / 10_000          (accrued in feesAccrued)
referralAmount  = valid ? actualDelta * referralBps / 10_000 : 0   (pushed to referrer)
creatorAmount   = actualDelta - fee - referralAmount     (pushed to creator)
```

Integer division truncates toward zero; any remainder (at most 2 micro-USDC) goes to the creator.

Combined constraint: `feeBps + referralBps <= 1500` (15% max), enforced at proposal time.

### Validity check

A referrer is **valid** iff ALL of the following hold at settlement time:
1. `r.referrer != address(0)` — non-zero address
2. `r.referrer != r.viewer` — no self-referral
3. `r.referrer != r.creator` — creator cannot be own referrer
4. `paidTo[r.referrer][r.creator] > 0` — the referrer must have previously paid to watch this creator

Condition 4 prevents a fresh wallet from claiming referral revenue before they have any economic stake.

### Lane keying by signed referrer

Cumulative settlement is tracked per `(viewer, creator, referrer)` — each distinct `referrer` value is an independent lane in `settled[viewer][creator][referrer]`. The `referrer` in a receipt is bound to the viewer's signature: a third party cannot create or manipulate a lane on behalf of a viewer.

### Why signed-referrer lane keying is safe

1. **Signature binding.** Each lane requires a fresh EIP-712 signature by the viewer or their authorized session key over the exact `referrer` value.
2. **Session-key spendCap bounds total spend.** The session key's `spent` counter increments by `actualDelta` across ALL lanes together. Re-authorizing a key with `authorizeSessionKey` preserves the existing `spent` counter — the cap cannot be reset without revoking and creating a new key.

### Invalid-then-valid referrer scenario (correct behavior)

A viewer signs receipts via a referrer X when X is not yet eligible:
- First receipt (cumulative=500): `settled[viewer][creator][X]` = 500; referralAmount=0.
- X then watches the same creator → `paidTo[X][creator]` > 0.
- Next receipt (cumulative=800): delta=300 (prior=500), referralAmount=300*referralBps/10000, X gets it.
- Viewer is charged exactly 800 total (no double charge).

---

## Security Model

### Trust hierarchy

- **Owner**: can pause/unpause deposits and settlement, propose `feeBps`/`referralBps` changes (48h timelock), set `feeRecipient` (immediate), set `withdrawDelay` (immediate). Ownership is Ownable2Step. The owner has NO path to viewer or creator funds.
- **Settler**: trusted only for LIVENESS. `settleBatch` is open to anyone — funds always go to the creator and referrer named in the signed receipt.
- **Session keys**: spend up to `spendCap` before expiry across all lanes. Re-authorizing preserves `spent`; revoking immediately stops future settlements.

### OOG-safe batch settlement

`settleBatch` checks `gasleft() < GAS_PER_ENTRY (250 000) + BATCH_GAS_OVERHEAD (50 000)` before each entry. If gas is insufficient, the entire transaction reverts with `InsufficientGasForBatch` — no silent skips. The settler must re-submit with sufficient gas or split the batch.

Genuine per-entry failures (bad signature, expired, stale) still emit `SettlementSkipped(i, reason)` and continue.

### Replay protection

Receipts are cumulative per `(viewer, creator, referrer)` lane. Replaying an old receipt with `cumulativeAmount <= prior` is a no-op. Cross-chain and cross-contract replay is prevented by the EIP-712 domain (chainId + verifyingContract).

### Reentrancy

All fund-moving entry points use `nonReentrant`. Strict CEI: all state changes (`settled`, `paidTo`, `balanceOf`, `feesAccrued`, `session.spent`) happen before external USDC transfers.

### Pause behavior

When paused: deposits and settlement halt. `withdraw()`, `requestWithdraw()`, and `withdrawFees()` all keep working — users and the platform can always exit funds regardless of pause state.

---

## Known Limitations (v4 MVP)

1. **Push payments to creator and referrer**: settlement directly transfers USDC to `r.creator` and `r.referrer`. If either is blocklisted on Arc, that settlement lane fails (emits `SettlementSkipped`). Viewer funds stay in escrow. For production, consider pull-based accounting for creators and referrers too.
2. **Fee timelock only, not instant**: `setFee` / `setReferralBps` queue a 48h timelock. This is stronger than v3 (immediate), but does not prevent an owner from proposing a raise without warning. A multisig + governance mitigates the trust requirement.
3. **No video-level receipts**: receipts are per viewer→creator→referrer triple, not per video. The frontend sums per-video time into a per-creator cumulative.
4. **1-hour minimum withdraw delay**: even at the minimum (1h), a short-running settler can still race the delay. Operational control: run settler at < withdrawDelay interval. Default 24h provides much more buffer than v3's 1h constant.
5. **MAX_BATCH = 100**: `settleBatch` is capped at 100 receipts per transaction.
6. **Referrer eligibility is permanent once unlocked**: once `paidTo[referrer][creator] > 0` it stays positive.
7. **Owner powers**: for mainnet, transfer ownership to a multisig before going live.

---

## Contract Interface Reference (v4)

### Creator
```solidity
registerVideo(bytes32 videoId, uint128 pricePerHour)
updatePrice(bytes32 videoId, uint128 newPrice)
setVideoActive(bytes32 videoId, bool active)   // UI signal only; not enforced on settlement
```

### Viewer
```solidity
deposit(uint256 amount)
depositAndAuthorize(uint256 amount, address key, uint64 expiry, uint128 spendCap)
authorizeSessionKey(address key, uint64 expiry, uint128 spendCap)   // preserves spent if re-authorizing
revokeSessionKey(address key)
requestWithdraw(uint256 amount)
withdraw()
cancelWithdraw()
```

### Settlement (open to anyone)
```solidity
settle(Receipt calldata r, bytes calldata sig)
settleBatch(Receipt[] calldata rs, bytes[] calldata sigs)   // max 100; reverts InsufficientGasForBatch if under-gassed
```

### Fee withdrawal (open to anyone)
```solidity
withdrawFees()   // pulls feesAccrued to feeRecipient
```

### Views
```solidity
getVideo(bytes32 videoId) returns (Video)
hashReceipt(Receipt) returns (bytes32)
DOMAIN_SEPARATOR() returns (bytes32)
balanceOf(address viewer) returns (uint256)
settled(address viewer, address creator, address referrer) returns (uint256)
paidTo(address viewer, address creator) returns (uint256)
pendingWithdrawal(address viewer) returns (uint128 amount, uint64 availableAt)
sessionKeys(address viewer, address key) returns (uint64 expiry, uint128 spendCap, uint128 spent)
feeBps() returns (uint16)
referralBps() returns (uint16)
feeRecipient() returns (address)
feesAccrued() returns (uint256)
WITHDRAW_DELAY() returns (uint64)           // current delay (view, not constant)
MAX_BATCH() returns (uint256)               // 100
MAX_REFERRAL_BPS() returns (uint16)         // 1000
MAX_COMBINED_BPS() returns (uint16)         // 1500
GAS_PER_ENTRY() returns (uint256)           // 250000
BATCH_GAS_OVERHEAD() returns (uint256)      // 50000
FEE_TIMELOCK() returns (uint64)             // 48 hours
pendingFeeBps() returns (uint16)
pendingFeeApplicableAt() returns (uint64)
pendingReferralBps() returns (uint16)
pendingReferralApplicableAt() returns (uint64)
```

### Owner
```solidity
proposeFee(uint16 bps)          // queues change; enforces feeBps+referralBps <= 1500
setFee(uint16 bps)              // backward-compat alias for proposeFee
applyFee()                      // callable by anyone after FEE_TIMELOCK
proposeReferralBps(uint16 bps)  // queues change; enforces combined cap
setReferralBps(uint16 bps)      // backward-compat alias for proposeReferralBps
applyReferralBps()              // callable by anyone after FEE_TIMELOCK
setFeeRecipient(address)        // immediate
setWithdrawDelay(uint64)        // [1h, 7d]; immediate
pause()
unpause()
```

---

## ABI Changes vs v3

### Added functions
- `proposeFee(uint16)` — queues fee change with 48h timelock
- `applyFee()` — applies pending fee after timelock
- `proposeReferralBps(uint16)` — queues referral rate change
- `applyReferralBps()` — applies pending referral rate after timelock
- `setWithdrawDelay(uint64)` — sets adjustable withdraw delay
- `withdrawFees()` — pulls accrued fees to feeRecipient

### Changed behavior (signatures unchanged)
- `setFee(uint16)` — now an alias for `proposeFee`; does NOT apply immediately (breaking behavior change)
- `setReferralBps(uint16)` — now an alias for `proposeReferralBps`; does NOT apply immediately
- `WITHDRAW_DELAY()` — returns `uint64` (was a `uint64 constant`; now a view returning storage value)

### Added state variables (new public getters)
- `feesAccrued() → uint256`
- `pendingFeeBps() → uint16`
- `pendingFeeApplicableAt() → uint64`
- `pendingReferralBps() → uint16`
- `pendingReferralApplicableAt() → uint64`

### Added constants
- `MAX_COMBINED_BPS` — 1500
- `FEE_TIMELOCK` — 48 hours
- `GAS_PER_ENTRY` — 250 000
- `BATCH_GAS_OVERHEAD` — 50 000
- `MIN_WITHDRAW_DELAY` — 1 hour
- `MAX_WITHDRAW_DELAY` — 7 days

### Added errors
- `InsufficientGasForBatch()` — reverts when settleBatch lacks gas for next entry
- `DelayOutOfRange()` — reverts when setWithdrawDelay is out of bounds
- `TimelockNotExpired()` — reverts when applyFee/applyReferralBps called before timelock
- `CombinedFeeTooHigh()` — reverts when feeBps + referralBps would exceed MAX_COMBINED_BPS

### Added events
- `FeeProposed(uint16 bps, uint64 applicableAt)`
- `ReferralBpsProposed(uint16 bps, uint64 applicableAt)`
- `WithdrawDelayUpdated(uint64 newDelay)`
- `FeesWithdrawn(address indexed recipient, uint256 amount)`

### Removed
- Nothing removed. All v3 external functions, views, and events are present in v4.

---

## Deployment

```bash
USDC_ADDRESS=0x3600000000000000000000000000000000000000 \
FEE_BPS=500 \
FEE_RECIPIENT=<your-multisig> \
INITIAL_OWNER=<your-multisig> \
forge script contracts/script/Deploy.s.sol --broadcast --rpc-url https://rpc.mainnet.arc.io
```

Constructor args: `(usdc_, feeBps_, feeRecipient_, initialOwner_)`. Initial values take effect immediately — no timelock on deploy.

Obtain an independent audit and deliver the mainnet disclaimer before any real-funds deployment.

---

## Audit Summary

| Version | Round | Findings | Status |
|---|---|---|---|
| v1 | Round 1 | 1 Critical, 3 High, 1 Medium | All fixed |
| v1 | Round 2 | 2 High, 1 Medium | All fixed |
| v2 | Round 1 | 1 Critical (lane normalization bug), 1 Medium (instant fee change) | Critical fixed; Medium carried to v4 |
| v3 | Round 1 | 4 Medium, 6 Low, 5 Info | All Medium fixed in v4; Low/Info addressed with NatSpec |
