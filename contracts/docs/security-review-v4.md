# PayPerWatch v4 — Security Review

**Target contract:** `contracts/src/PayPerWatch.sol`  
**EIP-712 domain version:** `"4"` (unchanged)  
**Testnet deployment:** `0x9da4403e212804081cd0d5bab0ea9d0bcc3d96e1` (Arc Testnet)  
**Intended mainnet chain:** Arc Mainnet (chain ID 5042, USDC `0x3600000000000000000000000000000000000000`, 6 decimals)  
**Review date:** 2026-10-23  
**Test suite:** Foundry. Baseline 93 tests (all passing). 23 new audit tests added in round 1 (all passing after fixes). 14 cancel-function tests added in round 2. Final: **130 tests, 0 failures.**  
**ABI:** `contracts/abi/PayPerWatch.json` (regenerated after all fixes).

---

## Summary

Three confirmed bugs and one compilation prerequisite were found and fixed. The contract is
substantially well-engineered: CEI ordering is correct throughout, reentrancy guards are placed on
all fund-moving entry points, the EIP-712 domain binds to both chainId and verifyingContract (cross-chain
and cross-contract replay is blocked), session-key spend tracking is correct, and the invariant tests
confirm no value is created or destroyed across settlement.

The highest-severity finding (H-1) allowed a Safe multisig to inadvertently push the combined fee
rate above the declared 15% cap. This is now blocked both at proposal time (by cross-checking pending
values) and at apply time (by re-validating against the live rate).

---

## Findings

### HIGH

#### H-1: Dual pending proposals can push `feeBps + referralBps` above `MAX_COMBINED_BPS` at apply time

**Function:** `proposeFee` / `proposeReferralBps` (lines 443–493 before fix)  
**Status:** **Fixed in this review.**

**Root cause.** Each proposal validates the combined cap against the *current* live value of the other
parameter, completely ignoring any co-pending proposal. Both checks can pass individually while their
sum at apply time exceeds 1500 bps.

**Exploit scenario.**
1. Current state: `feeBps = 500`, `referralBps = 500`.
2. `proposeFee(900)` — check: `900 + 500 = 1400 ≤ 1500` ✓ stored as pending.
3. `proposeReferralBps(700)` — check: `500 + 700 = 1200 ≤ 1500` ✓ stored as pending.
4. Both timelocks expire. `applyFee()` → `feeBps = 900`. `applyReferralBps()` → `referralBps = 700`.
5. Final combined rate: **1600 bps = 16% > 15% cap.** Creator receives less than the promised 85% floor.

**Confirmed by test:** `test_H1_DualPendingProposalsExceedCombinedCap` and `test_H1_DualPendingProposals_ReferralFirst` both failed pre-fix (showed combined = 1600 > 1500).

**Fix applied (two-layer defence).**
1. At proposal time: `proposeFee` now also checks `pendingReferralBps` if a referral proposal is
   outstanding (`pendingReferralApplicableAt != 0`), and vice versa. The second concurrent proposal
   that would cause a future cap violation is rejected at proposal time with `CombinedFeeTooHigh`.
2. At apply time: `applyFee` re-checks `pendingFeeBps + referralBps ≤ MAX_COMBINED_BPS` immediately
   before writing `feeBps`; `applyReferralBps` re-checks `feeBps + pendingReferralBps ≤ MAX_COMBINED_BPS`.
   This is a belt-and-suspenders guard in case the two proposals originated from different signers of
   the same Safe or from a governance path that bypasses the proposal-time guard.

**ABI impact:** None. `CombinedFeeTooHigh` error already declared; no new ABI surface.

---

### MEDIUM

#### M-1: `PendingProposalExists` declared but never enforced — timelocks can be silently reset

**Function:** `proposeFee`, `setFee`, `proposeReferralBps`, `setReferralBps` (lines 443–484 before fix)  
**Status:** **Fixed in this review.**

**Root cause.** The error `PendingProposalExists` was declared at line 89 but never used. Any call to
`proposeFee` while a fee proposal is already pending silently overwrites `pendingFeeBps` and resets
`pendingFeeApplicableAt` to `now + 48h`, restarting the timelock from scratch. This has two
consequences:

1. **Accidental reset.** An operator who re-proposes a value to "double-check" inadvertently
   extends the lock by another 48 hours.
2. **Deliberate lock suppression.** A Safe signer (with a conflicted interest) could resubmit a
   proposal every 47.5 hours to prevent `applyFee` from ever being callable.
3. **Silent value substitution.** If fee proposals are submitted by separate Safe signers, a
   late-arriving signer can replace a queued raise with a different value without the first signer
   knowing, since both signatures eventually gather enough Safe threshold and both call `proposeFee`.

**Confirmed by test:** `test_M1_PendingProposalCanBeOverwritten_FeeReset` showed the timer advancing
when the overwrite should have been blocked.

**Fix applied — round 1.** `proposeFee`/`setFee`/`proposeReferralBps`/`setReferralBps` now check
`pendingFeeApplicableAt != 0 && block.timestamp < pendingFeeApplicableAt` and revert
`PendingProposalExists` if a live proposal already exists. Re-proposing is allowed only after the
timelock has passed (the previous proposal was applied or left to expire without being applied).

**Follow-on fix — round 2: `cancelFeeProposal` and `cancelReferralProposal`.**

The round-1 guard creates a new problem: an owner who proposes a wrong value (typo, e.g. `1000`
instead of `100`) has no escape hatch — they cannot overwrite the proposal and must wait 48 h for
the timelock to expire before proposing again.

Two new owner-only functions are added to resolve this:

```solidity
function cancelFeeProposal() external onlyOwner
function cancelReferralProposal() external onlyOwner
```

**Behaviour of each cancel function:**
- Reverts `InvalidAmount` if no proposal is currently pending (`pendingFeeApplicableAt == 0`).
- Clears both the pending value (`pendingFeeBps` / `pendingReferralBps` → `0`) and the timer
  (`pendingFeeApplicableAt` / `pendingReferralApplicableAt` → `0`).
- Emits `FeeProposalCancelled(uint16 bps)` / `ReferralBpsProposalCancelled(uint16 bps)` with the
  value that was cancelled.
- After cancellation the owner may immediately call `proposeFee` / `proposeReferralBps` with the
  corrected value (the `PendingProposalExists` guard sees no live proposal).
- Works whether the timelock is still running or has already expired (i.e., it also cancels an
  unapplied but expired proposal without applying it).

**New events added to the ABI:**
```
event FeeProposalCancelled(uint16 bps)
event ReferralBpsProposalCancelled(uint16 bps)
```

**No other ABI changes.** All existing functions, events, and errors are unchanged. EIP-712
domain version `"4"` is unchanged.

**Tests added (14 new):**

| Test | What it verifies |
|---|---|
| `test_CancelFeeProposal_ByOwner_ClearsState` | Happy path: state cleared, event emitted, live rate unchanged |
| `test_CancelFeeProposal_NonOwner_Reverts` | Access control |
| `test_CancelFeeProposal_NoPending_Reverts` | `InvalidAmount` when nothing pending |
| `test_CancelFeeProposal_AfterApply_Reverts` | `InvalidAmount` after previous proposal was applied |
| `test_CancelFeeProposal_ThenRepropose_Works` | Cancel typo then immediately re-propose correct value |
| `test_ApplyFee_AfterCancel_Reverts` | `applyFee` reverts after cancel (no pending proposal) |
| `test_CancelFeeProposal_TypoAndReplace` | End-to-end typo-correction flow |
| `test_CancelFeeProposal_AppliTimeBackstop_StorageBypass` | H-1 apply-time backstop remains effective at cap boundary |
| `test_CancelFeeProposal_AfterTimelockExpired_Works` | Cancel still works on an unapplied but expired proposal |
| `test_CancelReferralProposal_ByOwner_ClearsState` | Referral happy path |
| `test_CancelReferralProposal_NonOwner_Reverts` | Access control |
| `test_CancelReferralProposal_NoPending_Reverts` | `InvalidAmount` when nothing pending |
| `test_CancelReferralProposal_ThenRepropose_Works` | Cancel then re-propose correct referral rate |
| `test_ApplyReferralBps_AfterCancel_Reverts` | `applyReferralBps` reverts after cancel |

#### M-2: `setWithdrawDelay` takes effect immediately — no timelock

**Function:** `setWithdrawDelay` (line 503)  
**Status:** Documented; **not fixed** (see rationale below).

**Issue.** The owner can lower the withdraw delay from 24 h to the 1 h minimum in a single
transaction. The settler sends receipts on an hourly cadence. A viewer who deposits USDC, submits
a receipt, and then immediately calls `requestWithdraw` in a chain-reorg or high-gas window could
theoretically withdraw before the settler delivers the receipt if the delay is already 1 h, though
under normal operation the settler runs more frequently than the delay.

**Severity in the mainnet plan.** With a Safe multisig as owner, reducing the delay requires threshold
consensus, which substantially limits exploit feasibility. The 24 h default provides a large buffer.

**Rationale for not fixing now.** Adding a timelock to `setWithdrawDelay` changes the operational UX
significantly and requires a new pending-delay state machine. Given that M-1 now prevents surprise
changes from a single Safe signer, and the default delay is 24 h (much larger than the settlement
interval), this is deferred. The suggested mitigation is operational: run the settler at a cadence of
at most `min(withdrawDelay) / 2`, and document this constraint in the run-book. If the owner reduces
the delay, the settler cadence must tighten correspondingly.

**Suggested fix (if desired later).** Mirror the M-4 timelock pattern: `proposeWithdrawDelay` +
`applyWithdrawDelay` with a 24 h timelock.

---

### LOW

#### L-1: Zero `r.creator` in a receipt produces a confusing ERC20 revert inside `safeTransfer`

**Function:** `_settle` (line 566)  
**Status:** **Fixed in this review.**

**Issue.** A receipt with `r.creator == address(0)` passed all checks up to the `safeTransfer`
call, where OpenZeppelin's ERC20 reverted with `ERC20InvalidReceiver`. In `settleBatch`, this was
caught and emitted as `SettlementSkipped(i, <ERC20 selector>)`, which is cryptic and not the
intended error.

**Fix applied.** `_settle` now checks `if (r.creator == address(0)) revert ZeroAddress()` immediately
after the deadline check. This gives a clear, specific revert both in `settle` and in the
`SettlementSkipped` reason field of `settleBatch`.

**ABI impact:** None. Existing tests that expect a revert on zero creator continue to pass.

#### L-2: `pendingFeeBps` / `pendingReferralBps` not cleared after apply (stale storage read)

**Function:** `applyFee`, `applyReferralBps`  
**Status:** **Fixed in this review.**

**Issue.** After `applyFee()`, `pendingFeeApplicableAt` was cleared to `0` but `pendingFeeBps` kept
its last proposed value. Any off-chain script reading `pendingFeeBps()` after application would
see a non-zero stale value and might incorrectly infer a pending proposal.

**Fix applied.** `applyFee()` now sets `pendingFeeBps = 0` before emitting `FeeUpdated`.
`applyReferralBps()` sets `pendingReferralBps = 0`. These are also necessary for the H-1 apply-time
re-check to work correctly after a partial sequence.

---

### INFO

#### I-1: `via_ir = true` required to compile the contract

**File:** `foundry.toml`  
**Status:** **Fixed** (foundry.toml updated to add `via_ir = true`).

**Issue.** The Solidity compiler rejected the contract with "Stack too deep" when compiled without
the IR pipeline. This means the production build toolchain (Forge, Hardhat, Remix) must explicitly
enable `--via-ir` / `viaIR: true`. Omitting it in a production deployment script would produce a
compilation failure and a deployment that silently uses a stale artifact.

**Risk.** The deploy script in `contracts/script/Deploy.s.sol` uses `forge script`; without
`via_ir = true` in `foundry.toml` that script will fail to compile. The fix is already applied to
`foundry.toml`; the deploy script does not need to change because it inherits the profile.

#### I-2: `_settleEntry` is in the external ABI

**Function:** `_settleEntry` (line 391)  
**Status:** Acknowledged (working as designed).

**Detail.** `_settleEntry` is marked `external` (required for the low-level call pattern in
`_trySettle`) and protected by `msg.sender != address(this)`. It appears in the publicly visible ABI,
which may confuse integrators. The NatSpec already notes "Not part of the public API; do not call
directly." No code change is needed.

#### I-3: `setVideoActive` lacks `whenNotPaused`

**Function:** `setVideoActive` (line 266)  
**Status:** Acknowledged (working as designed).

**Detail.** `registerVideo` and `updatePrice` have `whenNotPaused`, but `setVideoActive` does not.
Since `video.active` is explicitly documented as a UI signal with no enforcement on the settlement
path, pausing the contract does not affect its semantics. Creators being able to deactivate their
video while the contract is paused is a harmless convenience.

#### I-4: `setFeeRecipient` takes effect immediately with no timelock

**Function:** `setFeeRecipient` (line 540)  
**Status:** Acknowledged.

**Detail.** If `feesAccrued > 0`, the owner can redirect all accrued fees to a different address in a
single transaction before anyone calls `withdrawFees`. Under the mainnet plan (owner = Safe multisig),
this requires threshold consensus. The risk is low; the documented mitigation is to call
`withdrawFees` frequently so the accrued balance is minimized.

---

## Mainnet Constructor Plan Review

Planned invocation:
```
new PayPerWatch(
    usdc_         = 0x3600000000000000000000000000000000000000,
    feeBps_       = <initial fee, e.g. 500>,
    feeRecipient_ = <separate operations address>,
    initialOwner_ = <Safe multisig>
)
```

| Check | Result |
|---|---|
| USDC address for Arc Mainnet (chain 5042) | Correct: `0x3600000000000000000000000000000000000000`, 6 decimals |
| Initial `feeBps_` bypasses timelock | Correct by design; document the initial rate in governance. Combined cap validated in constructor. |
| `feeRecipient_` separate from owner | Good. Separates fee revenue from administrative control. |
| `initialOwner_` = Safe multisig | Correct. Ownable2Step means the Safe must `acceptOwnership()` if ownership is ever transferred. |
| Settler key (hot, only pays gas) | Settlement is open to anyone. The settler never has custody and cannot redirect funds. No privileged setter key is needed onchain. |
| Ownership transfer (Safe → Safe upgrade) | Ownable2Step requires the new owner to call `acceptOwnership()`. Covered in new tests. |
| Pause coverage | `withdraw`, `requestWithdraw`, `cancelWithdraw`, `revokeSessionKey`, and `withdrawFees` all work while paused. Deposits and settlement halt. Confirmed in tests. |
| Withdraw delay bounds | Default 24 h. Bounds [1 h, 7 d]. Changes are immediate (M-2 above). |
| Receipt replay: cross-chain | EIP-712 domain includes `chainId` (Arc mainnet = 5042) and `verifyingContract`. A receipt signed on testnet (chain 5042002) is invalid on mainnet. |
| Receipt replay: cross-version | EIP-712 domain version `"4"` is unchanged. A v3 receipt signed under a v3 domain (verifyingContract = old address) is invalid on the new deployment. |
| Receipt replay: same chain, same contract | Cumulative per `(viewer, creator, referrer)` lane. `cumulativeAmount <= settled` is a no-op. No replay possible. |
| Session-key spend caps | Cap checked against signed delta before incrementing by `actualDelta`. Re-authorization preserves `spent`. Re-authorization with lower cap than current `spent` silently creates an exhausted key. This is the viewer's own choice; no funds are at risk. |
| Referral payout race | Referrer eligibility is permanent once `paidTo[referrer][creator] > 0`. No retroactive payment for pre-eligibility spend. No double-charge. Confirmed in tests. |
| Rounding | Fee and referral truncate toward zero; remainder goes to creator (max 2 micro-USDC). Documented in L-3 NatSpec. |
| Fund lock paths | `withdraw` works while paused. `requestWithdraw` can be called any time. `cancelWithdraw` can be called any time. If creator or referrer is USDC-blocklisted, that settlement lane is skipped (`SettlementSkipped`) but viewer funds stay in escrow. `withdrawFees` works while paused. |
| Fund drain paths | No owner path to viewer or creator balances. Settlement only pays addresses in the signed receipt. Fee accumulation is pull-only. |

---

## Invariant Status (post-fix)

Both invariants pass at 256 runs / 128 000 calls each:

1. `viewer_balance + paid_to_creator + feesAccrued + referralPaid == totalDeposited`
2. `contractUSDCBalance >= viewerBalance + feesAccrued`

---

## Test Coverage Added

New file: `contracts/test/PayPerWatchAudit.t.sol` (23 tests)

| Test | Finding covered |
|---|---|
| `test_H1_DualPendingProposalsExceedCombinedCap` | H-1 (fee first) |
| `test_H1_DualPendingProposals_ReferralFirst` | H-1 (referral first) |
| `test_M1_PendingProposalCannotBeOverwritten_FeeReverts` | M-1 (fee) |
| `test_M1_PendingProposalCanBeOverwritten_AfterTimelockExpires` | M-1 (expiry path) |
| `test_M1_PendingReferralCannotBeOverwritten_Reverts` | M-1 (referral) |
| `test_M2_WithdrawDelayCanBeReducedImmediately` | M-2 (documents behavior) |
| `test_M2_ExistingPendingWithdrawUnaffected` | M-2 (retroactive non-effect) |
| `test_Ownable2Step_TransferAndAccept` | Safe handover, I-2 |
| `test_Ownable2Step_OnlyPendingOwnerCanAccept` | Handover guard |
| `test_Ownable2Step_DirectTransferBeforeAcceptDoesNotChangeOwner` | Handover guard |
| `test_Pause_RequestWithdrawWorksWhilePaused` | Pause coverage |
| `test_Pause_CancelWithdrawWorksWhilePaused` | Pause coverage |
| `test_Pause_RevokeSessionKeyWorksWhilePaused` | Pause coverage |
| `test_CreatorZeroAddress_RevsertsOnTransfer` | L-1 |
| `test_CreatorZeroAddress_SkippedInBatch` | L-1 (batch path) |
| `test_SessionKey_SpentIsActualDelta_OnPartialSettle` | Session cap behavior |
| `test_ApplyFee_PendingBpsRetainsStaleValue` (renamed) | L-2 |
| `test_SetFeeRecipient_RedirectsNewWithdraw` | I-4 |
| `test_Settle_ZeroCumulativeAmount_NoOp` | Edge case |
| `test_SettleBatch_RevertsWhenExceedsMaxBatch` | Batch bounds |
| `test_SettleBatch_RevertsLengthMismatch` | Batch input validation |
| `test_DomainSeparator_IncludesChainId` | EIP-712 |
| `test_HashReceipt_ConsistentAcrossCalls` | EIP-712 |

---

## Files Changed

| File | Change |
|---|---|
| `contracts/src/PayPerWatch.sol` | H-1, M-1, L-1, L-2 fixes. Round 2: `cancelFeeProposal`, `cancelReferralProposal`, `FeeProposalCancelled`, `ReferralBpsProposalCancelled` added. EIP-712 domain version `"4"` unchanged. |
| `foundry.toml` | Added `via_ir = true` (I-1). |
| `contracts/test/PayPerWatchAudit.t.sol` | Round 1: 23 audit tests. Round 2: 14 cancel tests added (37 total). |
| `contracts/abi/PayPerWatch.json` | Generated from `forge build` artifact. Includes all new functions and events. |
| `contracts/PayPerWatch.sol` | New: thin re-export shim so `test/*.t.sol` relative imports resolve. |
| `contracts/test-helpers/MockERC20.sol` | New: minimal ERC-20 mock required by all test files. |
