// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {PayPerWatch} from "../PayPerWatch.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// =============================================================================
// Invariant handler — drives deposits and settlements for the accounting invariant
// =============================================================================
contract PayPerWatchHandler is Test {
    PayPerWatch public ppw;
    MockERC20 public usdc;

    // Ghost accounting: track what went in and out
    uint256 public ghostTotalDeposited;
    uint256 public ghostTotalPaidCreator;
    uint256 public ghostTotalFees;
    uint256 public ghostTotalReferral;

    // Fixed participants for the handler
    address public viewer;
    uint256 public viewerPk;
    address public creator;
    address public feeRecipient;

    // Running cumulative for the single (viewer→creator) pair
    uint256 public cumulative;

    constructor(PayPerWatch _ppw, MockERC20 _usdc, address _creator, address _feeRecipient) {
        ppw = _ppw;
        usdc = _usdc;
        creator = _creator;
        feeRecipient = _feeRecipient;
        (viewer, viewerPk) = makeAddrAndKey("handler_viewer");
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 1_000_000e6);
        usdc.mint(viewer, amount);
        vm.startPrank(viewer);
        usdc.approve(address(ppw), amount);
        ppw.deposit(amount);
        vm.stopPrank();
        ghostTotalDeposited += amount;
    }

    function settle(uint256 extra) external {
        // Only settle if there is balance
        uint256 balance = ppw.balanceOf(viewer);
        if (balance == 0) return;

        extra = bound(extra, 1, balance);
        uint256 newCumulative = cumulative + extra;

        PayPerWatch.Receipt memory r = PayPerWatch.Receipt({
            viewer: viewer,
            creator: creator,
            referrer: address(0),
            cumulativeAmount: newCumulative,
            deadline: uint64(block.timestamp + 1 hours)
        });

        bytes32 digest = ppw.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(viewerPk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        uint256 creatorBefore = usdc.balanceOf(creator);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        ppw.settle(r, sig);

        ghostTotalPaidCreator += usdc.balanceOf(creator) - creatorBefore;
        ghostTotalFees += usdc.balanceOf(feeRecipient) - feeBefore;
        // No referrer in handler (referrer == address(0)), so ghostTotalReferral stays 0
        cumulative = newCumulative;
    }
}

// =============================================================================
// Main test contract
// =============================================================================
contract PayPerWatchTest is Test {
    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    PayPerWatch internal ppw;
    MockERC20 internal usdc;

    address internal owner;
    address internal feeRecipient;
    address internal alice;
    address internal bob; // creator
    address internal charlie; // bystander

    uint256 internal alicePk;
    uint256 internal sessionKeyPk;
    address internal sessionKeyAddr;

    uint16 internal constant FEE_BPS = 500; // 5%
    uint256 internal constant DEPOSIT_AMOUNT = 1_000e6; // 1000 USDC (6 dec)

    // Invariant handler
    PayPerWatchHandler internal handler;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// @dev Mint USDC to `to` and approve the contract to spend it.
    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        vm.prank(to);
        usdc.approve(address(ppw), amount);
    }

    /// @dev Deposit `amount` on behalf of `viewer`.
    function _deposit(address viewer, uint256 amount) internal {
        _fund(viewer, amount);
        vm.prank(viewer);
        ppw.deposit(amount);
    }

    /// @dev Build and sign a receipt with a given private key.
    function _signReceipt(
        PayPerWatch.Receipt memory r,
        uint256 signerPk
    ) internal view returns (bytes memory sig) {
        bytes32 digest = ppw.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, digest);
        sig = abi.encodePacked(rs, ss, v);
    }

    /// @dev Build a receipt for (alice → bob) with given cumulative and deadline.
    function _receipt(uint256 cumAmt, uint64 deadline)
        internal
        view
        returns (PayPerWatch.Receipt memory)
    {
        return PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: cumAmt,
            deadline: deadline
        });
    }

    /// @dev Settle helper: sign with alice's key and call settle().
    function _settle(uint256 cumAmt) internal {
        PayPerWatch.Receipt memory r = _receipt(cumAmt, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);
        ppw.settle(r, sig);
    }

    // -------------------------------------------------------------------------
    // setUp — runs before EVERY test
    // -------------------------------------------------------------------------
    function setUp() public {
        owner = makeAddr("owner");
        feeRecipient = makeAddr("feeRecipient");
        (alice, alicePk) = makeAddrAndKey("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        (sessionKeyAddr, sessionKeyPk) = makeAddrAndKey("sessionKey");

        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        ppw = new PayPerWatch(address(usdc), FEE_BPS, feeRecipient, owner);
    }

    // =========================================================================
    // 1. CONSTRUCTOR / INITIALIZATION
    // =========================================================================

    function test_Constructor_SetsFields() public view {
        assertEq(address(ppw.usdc()), address(usdc));
        assertEq(ppw.feeBps(), FEE_BPS);
        assertEq(ppw.feeRecipient(), feeRecipient);
        assertEq(ppw.owner(), owner);
    }

    function test_Constructor_RevertsZeroUsdc() public {
        vm.expectRevert(PayPerWatch.ZeroAddress.selector);
        new PayPerWatch(address(0), FEE_BPS, feeRecipient, owner);
    }

    function test_Constructor_RevertsZeroFeeRecipient() public {
        vm.expectRevert(PayPerWatch.ZeroAddress.selector);
        new PayPerWatch(address(usdc), FEE_BPS, address(0), owner);
    }

    function test_Constructor_RevertsZeroOwner() public {
        // OZ Ownable validates address(0) before PayPerWatch's ZeroAddress check,
        // so the revert is OwnableInvalidOwner, not ZeroAddress.
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0))
        );
        new PayPerWatch(address(usdc), FEE_BPS, feeRecipient, address(0));
    }

    function test_Constructor_RevertsFeeTooHigh() public {
        vm.expectRevert(PayPerWatch.FeeTooHigh.selector);
        new PayPerWatch(address(usdc), 1001, feeRecipient, owner);
    }

    // =========================================================================
    // 2. DEPOSIT — happy path (case 1)
    // =========================================================================

    function test_Deposit_HappyPath() public {
        _fund(alice, DEPOSIT_AMOUNT);

        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.Deposited(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.deposit(DEPOSIT_AMOUNT);

        assertEq(ppw.balanceOf(alice), DEPOSIT_AMOUNT);
        assertEq(usdc.balanceOf(address(ppw)), DEPOSIT_AMOUNT);
    }

    function test_Deposit_RevertsOnZero() public {
        vm.prank(alice);
        vm.expectRevert(PayPerWatch.InvalidAmount.selector);
        ppw.deposit(0);
    }

    function test_Deposit_RevertWhenPaused() public {
        // case 13: deposit reverts while paused
        vm.prank(owner);
        ppw.pause();

        _fund(alice, DEPOSIT_AMOUNT);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        ppw.deposit(DEPOSIT_AMOUNT);
    }

    // =========================================================================
    // 3. WITHDRAW — happy path & delay revert (cases 1 & 2)
    // =========================================================================

    function test_Withdraw_HappyPath() public {
        // case 1: deposit → requestWithdraw → wait → withdraw
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

        // Advance past the delay
        skip(ppw.WITHDRAW_DELAY() + 1);

        uint256 balBefore = usdc.balanceOf(alice);

        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.Withdrawn(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.withdraw();

        assertEq(usdc.balanceOf(alice), balBefore + DEPOSIT_AMOUNT);
        assertEq(ppw.balanceOf(alice), 0);
    }

    function test_Withdraw_RevertsBeforeDelay() public {
        // case 2: WithdrawDelayNotMet
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

        // Only half the delay elapsed
        skip(ppw.WITHDRAW_DELAY() / 2);

        vm.prank(alice);
        vm.expectRevert(PayPerWatch.WithdrawDelayNotMet.selector);
        ppw.withdraw();
    }

    function test_Withdraw_WorksWhilePaused() public {
        // case 12: withdraw is not guarded by whenNotPaused
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

        skip(ppw.WITHDRAW_DELAY() + 1);

        vm.prank(owner);
        ppw.pause();

        // Should NOT revert even though paused
        vm.prank(alice);
        ppw.withdraw();

        assertEq(ppw.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), DEPOSIT_AMOUNT);
    }

    function test_RequestWithdraw_RevertsInsufficientBalance() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(PayPerWatch.InsufficientBalance.selector);
        ppw.requestWithdraw(DEPOSIT_AMOUNT + 1);
    }

    function test_CancelWithdraw_EmitsEvent() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

        vm.expectEmit(true, false, false, false, address(ppw));
        emit PayPerWatch.WithdrawCancelled(alice);

        vm.prank(alice);
        ppw.cancelWithdraw();

        // pending withdrawal cleared
        (uint128 amt,) = ppw.pendingWithdrawal(alice);
        assertEq(amt, 0);
    }

    // =========================================================================
    // 4. SESSION KEYS
    // =========================================================================

    function test_AuthorizeSessionKey_HappyPath() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint128 cap = 500e6;

        vm.expectEmit(true, true, false, true, address(ppw));
        emit PayPerWatch.SessionKeyAuthorized(alice, sessionKeyAddr, expiry, cap);

        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

        (uint64 storedExpiry, uint128 storedCap, uint128 storedSpent) =
            ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(storedExpiry, expiry);
        assertEq(storedCap, cap);
        assertEq(storedSpent, 0);
    }

    function test_AuthorizeSessionKey_RevertsExpiredExpiry() public {
        vm.prank(alice);
        vm.expectRevert(PayPerWatch.SessionKeyExpired.selector);
        ppw.authorizeSessionKey(sessionKeyAddr, uint64(block.timestamp), 500e6);
    }

    function test_RevokeSessionKey_EmitsEvent() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, 500e6);

        vm.expectEmit(true, true, false, false, address(ppw));
        emit PayPerWatch.SessionKeyRevoked(alice, sessionKeyAddr);

        vm.prank(alice);
        ppw.revokeSessionKey(sessionKeyAddr);

        (uint64 storedExpiry,,) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(storedExpiry, 0);
    }

    // =========================================================================
    // 5. SETTLE — viewer's own signature (case 3)
    // =========================================================================

    function test_Settle_ViewerSignature_HappyPath() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint256 amount = 100e6;
        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);

        uint256 creatorBefore = usdc.balanceOf(bob);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        vm.expectEmit(true, true, true, true, address(ppw));
        uint256 expectedFee = (amount * FEE_BPS) / 10_000;
        emit PayPerWatch.Settled(alice, bob, address(0), amount, expectedFee, 0, amount);

        ppw.settle(r, sig);

        // Viewer balance reduced
        assertEq(ppw.balanceOf(alice), DEPOSIT_AMOUNT - amount);
        // Creator received amount - fee (no referral)
        assertEq(usdc.balanceOf(bob), creatorBefore + amount - expectedFee);
        // Fee recipient received fee
        assertEq(usdc.balanceOf(feeRecipient), feeBefore + expectedFee);
        // Settled mapping updated (lane keyed by referrer = address(0))
        assertEq(ppw.settled(alice, bob, address(0)), amount);
    }

    function test_Settle_RevertsExpiredReceipt() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp - 1));
        bytes memory sig = _signReceipt(r, alicePk);

        vm.expectRevert(PayPerWatch.ReceiptExpired.selector);
        ppw.settle(r, sig);
    }

    function test_Settle_RevertsWhenPaused() public {
        // case 14: settle reverts while paused
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(owner);
        ppw.pause();

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        ppw.settle(r, sig);
    }

    function test_Settle_InvalidSignature_RandomSig() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        // Sign with a completely wrong key (charlie's)
        (, uint256 charliePk) = makeAddrAndKey("charlie");
        bytes memory sig = _signReceipt(r, charliePk);

        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 6. SETTLE — session key happy path (case 4)
    // =========================================================================

    function test_Settle_SessionKey_HappyPath() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        // Alice authorizes the session key
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint128 cap = 500e6;
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

        uint256 amount = 200e6;
        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        // Sign with SESSION KEY, not alice
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        uint256 creatorBefore = usdc.balanceOf(bob);

        ppw.settle(r, sig);

        uint256 expectedFee = (amount * FEE_BPS) / 10_000;
        assertEq(ppw.balanceOf(alice), DEPOSIT_AMOUNT - amount);
        assertEq(usdc.balanceOf(bob), creatorBefore + amount - expectedFee);
        assertEq(ppw.settled(alice, bob, address(0)), amount);

        // Session spent tracking
        (, , uint128 spent) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(spent, amount);
    }

    // =========================================================================
    // 7. SESSION CAP EXCEEDED (case 5)
    // =========================================================================

    function test_Settle_SessionCapExceeded() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 expiry = uint64(block.timestamp + 1 days);
        uint128 cap = 100e6; // cap at 100
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

        // Try to settle 101 — over cap
        uint256 amount = 101e6;
        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        vm.expectRevert(PayPerWatch.SessionCapExceeded.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 8. SESSION KEY EXPIRED (case 6)
    // =========================================================================

    function test_Settle_SessionKeyExpired() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        // Key expires in 1 hour, but receipt deadline is far in the future (3 hours)
        // so after we warp past the key expiry the receipt is still live.
        uint64 keyExpiry = uint64(block.timestamp + 1 hours);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, keyExpiry, 500e6);

        // Build receipt with a far-future deadline BEFORE warping
        uint64 receiptDeadline = uint64(block.timestamp + 3 hours);
        PayPerWatch.Receipt memory r = PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: 100e6,
            deadline: receiptDeadline
        });
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        // Advance past the key expiry but NOT past the receipt deadline
        skip(2 hours);

        vm.expectRevert(PayPerWatch.SessionKeyExpired.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 9. REVOKED SESSION KEY → InvalidSignature (case 7)
    // =========================================================================

    function test_Settle_RevokedSessionKey_InvalidSignature() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, 500e6);

        // Alice revokes the session key
        vm.prank(alice);
        ppw.revokeSessionKey(sessionKeyAddr);

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 10. STALE RECEIPT — no-op (case 8)
    // =========================================================================

    function test_Settle_StaleReceipt_NoOp() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint256 amount = 100e6;
        // First settle
        _settle(amount);

        uint256 balAfterFirst = ppw.balanceOf(alice);
        uint256 creatorAfterFirst = usdc.balanceOf(bob);

        // Second settle with SAME cumulativeAmount — should be a no-op (delta == 0)
        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);
        ppw.settle(r, sig);

        // Nothing changed
        assertEq(ppw.balanceOf(alice), balAfterFirst);
        assertEq(usdc.balanceOf(bob), creatorAfterFirst);
    }

    // =========================================================================
    // 11. PARTIAL SETTLEMENT — balance capped (case 9)
    // =========================================================================

    function test_Settle_PartialSettlement_BalanceCapped() public {
        uint256 depositAmt = 50e6; // only 50 USDC
        _deposit(alice, depositAmt);

        uint256 requestedDelta = 100e6; // asking for 100 but only 50 available

        PayPerWatch.Receipt memory r = _receipt(requestedDelta, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);

        vm.expectEmit(true, true, false, true, address(ppw));
        emit PayPerWatch.PartialSettlement(alice, bob, depositAmt, requestedDelta);

        ppw.settle(r, sig);

        // Viewer balance drained to 0
        assertEq(ppw.balanceOf(alice), 0);
        // Creator got depositAmt - fee
        uint256 expectedFee = (depositAmt * FEE_BPS) / 10_000;
        assertEq(usdc.balanceOf(bob), depositAmt - expectedFee);
    }

    // =========================================================================
    // 12. FEE MATH (case 10)
    // =========================================================================

    function test_FeeMath_ZeroFee() public {
        // Deploy with feeBps = 0
        PayPerWatch ppwNoFee = new PayPerWatch(address(usdc), 0, feeRecipient, owner);

        _fund(alice, DEPOSIT_AMOUNT);
        vm.prank(alice);
        usdc.approve(address(ppwNoFee), DEPOSIT_AMOUNT);
        vm.prank(alice);
        ppwNoFee.deposit(DEPOSIT_AMOUNT);

        uint256 amount = 100e6;
        PayPerWatch.Receipt memory r = PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: amount,
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes32 digest = ppwNoFee.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(alicePk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        uint256 creatorBefore = usdc.balanceOf(bob);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        ppwNoFee.settle(r, sig);

        // Creator gets full amount (no fee)
        assertEq(usdc.balanceOf(bob), creatorBefore + amount);
        // Fee recipient unchanged
        assertEq(usdc.balanceOf(feeRecipient), feeBefore);
    }

    function test_FeeMath_TenPercentFee() public {
        // Deploy with feeBps = 1000 (10%)
        PayPerWatch ppw10 = new PayPerWatch(address(usdc), 1000, feeRecipient, owner);

        _fund(alice, DEPOSIT_AMOUNT);
        vm.prank(alice);
        usdc.approve(address(ppw10), DEPOSIT_AMOUNT);
        vm.prank(alice);
        ppw10.deposit(DEPOSIT_AMOUNT);

        uint256 amount = 100e6;
        PayPerWatch.Receipt memory r = PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: amount,
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes32 digest = ppw10.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(alicePk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        uint256 creatorBefore = usdc.balanceOf(bob);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        ppw10.settle(r, sig);

        uint256 expectedFee = amount / 10; // 10%
        assertEq(usdc.balanceOf(feeRecipient), feeBefore + expectedFee);
        assertEq(usdc.balanceOf(bob), creatorBefore + amount - expectedFee);
    }

    // =========================================================================
    // 13. SETTLE BATCH — one bad entry skipped (case 11)
    // =========================================================================

    function test_SettleBatch_SkipsBadEntry() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        // Receipt 0: valid
        PayPerWatch.Receipt memory r0 = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig0 = _signReceipt(r0, alicePk);

        // Receipt 1: bad (expired) — should emit SettlementSkipped
        PayPerWatch.Receipt memory r1 = _receipt(200e6, uint64(block.timestamp - 1));
        bytes memory sig1 = _signReceipt(r1, alicePk);

        PayPerWatch.Receipt[] memory rs = new PayPerWatch.Receipt[](2);
        rs[0] = r0;
        rs[1] = r1;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = sig0;
        sigs[1] = sig1;

        // Expect SettlementSkipped for index 1
        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.SettlementSkipped(1, PayPerWatch.ReceiptExpired.selector);

        ppw.settleBatch(rs, sigs);

        // Valid entry settled
        assertEq(ppw.settled(alice, bob, address(0)), 100e6);
    }

    function test_SettleBatch_RevertsWhenPaused() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(owner);
        ppw.pause();

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);

        PayPerWatch.Receipt[] memory rs = new PayPerWatch.Receipt[](1);
        rs[0] = r;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = sig;

        vm.expectRevert(Pausable.EnforcedPause.selector);
        ppw.settleBatch(rs, sigs);
    }

    // =========================================================================
    // 14. WRONG CHAIN ID IN DOMAIN → signature fails (case 15)
    // =========================================================================

    function test_Settle_WrongChainId_SignatureFails() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        // Sign on a different chain id
        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes32 digest = ppw.hashReceipt(r);

        // Switch chain id, re-sign, then switch back
        vm.chainId(999);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(alicePk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);
        vm.chainId(block.chainid); // restore

        // The digest was computed on chain 1, but we signed on 999, so
        // the signer recovered won't be alice → InvalidSignature
        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 15. WRONG CONTRACT ADDRESS IN DOMAIN → signature fails (case 16)
    // =========================================================================

    function test_Settle_WrongContractAddress_SignatureFails() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        // Deploy a second contract (different address, same params)
        PayPerWatch ppw2 = new PayPerWatch(address(usdc), FEE_BPS, feeRecipient, owner);

        // Sign a receipt for ppw2's domain
        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes32 digestForPpw2 = ppw2.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(alicePk, digestForPpw2);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        // Use the sig (signed for ppw2) against ppw → domain mismatch → InvalidSignature
        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 16. VIDEO MANAGEMENT
    // =========================================================================

    function test_RegisterVideo_HappyPath() public {
        bytes32 vid = keccak256("vid1");
        uint128 price = 1_000_000; // 1 USDC/hour

        vm.expectEmit(true, true, false, true, address(ppw));
        emit PayPerWatch.VideoRegistered(vid, bob, price);

        vm.prank(bob);
        ppw.registerVideo(vid, price);

        PayPerWatch.Video memory v = ppw.getVideo(vid);
        assertEq(v.creator, bob);
        assertEq(v.pricePerHour, price);
        assertTrue(v.active);
    }

    function test_RegisterVideo_RevertsAlreadyExists() public {
        bytes32 vid = keccak256("vid1");
        vm.prank(bob);
        ppw.registerVideo(vid, 1_000_000);

        vm.prank(charlie);
        vm.expectRevert(PayPerWatch.VideoAlreadyExists.selector);
        ppw.registerVideo(vid, 2_000_000);
    }

    function test_UpdatePrice_HappyPath() public {
        bytes32 vid = keccak256("vid1");
        vm.prank(bob);
        ppw.registerVideo(vid, 1_000_000);

        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.PriceUpdated(vid, 2_000_000);

        vm.prank(bob);
        ppw.updatePrice(vid, 2_000_000);

        assertEq(ppw.getVideo(vid).pricePerHour, 2_000_000);
    }

    function test_UpdatePrice_RevertsNotCreator() public {
        bytes32 vid = keccak256("vid1");
        vm.prank(bob);
        ppw.registerVideo(vid, 1_000_000);

        vm.prank(charlie);
        vm.expectRevert(PayPerWatch.NotCreator.selector);
        ppw.updatePrice(vid, 2_000_000);
    }

    function test_SetVideoActive_HappyPath() public {
        bytes32 vid = keccak256("vid1");
        vm.prank(bob);
        ppw.registerVideo(vid, 1_000_000);

        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.VideoActiveSet(vid, false);

        vm.prank(bob);
        ppw.setVideoActive(vid, false);

        assertFalse(ppw.getVideo(vid).active);
    }

    // =========================================================================
    // 17. OWNER FUNCTIONS
    // =========================================================================

    function test_SetFee_HappyPath() public {
        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.FeeUpdated(200);

        vm.prank(owner);
        ppw.setFee(200);

        assertEq(ppw.feeBps(), 200);
    }

    function test_SetFee_RevertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice)
        );
        ppw.setFee(200);
    }

    function test_SetFee_RevertsFeeTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.FeeTooHigh.selector);
        ppw.setFee(1001);
    }

    function test_SetFeeRecipient_HappyPath() public {
        address newRecipient = makeAddr("newRecipient");
        vm.prank(owner);
        ppw.setFeeRecipient(newRecipient);
        assertEq(ppw.feeRecipient(), newRecipient);
    }

    function test_SetFeeRecipient_RevertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.ZeroAddress.selector);
        ppw.setFeeRecipient(address(0));
    }

    function test_Pause_HappyPath() public {
        vm.prank(owner);
        ppw.pause();
        assertTrue(ppw.paused());
    }

    function test_Pause_RevertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice)
        );
        ppw.pause();
    }

    function test_Unpause_HappyPath() public {
        vm.prank(owner);
        ppw.pause();
        vm.prank(owner);
        ppw.unpause();
        assertFalse(ppw.paused());
    }

    // =========================================================================
    // 18. depositAndAuthorize
    // =========================================================================

    function test_DepositAndAuthorize_HappyPath() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint128 cap = 300e6;

        _fund(alice, DEPOSIT_AMOUNT);
        vm.prank(alice);
        ppw.depositAndAuthorize(DEPOSIT_AMOUNT, sessionKeyAddr, expiry, cap);

        assertEq(ppw.balanceOf(alice), DEPOSIT_AMOUNT);
        (uint64 storedExpiry, uint128 storedCap,) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(storedExpiry, expiry);
        assertEq(storedCap, cap);
    }

    // =========================================================================
    // 19. FUZZ — fee math always splits correctly (case 10 extended)
    // =========================================================================

    function testFuzz_FeeMath(uint256 depositAmt, uint256 settleAmt, uint16 bps) public {
        depositAmt = bound(depositAmt, 1, 1_000_000e6);
        bps = uint16(bound(bps, 0, 1000));
        settleAmt = bound(settleAmt, 1, depositAmt);

        PayPerWatch ppwFuzz = new PayPerWatch(address(usdc), bps, feeRecipient, owner);

        _fund(alice, depositAmt);
        vm.prank(alice);
        usdc.approve(address(ppwFuzz), depositAmt);
        vm.prank(alice);
        ppwFuzz.deposit(depositAmt);

        PayPerWatch.Receipt memory r = PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: settleAmt,
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes32 digest = ppwFuzz.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(alicePk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        uint256 creatorBefore = usdc.balanceOf(bob);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);

        ppwFuzz.settle(r, sig);

        uint256 expectedFee = (settleAmt * bps) / 10_000;
        assertEq(usdc.balanceOf(feeRecipient), feeBefore + expectedFee, "fee mismatch");
        assertEq(usdc.balanceOf(bob), creatorBefore + settleAmt - expectedFee, "creator mismatch");
    }

    // =========================================================================
    // 20. FUZZ — session cap tracking
    // =========================================================================

    function testFuzz_SessionCapTracking(uint128 cap, uint128 settle1, uint128 settle2) public {
        cap = uint128(bound(cap, 1, 1_000e6));
        settle1 = uint128(bound(settle1, 1, cap));
        // settle2 starts from cumulative settle1; valid range is [0, cap - settle1]
        settle2 = uint128(bound(settle2, 0, cap - settle1));

        _deposit(alice, cap); // deposit exactly cap

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

        // First settlement
        PayPerWatch.Receipt memory r1 = PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: settle1,
            deadline: uint64(block.timestamp + 1 hours)
        });
        bytes memory sig1 = _signReceipt(r1, sessionKeyPk);
        ppw.settle(r1, sig1);

        (,, uint128 spentAfter1) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(spentAfter1, settle1);

        if (settle2 > 0) {
            // Second settlement (cumulative)
            PayPerWatch.Receipt memory r2 = PayPerWatch.Receipt({
                viewer: alice,
                creator: bob,
                referrer: address(0),
                cumulativeAmount: uint256(settle1) + uint256(settle2),
                deadline: uint64(block.timestamp + 1 hours)
            });
            bytes memory sig2 = _signReceipt(r2, sessionKeyPk);
            ppw.settle(r2, sig2);

            (,, uint128 spentAfter2) = ppw.sessionKeys(alice, sessionKeyAddr);
            assertEq(spentAfter2, settle1 + settle2);
        }
    }

    // =========================================================================
    // 21. FUZZ — stale receipt always a no-op (case 8 extended)
    // =========================================================================

    function testFuzz_StaleReceipt_NoOp(uint256 amount, uint256 staleCumulative) public {
        amount = bound(amount, 1, 1_000_000e6);
        _deposit(alice, amount);

        // First settle
        PayPerWatch.Receipt memory r0 = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig0 = _signReceipt(r0, alicePk);
        ppw.settle(r0, sig0);

        uint256 balAfter = ppw.balanceOf(alice);

        // Try to settle with a cumulativeAmount <= already settled amount — always a no-op (silent return).
        // The contract returns early for any cumulativeAmount <= prior, whether strictly less or equal.
        staleCumulative = bound(staleCumulative, 0, amount);
        PayPerWatch.Receipt memory rs = _receipt(staleCumulative, uint64(block.timestamp + 1 hours));
        bytes memory sigs = _signReceipt(rs, alicePk);
        ppw.settle(rs, sigs); // must NOT revert
        assertEq(ppw.balanceOf(alice), balAfter, "stale receipt changed balance");
    }
}

// =============================================================================
// 22. INVARIANT TEST — accounting conservation (case 17)
// =============================================================================
contract PayPerWatchInvariantTest is Test {
    PayPerWatch internal ppw;
    MockERC20 internal usdc;
    PayPerWatchHandler internal handler;

    address internal owner;
    address internal feeRecipient;
    address internal creator;

    function setUp() public {
        owner = makeAddr("inv_owner");
        feeRecipient = makeAddr("inv_feeRecipient");
        creator = makeAddr("inv_creator");

        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        ppw = new PayPerWatch(address(usdc), 500, feeRecipient, owner); // 5% fee

        handler = new PayPerWatchHandler(ppw, usdc, creator, feeRecipient);
        targetContract(address(handler));
    }

    /// @dev Invariant: viewer_balance + paid_to_creator + fees + referral == total_deposited
    /// (i.e. no USDC created or destroyed; every coin is accounted for)
    function invariant_AccountingConservation() public view {
        uint256 viewerBalance = ppw.balanceOf(handler.viewer());
        uint256 paidCreator = handler.ghostTotalPaidCreator();
        uint256 paidFees = handler.ghostTotalFees();
        uint256 paidReferral = handler.ghostTotalReferral();
        uint256 totalDeposited = handler.ghostTotalDeposited();

        assertEq(
            viewerBalance + paidCreator + paidFees + paidReferral,
            totalDeposited,
            "accounting conservation violated"
        );
    }

    /// @dev Invariant: contract USDC balance always covers all viewer balances
    function invariant_ContractBalanceCoversPendingDeposits() public view {
        uint256 contractBalance = usdc.balanceOf(address(ppw));
        uint256 viewerBalance = ppw.balanceOf(handler.viewer());
        assertGe(contractBalance, viewerBalance, "contract USDC < viewer balances");
    }
}
