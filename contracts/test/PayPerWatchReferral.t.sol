// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PayPerWatch} from "../PayPerWatch.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// =============================================================================
// Referral-specific tests for PayPerWatch v4
// v4 changes: fees accrue in feesAccrued (not pushed to feeRecipient during settle).
//             setReferralBps / setFee are now propose+apply with 48h timelock.
// =============================================================================
contract PayPerWatchReferralTest is Test {
    PayPerWatch internal ppw;
    MockERC20   internal usdc;

    address internal owner;
    address internal feeRecipient;
    address internal alice;     // viewer
    address internal bob;       // creator
    address internal carol;     // referrer candidate
    address internal dave;      // second referrer / bystander

    uint256 internal alicePk;
    uint256 internal carolPk;
    uint256 internal sessionKeyPk;
    address internal sessionKeyAddr;

    uint16 internal constant FEE_BPS_200  = 200;   // 2%
    uint256 internal constant DEPOSIT     = 1_000e6;

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------
    function setUp() public {
        owner        = makeAddr("owner");
        feeRecipient = makeAddr("feeRecipient");
        (alice, alicePk)     = makeAddrAndKey("alice");
        bob                  = makeAddr("bob");
        (carol, carolPk)     = makeAddrAndKey("carol");
        dave                 = makeAddr("dave");
        (sessionKeyAddr, sessionKeyPk) = makeAddrAndKey("sessionKey");

        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        ppw  = new PayPerWatch(address(usdc), FEE_BPS_200, feeRecipient, owner);
    }

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

    function _receipt(
        address viewer,
        address creator,
        address referrer,
        uint256 cumAmt,
        uint64  deadline
    ) internal pure returns (PayPerWatch.Receipt memory) {
        return PayPerWatch.Receipt({
            viewer:           viewer,
            creator:          creator,
            referrer:         referrer,
            cumulativeAmount: cumAmt,
            deadline:         deadline
        });
    }

    function _sign(PayPerWatch.Receipt memory r, uint256 pk)
        internal view returns (bytes memory)
    {
        bytes32 digest = ppw.hashReceipt(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(pk, digest);
        return abi.encodePacked(rs, ss, v);
    }

    function _settleNoRef(uint256 cumAmt) internal {
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, address(0), cumAmt, uint64(block.timestamp + 1 hours)
        );
        ppw.settle(r, _sign(r, alicePk));
    }

    /// @dev Make `referrer` eligible to receive referral for `creator`.
    function _makeEligible(address referrer, uint256 referrerPk, address creator) internal {
        _deposit(referrer, 1e6);
        PayPerWatch.Receipt memory r = _receipt(
            referrer, creator, address(0), 1e6, uint64(block.timestamp + 1 hours)
        );
        ppw.settle(r, _sign(r, referrerPk));
        assertGt(ppw.paidTo(referrer, creator), 0, "_makeEligible: paidTo not set");
    }

    // =========================================================================
    // 1. Valid referral — exact split math (feeBps 200 = 2%)
    //    fee = 2% (accrued), referral = 5% (pushed), creator = 93%
    // =========================================================================
    function test_Referral_ValidReferrer_Fee2pct() public {
        _makeEligible(carol, carolPk, bob);

        _deposit(alice, 100e6);
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours)
        );

        uint256 creatorBefore     = usdc.balanceOf(bob);
        uint256 carolBefore       = usdc.balanceOf(carol);
        uint256 feeRecipBefore    = usdc.balanceOf(feeRecipient);
        uint256 feesAccruedBefore = ppw.feesAccrued();

        ppw.settle(r, _sign(r, alicePk));

        // fee = 100 * 200/10000 = 2 (accrued, NOT pushed to feeRecipient)
        // referral = 100 * 500/10000 = 5 (pushed to carol)
        // creator = 100 - 2 - 5 = 93
        assertEq(usdc.balanceOf(bob),          creatorBefore + 93e6,              "creator");
        assertEq(usdc.balanceOf(carol),         carolBefore   +  5e6,              "referral");
        assertEq(usdc.balanceOf(feeRecipient),  feeRecipBefore,                    "feeRecipient unchanged (pull)");
        assertEq(ppw.feesAccrued(),             feesAccruedBefore + 2e6,           "fee accrued");
        assertEq(ppw.settled(alice, bob, carol), 100e6,                            "settled lane");
        assertEq(ppw.paidTo(alice, bob),         100e6,                            "paidTo");
        assertEq(ppw.balanceOf(alice),           0,                                "viewer balance");
    }

    // =========================================================================
    // 2. feeBps = 0: referral 5%, creator 95%
    // =========================================================================
    function test_Referral_ValidReferrer_FeeZero() public {
        PayPerWatch ppw0 = new PayPerWatch(address(usdc), 0, feeRecipient, owner);

        usdc.mint(carol, 1e6);
        vm.prank(carol);
        usdc.approve(address(ppw0), 1e6);
        vm.prank(carol);
        ppw0.deposit(1e6);
        PayPerWatch.Receipt memory eligR = _receipt(carol, bob, address(0), 1e6, uint64(block.timestamp + 1 hours));
        bytes32 d = ppw0.hashReceipt(eligR);
        (uint8 vv, bytes32 rr, bytes32 ss) = vm.sign(carolPk, d);
        ppw0.settle(eligR, abi.encodePacked(rr, ss, vv));

        usdc.mint(alice, 100e6);
        vm.prank(alice);
        usdc.approve(address(ppw0), 100e6);
        vm.prank(alice);
        ppw0.deposit(100e6);

        PayPerWatch.Receipt memory r = _receipt(alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours));
        bytes32 dig = ppw0.hashReceipt(r);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(alicePk, dig);

        uint256 creatorBefore = usdc.balanceOf(bob);
        uint256 carolBefore   = usdc.balanceOf(carol);

        ppw0.settle(r, abi.encodePacked(r2, s2, v2));

        assertEq(usdc.balanceOf(bob),         creatorBefore + 95e6, "creator 95%");
        assertEq(usdc.balanceOf(carol),        carolBefore   +  5e6, "referral 5%");
        assertEq(ppw0.feesAccrued(), 0, "no fee accrued");
    }

    // =========================================================================
    // 3. feeBps = 1000 (10%): fee 10%, referral 5%, creator 85%
    //    Combined 10%+5%=15% == MAX_COMBINED_BPS → valid
    // =========================================================================
    function test_Referral_ValidReferrer_FeeMax() public {
        PayPerWatch ppw10 = new PayPerWatch(address(usdc), 1000, feeRecipient, owner);

        usdc.mint(carol, 1e6);
        vm.prank(carol); usdc.approve(address(ppw10), 1e6);
        vm.prank(carol); ppw10.deposit(1e6);
        PayPerWatch.Receipt memory eligR = _receipt(carol, bob, address(0), 1e6, uint64(block.timestamp + 1 hours));
        bytes32 d = ppw10.hashReceipt(eligR);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(carolPk, d);
        ppw10.settle(eligR, abi.encodePacked(r1, s1, v1));

        usdc.mint(alice, 100e6);
        vm.prank(alice); usdc.approve(address(ppw10), 100e6);
        vm.prank(alice); ppw10.deposit(100e6);

        PayPerWatch.Receipt memory r = _receipt(alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours));
        bytes32 dig = ppw10.hashReceipt(r);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(alicePk, dig);

        uint256 creatorBefore = usdc.balanceOf(bob);
        uint256 carolBefore   = usdc.balanceOf(carol);

        uint256 feesAccruedBefore10 = ppw10.feesAccrued();
        ppw10.settle(r, abi.encodePacked(r2, s2, v2));

        assertEq(usdc.balanceOf(bob),   creatorBefore + 85e6, "creator 85%");
        assertEq(usdc.balanceOf(carol),  carolBefore   +  5e6, "referral 5%");
        assertEq(ppw10.feesAccrued(), feesAccruedBefore10 + 10e6, "fee 10% accrued");
    }

    // =========================================================================
    // 4. Self-referral (referrer == viewer) → referralAmount = 0
    // =========================================================================
    function test_Referral_SelfReferral() public {
        _deposit(alice, 100e6);
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, alice /*self*/, 100e6, uint64(block.timestamp + 1 hours)
        );
        uint256 creatorBefore = usdc.balanceOf(bob);
        uint256 aliceBefore   = usdc.balanceOf(alice);

        ppw.settle(r, _sign(r, alicePk));

        uint256 fee = uint256(100e6) * FEE_BPS_200 / 10_000; // 2e6
        assertEq(usdc.balanceOf(bob),   creatorBefore + 100e6 - fee, "creator gets full (minus fee)");
        assertEq(usdc.balanceOf(alice),  aliceBefore,                 "alice got no referral payout");
        assertEq(ppw.settled(alice, bob, alice), 100e6,               "lane keyed by alice");
    }

    // =========================================================================
    // 5. Creator as referrer → referralAmount = 0
    // =========================================================================
    function test_Referral_CreatorAsReferrer() public {
        _deposit(alice, 100e6);
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, bob /*creator == referrer*/, 100e6, uint64(block.timestamp + 1 hours)
        );
        uint256 creatorBefore = usdc.balanceOf(bob);

        ppw.settle(r, _sign(r, alicePk));

        uint256 fee = uint256(100e6) * FEE_BPS_200 / 10_000;
        assertEq(usdc.balanceOf(bob), creatorBefore + 100e6 - fee, "creator no double dip");
        assertEq(ppw.settled(alice, bob, bob), 100e6, "lane keyed by bob");
    }

    // =========================================================================
    // 6. Referrer not yet paid this creator → referralAmount = 0
    // =========================================================================
    function test_Referral_ReferrerNotPaidCreator() public {
        assertEq(ppw.paidTo(carol, bob), 0, "carol not yet eligible");

        _deposit(alice, 100e6);
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours)
        );
        uint256 carolBefore = usdc.balanceOf(carol);

        ppw.settle(r, _sign(r, alicePk));

        assertEq(usdc.balanceOf(carol), carolBefore, "no referral payout when ineligible");
        uint256 fee = uint256(100e6) * FEE_BPS_200 / 10_000;
        assertEq(usdc.balanceOf(bob), 100e6 - fee, "creator gets full (minus fee)");
    }

    // =========================================================================
    // 7. Referrer becomes eligible after first payment — subsequent receipt pays
    // =========================================================================
    function test_Referral_EligibilityUnlockedAfterFirstPayment() public {
        assertEq(ppw.paidTo(dave, bob), 0);

        _deposit(alice, 300e6);
        PayPerWatch.Receipt memory r1 = _receipt(
            alice, bob, dave, 100e6, uint64(block.timestamp + 1 hours)
        );
        uint256 daveBefore1 = usdc.balanceOf(dave);
        ppw.settle(r1, _sign(r1, alicePk));
        assertEq(usdc.balanceOf(dave), daveBefore1, "dave gets nothing when ineligible");

        (, uint256 davePk) = makeAddrAndKey("dave");
        _deposit(dave, 5e6);
        PayPerWatch.Receipt memory daveR = _receipt(
            dave, bob, address(0), 5e6, uint64(block.timestamp + 1 hours)
        );
        ppw.settle(daveR, _sign(daveR, davePk));
        assertGt(ppw.paidTo(dave, bob), 0, "dave now eligible");

        PayPerWatch.Receipt memory r2 = _receipt(
            alice, bob, dave, 200e6, uint64(block.timestamp + 1 hours)
        );
        uint256 daveBefore2  = usdc.balanceOf(dave);
        uint256 creatorBefore = usdc.balanceOf(bob);

        ppw.settle(r2, _sign(r2, alicePk));

        uint256 delta = 100e6;
        uint256 fee      = delta * FEE_BPS_200 / 10_000;          // 2e6
        uint256 referral = delta * ppw.referralBps() / 10_000;    // 5e6
        uint256 creator  = delta - fee - referral;                 // 93e6

        assertEq(usdc.balanceOf(dave), daveBefore2 + referral, "dave gets referral");
        assertEq(usdc.balanceOf(bob),  creatorBefore + creator, "creator correct");
    }

    // =========================================================================
    // 8. Invalid-then-valid: no double charge
    // =========================================================================
    function test_Referral_InvalidThenValid_NoDoubleCharge() public {
        assertEq(ppw.paidTo(carol, bob), 0);

        _deposit(alice, 800e6);

        PayPerWatch.Receipt memory r1 = _receipt(
            alice, bob, carol, 500e6, uint64(block.timestamp + 1 hours)
        );
        uint256 creatorBefore1 = usdc.balanceOf(bob);
        uint256 carolBefore1   = usdc.balanceOf(carol);

        ppw.settle(r1, _sign(r1, alicePk));

        uint256 fee1 = uint256(500e6) * FEE_BPS_200 / 10_000; // 10e6
        assertEq(usdc.balanceOf(bob),  creatorBefore1 + 500e6 - fee1, "creator step1 (full minus fee)");
        assertEq(usdc.balanceOf(carol), carolBefore1,                  "carol no referral step1");
        assertEq(ppw.settled(alice, bob, carol), 500e6,                "lane carol = 500");
        assertEq(ppw.balanceOf(alice), 300e6,                          "alice charged 500");

        _makeEligible(carol, carolPk, bob);
        assertGt(ppw.paidTo(carol, bob), 0);

        PayPerWatch.Receipt memory r2 = _receipt(
            alice, bob, carol, 800e6, uint64(block.timestamp + 1 hours)
        );
        uint256 creatorBefore2 = usdc.balanceOf(bob);
        uint256 carolBefore2   = usdc.balanceOf(carol);

        ppw.settle(r2, _sign(r2, alicePk));

        uint256 delta2    = 300e6; // 800 - 500 prior
        uint256 fee2      = delta2 * FEE_BPS_200 / 10_000;         // 6e6
        uint256 referral2 = delta2 * ppw.referralBps() / 10_000;   // 15e6 (5%)
        uint256 creator2  = delta2 - fee2 - referral2;              // 279e6

        assertEq(usdc.balanceOf(carol), carolBefore2 + referral2, "carol gets referral");
        assertEq(usdc.balanceOf(bob),   creatorBefore2 + creator2, "creator correct step2");
        assertEq(ppw.settled(alice, bob, carol), 800e6,            "lane carol = 800");
        assertEq(ppw.balanceOf(alice), 0,                          "alice total charged 800 (not 1100)");
        assertEq(ppw.paidTo(alice, bob), 800e6,                    "paidTo = 800");
    }

    // =========================================================================
    // 9. Lane 0 (no referrer) is unaffected by carol lane for same viewer/creator
    // =========================================================================
    function test_Referral_Lane0_Unaffected_By_Carol_Lane() public {
        _makeEligible(carol, carolPk, bob);
        _deposit(alice, 500e6);

        _settleNoRef(200e6);
        assertEq(ppw.settled(alice, bob, address(0)), 200e6, "lane 0 = 200");
        assertEq(ppw.balanceOf(alice), 300e6, "alice left = 300");

        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours)
        );
        ppw.settle(r, _sign(r, alicePk));

        assertEq(ppw.settled(alice, bob, carol),    100e6, "carol lane = 100");
        assertEq(ppw.settled(alice, bob, address(0)), 200e6, "lane 0 still 200, unaffected");
        assertEq(ppw.balanceOf(alice), 200e6, "alice charged 100 more = 200 left");
        assertEq(ppw.paidTo(alice, bob), 300e6, "paidTo total = 300");
    }

    // =========================================================================
    // 10. Session-key spendCap enforced across lanes with referrer
    // =========================================================================
    function test_Referral_SessionKey_CapEnforced_AcrossLanes() public {
        _makeEligible(carol, carolPk, bob);
        _deposit(alice, 500e6);

        uint64 expiry = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        ppw.authorizeSessionKey(sessionKeyAddr, expiry, 200e6);

        PayPerWatch.Receipt memory r1 = _receipt(
            alice, bob, carol, 150e6, uint64(block.timestamp + 1 hours)
        );
        ppw.settle(r1, _sign(r1, sessionKeyPk));
        (, , uint128 spent1) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(spent1, 150e6, "spent = 150");

        PayPerWatch.Receipt memory r2 = _receipt(
            alice, bob, carol, 210e6, uint64(block.timestamp + 1 hours)
        );
        bytes memory sig2 = _sign(r2, sessionKeyPk);
        vm.expectRevert(PayPerWatch.SessionCapExceeded.selector);
        ppw.settle(r2, sig2);

        PayPerWatch.Receipt memory r3 = _receipt(
            alice, bob, address(0), 60e6, uint64(block.timestamp + 1 hours)
        );
        bytes memory sig3 = _sign(r3, sessionKeyPk);
        vm.expectRevert(PayPerWatch.SessionCapExceeded.selector);
        ppw.settle(r3, sig3);

        PayPerWatch.Receipt memory r4 = _receipt(
            alice, bob, address(0), 50e6, uint64(block.timestamp + 1 hours)
        );
        bytes memory sig4 = _sign(r4, sessionKeyPk);
        ppw.settle(r4, sig4);
        (, , uint128 spent2) = ppw.sessionKeys(alice, sessionKeyAddr);
        assertEq(spent2, 200e6, "spent at cap after second settle");
    }

    // =========================================================================
    // 11. settleBatch — mixed referral / non-referral / bad entries
    // =========================================================================
    function test_Referral_SettleBatch_Mixed() public {
        _makeEligible(carol, carolPk, bob);
        _deposit(alice, 500e6);

        PayPerWatch.Receipt memory r0 = _receipt(
            alice, bob, address(0), 100e6, uint64(block.timestamp + 1 hours)
        );
        bytes memory sig0 = _sign(r0, alicePk);

        PayPerWatch.Receipt memory r1 = _receipt(
            alice, bob, carol, 50e6, uint64(block.timestamp + 1 hours)
        );
        bytes memory sig1 = _sign(r1, alicePk);

        PayPerWatch.Receipt memory r2 = _receipt(
            alice, bob, address(0), 200e6, uint64(block.timestamp - 1)
        );
        bytes memory sig2 = _sign(r2, alicePk);

        PayPerWatch.Receipt[] memory rs = new PayPerWatch.Receipt[](3);
        rs[0] = r0; rs[1] = r1; rs[2] = r2;
        bytes[] memory sigs = new bytes[](3);
        sigs[0] = sig0; sigs[1] = sig1; sigs[2] = sig2;

        vm.expectEmit(true, false, false, true, address(ppw));
        emit PayPerWatch.SettlementSkipped(2, PayPerWatch.ReceiptExpired.selector);

        ppw.settleBatch(rs, sigs);

        assertEq(ppw.settled(alice, bob, address(0)), 100e6, "lane 0");
        assertEq(ppw.settled(alice, bob, carol), 50e6, "carol lane");
        assertEq(ppw.balanceOf(alice), 500e6 - 100e6 - 50e6, "alice balance");

        uint256 referral1 = uint256(50e6) * uint256(ppw.referralBps()) / 10_000;
        assertEq(usdc.balanceOf(carol), referral1, "carol exact referral");
    }

    // =========================================================================
    // 12. setReferralBps → proposeReferralBps + applyReferralBps (v4 timelock)
    //     Owner proposes a change; it takes effect after 48h.
    // =========================================================================
    function test_SetReferralBps_OwnerCanChange() public {
        assertEq(ppw.referralBps(), 500, "default 5%");

        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.ReferralBpsProposed(800, uint64(block.timestamp) + ppw.FEE_TIMELOCK());
        vm.prank(owner);
        ppw.setReferralBps(800);

        // Not applied yet
        assertEq(ppw.referralBps(), 500, "still 5% before timelock");

        // Warp past timelock and apply
        skip(ppw.FEE_TIMELOCK() + 1);
        vm.expectEmit(false, false, false, true, address(ppw));
        emit PayPerWatch.ReferralBpsUpdated(800);
        ppw.applyReferralBps();

        assertEq(ppw.referralBps(), 800, "updated to 8%");

        // Verify the new rate applies at settlement
        _makeEligible(carol, carolPk, bob);
        _deposit(alice, 100e6);
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours)
        );
        uint256 carolBefore = usdc.balanceOf(carol);
        ppw.settle(r, _sign(r, alicePk));

        uint256 expectedReferral = uint256(100e6) * 800 / 10_000; // 8e6
        assertEq(usdc.balanceOf(carol), carolBefore + expectedReferral, "referral at new rate");
    }

    // =========================================================================
    // 13. setReferralBps — non-owner reverts
    // =========================================================================
    function test_SetReferralBps_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
                alice
            )
        );
        ppw.setReferralBps(800);
    }

    // =========================================================================
    // 14. setReferralBps — > MAX_REFERRAL_BPS (1000) reverts ReferralTooHigh
    // =========================================================================
    function test_SetReferralBps_TooHighReverts() public {
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.ReferralTooHigh.selector);
        ppw.setReferralBps(1001);
    }

    // =========================================================================
    // 15. setReferralBps = 0 — no referral payout even for eligible referrer
    //     At 0, proposes 0, apply immediately after timelock.
    // =========================================================================
    function test_SetReferralBps_ZeroDisablesReferral() public {
        vm.prank(owner);
        ppw.setReferralBps(0);
        skip(ppw.FEE_TIMELOCK() + 1);
        ppw.applyReferralBps();
        assertEq(ppw.referralBps(), 0, "referralBps is 0");

        _makeEligible(carol, carolPk, bob);
        _deposit(alice, 100e6);
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours)
        );
        uint256 carolBefore   = usdc.balanceOf(carol);
        uint256 creatorBefore = usdc.balanceOf(bob);

        ppw.settle(r, _sign(r, alicePk));

        uint256 fee = uint256(100e6) * FEE_BPS_200 / 10_000; // 2e6
        assertEq(usdc.balanceOf(carol),  carolBefore,                "no referral when rate=0");
        assertEq(usdc.balanceOf(bob),    creatorBefore + 100e6 - fee, "creator gets all minus fee");
    }

    // =========================================================================
    // 16. M-4: Fee changes timelocked — settlement uses old rate until applied
    // =========================================================================
    function test_FeeTimelock_OldRateUsedUntilApplied() public {
        _makeEligible(carol, carolPk, bob);
        _deposit(alice, 100e6);

        // Owner proposes a higher fee but doesn't apply it yet
        vm.prank(owner);
        ppw.proposeFee(900); // propose 9% (combined 9%+5%=14% < 15%)

        // Settle before timelock — should use current feeBps (200)
        uint256 feesAccruedBefore = ppw.feesAccrued();
        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours)
        );
        ppw.settle(r, _sign(r, alicePk));

        uint256 expectedFee = uint256(100e6) * FEE_BPS_200 / 10_000; // 2e6 at old rate
        assertEq(ppw.feesAccrued() - feesAccruedBefore, expectedFee, "old fee rate used");
    }

    // =========================================================================
    // 17. M-4: Combined cap — feeBps + referralBps <= 1500 enforced
    // =========================================================================
    function test_CombinedCap_ProposeFeeTooHigh() public {
        // Default: referralBps=500. Max combined=1500 means feeBps can be at most 1000.
        // feeBps=1000, referral=500 → 1500 == MAX_COMBINED_BPS → OK
        vm.prank(owner);
        ppw.proposeFee(1000); // should succeed
        skip(ppw.FEE_TIMELOCK() + 1);
        ppw.applyFee();
        assertEq(ppw.feeBps(), 1000);

        // Now try to raise referral to 600 → 1000+600=1600>1500 → revert CombinedFeeTooHigh
        vm.prank(owner);
        vm.expectRevert(PayPerWatch.CombinedFeeTooHigh.selector);
        ppw.proposeReferralBps(600);
    }

    // =========================================================================
    // 18. withdrawFees after referral settlement pays only platform fee
    // =========================================================================
    function test_WithdrawFees_AfterReferralSettlement() public {
        _makeEligible(carol, carolPk, bob);
        _deposit(alice, 100e6);

        PayPerWatch.Receipt memory r = _receipt(
            alice, bob, carol, 100e6, uint64(block.timestamp + 1 hours)
        );
        ppw.settle(r, _sign(r, alicePk));

        uint256 expectedFee = uint256(100e6) * FEE_BPS_200 / 10_000; // 2e6 for the alice settle
        // feesAccrued may include fee from _makeEligible (carol's 1e6 settlement), so check delta
        uint256 totalAccrued = ppw.feesAccrued();
        assertGe(totalAccrued, expectedFee, "at least alice's fee accrued");

        uint256 recipBefore = usdc.balanceOf(feeRecipient);
        ppw.withdrawFees();
        assertEq(usdc.balanceOf(feeRecipient), recipBefore + totalAccrued, "recipient got all accrued");
        assertEq(ppw.feesAccrued(), 0);
    }
}
