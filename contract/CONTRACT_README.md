# PayPerWatch — Contract README (v2)

## Overview

PayPerWatch is an escrow-and-settle contract on Arc (Circle's USDC-native chain). Viewers deposit USDC once, watch videos with per-second billing tracked off-chain, and a settler relayer submits signed EIP-712 receipts hourly. Creators receive payment automatically at settlement. Unused USDC can be withdrawn at any time after a 1-hour delay.

v2 adds a **referral system**: viewers can be referred by another address, which earns 10% of the viewer's watch spend paid out of the creator's share at no extra cost to the viewer.

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

5. Viewer calls requestWithdraw(amount), waits 1 hour, calls withdraw().
   → Unused USDC returned.
```

---

## Referral Rules

### Split at settlement

For each `actualDelta` (viewer's actual payment, capped at their balance):

```
fee             = actualDelta * feeBps / 10_000          (platform fee, 2% at deploy)
referralAmount  = valid ? actualDelta * 1_000 / 10_000 : 0   (10% if valid)
creatorAmount   = actualDelta - fee - referralAmount
```

### Validity check

A referrer is **valid** iff ALL of the following hold at settlement time:
1. `r.referrer != address(0)` — non-zero address
2. `r.referrer != r.viewer` — no self-referral
3. `r.referrer != r.creator` — creator cannot be own referrer
4. `paidTo[r.referrer][r.creator] > 0` — the referrer must have previously paid to watch this creator

Condition 4 prevents a fresh wallet from claiming referral revenue before they have any economic stake. Once a referrer has paid this creator, they are permanently eligible for future referral payments in that creator's lane.

An **invalid** referrer is silently treated as no-referral: `referralAmount = 0`, creator receives the extra share, and the receipt still settles normally. No revert.

### Lane keying by signed referrer

Cumulative settlement is tracked per `(viewer, creator, referrer)` — each distinct `referrer` value is an independent lane in `settled[viewer][creator][referrer]`. The `referrer` in a receipt is bound to the viewer's signature (or session-key signature): a third party cannot create or manipulate a lane on behalf of a viewer.

### Why signed-referrer lane keying is safe

The audit raised the question of whether cycling `referrer` values could let an attacker replay spend across lanes. It cannot, for two reasons:

1. **Signature binding.** Each lane requires a fresh EIP-712 signature by the viewer or their authorized session key over the exact `referrer` value. The settler and third parties can only submit receipts the viewer signed — they cannot invent new lanes.

2. **Session-key spendCap bounds total spend.** The session key's `spent` counter increments by `actualDelta` across ALL lanes together. Once `spent + delta > spendCap` the contract reverts `SessionCapExceeded` regardless of which lane the receipt targets. A spendCap set equal to the viewer's deposit (the recommended pattern in `depositAndAuthorize`) means the key cannot authorize more spend than the viewer deposited, even across many referrer lanes.

The `paidTo[viewer][creator]` mapping records the total settled by a viewer to a creator across all lanes, used solely to evaluate referrer eligibility — not to gate per-lane replay.

### Invalid-then-valid referrer scenario (correct behavior)

A viewer signs receipts via a referrer X when X is not yet eligible:
- First receipt (cumulative=500): `settled[viewer][creator][X]` = 500; referralAmount=0, creator gets 500-fee.
- X then watches the same creator → `paidTo[X][creator]` > 0.
- Next receipt (cumulative=800): delta=300 (prior=500), referralAmount=30, creator gets 270, X gets 30.
- Viewer is charged exactly 800 total (no double charge). lane-0 is unaffected.

---

## Security Model

### Trust hierarchy

- **Owner**: can pause/unpause deposits and settlement, set `feeBps` (max 10%), set `feeRecipient`. Ownership is Ownable2Step (prevents accidental transfer). The owner has NO path to viewer or creator funds.
- **Settler**: trusted only for LIVENESS. `settleBatch` is open to anyone — funds always go to the creator and referrer named in the signed receipt. A lazy or malicious settler delays settlement but cannot steal.
- **Session keys**: spend up to `spendCap` before expiry across all lanes. Revoking a key immediately stops future settlements from it. The private key never leaves the browser.

### Replay protection

Receipts are cumulative per `(viewer, creator, referrer)` lane. Replaying an old receipt with `cumulativeAmount <= prior` is a no-op (returns without reverting). Cross-chain and cross-contract replay is prevented by the EIP-712 domain (chainId + verifyingContract).

### Reentrancy

All fund-moving entry points use `nonReentrant`. Strict CEI (Checks-Effects-Interactions): all state changes (`settled`, `paidTo`, `balanceOf`, `session.spent`) happen before external USDC transfers.

### Signature verification

OpenZeppelin `SignatureChecker.isValidSignatureNow` supports ECDSA EOA signatures and EIP-1271 contract wallet signatures.

### Pause behavior

When paused: deposits and settlement halt. `withdraw()` and `requestWithdraw()` both keep working — users can always exit funds regardless of pause state.

---

## Known Limitations (v2 MVP)

1. **Push payments to creator and referrer**: settlement directly transfers USDC to `r.creator` and `r.referrer`. If either becomes unsendable (blocklisted on Arc), that settlement pair will fail. For production, consider pull-based accounting for both parties.

2. **Fee parameter changes have no timelock**: `setFee` and `setFeeRecipient` take effect immediately. Recommend a 24-hour timelock for mainnet.

3. **No video-level receipts**: receipts are per viewer→creator→referrer triple, not per video. The frontend sums per-video time into a per-creator cumulative.

4. **1-hour withdraw delay**: if the settler is down for > 1 hour, a viewer who requested withdrawal may withdraw before all outstanding receipts are settled, resulting in a `PartialSettlement` when the settler eventually catches up.

5. **MAX_BATCH = 100**: `settleBatch` is capped at 100 receipts per transaction. Large platforms should paginate.

6. **Referrer eligibility is permanent once unlocked**: once `paidTo[referrer][creator] > 0`, it stays positive forever. There is no mechanism to re-lock eligibility.

7. **Ownable2Step owner**: for mainnet, transfer ownership to a multisig before going live.

---

## Contract Interface Reference (v2)

### Creator
```solidity
registerVideo(bytes32 videoId, uint128 pricePerHour)
updatePrice(bytes32 videoId, uint128 newPrice)
setVideoActive(bytes32 videoId, bool active)
```
`videoId = keccak256(abi.encodePacked(creatorAddress, contentCID))`

### Viewer
```solidity
deposit(uint256 amount)
depositAndAuthorize(uint256 amount, address key, uint64 expiry, uint128 spendCap)
authorizeSessionKey(address key, uint64 expiry, uint128 spendCap)
revokeSessionKey(address key)
requestWithdraw(uint256 amount)
withdraw()
cancelWithdraw()
```

### Settlement (open to anyone)
```solidity
settle(Receipt calldata r, bytes calldata sig)
settleBatch(Receipt[] calldata rs, bytes[] calldata sigs)   // max 100 per call
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
REFERRAL_BPS() returns (uint16)   // constant 1000
MAX_BATCH() returns (uint256)     // constant 100
```

### Owner
```solidity
setFee(uint16 bps)          // max 1000 (10%)
setFeeRecipient(address)
pause()
unpause()
```

---

## Deployment

For mainnet, use the Foundry script:

```bash
USDC_ADDRESS=0x3600000000000000000000000000000000000000 \
FEE_BPS=200 \
FEE_RECIPIENT=<your-multisig> \
INITIAL_OWNER=<your-multisig> \
forge script contracts/script/Deploy.s.sol --broadcast --rpc-url https://rpc.mainnet.arc.io
```

Obtain an independent audit and deliver the mainnet disclaimer before any real-funds deployment.

---

## Audit Summary

Two rounds on v1, one round on v2, all at max severity. All Critical, High, and Medium findings resolved.

| Version | Round | Findings | Status |
|---|---|---|---|
| v1 | Round 1 | 1 Critical, 3 High, 1 Medium | All fixed |
| v1 | Round 2 | 2 High, 1 Medium | All fixed |
| v2 | Round 1 | 1 Critical (lane normalization bug), 1 Medium (instant fee change) | Critical fixed; Medium documented as known limitation |

Key v1 fixes: requestWithdraw works while paused; CEI in _settle; settleBatch deadlock; session-key spent cap vs actualDelta; stale receipt no-op; SafeCast for uint128; MAX_BATCH=100.

Key v2 fix: the initial `effectiveReferrer` normalization approach was reverted (it introduced a double-charge bug for the invalid-then-valid referrer scenario). Referral validity governs payout only; lane keying always uses the signed `r.referrer`. Security is provided by signature binding and session-key spendCap (see Security Model above).
