# PayPerWatch v3 Security Review

**Contract:** `0xfff200a3921d18ae09616901a1aaf9434ce693e7` — Arc Testnet (chain 5042002)  
**Source:** `contracts/PayPerWatch.sol` (v3, EIP-712 domain version "3")  
**Review date:** 2026-10-23  
**Test run:** 66/66 pass (49 unit, 2 invariant × 256 runs × 128 000 calls, 15 referral). Zero failures.  
**Scope:** full contract source + threat model from user brief  
**Preset:** max severity

---

## Executive Summary

The contract is structurally sound. CEI is enforced, nonReentrant covers all fund paths, custom errors are complete, and the fuzz invariant (`viewer balances + creator payments + fees + referral = total deposited`) holds across 32 million randomized call sequences. No critical or high-severity issues were found. The findings below are four medium-severity issues and a set of lower-severity observations, most of which are architectural trade-offs acknowledged in `CONTRACT_README.md` rather than new discoveries.

| Severity | Count |
|---|---|
| Medium | 4 |
| Low | 6 |
| Info | 5 |

---

## Medium Findings

### M-1 — `settleBatch` out-of-gas griefing: `SettlementSkipped(i, 0x00000000)` with no on-chain guard

**Function:** `settleBatch` → `_trySettle` → `address(this).call(...)` (line 249)

**Description.** `_trySettle` uses a bare `address(this).call(...)` with no explicit gas stipend. EVM rule 63/64: the inner call receives at most 63/64 of the remaining gas. When a caller (or the gas oracle used by `eth_estimateGas`) passes a transaction with marginally enough gas to enter `settleBatch` but not enough for every `_settleEntry` execution, individual entries silently run out of gas inside the inner call. The inner call returns `(false, )` with an empty return buffer, so `ret.length >= 4` is false and `reason` stays `bytes4(0)`. `SettlementSkipped(i, 0x00000000)` is emitted, the tx succeeds, and the settlement is lost until the next cron cycle. You already observed this in production.

The failure mode has two sub-forms:
1. **Honest under-budgeting:** `eth_estimateGas` simulates the tx and sees the inner calls succeed (because at estimate time they run with full gas), then the real tx runs at the estimated limit and the 63/64 rule starves the inner calls. This is the scenario you described.
2. **Griefing:** A viewer registers an ERC-1271 contract wallet (e.g. a Safe) as their viewer address. `SignatureChecker.isValidSignatureNow` does an external call into that wallet; a malicious wallet's `isValidSignature` can burn arbitrary gas. If the viewer is an ERC-1271 contract that deliberately consumes gas near the 63/64 boundary on every call, every batch that includes one of their receipts will mis-estimate and silently skip them — or other entries around them. This is a liveness attack on the settler, not a fund-theft attack.

**Impact:** Silent loss of settlement for one or more entries per batch. Funds are safe (not lost), but creators receive payment late.

**Recommended fix (contract-side).** Add a `gasleft()` floor check inside `settleBatch` before each `_trySettle` call:

```solidity
uint256 GAS_PER_ENTRY = 250_000;
for (uint256 i = 0; i < rs.length; ++i) {
    if (gasleft() < GAS_PER_ENTRY * 2) {
        emit SettlementSkipped(i, bytes4(keccak256("OutOfGas()")));
        // continue or break depending on desired behavior
        break;
    }
    (bool success, bytes4 reason) = _trySettle(rs[i], sigs[i]);
    if (!success) emit SettlementSkipped(i, reason);
}
```

Breaking rather than continuing is safer: once gas is near the floor, remaining entries would also fail, and emitting N skips wastes gas. The off-chain fix (budget 250 k/receipt) is correct but fragile for batches with ERC-1271 viewers. A `gasleft()` check makes the behavior deterministic on-chain.

**Alternatively (off-chain only):** continue your current off-chain 250 k/receipt budget and additionally split batches containing ERC-1271 viewers into separate calls.

---

### M-2 — Withdraw-before-settlement race: viewer can withdraw before the settler processes outstanding receipts

**Function:** `requestWithdraw` (line 181) / `withdraw` (line 195)

**Description.** The withdraw delay is 1 hour (`WITHDRAW_DELAY`). The settler runs hourly. There is a window (up to one full hour in the degenerate case) where a viewer has signed a session-key receipt for, say, $5 but has not yet been settled. The viewer calls `requestWithdraw($5)`, waits one hour, and calls `withdraw()` before the settler's next run. The result: `balanceOf[viewer]` goes to zero, the next settler run computes `actualDelta = min(delta, available) = 0`, emits `PartialSettlement`, and the creator receives nothing.

This is documented in `CONTRACT_README.md` (Known Limitation 4), but the threat model now includes a **platform 'agent account'** that signs receipts with deadlines **one year out**. An agent can accumulate a large cumulative amount (months of watch time), then withdraw the full balance the moment the delay expires, leaving an arbitrarily large PartialSettlement that can never be recovered (no retroactive charge path).

**Impact:** Creators can be deprived of payment that they earned. The viewer retains their USDC. There is no fund theft from the contract (the accounting invariant holds), but it is a reliable revenue-loss mechanism for any viewer who is willing to sacrifice their cumulative receipt history.

**Recommended mitigation.** Consider one or more of:

1. **Reduce the withdraw delay to less than the minimum settler interval** (or set the settler to run more frequently than the withdraw delay). Currently they are equal, creating a full-window race.
2. **Track a "pending outflow" per viewer**: at `requestWithdraw`, record `amount`, but do not allow `withdraw` until `paidTo[viewer][*] + requested <= balance_at_request_time` is consistent with on-chain state. This is complex and may not be worth the gas.
3. **Document and accept**: for the AI-agent use case with year-long deadlines, the operator should ensure the agent account never requests withdrawal while receipts are outstanding. This is an operational control, not a contract control.

---

### M-3 — Push-payment failure bricks a settlement lane when creator or referrer is USDC-blocklisted

**Function:** `_settle` lines 401–407 (`usdc.safeTransfer`)

**Description.** Settlement uses push payments: `safeTransfer` to `r.creator`, then to `feeRecipient`, then to `r.referrer`. Circle's USDC contract has a blocklist; transfers to a blocklisted address revert. On Arc, USDC is both the ERC-20 and the native gas token — the blocklist applies to the ERC-20 path, which is what `safeTransfer` uses.

If `r.creator` is blocklisted after they registered a video, every subsequent settlement for any viewer→creator pair will revert inside `_settleEntry`, be caught by `_trySettle`, and emit `SettlementSkipped`. Viewer funds are locked in escrow indefinitely. This applies to `feeRecipient` and `r.referrer` too (a blocklisted `feeRecipient` blocks every settlement on the entire contract while `feeBps > 0`).

**Highest-risk vector: `feeRecipient`.** If the platform's `feeRecipient` wallet is blocklisted (e.g., due to a regulatory action), and `feeBps > 0`, **every single settlement call in the entire contract will silently fail**. This would be a protocol-wide outage.

**Recommended fix.** Use a pull-payment pattern for the fee (and optionally for creator/referrer):

```solidity
mapping(address => uint256) public accruedFees;

// In _settle, instead of immediate transfer:
accruedFees[feeRecipient] += fee;
// Add a separate withdrawFees() function
```

For the creator and referrer, a pull pattern is more complex but worth it for production. At minimum, add an emergency `setFeeRecipient` to a safe address and call it atomically if the current recipient is blocklisted.

---

### M-4 — `feeBps` and `referralBps` changes take effect on receipts already signed but not yet settled

**Function:** `setFee` (line 279) / `setReferralBps` (line 294)

**Description.** Both parameters are read at settlement time, not at signing time. A viewer signs a receipt at 5% fee and 5% referral rate; the owner raises `feeBps` to 10% before the hourly cron runs. The viewer's already-signed receipt settles at 10% + 5% = 15% deducted from the creator's share (or creator receives less). The viewer was not informed of the new rate and signed under different assumptions.

More acutely: if the owner raises `feeBps` to 10% and `referralBps` to 10% simultaneously, the fee + referral = 20%, leaving the creator with 80 cents of every dollar. With `feeBps = 1000` and `referralBps = 1000`, the sum is 20% — not 100%, so there is no arithmetic underflow (creator still gets 80%), but the combined cap of `feeBps + referralBps <= 2000` is not enforced by the contract.

**Impact:** Viewers and creators are subject to retroactive parameter changes on receipts they already signed. This is a trust issue, not an arithmetic safety issue.

**Recommended fix.** Add a timelock (e.g., 24 hours) to `setFee` and `setReferralBps`, or add a hard `require(feeBps + referralBps <= 1500)` to bound the maximum combined deduction (creator can never receive less than 85% of actualDelta). The combined cap is a one-liner:

```solidity
function setFee(uint16 bps) external onlyOwner {
    if (bps > 1000) revert FeeTooHigh();
    if (uint256(bps) + referralBps > 1500) revert FeeTooHigh(); // combined cap
    feeBps = bps;
    emit FeeUpdated(bps);
}
// Mirror in setReferralBps
```

---

## Low Findings

### L-1 — `_settleEntry` is callable by anyone who can become `address(this)` in a delegatecall context

**Function:** `_settleEntry` (line 261)

**Description.** The guard is `if (msg.sender != address(this)) revert InvalidSignature()`. This is safe in a normal EVM call context. In a delegatecall context (e.g., if a proxy ever points to this contract as its implementation), `address(this)` is the proxy's address and `msg.sender` can be anyone. PayPerWatch is not a proxy and has no upgradability, so this is not currently exploitable. However, the function being `external` instead of `private` means it appears in the ABI and can be called by anyone who finds a way to spoof `msg.sender == address(this)` in an unusual execution environment.

**Recommended fix.** No contract change needed. Document in interface comments that `_settleEntry` is not part of the public API. Consider adding `@dev internal` NatSpec to indicate it should not be called directly.

---

### L-2 — Session-key re-authorization resets `spent` to zero

**Function:** `_authorizeSessionKey` (line 421)

**Description.** If a viewer calls `authorizeSessionKey(key, newExpiry, newCap)` for a key that already has `spent > 0`, the new authorization overwrites the struct including `spent: 0`. The key's cumulative spend tracking is erased. A viewer could exploit this to reset a nearly-exhausted session key's spend counter without revoking and creating a new key, effectively doubling the key's authorized spend beyond the declared cap.

**Scenario:** viewer deposits 100 USDC, authorizes key with cap=100. Key accrues 99 USDC of spend. Viewer calls `authorizeSessionKey(key, newExpiry, cap=100)` → `spent` resets to 0. Key can now authorize another 100 USDC of spend for a total of 199 USDC against a 100 USDC deposit. The balance check (`actualDelta = min(delta, available)`) prevents the contract from over-paying, but the cap enforcement that the viewer declared is bypassed.

**Impact:** The session-key spendCap is meant to be a hard limit on how much a single key can authorize. Re-authorization allows bypassing it. The viewer is only acting against their own declared limit, but if the session key is compromised (stolen from localStorage), an attacker could extend the key's life and reset its cap before the viewer revokes it.

**Recommended fix.** When re-authorizing an existing key, preserve `spent` from the existing struct:

```solidity
uint128 existingSpent = sessionKeys[viewer][key].spent;
sessionKeys[viewer][key] = SessionKey({expiry: expiry, spendCap: spendCap, spent: existingSpent});
```

Or require an explicit revoke before re-authorize.

---

### L-3 — Integer rounding in fee/referral split rounds in the platform's favor but is never documented

**Function:** `_settle` lines 390–392

**Description.** Solidity integer division truncates toward zero. `fee = actualDelta * feeBps / 10_000` truncates the fee down (platform receives slightly less). `referralAmount = actualDelta * referralBps / 10_000` also truncates down. `creatorAmount = actualDelta - fee - referralAmount` therefore rounds up by the combined truncation (at most 1 base unit per term = max 2 USDC micro-units). This is correct and favors the creator, but it is unspecified in the README. For a USDC contract with 6 decimals and sub-cent rounding, this is negligible (< 0.0001¢ per settlement) but should be documented.

**Recommended fix.** Add a comment in `_settle` and a line in `CONTRACT_README.md`: "Integer division rounds fee and referral down; any remainder goes to the creator."

---

### L-4 — `pendingWithdrawal` amount is a `uint128` but `requestWithdraw` accepts `uint256`

**Function:** `requestWithdraw` (line 190), `Withdrawal` struct (line 30)

**Description.** `SafeCast.toUint128(amount)` is correctly used, so amounts above `type(uint128).max` revert. However, `balanceOf` is `uint256`, meaning a viewer could theoretically accumulate more than `2^128 - 1` USDC in escrow (astronomically unlikely at 6 USDC decimals — that's ~340 trillion USDC — but the asymmetry is worth noting). The SafeCast already handles this correctly; this is a documentation gap, not a bug.

---

### L-5 — `setVideoActive(videoId, true/false)` has no `whenNotPaused` guard

**Function:** `setVideoActive` (line 134)

**Description.** `registerVideo` and `updatePrice` are guarded by `whenNotPaused`, but `setVideoActive` is not. A creator can toggle a video's active status while the contract is paused. The `active` flag is not read by the settlement path (the contract does not gate `settle` on `video.active`), so this is cosmetic — the settler and viewers don't care about `active` on-chain. But clients reading `active` off-chain may show stale state after a pause. Low impact in practice.

---

### L-6 — `video.active` is set but never read on the settlement path

**Function:** `Video` struct (line 18), `_settle` (line 310+)

**Description.** `active` is stored in the `Video` struct and can be toggled by the creator, but `_settle` does not check it. A creator who marks a video inactive can still receive settlement for receipts signed while it was active (and even after it is marked inactive, since the receipt is signed off-chain and submitted later). This is consistent with the "receipts are cumulative and permissionless" model but may surprise creators who expect deactivating a video to stop payments.

**Recommended fix:** Document explicitly: "Setting a video inactive does not stop settlement of existing receipts; it is a UI signal only." Consider removing `active` from the struct if it serves no on-chain purpose.

---

## Informational Findings

### I-1 — EIP-712 domain: `verifyingContract` provides chain-replay protection even without `chainId` if Arc forks

The domain binds `chainId` (5042002 for Arc Testnet) and `verifyingContract`. If Arc ever forks and the fork inherits the same chain ID (unlikely but possible), receipts signed on one fork are replayable on the other if the contract is re-deployed to the same address. No action needed unless Arc forks.

---

### I-2 — EIP-1271 viewers can break `_trySettle` gas budget even without malicious intent

A Safe multisig or any ERC-4337 wallet implementing `isValidSignature` with on-chain state checks (e.g., confirming all signers approved) will consume gas beyond what a standard ECDSA signature verification uses. The off-chain 250 k/receipt budget is the correct mitigation; consider documenting the expected gas range for ERC-1271 viewers explicitly.

---

### I-3 — Agent account with year-long deadlines creates a very large unsettled liability

The brief mentions a platform agent account that signs receipts with deadlines one year out. A single agent address can accumulate a cumulative receipt whose `cumulativeAmount` represents 365 days × active watching. If the agent account's balance becomes insufficient before the year expires, every future receipt in that lane results in a `PartialSettlement`. Operators should ensure the agent account maintains sufficient escrow balance and that the settler processes agent receipts at the same cadence as viewer receipts.

---

### I-4 — `WITHDRAW_DELAY` is a constant; operators cannot extend it if settler latency increases

If the settler's cron job goes down for more than 1 hour, all pending withdrawal requests become exercisable before outstanding receipts are settled. The 1-hour delay is baked in as a constant and cannot be changed without redeployment. Consider making it an owner-settable parameter (with a maximum, e.g., 24 hours) for operational flexibility.

---

### I-5 — `referralBps` storage variable shadows the removed `REFERRAL_BPS` constant in the interface docs

`CONTRACT_README.md` (line 171) still references `REFERRAL_BPS()` as a constant returning `uint16` (1000). In v3 this is replaced by `referralBps()` (mutable storage, default 500) and `MAX_REFERRAL_BPS()` (constant, 1000). The README interface reference is stale and should be updated.

---

## Requested Deep-Dives

### 1. `settleBatch` gas estimation / `SettlementSkipped(i, 0x00000000)` — assessment

**You asked:** should the contract handle this with a `gasleft()` check?

**Assessment:** Yes, a `gasleft()` check is the correct contract-side defense, and it is complementary to the off-chain 250 k budget — not a replacement. The reason: the off-chain budget cannot account for variable-cost paths like ERC-1271 signature checks, large USDC state transitions (cold vs warm storage), or future Solidity compiler behavior changes. A `gasleft()` check converts silent failures into explicit `SettlementSkipped` with a recognizable reason selector, and allows the outer loop to break cleanly rather than continue emitting skip events for entries that will definitely also fail.

The minimal safe approach:
```solidity
uint256 constant GAS_PER_ENTRY = 250_000;
if (gasleft() < GAS_PER_ENTRY + 50_000) break; // 50k headroom for loop overhead
```
Place this at the top of the `for` loop body in `settleBatch`, before the `_trySettle` call. Breaking on gas floor means the settler knows exactly how many entries were processed (all indices before the break), and the rest go into the next batch. Continuing would be cheaper per-entry but creates confusion about which entries in the middle of the array were processed vs skipped.

The `0x00000000` reason selector in `SettlementSkipped` is unmistakable evidence of an OOG failure (since any real revert in `_settle` produces a 4-byte selector). A sentinel reason like `bytes4(keccak256("OutOfGas()"))` = `0x...` makes off-chain monitoring easier.

---

### 2. Signature replay and EIP-712 domain

Domain: `{ name: "PayPerWatch", version: "3", chainId, verifyingContract }`. Correctly constructed by OZ EIP712 using immutable chain ID at deploy time. No replay across chains, contracts, or domain versions. No nonce needed because receipts are cumulative (a lower `cumulativeAmount` is a no-op). One edge case worth noting: if the platform deploys a new contract version to the same address (e.g., via CREATE2 with identical salt), receipts signed against the old contract address would be valid on the new one. This is mitigated by the fact that a new deployment always gets a new address unless a CREATE2 factory is used; review `context/contracts/script/DeployCreate2.s.sol` before using it on mainnet.

---

### 3. EIP-1271 handling

`_settle` calls `SignatureChecker.isValidSignatureNow(r.viewer, digest, sig)`. This is the correct OZ pattern. Two properties are worth confirming:

- **Reentrancy via EIP-1271:** CEI is correctly ordered — all state mutations (`settled`, `paidTo`, `balanceOf`, `session.spent`) happen before the USDC `safeTransfer` calls. The `isValidSignatureNow` call is made *before* state mutation, but the `nonReentrant` guard on `settle` (and `_settleEntry`) prevents a re-entrant call back into the contract from a malicious `isValidSignature` implementation from touching contract state.
- **Double ecrecover:** Lines 318 and 327 both call `SignatureChecker.isValidSignatureNow(recovered, digest, sig)` — the second call (line 327) is redundant. If `ECDSA.tryRecover` succeeded and returned `recovered`, then `isValidSignatureNow(recovered, ...)` on an EOA address will just call `ecrecover` again. This is gas waste (~3000 gas per settle via session key) but not a security issue. Consider removing the redundant call.

---

### 4. Session-key cap and expiry enforcement

Cap: `uint256(session.spent) + delta > session.spendCap` checks the *signed* delta (not `actualDelta`), then increments `spent` by `actualDelta`. This is intentional: a receipt whose declared delta exceeds the remaining cap is rejected even if the viewer's balance would only partially cover it. The asymmetry means a low-balance viewer can have their session key exhausted (cap exceeded) before their balance is exhausted. The viewer's only recourse is to deposit more and authorize a new key. This is documented in `CONTRACT_README.md` as the security design and is correct for the threat model.

Expiry: `sk.expiry <= block.timestamp` reverts `SessionKeyExpired`. A key expiring exactly at the current timestamp is treated as expired. This is the correct strict comparison.

---

### 5. Cumulative receipt monotonicity

`if (r.cumulativeAmount <= prior) { return; }` — stale receipts are no-ops. There is no case where a lower `cumulativeAmount` can cause funds to flow backward or be re-charged. The lane key includes `r.referrer`, so a receipt with the same `(viewer, creator)` but a different `referrer` starts a fresh lane with `prior = 0` — this is intentional and documented as the signed-referrer lane model.

---

### 6. Withdraw delay vs pending receipts front-run

See M-2 above. Summary: the race is real and acknowledged. The 1-hour delay matches the settler interval but does not guarantee the settler runs before the delay expires (if it is delayed or down). The viewer cannot profit from the race against honest actors (they lose their own future receipts being settled), but it is a reliable mechanism to deprive creators of payment. The AI-agent scenario with year-long deadlines increases the stakes.

---

### 7. Fee/referral math and rounding

`feeBps` ≤ 1000 (10%), `referralBps` ≤ 1000 (10%). Combined maximum: 20% deducted. No underflow: `actualDelta - fee - referralAmount` is non-negative because `fee + referralAmount = actualDelta * (feeBps + referralBps) / 10_000 ≤ actualDelta * 2000 / 10_000 = 0.2 * actualDelta < actualDelta`. Integer division truncates down, so the creator receives any rounding remainder. No overflow: `actualDelta` is at most `balanceOf[viewer]` which is a `uint256`, and `feeBps`/`referralBps` are `uint16` — the intermediate product `actualDelta * feeBps` fits in `uint256` for all practical values.

---

### 8. Referrer rules

Referral validity gating is correct. The `paidTo[referrer][creator] > 0` requirement prevents fresh-wallet Sybil referral. The signed-referrer lane model correctly prevents lane-normalization double-charge. One subtle point: `paidTo[viewer][creator]` is incremented by `actualDelta` (the *paid* amount, not the signed amount), so it only grows when real USDC flows. A viewer who deposits nothing cannot bootstrap referral eligibility by signing receipts that settle with `actualDelta = 0`.

---

### 9. Reentrancy

`nonReentrant` is present on: `deposit`, `depositAndAuthorize`, `withdraw`, `settle`, `_settleEntry`. `settleBatch` does not hold the reentrancy guard itself (this was an intentional fix from a previous audit — the original version deadlocked). Each inner `_settleEntry` call acquires and releases the guard independently. CEI is enforced in `_settle`: all storage writes before USDC transfers. No reentrancy vector identified.

---

### 10. Pause/owner powers and centralization

Owner powers: `pause`, `unpause`, `setFee`, `setFeeRecipient`, `setReferralBps`. The owner cannot move user funds, cannot change USDC address, and cannot register videos on behalf of creators. The most dangerous power is `pause` (blocks deposits and settlement indefinitely) combined with the ability to change `feeRecipient` to a blocklisted address (which would block all settlements — see M-3). `Ownable2Step` prevents accidental ownership transfer. For mainnet, a multisig + timelock is recommended.

---

### 11. USDC-specific behaviors

- **Blocklist:** covered in M-3. The `feeRecipient` is the highest-risk single point of failure.
- **6 decimals:** correct. `MAX_PRICE = 100_000_000` = $100.00 with 6 decimals. `deposit(0)` reverts with `InvalidAmount`. No path confuses native (18-decimal) and ERC-20 (6-decimal) units.
- **Arc native-USDC:** on Arc, USDC is both the ERC-20 and the gas token. The contract uses `IERC20(usdc_)` for all operations, never `msg.value`. Gas is paid in native USDC (auto-converted by the Arc node); the contract never handles native value. No `payable` functions exist. This is correct.
- **Fee-on-transfer / rebasing:** USDC is not fee-on-transfer or rebasing. `SafeERC20.safeTransferFrom` is used, which reverts on failure. If a future USDC upgrade introduced fees, `balanceOf[viewer]` could be inflated relative to actual contract holdings; this is a theoretical risk with no current vector.

---

## Test Coverage Assessment

**66/66 pass.** The test suite covers:

✅ All happy-path flows  
✅ All revert conditions (each custom error tested at least once)  
✅ Fee math at 0%, 2%, 10%  
✅ Referral split at 2%, 0%, 10% fee  
✅ Session-key cap enforcement across lanes  
✅ Invalid-then-valid referrer (no double charge)  
✅ Lane-0 independence from X lane  
✅ settleBatch mixed (valid/referral/bad) entries  
✅ Fuzz: `viewer balances + creator payments + fees + referral = total deposited` (256 runs × 128 k calls)  
✅ Invariant: contract USDC balance ≥ sum of viewer `balanceOf`  

**Not tested (gaps):**

- ❌ Gas exhaustion / `SettlementSkipped(i, 0x00000000)` — no test simulates the 63/64 OOG path in `_trySettle`
- ❌ USDC blocklist: no test simulates a blocklisted creator, feeRecipient, or referrer
- ❌ ERC-1271 viewer (contract wallet): the test suite uses only EOA signers; no test exercises the EIP-1271 code path
- ❌ Session-key re-authorization with existing `spent > 0` (the L-2 `spent` reset gap has no test)
- ❌ `setFee` + `setReferralBps` retroactive effect on pending receipts (M-4 scenario)
- ❌ Multiple concurrent lanes (same viewer/creator, many referrers) under fuzz invariant — the handler uses a single fixed referrer
- ❌ `requestWithdraw` overwriting an existing pending withdrawal (the struct is overwritten without checking if one exists; a viewer who calls it twice loses the first request silently)
- ❌ `cancelWithdraw` on an address with no pending withdrawal (currently a no-op `delete`; no test confirms this does not revert)
- ❌ `_settleEntry` called directly by an EOA (should revert `InvalidSignature`)

---

## Summary Table

| ID | Severity | Title |
|---|---|---|
| M-1 | Medium | settleBatch OOG: SettlementSkipped(i, 0x00) / no gasleft() guard |
| M-2 | Medium | Withdraw-before-settlement race; creator revenue loss |
| M-3 | Medium | Push-payment to blocklisted creator/feeRecipient/referrer bricks lane |
| M-4 | Medium | feeBps/referralBps changes apply retroactively to signed receipts |
| L-1 | Low | _settleEntry is external and appears in ABI |
| L-2 | Low | Session-key re-authorization resets spent counter |
| L-3 | Low | Rounding direction undocumented |
| L-4 | Low | uint128 cap on pendingWithdrawal.amount not documented |
| L-5 | Low | setVideoActive has no whenNotPaused guard |
| L-6 | Low | video.active flag never read on settlement path |
| I-1 | Info | EIP-712 domain fork-replay theoretical risk |
| I-2 | Info | ERC-1271 viewers increase gas variance in batches |
| I-3 | Info | Agent account year-long deadline creates large unsettled liability |
| I-4 | Info | WITHDRAW_DELAY is constant, cannot be adjusted operationally |
| I-5 | Info | README still references removed REFERRAL_BPS constant |
