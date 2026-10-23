// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {PayPerWatch} from "../PayPerWatch.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// =============================================================================
// Invariant handler — drives deposits and settlements for the accounting invariant
// v4: fees now accrue in feesAccrued, not pushed to feeRecipient on settle.
// =============================================================================
contract PayPerWatchHandler is Test {
    PayPerWatch public ppw;
    MockERC20 public usdc;

    // Ghost accounting: track what went in and out
    uint256 public ghostTotalDeposited;
    uint256 public ghostTotalPaidCreator;
    uint256 public ghostTotalFees;      // accrued in feesAccrued (not pushed)
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
        uint256 feesBefore    = ppw.feesAccrued();

        ppw.settle(r, sig);

        ghostTotalPaidCreator += usdc.balanceOf(creator) - creatorBefore;
        // v4: fees accrue in feesAccrued, not pushed to feeRecipient
        ghostTotalFees += ppw.feesAccrued() - feesBefore;
        cumulative = newCumulative;
    }
}

// =============================================================================
// Main test contract
// =============================================================================
contract PayPerWatchTest is Test {
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
    uint256 internal constant DEPOSIT_AMOUNT = 1_000e6;

    PayPerWatchHandler internal handler;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _fund(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        vm.prank(to);
        usdc.approve(address(ppw), amount);
    }

    function _deposit(address viewer, uint256 amount) internal {
        _fund(viewer, amount);
        vm.prank(viewer);
        ppw.deposit(amount);
    }

    function _signReceipt(PayPerWatch.Receipt memory r, uint256 signerPk)
        internal view returns (bytes memory sig)
    {
        bytes32 digest = ppw.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, digest);
        sig = abi.encodePacked(rs, ss, v);
    }

    function _receipt(uint256 cumAmt, uint64 deadline)
        internal view returns (PayPerWatch.Receipt memory)
    {
        return PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: cumAmt,
            deadline: deadline
        });
    }

    function _settle(uint256 cumAmt) internal {
        PayPerWatch.Receipt memory r = _receipt(cumAmt, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);
        ppw.settle(r, sig);
    }

    // -------------------------------------------------------------------------
    // setUp
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
        assertEq(ppw.referralBps(), 500);
        assertEq(ppw.WITHDRAW_DELAY(), 24 hours);
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
    // 2. DEPOSIT
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
        vm.prank(owner);
        ppw.pause();

        _fund(alice, DEPOSIT_AMOUNT);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        ppw.deposit(DEPOSIT_AMOUNT);
    }

    // =========================================================================
    // 3. WITHDRAW
    // =========================================================================

    function test_Withdraw_HappyPath() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

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
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

        skip(ppw.WITHDRAW_DELAY() / 2);

        vm.prank(alice);
        vm.expectRevert(PayPerWatch.WithdrawDelayNotMet.selector);
        ppw.withdraw();
    }

    function test_Withdraw_WorksWhilePaused() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

        skip(ppw.WITHDRAW_DELAY() + 1);

        vm.prank(owner);
        ppw.pause();

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
    // 5. SETTLE — viewer's own signature
    //    v4: fee accrues in feesAccrued, not pushed to feeRecipient
    // =========================================================================

    function test_Settle_ViewerSignature_HappyPath() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint256 amount = 100e6;
        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);

        uint256 creatorBefore  = usdc.balanceOf(bob);
        uint256 feesAccruedBefore = ppw.feesAccrued();
        uint256 feeRecipBefore = usdc.balanceOf(feeRecipient);

        uint256 expectedFee = (amount * FEE_BPS) / 10_000;

        vm.expectEmit(true, true, true, true, address(ppw));
        emit PayPerWatch.Settled(alice, bob, address(0), amount, expectedFee, 0, amount);

        ppw.settle(r, sig);

        // Viewer balance reduced
        assertEq(ppw.balanceOf(alice), DEPOSIT_AMOUNT - amount);
        // Creator received amount - fee
        assertEq(usdc.balanceOf(bob), creatorBefore + amount - expectedFee);
        // v4: fee NOT pushed to feeRecipient; it accrues in feesAccrued
        assertEq(usdc.balanceOf(feeRecipient), feeRecipBefore, "feeRecipient unchanged (pull model)");
        assertEq(ppw.feesAccrued(), feesAccruedBefore + expectedFee, "fee accrued");
        // Settled mapping updated
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
        (, uint256 charliePk) = makeAddrAndKey("charlie");
        bytes memory sig = _signReceipt(r, charliePk);

        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 6. SETTLE — session key happy path
    // =========================================================================

    function test_Settle_SessionKey_HappyPath() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 expiry = uint64(block.timestamp + 1 days);
        uint128 cap = 500e6;
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

        uint256 amount = 200e6;
        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        uint256 creatorBefore = usdc.balanceOf(bob);

        ppw.settle(r, sig);

        uint256 expectedFee = (amount * FEE_BPS) / 10_000;
        assertEq(ppw.balanceOf(alice), DEPOSIT_AMOUNT - amount);
        assertEq(usdc.balanceOf(bob), creatorBefore + amount - expectedFee);
        assertEq(ppw.settled(alice, bob, address(0)), amount);

        (, , uint128 spent) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(spent, amount);
    }

    // =========================================================================
    // 7. SESSION CAP EXCEEDED
    // =========================================================================

    function test_Settle_SessionCapExceeded() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 expiry = uint64(block.timestamp + 1 days);
        uint128 cap = 100e6;
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

        uint256 amount = 101e6;
        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        vm.expectRevert(PayPerWatch.SessionCapExceeded.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 8. SESSION KEY EXPIRED
    // =========================================================================

    function test_Settle_SessionKeyExpired() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 keyExpiry = uint64(block.timestamp + 1 hours);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, keyExpiry, 500e6);

        uint64 receiptDeadline = uint64(block.timestamp + 3 hours);
        PayPerWatch.Receipt memory r = PayPerWatch.Receipt({
            viewer: alice,
            creator: bob,
            referrer: address(0),
            cumulativeAmount: 100e6,
            deadline: receiptDeadline
        });
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        skip(2 hours);

        vm.expectRevert(PayPerWatch.SessionKeyExpired.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 9. REVOKED SESSION KEY → InvalidSignature
    // =========================================================================

    function test_Settle_RevokedSessionKey_InvalidSignature() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, 500e6);

        vm.prank(alice);
        ppw.revokeSessionKey(sessionKeyAddr);

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, sessionKeyPk);

        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 10. STALE RECEIPT — no-op
    // =========================================================================

    function test_Settle_StaleReceipt_NoOp() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint256 amount = 100e6;
        _settle(amount);

        uint256 balAfterFirst = ppw.balanceOf(alice);
        uint256 creatorAfterFirst = usdc.balanceOf(bob);

        PayPerWatch.Receipt memory r = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);
        ppw.settle(r, sig);

        assertEq(ppw.balanceOf(alice), balAfterFirst);
        assertEq(usdc.balanceOf(bob), creatorAfterFirst);
    }

    // =========================================================================
    // 11. PARTIAL SETTLEMENT — balance capped
    // =========================================================================

    function test_Settle_PartialSettlement_BalanceCapped() public {
        uint256 depositAmt = 50e6;
        _deposit(alice, depositAmt);

        uint256 requestedDelta = 100e6;
        PayPerWatch.Receipt memory r = _receipt(requestedDelta, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);

        vm.expectEmit(true, true, false, true, address(ppw));
        emit PayPerWatch.PartialSettlement(alice, bob, depositAmt, requestedDelta);

        ppw.settle(r, sig);

        assertEq(ppw.balanceOf(alice), 0);
        uint256 expectedFee = (depositAmt * FEE_BPS) / 10_000;
        assertEq(usdc.balanceOf(bob), depositAmt - expectedFee);
    }

    // =========================================================================
    // 12. FEE MATH (v4: fees accrue in feesAccrued)
    // =========================================================================

    function test_FeeMath_ZeroFee() public {
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

        ppwNoFee.settle(r, sig);

        assertEq(usdc.balanceOf(bob), creatorBefore + amount, "creator gets full amount");
        assertEq(ppwNoFee.feesAccrued(), 0, "no fee accrued");
    }

    function test_FeeMath_TenPercentFee() public {
        // feeBps=1000, referralBps default=500, combined=1500 — exactly at the cap
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

        ppw10.settle(r, sig);

        uint256 expectedFee = amount / 10; // 10%
        // fee accrues in feesAccrued, not pushed
        assertEq(ppw10.feesAccrued(), expectedFee, "fee accrued");
        assertEq(usdc.balanceOf(bob), creatorBefore + amount - expectedFee, "creator correct");
    }

    // =========================================================================
    // 13. SETTLE BATCH — one bad entry skipped
    // =========================================================================

    function test_SettleBatch_SkipsBadEntry() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        PayPerWatch.Receipt memory r0 = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig0 = _signReceipt(r0, alicePk);

        // Expired — should be skipped
        PayPerWatch.Receipt memory r1 = _receipt(200e6, uint64(block.timestamp - 1));
        bytes memory sig1 = _signReceipt(r1, alicePk);

        PayPerWatch.Receipt[] memory rs = new PayPerWatch.Receipt[](2);
        rs[0] = r0;
        rs[1] = r1;
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = sig0;
        sigs[1] = sig1;

        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.SettlementSkipped(1, PayPerWatch.ReceiptExpired.selector);

        ppw.settleBatch(rs, sigs);

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
    // 14. WRONG CHAIN ID IN DOMAIN → signature fails
    // =========================================================================

    function test_Settle_WrongChainId_SignatureFails() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes32 digest = ppw.hashReceipt(r);

        vm.chainId(999);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(alicePk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);
        vm.chainId(block.chainid);

        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 15. WRONG CONTRACT ADDRESS IN DOMAIN → signature fails
    // =========================================================================

    function test_Settle_WrongContractAddress_SignatureFails() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        PayPerWatch ppw2 = new PayPerWatch(address(usdc), FEE_BPS, feeRecipient, owner);

        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes32 digestForPpw2 = ppw2.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(alicePk, digestForPpw2);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw.settle(r, sig);
    }

    // =========================================================================
    // 16. VIDEO MANAGEMENT
    // =========================================================================

    function test_RegisterVideo_HappyPath() public {
        bytes32 vid = keccak256("vid1");
        uint128 price = 1_000_000;

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
    // 17. OWNER FUNCTIONS — fee (v4: propose/apply with 48h timelock)
    // =========================================================================

    /// @dev setFee now queues a proposal; applyFee() applies after 48h.
    function test_SetFee_HappyPath() public {
        // Propose via setFee alias
        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.FeeProposed(200, uint64(block.timestamp) + ppw.FEE_TIMELOCK());
        vm.prank(owner);
        ppw.setFee(200);

        // feeBps still shows old value
        assertEq(ppw.feeBps(), FEE_BPS, "not applied yet");

        // Warp past timelock and apply
        skip(ppw.FEE_TIMELOCK() + 1);

        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.FeeUpdated(200);
        ppw.applyFee();

        assertEq(ppw.feeBps(), 200, "fee updated");
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
    // 19. FUZZ — fee math always splits correctly (v4: fee in feesAccrued)
    // =========================================================================

    function testFuzz_FeeMath(uint256 depositAmt, uint256 settleAmt, uint16 bps) public {
        depositAmt = bound(depositAmt, 1, 1_000_000e6);
        bps = uint16(bound(bps, 0, 500)); // keep combined cap: 500 referral + <=500 fee <= 1000 <=1500
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

        ppwFuzz.settle(r, sig);

        uint256 expectedFee = (settleAmt * bps) / 10_000;
        assertEq(ppwFuzz.feesAccrued(), expectedFee, "fee accrued");
        assertEq(usdc.balanceOf(bob), creatorBefore + settleAmt - expectedFee, "creator mismatch");
    }

    // =========================================================================
    // 20. FUZZ — session cap tracking
    // =========================================================================

    function testFuzz_SessionCapTracking(uint128 cap, uint128 settle1, uint128 settle2) public {
        cap = uint128(bound(cap, 1, 1_000e6));
        settle1 = uint128(bound(settle1, 1, cap));
        settle2 = uint128(bound(settle2, 0, cap - settle1));

        _deposit(alice, cap);

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

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
    // 21. FUZZ — stale receipt always a no-op
    // =========================================================================

    function testFuzz_StaleReceipt_NoOp(uint256 amount, uint256 staleCumulative) public {
        amount = bound(amount, 1, 1_000_000e6);
        _deposit(alice, amount);

        PayPerWatch.Receipt memory r0 = _receipt(amount, uint64(block.timestamp + 1 hours));
        bytes memory sig0 = _signReceipt(r0, alicePk);
        ppw.settle(r0, sig0);

        uint256 balAfter = ppw.balanceOf(alice);

        staleCumulative = bound(staleCumulative, 0, amount);
        PayPerWatch.Receipt memory rs = _receipt(staleCumulative, uint64(block.timestamp + 1 hours));
        bytes memory sigs = _signReceipt(rs, alicePk);
        ppw.settle(rs, sigs);
        assertEq(ppw.balanceOf(alice), balAfter, "stale receipt changed balance");
    }

    // =========================================================================
    // 22. M-3: withdrawFees — pull-payment for platform fees
    // =========================================================================

    function test_WithdrawFees_HappyPath() public {
        _deposit(alice, DEPOSIT_AMOUNT);
        _settle(100e6);

        uint256 settled100 = 100e6;
        uint256 expectedFee = (settled100 * FEE_BPS) / 10_000;
        assertEq(ppw.feesAccrued(), expectedFee, "fee accrued");

        uint256 recipBefore = usdc.balanceOf(feeRecipient);

        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.FeesWithdrawn(feeRecipient, expectedFee);

        ppw.withdrawFees(); // callable by anyone

        assertEq(usdc.balanceOf(feeRecipient), recipBefore + expectedFee, "recipient got fees");
        assertEq(ppw.feesAccrued(), 0, "feesAccrued cleared");
    }

    function test_WithdrawFees_RevertsZeroAccrued() public {
        vm.expectRevert(PayPerWatch.InvalidAmount.selector);
        ppw.withdrawFees();
    }

    function test_WithdrawFees_AccruedAcrossMultipleSettlements() public {
        _deposit(alice, DEPOSIT_AMOUNT);
        _settle(100e6);
        _settle(300e6); // cumulative now 300, delta=200

        uint256 fee1 = (uint256(100e6) * FEE_BPS) / 10_000;
        uint256 fee2 = (uint256(200e6) * FEE_BPS) / 10_000;
        assertEq(ppw.feesAccrued(), fee1 + fee2, "fees from both settlements");

        ppw.withdrawFees();
        assertEq(ppw.feesAccrued(), 0);
        assertEq(usdc.balanceOf(feeRecipient), fee1 + fee2);
    }

    // =========================================================================
    // 23. M-4: Fee timelock
    // =========================================================================

    function test_ProposeFee_TimelockPreventsImmediate() public {
        vm.prank(owner);
        ppw.proposeFee(200);

        // feeBps must not change yet
        assertEq(ppw.feeBps(), FEE_BPS, "feeBps unchanged before timelock");
    }

    function test_ApplyFee_RevertsBeforeTimelock() public {
        vm.prank(owner);
        ppw.proposeFee(200);

        skip(ppw.FEE_TIMELOCK() - 1);

        vm.expectRevert(PayPerWatch.TimelockNotExpired.selector);
        ppw.applyFee();
    }

    function test_ApplyFee_HappyPath() public {
        vm.prank(owner);
        ppw.proposeFee(200);

        skip(ppw.FEE_TIMELOCK() + 1);

        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.FeeUpdated(200);
        ppw.applyFee();

        assertEq(ppw.feeBps(), 200);
        assertEq(ppw.pendingFeeApplicableAt(), 0, "pending cleared");
    }

    function test_ApplyFee_RevertsNoPending() public {
        vm.expectRevert(PayPerWatch.InvalidAmount.selector);
        ppw.applyFee();
    }

    function test_ProposeFee_RevertsCombinedCapExceeded() public {
        // referralBps is 500 by default; proposing feeBps=1001 > 1000 reverts FeeTooHigh first
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.FeeTooHigh.selector);
        ppw.proposeFee(1001);

        // proposing feeBps=1100 (valid alone, but 1100+500>1500) → CombinedFeeTooHigh
        // but feeBps max is 1000 so FeeTooHigh triggers first. Use 1000+600 scenario:
        // first raise referral to 600, then try fee=1000 → 1000+600=1600>1500
        vm.prank(owner);
        ppw.proposeReferralBps(600);
        skip(ppw.FEE_TIMELOCK() + 1);
        ppw.applyReferralBps();
        assertEq(ppw.referralBps(), 600);

        vm.prank(owner);
        vm.expectRevert(PayPerWatch.CombinedFeeTooHigh.selector);
        ppw.proposeFee(1000);
    }

    function test_ProposeReferralBps_HappyPath() public {
        vm.prank(owner);
        ppw.proposeReferralBps(800);

        assertEq(ppw.referralBps(), 500, "not applied yet");

        skip(ppw.FEE_TIMELOCK() + 1);

        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.ReferralBpsUpdated(800);
        ppw.applyReferralBps();

        assertEq(ppw.referralBps(), 800);
    }

    function test_ApplyReferralBps_RevertsBeforeTimelock() public {
        vm.prank(owner);
        ppw.proposeReferralBps(300);

        vm.expectRevert(PayPerWatch.TimelockNotExpired.selector);
        ppw.applyReferralBps();
    }

    function test_ProposeReferralBps_RevertsCombinedCapExceeded() public {
        // feeBps=500, referral=1001 → ReferralTooHigh first (>1000 ceiling)
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.ReferralTooHigh.selector);
        ppw.proposeReferralBps(1001);

        // feeBps=500, referral=1100 → also ReferralTooHigh (>1000)
        // To hit CombinedFeeTooHigh: raise feeBps to 800 first, then propose referral=800 → 1600>1500
        vm.prank(owner);
        ppw.proposeFee(800);
        skip(ppw.FEE_TIMELOCK() + 1);
        ppw.applyFee();
        assertEq(ppw.feeBps(), 800);

        vm.prank(owner);
        vm.expectRevert(PayPerWatch.CombinedFeeTooHigh.selector);
        ppw.proposeReferralBps(800);
    }

    // =========================================================================
    // 24. M-2: Withdraw delay adjustable
    // =========================================================================

    function test_WithdrawDelay_Default24h() public view {
        assertEq(ppw.WITHDRAW_DELAY(), 24 hours);
    }

    function test_SetWithdrawDelay_HappyPath() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.WithdrawDelayUpdated(2 days);
        ppw.setWithdrawDelay(2 days);

        assertEq(ppw.WITHDRAW_DELAY(), 2 days);
    }

    function test_SetWithdrawDelay_RevertsBelow1h() public {
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.DelayOutOfRange.selector);
        ppw.setWithdrawDelay(1 hours - 1);
    }

    function test_SetWithdrawDelay_RevertsAbove7d() public {
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.DelayOutOfRange.selector);
        ppw.setWithdrawDelay(7 days + 1);
    }

    function test_SetWithdrawDelay_Boundary1h() public {
        vm.prank(owner);
        ppw.setWithdrawDelay(1 hours); // exact min — should not revert
        assertEq(ppw.WITHDRAW_DELAY(), 1 hours);
    }

    function test_SetWithdrawDelay_Boundary7d() public {
        vm.prank(owner);
        ppw.setWithdrawDelay(7 days); // exact max — should not revert
        assertEq(ppw.WITHDRAW_DELAY(), 7 days);
    }

    function test_SetWithdrawDelay_UsedForNewRequests() public {
        // Owner sets delay to 2 days
        vm.prank(owner);
        ppw.setWithdrawDelay(2 days);

        _deposit(alice, DEPOSIT_AMOUNT);
        vm.prank(alice);
        ppw.requestWithdraw(DEPOSIT_AMOUNT);

        // 1 day is not enough
        skip(1 days);
        vm.prank(alice);
        vm.expectRevert(PayPerWatch.WithdrawDelayNotMet.selector);
        ppw.withdraw();

        // 2 days + 1 second is enough
        skip(1 days + 1);
        vm.prank(alice);
        ppw.withdraw();
        assertEq(ppw.balanceOf(alice), 0);
    }

    function test_SetWithdrawDelay_RevertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice)
        );
        ppw.setWithdrawDelay(2 hours);
    }

    // =========================================================================
    // 25. L-2: Session-key re-authorization preserves spent counter
    // =========================================================================

    function test_ReAuth_SessionKey_PreservesSpent() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 expiry = uint64(block.timestamp + 1 days);
        uint128 cap = 500e6;
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, cap);

        // Settle 300 — uses 300 of 500 cap
        PayPerWatch.Receipt memory r = _receipt(300e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, sessionKeyPk);
        ppw.settle(r, sig);

        (,, uint128 spentBefore) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(spentBefore, 300e6, "spent = 300 after first settle");

        // Re-authorize with a new expiry and increased cap — spent must be preserved
        uint64 newExpiry = uint64(block.timestamp + 2 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, newExpiry, 1000e6);

        (uint64 storedExpiry, uint128 storedCap, uint128 spentAfterReauth) =
            ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(storedExpiry, newExpiry, "expiry updated");
        assertEq(storedCap, 1000e6, "cap updated");
        assertEq(spentAfterReauth, 300e6, "spent preserved after re-auth");
    }

    function test_ReAuth_SessionKey_SpentNotReset_BlocksOvercap() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, 500e6);

        // Settle 450 — nearly at cap
        PayPerWatch.Receipt memory r = _receipt(450e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, sessionKeyPk);
        ppw.settle(r, sig);

        // Re-authorize with same cap (500e6) — spent=450 preserved, so only 50 remains
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, uint64(block.timestamp + 2 days), 500e6);

        // Try to settle 60 more (cumulative=510) — delta=60 > remaining cap=50 → revert
        PayPerWatch.Receipt memory r2 = _receipt(510e6, uint64(block.timestamp + 1 hours));
        bytes memory sig2 = _signReceipt(r2, sessionKeyPk);
        vm.expectRevert(PayPerWatch.SessionCapExceeded.selector);
        ppw.settle(r2, sig2);
    }

    // =========================================================================
    // 26. M-1: InsufficientGasForBatch — gasleft() check
    // =========================================================================

    function test_SettleBatch_RevertsInsufficientGas() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        // Build a valid batch of 5 receipts
        uint256 n = 5;
        PayPerWatch.Receipt[] memory rs = new PayPerWatch.Receipt[](n);
        bytes[] memory sigs = new bytes[](n);
        for (uint256 i = 0; i < n; ++i) {
            rs[i] = _receipt((i + 1) * 10e6, uint64(block.timestamp + 1 hours));
            sigs[i] = _signReceipt(rs[i], alicePk);
        }

        // Submit with just barely too little gas (below GAS_PER_ENTRY + BATCH_GAS_OVERHEAD for first entry)
        uint256 tooLittle = ppw.BATCH_GAS_OVERHEAD() + 1000; // far below GAS_PER_ENTRY + BATCH_GAS_OVERHEAD
        vm.expectRevert(PayPerWatch.InsufficientGasForBatch.selector);
        ppw.settleBatch{gas: tooLittle}(rs, sigs);
    }

    function test_SettleBatch_SucceedsWithSufficientGas() public {
        _deposit(alice, DEPOSIT_AMOUNT);

        PayPerWatch.Receipt[] memory rs = new PayPerWatch.Receipt[](2);
        bytes[] memory sigs = new bytes[](2);
        rs[0] = _receipt(100e6, uint64(block.timestamp + 1 hours));
        sigs[0] = _signReceipt(rs[0], alicePk);
        rs[1] = _receipt(200e6, uint64(block.timestamp + 1 hours)); // cumulative, stale for lane 0 after rs[0]
        sigs[1] = _signReceipt(rs[1], alicePk);

        // Submit with generous gas — both entries should be processed (second is cumulative advance)
        ppw.settleBatch{gas: 1_000_000}(rs, sigs);

        assertEq(ppw.settled(alice, bob, address(0)), 200e6, "cumulative settled");
    }

    // =========================================================================
    // 27. _settleEntry direct call reverts (L-1)
    // =========================================================================

    function test_SettleEntry_DirectCallRevertsInvalidSignature() public {
        _deposit(alice, DEPOSIT_AMOUNT);
        PayPerWatch.Receipt memory r = _receipt(100e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _signReceipt(r, alicePk);

        // Calling from EOA (not address(this)) should revert InvalidSignature
        vm.expectRevert(PayPerWatch.InvalidSignature.selector);
        ppw._settleEntry(r, sig);
    }
}

// =============================================================================
// 28. INVARIANT TEST — accounting conservation (v4 updated)
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
        ppw = new PayPerWatch(address(usdc), 500, feeRecipient, owner);

        handler = new PayPerWatchHandler(ppw, usdc, creator, feeRecipient);
        targetContract(address(handler));
    }

    /// @dev Invariant: viewer_balance + paid_to_creator + feesAccrued + referral == total_deposited
    ///      v4: fees stay in feesAccrued until withdrawFees() is called.
    function invariant_AccountingConservation() public view {
        uint256 viewerBalance = ppw.balanceOf(handler.viewer());
        uint256 paidCreator   = handler.ghostTotalPaidCreator();
        uint256 paidFees      = ppw.feesAccrued(); // accrued but not yet withdrawn
        uint256 paidReferral  = handler.ghostTotalReferral();
        uint256 totalDeposited = handler.ghostTotalDeposited();

        assertEq(
            viewerBalance + paidCreator + paidFees + paidReferral,
            totalDeposited,
            "accounting conservation violated"
        );
    }

    /// @dev Invariant: contract USDC balance always covers viewer balances + accrued fees
    function invariant_ContractBalanceCoversPendingDeposits() public view {
        uint256 contractBalance = usdc.balanceOf(address(ppw));
        uint256 viewerBalance   = ppw.balanceOf(handler.viewer());
        uint256 accruedFees     = ppw.feesAccrued();
        assertGe(contractBalance, viewerBalance + accruedFees, "contract USDC < viewer balances + fees");
    }
}
