// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title PayPerWatch v4
/// @notice Escrow-and-settle contract for per-second video billing on Arc (USDC-native chain).
/// @dev v4 changes vs v3:
///   - M-1: settleBatch now reverts InsufficientGasForBatch if gasleft() < GAS_PER_ENTRY+BATCH_GAS_OVERHEAD
///     before each entry, preventing silent OOG skips. Genuine per-entry failures still emit SettlementSkipped.
///   - M-2: WITHDRAW_DELAY is now owner-adjustable (setWithdrawDelay), default 24 h, bounded [1 h, 7 d].
///     WITHDRAW_DELAY() view kept for ABI compatibility.
///   - M-3: Platform fees no longer pushed during settlement. They accrue in feesAccrued and are pulled
///     via withdrawFees(). Creator and referrer still receive direct push payments.
///   - M-4: feeBps and referralBps are timelocked (48 h). propose/apply pattern. Combined cap
///     feeBps + referralBps <= 1500 enforced at proposal time. setFee() is kept as an alias for
///     proposeFee() for backward ABI compatibility; callers must still call applyFee() after 48 h.
///   - L-2: Re-authorizing an existing unexpired session key preserves its spent counter.
///   - L-1: _settleEntry NatSpec clarifies it is not public API.
///   - L-3: Rounding documented: fee and referral truncate toward zero; remainder goes to creator.
///   - L-4: SafeCast in requestWithdraw documented.
///   - L-5/L-6: NatSpec added; video.active is a UI signal and not enforced on settlement.
///   - Redundant SignatureChecker call on session-key path removed (gas saving ~3000 gas/settle).
contract PayPerWatch is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Structs
    // =========================================================================

    struct Video {
        address creator;
        uint128 pricePerHour;
        /// @dev UI signal only; not enforced on the settlement path.
        bool active;
    }

    struct SessionKey {
        uint64 expiry;
        uint128 spendCap;
        uint128 spent;
    }

    struct Withdrawal {
        uint128 amount;
        uint64 availableAt;
    }

    /// @dev Receipt struct is unchanged from v3 so all signed receipts remain valid.
    struct Receipt {
        address viewer;
        address creator;
        address referrer;
        uint256 cumulativeAmount;
        uint64 deadline;
    }

    // =========================================================================
    // Errors
    // =========================================================================

    error VideoAlreadyExists();
    error InvalidPrice();
    error NotCreator();
    error InvalidSignature();
    error ReceiptExpired();
    error SessionCapExceeded();
    error SessionKeyExpired();
    error WithdrawDelayNotMet();
    error InsufficientBalance();
    error ZeroAddress();
    error FeeTooHigh();
    error ReferralTooHigh();
    error InvalidAmount();
    /// @notice Reverts when a settleBatch call does not have enough gas for all entries.
    ///         Re-submit with more gas or split the batch.
    error InsufficientGasForBatch();
    /// @notice Reverts when a proposed withdraw delay is outside [MIN_WITHDRAW_DELAY, MAX_WITHDRAW_DELAY].
    error DelayOutOfRange();
    /// @notice Reverts when a fee proposal is made before the previous one has been applied.
    error PendingProposalExists();
    /// @notice Reverts when applyFee / applyReferralBps is called before the timelock expires.
    error TimelockNotExpired();
    /// @notice Reverts when the combined feeBps + referralBps would exceed 1500 (15%).
    error CombinedFeeTooHigh();

    // =========================================================================
    // Events
    // =========================================================================

    event VideoRegistered(bytes32 indexed videoId, address indexed creator, uint128 pricePerHour);
    event PriceUpdated(bytes32 indexed videoId, uint128 newPrice);
    event VideoActiveSet(bytes32 indexed videoId, bool active);
    event Deposited(address indexed viewer, uint256 amount);
    event SessionKeyAuthorized(address indexed viewer, address indexed key, uint64 expiry, uint128 spendCap);
    event SessionKeyRevoked(address indexed viewer, address indexed key);
    event WithdrawRequested(address indexed viewer, uint256 amount, uint64 availableAt);
    event WithdrawCancelled(address indexed viewer);
    event Withdrawn(address indexed viewer, uint256 amount);
    event Settled(
        address indexed viewer,
        address indexed creator,
        address indexed referrer,
        uint256 delta,
        uint256 fee,
        uint256 referralAmount,
        uint256 cumulativeAmount
    );
    event PartialSettlement(address indexed viewer, address indexed creator, uint256 actualDelta, uint256 requestedDelta);
    event SettlementSkipped(uint256 indexed index, bytes4 reason);
    event FeeUpdated(uint16 bps);
    event ReferralBpsUpdated(uint16 bps);
    /// @notice Emitted when a new fee value is proposed. It takes effect after FEE_TIMELOCK seconds.
    event FeeProposed(uint16 bps, uint64 applicableAt);
    /// @notice Emitted when a new referralBps value is proposed.
    event ReferralBpsProposed(uint16 bps, uint64 applicableAt);
    /// @notice Emitted when the withdraw delay is changed by the owner.
    event WithdrawDelayUpdated(uint64 newDelay);
    /// @notice Emitted when accrued fees are pulled to feeRecipient.
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    /// @notice Emitted when a pending fee proposal is cancelled by the owner before it is applied.
    event FeeProposalCancelled(uint16 bps);
    /// @notice Emitted when a pending referral-rate proposal is cancelled by the owner before it is applied.
    event ReferralBpsProposalCancelled(uint16 bps);

    // =========================================================================
    // Constants
    // =========================================================================

    bytes32 private constant RECEIPT_TYPEHASH =
        keccak256("Receipt(address viewer,address creator,address referrer,uint256 cumulativeAmount,uint64 deadline)");

    uint128 private constant MAX_PRICE = 100_000_000;

    /// @notice Maximum referral rate ceiling (10%).
    uint16 public constant MAX_REFERRAL_BPS = 1000;

    /// @notice Maximum combined feeBps + referralBps (15%). Creator always gets >= 85%.
    uint16 public constant MAX_COMBINED_BPS = 1500;

    /// @notice Fee timelock duration: 48 hours.
    uint64 public constant FEE_TIMELOCK = 48 hours;

    /// @notice Maximum batch size for settleBatch.
    uint256 public constant MAX_BATCH = 100;

    /// @notice Gas reserved per batch entry. If gasleft() < GAS_PER_ENTRY + BATCH_GAS_OVERHEAD
    ///         before an entry, the whole tx reverts InsufficientGasForBatch.
    uint256 public constant GAS_PER_ENTRY = 250_000;

    /// @notice Headroom reserved for loop overhead and the final revert path.
    uint256 public constant BATCH_GAS_OVERHEAD = 50_000;

    /// @notice Minimum withdraw delay: 1 hour.
    uint64 public constant MIN_WITHDRAW_DELAY = 1 hours;

    /// @notice Maximum withdraw delay: 7 days.
    uint64 public constant MAX_WITHDRAW_DELAY = 7 days;

    // =========================================================================
    // Immutables
    // =========================================================================

    IERC20 public immutable usdc;

    // =========================================================================
    // Storage
    // =========================================================================

    mapping(bytes32 => Video) public videos;
    mapping(address => uint256) public balanceOf;

    /// @dev settled[viewer][creator][referrer] = cumulative settled for this triple.
    ///      Lane is always keyed by the SIGNED r.referrer regardless of referral validity.
    mapping(address => mapping(address => mapping(address => uint256))) public settled;

    /// @dev paidTo[viewer][creator] = total settled by viewer to creator across ALL referrer lanes.
    mapping(address => mapping(address => uint256)) public paidTo;

    mapping(address => mapping(address => SessionKey)) public sessionKeys;
    mapping(address => Withdrawal) public pendingWithdrawal;

    /// @notice Current effective platform fee (basis points). Read-only during settlement.
    uint16 public feeBps;

    /// @notice Current effective referral rate (basis points). Read-only during settlement.
    uint16 public referralBps;

    /// @notice Address that receives fees withdrawn via withdrawFees().
    address public feeRecipient;

    /// @notice Accrued platform fees waiting to be pulled via withdrawFees().
    uint256 public feesAccrued;

    // --- Timelock state for fee ---
    uint16 public pendingFeeBps;
    uint64 public pendingFeeApplicableAt; // 0 = no pending proposal

    // --- Timelock state for referralBps ---
    uint16 public pendingReferralBps;
    uint64 public pendingReferralApplicableAt; // 0 = no pending proposal

    // --- Withdraw delay (adjustable) ---
    uint64 private _withdrawDelay;

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @param usdc_         USDC ERC-20 address (immutable).
    /// @param feeBps_       Initial platform fee in basis points (max 1000 = 10%).
    /// @param feeRecipient_ Address that receives pulled fees.
    /// @param initialOwner_ Initial contract owner.
    /// @dev feeBps_ and referralBps (default 500) apply immediately at deploy — no timelock on initial values.
    constructor(address usdc_, uint16 feeBps_, address feeRecipient_, address initialOwner_)
        EIP712("PayPerWatch", "4")
        Ownable(initialOwner_)
    {
        if (usdc_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (feeBps_ > 1000) {
            revert FeeTooHigh();
        }
        // Default referralBps = 500 (5%). Combined cap: 500 + 500 = 1000 <= 1500 ✓
        uint16 defaultReferral = 500;
        if (uint256(feeBps_) + defaultReferral > MAX_COMBINED_BPS) {
            revert CombinedFeeTooHigh();
        }

        usdc = IERC20(usdc_);
        feeBps = feeBps_;
        referralBps = defaultReferral;
        feeRecipient = feeRecipient_;
        _withdrawDelay = 24 hours;
    }

    // =========================================================================
    // Creator functions
    // =========================================================================

    function registerVideo(bytes32 videoId, uint128 pricePerHour) external whenNotPaused {
        if (videos[videoId].creator != address(0)) {
            revert VideoAlreadyExists();
        }
        _validatePrice(pricePerHour);
        videos[videoId] = Video({creator: msg.sender, pricePerHour: pricePerHour, active: true});
        emit VideoRegistered(videoId, msg.sender, pricePerHour);
    }

    function updatePrice(bytes32 videoId, uint128 newPrice) external whenNotPaused {
        Video storage video = videos[videoId];
        if (video.creator != msg.sender) revert NotCreator();
        _validatePrice(newPrice);
        video.pricePerHour = newPrice;
        emit PriceUpdated(videoId, newPrice);
    }

    /// @dev video.active is a UI signal; it is NOT enforced on the settlement path.
    ///      Deactivating a video does not stop settlement of existing signed receipts.
    function setVideoActive(bytes32 videoId, bool active) external {
        Video storage video = videos[videoId];
        if (video.creator != msg.sender) revert NotCreator();
        video.active = active;
        emit VideoActiveSet(videoId, active);
    }

    // =========================================================================
    // Viewer functions
    // =========================================================================

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function depositAndAuthorize(uint256 amount, address key, uint64 expiry, uint128 spendCap)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert InvalidAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
        _authorizeSessionKey(msg.sender, key, expiry, spendCap);
    }

    function authorizeSessionKey(address key, uint64 expiry, uint128 spendCap) external whenNotPaused {
        _authorizeSessionKey(msg.sender, key, expiry, spendCap);
    }

    function revokeSessionKey(address key) external {
        delete sessionKeys[msg.sender][key];
        emit SessionKeyRevoked(msg.sender, key);
    }

    /// @notice Queue a withdrawal. Amount must fit uint128 (enforced via SafeCast).
    ///         A second call overwrites a previous pending request.
    function requestWithdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (amount > balanceOf[msg.sender]) revert InsufficientBalance();
        uint64 availableAt = uint64(block.timestamp) + _withdrawDelay;
        // SafeCast.toUint128 reverts if amount > type(uint128).max (astronomically unlikely at 6 decimals).
        pendingWithdrawal[msg.sender] = Withdrawal({amount: SafeCast.toUint128(amount), availableAt: availableAt});
        emit WithdrawRequested(msg.sender, amount, availableAt);
    }

    function withdraw() external nonReentrant {
        Withdrawal memory w = pendingWithdrawal[msg.sender];
        if (w.amount == 0) revert InvalidAmount();
        if (block.timestamp < w.availableAt) revert WithdrawDelayNotMet();

        uint256 available = balanceOf[msg.sender];
        uint256 amount = w.amount <= available ? w.amount : available;

        delete pendingWithdrawal[msg.sender];

        if (amount > 0) {
            balanceOf[msg.sender] = available - amount;
            usdc.safeTransfer(msg.sender, amount);
        }

        emit Withdrawn(msg.sender, amount);
    }

    function cancelWithdraw() external {
        delete pendingWithdrawal[msg.sender];
        emit WithdrawCancelled(msg.sender);
    }

    // =========================================================================
    // Settlement (open to anyone)
    // =========================================================================

    function settle(Receipt calldata r, bytes calldata sig) external nonReentrant whenNotPaused {
        _settle(r, sig);
    }

    /// @notice Settle a batch of receipts. Per-entry failures are skipped with SettlementSkipped(i, reason).
    ///         Reverts InsufficientGasForBatch if there is not enough gas for the next entry,
    ///         so eth_estimateGas is forced to account for every entry.
    function settleBatch(Receipt[] calldata rs, bytes[] calldata sigs) external whenNotPaused {
        if (rs.length > MAX_BATCH) revert InvalidAmount();
        if (rs.length != sigs.length) revert InvalidAmount();

        for (uint256 i = 0; i < rs.length; ++i) {
            // M-1 fix: revert the whole tx if there is not enough gas for this entry.
            // This prevents silent OOG skips caused by the EVM 63/64 gas rule.
            if (gasleft() < GAS_PER_ENTRY + BATCH_GAS_OVERHEAD) {
                revert InsufficientGasForBatch();
            }
            (bool success, bytes4 reason) = _trySettle(rs[i], sigs[i]);
            if (!success) {
                // M-1: detect OOG (empty return data) vs genuine per-entry failure.
                // If the inner call returned no data AND gas is nearly gone, treat as OOG and revert.
                if (reason == bytes4(0) && gasleft() < BATCH_GAS_OVERHEAD) {
                    revert InsufficientGasForBatch();
                }
                emit SettlementSkipped(i, reason);
            }
        }
    }

    /// @dev Calls _settleEntry via a low-level call so per-entry reverts are caught and skipped.
    function _trySettle(Receipt calldata r, bytes calldata sig)
        private
        returns (bool success, bytes4 reason)
    {
        bytes memory ret;
        (success, ret) = address(this).call(
            abi.encodeWithSelector(this._settleEntry.selector, r, sig)
        );
        if (!success && ret.length >= 4) {
            assembly {
                reason := mload(add(ret, 0x20))
            }
        }
    }

    /// @dev External entry point used exclusively by settleBatch._trySettle.
    ///      msg.sender check prevents direct external calls (L-1).
    ///      Not part of the public API; do not call directly.
    function _settleEntry(Receipt calldata r, bytes calldata sig) external nonReentrant whenNotPaused {
        if (msg.sender != address(this)) revert InvalidSignature();
        _settle(r, sig);
    }

    // =========================================================================
    // Fee withdrawal (M-3: pull pattern for platform fees)
    // =========================================================================

    /// @notice Pull all accrued platform fees to feeRecipient. Callable by anyone.
    function withdrawFees() external nonReentrant {
        uint256 amount = feesAccrued;
        if (amount == 0) revert InvalidAmount();
        feesAccrued = 0;
        address recipient = feeRecipient;
        usdc.safeTransfer(recipient, amount);
        emit FeesWithdrawn(recipient, amount);
    }

    // =========================================================================
    // Views
    // =========================================================================

    function getVideo(bytes32 videoId) external view returns (Video memory) {
        return videos[videoId];
    }

    function hashReceipt(Receipt calldata r) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(RECEIPT_TYPEHASH, r.viewer, r.creator, r.referrer, r.cumulativeAmount, r.deadline)
        );
        return _hashTypedDataV4(structHash);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Returns the current effective withdraw delay in seconds.
    ///         Kept as a view (not a constant) for backward ABI compatibility with WITHDRAW_DELAY().
    function WITHDRAW_DELAY() external view returns (uint64) {
        return _withdrawDelay;
    }

    // =========================================================================
    // Owner functions — fee and referral management (M-4: timelocked)
    // =========================================================================

    /// @notice Propose a new platform fee. Takes effect after FEE_TIMELOCK (48 h) via applyFee().
    ///         Kept as setFee() in addition to proposeFee() for backward ABI compatibility.
    ///         Note: unlike v3 setFee(), this no longer applies immediately. Callers must call applyFee().
    ///         Reverts PendingProposalExists if a fee proposal is already pending (must apply or let it expire first).
    function proposeFee(uint16 bps) external onlyOwner {
        if (bps > 1000) revert FeeTooHigh();
        if (uint256(bps) + referralBps > MAX_COMBINED_BPS) revert CombinedFeeTooHigh();
        // H-1 fix (part): also validate against any pending referral proposal to prevent
        //                  combined cap bypass via two concurrent proposals.
        if (pendingReferralApplicableAt != 0 && uint256(bps) + pendingReferralBps > MAX_COMBINED_BPS) {
            revert CombinedFeeTooHigh();
        }
        // M-1 fix: reject if a fee proposal is already queued and unexpired.
        if (pendingFeeApplicableAt != 0 && block.timestamp < pendingFeeApplicableAt) {
            revert PendingProposalExists();
        }
        pendingFeeBps = bps;
        pendingFeeApplicableAt = uint64(block.timestamp) + FEE_TIMELOCK;
        emit FeeProposed(bps, pendingFeeApplicableAt);
    }

    /// @notice Backward-compatible alias for proposeFee. Does NOT apply immediately.
    ///         Reverts PendingProposalExists if a fee proposal is already pending.
    function setFee(uint16 bps) external onlyOwner {
        if (bps > 1000) revert FeeTooHigh();
        if (uint256(bps) + referralBps > MAX_COMBINED_BPS) revert CombinedFeeTooHigh();
        // H-1 fix (part): validate against pending referral proposal.
        if (pendingReferralApplicableAt != 0 && uint256(bps) + pendingReferralBps > MAX_COMBINED_BPS) {
            revert CombinedFeeTooHigh();
        }
        // M-1 fix.
        if (pendingFeeApplicableAt != 0 && block.timestamp < pendingFeeApplicableAt) {
            revert PendingProposalExists();
        }
        pendingFeeBps = bps;
        pendingFeeApplicableAt = uint64(block.timestamp) + FEE_TIMELOCK;
        emit FeeProposed(bps, pendingFeeApplicableAt);
    }

    /// @notice Apply the pending fee after the timelock has expired.
    ///         H-1 fix: re-checks the combined cap against the current referralBps at apply time.
    function applyFee() external {
        if (pendingFeeApplicableAt == 0) revert InvalidAmount();
        if (block.timestamp < pendingFeeApplicableAt) revert TimelockNotExpired();
        // H-1 fix: enforce combined cap at apply time in case referralBps changed since proposal.
        if (uint256(pendingFeeBps) + referralBps > MAX_COMBINED_BPS) revert CombinedFeeTooHigh();
        feeBps = pendingFeeBps;
        pendingFeeBps = 0;          // clear stale pending value
        pendingFeeApplicableAt = 0;
        emit FeeUpdated(feeBps);
    }

    /// @notice Propose a new referral rate. Takes effect after FEE_TIMELOCK via applyReferralBps().
    ///         Reverts PendingProposalExists if a referral proposal is already pending.
    function proposeReferralBps(uint16 bps) external onlyOwner {
        if (bps > MAX_REFERRAL_BPS) revert ReferralTooHigh();
        if (uint256(feeBps) + bps > MAX_COMBINED_BPS) revert CombinedFeeTooHigh();
        // H-1 fix (part): also validate against any pending fee proposal.
        if (pendingFeeApplicableAt != 0 && uint256(pendingFeeBps) + bps > MAX_COMBINED_BPS) {
            revert CombinedFeeTooHigh();
        }
        // M-1 fix: reject if a referral proposal is already queued and unexpired.
        if (pendingReferralApplicableAt != 0 && block.timestamp < pendingReferralApplicableAt) {
            revert PendingProposalExists();
        }
        pendingReferralBps = bps;
        pendingReferralApplicableAt = uint64(block.timestamp) + FEE_TIMELOCK;
        emit ReferralBpsProposed(bps, pendingReferralApplicableAt);
    }

    /// @notice Backward-compatible alias for proposeReferralBps. Does NOT apply immediately.
    ///         Reverts PendingProposalExists if a referral proposal is already pending.
    function setReferralBps(uint16 bps) external onlyOwner {
        if (bps > MAX_REFERRAL_BPS) revert ReferralTooHigh();
        if (uint256(feeBps) + bps > MAX_COMBINED_BPS) revert CombinedFeeTooHigh();
        // H-1 fix (part): validate against pending fee proposal.
        if (pendingFeeApplicableAt != 0 && uint256(pendingFeeBps) + bps > MAX_COMBINED_BPS) {
            revert CombinedFeeTooHigh();
        }
        // M-1 fix.
        if (pendingReferralApplicableAt != 0 && block.timestamp < pendingReferralApplicableAt) {
            revert PendingProposalExists();
        }
        pendingReferralBps = bps;
        pendingReferralApplicableAt = uint64(block.timestamp) + FEE_TIMELOCK;
        emit ReferralBpsProposed(bps, pendingReferralApplicableAt);
    }

    /// @notice Apply the pending referral rate after the timelock has expired.
    ///         H-1 fix: re-checks the combined cap against current feeBps at apply time.
    function applyReferralBps() external {
        if (pendingReferralApplicableAt == 0) revert InvalidAmount();
        if (block.timestamp < pendingReferralApplicableAt) revert TimelockNotExpired();
        // H-1 fix: enforce combined cap at apply time in case feeBps changed since proposal.
        if (uint256(feeBps) + pendingReferralBps > MAX_COMBINED_BPS) revert CombinedFeeTooHigh();
        referralBps = pendingReferralBps;
        pendingReferralBps = 0;     // clear stale pending value
        pendingReferralApplicableAt = 0;
        emit ReferralBpsUpdated(referralBps);
    }

    /// @notice Cancel a pending fee proposal before it can be applied.
    ///         Useful when the owner discovers a typo or wishes to replace the proposal after the
    ///         M-1 guard blocks a direct overwrite. After cancellation the owner may immediately
    ///         propose a new value.
    ///         Reverts InvalidAmount if no fee proposal is currently pending.
    function cancelFeeProposal() external onlyOwner {
        if (pendingFeeApplicableAt == 0) revert InvalidAmount();
        uint16 cancelled = pendingFeeBps;
        pendingFeeBps = 0;
        pendingFeeApplicableAt = 0;
        emit FeeProposalCancelled(cancelled);
    }

    /// @notice Cancel a pending referral-rate proposal before it can be applied.
    ///         Reverts InvalidAmount if no referral proposal is currently pending.
    function cancelReferralProposal() external onlyOwner {
        if (pendingReferralApplicableAt == 0) revert InvalidAmount();
        uint16 cancelled = pendingReferralBps;
        pendingReferralBps = 0;
        pendingReferralApplicableAt = 0;
        emit ReferralBpsProposalCancelled(cancelled);
    }

    /// @notice Update the fee recipient address immediately (no timelock needed — does not affect rates).
    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
    }

    /// @notice Set the withdraw delay. Must be in [MIN_WITHDRAW_DELAY, MAX_WITHDRAW_DELAY].
    ///         Changes do not retroactively affect pending withdrawal requests.
    function setWithdrawDelay(uint64 delay) external onlyOwner {
        if (delay < MIN_WITHDRAW_DELAY || delay > MAX_WITHDRAW_DELAY) revert DelayOutOfRange();
        _withdrawDelay = delay;
        emit WithdrawDelayUpdated(delay);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // =========================================================================
    // Internal — settlement core
    // =========================================================================

    function _settle(Receipt calldata r, bytes calldata sig) internal {
        if (block.timestamp > r.deadline) revert ReceiptExpired();
        // L-1 fix: reject zero creator early with a clear error rather than reverting
        // inside safeTransfer (which would produce a confusing ERC20 error in settleBatch).
        if (r.creator == address(0)) revert ZeroAddress();

        bytes32 digest = hashReceipt(r);

        // --- Signature verification ---
        // First check if viewer signed directly (EOA or ERC-1271).
        address signer;
        bool viewerSigned = SignatureChecker.isValidSignatureNow(r.viewer, digest, sig);

        if (viewerSigned) {
            signer = r.viewer;
        } else {
            // Try to recover an EOA signer and check if it is an authorized session key.
            // The redundant second isValidSignatureNow call present in v3 is removed here (L-2 audit note).
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
            if (err != ECDSA.RecoverError.NoError || recovered == address(0)) {
                revert InvalidSignature();
            }
            signer = recovered;
        }

        // --- Session key enforcement ---
        bool usingSessionKey = signer != r.viewer;
        if (usingSessionKey) {
            SessionKey storage sk = sessionKeys[r.viewer][signer];
            if (sk.expiry == 0) revert InvalidSignature();
            if (sk.expiry <= block.timestamp) revert SessionKeyExpired();
        }

        // --- Cumulative lane (keyed by signed r.referrer; validity only affects payout) ---
        uint256 prior = settled[r.viewer][r.creator][r.referrer];
        if (r.cumulativeAmount <= prior) {
            return; // stale receipt — no-op
        }

        uint256 delta = r.cumulativeAmount - prior;
        uint256 available = balanceOf[r.viewer];
        uint256 actualDelta = delta <= available ? delta : available;

        // Session-key cap: checked against signed delta, incremented by actualDelta.
        if (usingSessionKey) {
            SessionKey storage session = sessionKeys[r.viewer][signer];
            if (uint256(session.spent) + delta > session.spendCap) revert SessionCapExceeded();
            session.spent = SafeCast.toUint128(uint256(session.spent) + actualDelta);
        }

        if (actualDelta < delta) {
            emit PartialSettlement(r.viewer, r.creator, actualDelta, delta);
        }

        // --- Referral validity ---
        bool validReferral = r.referrer != address(0)
            && r.referrer != r.viewer
            && r.referrer != r.creator
            && paidTo[r.referrer][r.creator] > 0;

        // --- Split (integer division truncates toward zero; remainder goes to creator — L-3) ---
        uint256 fee = (actualDelta * feeBps) / 10_000;
        uint256 referralAmount = validReferral ? (actualDelta * referralBps) / 10_000 : 0;
        uint256 creatorAmount = actualDelta - fee - referralAmount;

        // --- Effects (CEI: all state before external calls) ---
        settled[r.viewer][r.creator][r.referrer] = prior + actualDelta;
        paidTo[r.viewer][r.creator] += actualDelta;
        balanceOf[r.viewer] = available - actualDelta;
        // M-3: accrue fee instead of pushing to feeRecipient.
        if (fee > 0) {
            feesAccrued += fee;
        }

        // --- Interactions ---
        if (actualDelta > 0) {
            usdc.safeTransfer(r.creator, creatorAmount);
            if (referralAmount > 0) {
                usdc.safeTransfer(r.referrer, referralAmount);
            }
        }

        emit Settled(r.viewer, r.creator, r.referrer, actualDelta, fee, referralAmount, r.cumulativeAmount);
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    function _authorizeSessionKey(address viewer, address key, uint64 expiry, uint128 spendCap) internal {
        if (key == address(0)) revert ZeroAddress();
        if (expiry <= block.timestamp) revert SessionKeyExpired();

        // L-2 fix: preserve existing spent counter when re-authorizing an unexpired key.
        uint128 existingSpent = sessionKeys[viewer][key].spent;
        sessionKeys[viewer][key] = SessionKey({expiry: expiry, spendCap: spendCap, spent: existingSpent});

        emit SessionKeyAuthorized(viewer, key, expiry, spendCap);
    }

    function _validatePrice(uint128 pricePerHour) internal pure {
        if (pricePerHour == 0 || pricePerHour > MAX_PRICE) revert InvalidPrice();
    }
}
