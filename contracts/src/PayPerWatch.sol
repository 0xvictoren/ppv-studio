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

contract PayPerWatch is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Video {
        address creator;
        uint128 pricePerHour;
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

    struct Receipt {
        address viewer;
        address creator;
        address referrer;
        uint256 cumulativeAmount;
        uint64 deadline;
    }

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

    event VideoRegistered(bytes32 indexed videoId, address indexed creator, uint128 pricePerHour);
    event PriceUpdated(bytes32 indexed videoId, uint128 newPrice);
    event VideoActiveSet(bytes32 indexed videoId, bool active);
    event Deposited(address indexed viewer, uint256 amount);
    event SessionKeyAuthorized(address indexed viewer, address indexed key, uint64 expiry, uint128 spendCap);
    event SessionKeyRevoked(address indexed viewer, address indexed key);
    event WithdrawRequested(address indexed viewer, uint256 amount, uint64 availableAt);
    event WithdrawCancelled(address indexed viewer);
    event Withdrawn(address indexed viewer, uint256 amount);
    event Settled(address indexed viewer, address indexed creator, address indexed referrer, uint256 delta, uint256 fee, uint256 referralAmount, uint256 cumulativeAmount);
    event PartialSettlement(address indexed viewer, address indexed creator, uint256 actualDelta, uint256 requestedDelta);
    event SettlementSkipped(uint256 indexed index, bytes4 reason);
    event FeeUpdated(uint16 bps);
    event ReferralBpsUpdated(uint16 bps);

    bytes32 private constant RECEIPT_TYPEHASH =
        keccak256("Receipt(address viewer,address creator,address referrer,uint256 cumulativeAmount,uint64 deadline)");

    uint128 private constant MAX_PRICE = 100_000_000;
    uint16 public constant MAX_REFERRAL_BPS = 1000; // 10% ceiling

    IERC20 public immutable usdc;
    uint64 public constant WITHDRAW_DELAY = 1 hours;
    uint256 public constant MAX_BATCH = 100;

    mapping(bytes32 => Video) public videos;
    mapping(address => uint256) public balanceOf;
    // settled[viewer][creator][referrer] = cumulative settled for this (viewer, creator, referrer) triple
    mapping(address => mapping(address => mapping(address => uint256))) public settled;
    // paidTo[viewer][creator] = total ever settled by viewer to creator across ALL referrers
    mapping(address => mapping(address => uint256)) public paidTo;
    mapping(address => mapping(address => SessionKey)) public sessionKeys;
    mapping(address => Withdrawal) public pendingWithdrawal;

    uint16 public feeBps;
    uint16 public referralBps = 500; // 5% default; owner-adjustable up to MAX_REFERRAL_BPS
    address public feeRecipient;

    constructor(address usdc_, uint16 feeBps_, address feeRecipient_, address initialOwner_)
        EIP712("PayPerWatch", "3")
        Ownable(initialOwner_)
    {
        if (usdc_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        if (feeBps_ > 1000) {
            revert FeeTooHigh();
        }

        usdc = IERC20(usdc_);
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
    }

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
        if (video.creator != msg.sender) {
            revert NotCreator();
        }
        _validatePrice(newPrice);

        video.pricePerHour = newPrice;

        emit PriceUpdated(videoId, newPrice);
    }

    function setVideoActive(bytes32 videoId, bool active) external {
        Video storage video = videos[videoId];
        if (video.creator != msg.sender) {
            revert NotCreator();
        }

        video.active = active;

        emit VideoActiveSet(videoId, active);
    }

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) {
            revert InvalidAmount();
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;

        emit Deposited(msg.sender, amount);
    }

    function depositAndAuthorize(uint256 amount, address key, uint64 expiry, uint128 spendCap)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) {
            revert InvalidAmount();
        }

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

    function requestWithdraw(uint256 amount) external {
        if (amount == 0) {
            revert InvalidAmount();
        }
        if (amount > balanceOf[msg.sender]) {
            revert InsufficientBalance();
        }

        uint64 availableAt = uint64(block.timestamp + WITHDRAW_DELAY);
        pendingWithdrawal[msg.sender] = Withdrawal({amount: SafeCast.toUint128(amount), availableAt: availableAt});

        emit WithdrawRequested(msg.sender, amount, availableAt);
    }

    function withdraw() external nonReentrant {
        Withdrawal memory w = pendingWithdrawal[msg.sender];
        if (w.amount == 0) {
            revert InvalidAmount();
        }
        if (block.timestamp < w.availableAt) {
            revert WithdrawDelayNotMet();
        }

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

    function settle(Receipt calldata r, bytes calldata sig) external nonReentrant whenNotPaused {
        _settle(r, sig);
    }

    function settleBatch(Receipt[] calldata rs, bytes[] calldata sigs) external whenNotPaused {
        if (rs.length > MAX_BATCH) {
            revert InvalidAmount();
        }
        if (rs.length != sigs.length) {
            revert InvalidAmount();
        }

        for (uint256 i = 0; i < rs.length; ++i) {
            (bool success, bytes4 reason) = _trySettle(rs[i], sigs[i]);
            if (!success) {
                emit SettlementSkipped(i, reason);
            }
        }
    }

    /// @dev Calls _settleEntry via a low-level call so per-entry reverts are
    ///      caught and skipped rather than bubbling up.
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

    /// @dev External entry point used only by settleBatch's _trySettle.
    ///      The sender check prevents external callers.
    function _settleEntry(Receipt calldata r, bytes calldata sig) external nonReentrant whenNotPaused {
        if (msg.sender != address(this)) revert InvalidSignature();
        _settle(r, sig);
    }

    function getVideo(bytes32 videoId) external view returns (Video memory) {
        return videos[videoId];
    }

    function hashReceipt(Receipt calldata r) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(RECEIPT_TYPEHASH, r.viewer, r.creator, r.referrer, r.cumulativeAmount, r.deadline));
        return _hashTypedDataV4(structHash);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function setFee(uint16 bps) external onlyOwner {
        if (bps > 1000) {
            revert FeeTooHigh();
        }
        feeBps = bps;
        emit FeeUpdated(bps);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) {
            revert ZeroAddress();
        }
        feeRecipient = recipient;
    }

    function setReferralBps(uint16 bps) external onlyOwner {
        if (bps > MAX_REFERRAL_BPS) {
            revert ReferralTooHigh();
        }
        referralBps = bps;
        emit ReferralBpsUpdated(bps);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _settle(Receipt calldata r, bytes calldata sig) internal {
        if (block.timestamp > r.deadline) {
            revert ReceiptExpired();
        }

        bytes32 digest = hashReceipt(r);

        address signer;
        bool viewerSigned = SignatureChecker.isValidSignatureNow(r.viewer, digest, sig);

        if (viewerSigned) {
            signer = r.viewer;
        } else {
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
            if (err != ECDSA.RecoverError.NoError || recovered == address(0)) {
                revert InvalidSignature();
            }
            if (!SignatureChecker.isValidSignatureNow(recovered, digest, sig)) {
                revert InvalidSignature();
            }
            signer = recovered;
        }

        bool usingSessionKey = signer != r.viewer;
        if (usingSessionKey) {
            SessionKey storage sk = sessionKeys[r.viewer][signer];
            if (sk.expiry == 0) {
                revert InvalidSignature();
            }
            if (sk.expiry <= block.timestamp) {
                revert SessionKeyExpired();
            }
        }

        // Cumulative lane is keyed by the SIGNED r.referrer — always, regardless of validity.
        // Referral validity (below) only decides whether referralAmount > 0; it never changes
        // which lane is read/written.  This prevents an ineligible-then-eligible transition
        // from re-settling amounts that already settled in the referrer's lane when they were
        // ineligible, and keeps genuine no-referrer receipts (r.referrer == address(0)) in
        // their own independent lane.
        // Security note: each lane requires a valid viewer / session-key signature over the
        // exact r.referrer value, so a third party cannot fabricate lanes.  A viewer who signs
        // receipts across multiple referrer values can only ever spend their own balanceOf,
        // and the session-key spendCap (spent tracks actualDelta across ALL lanes for that key)
        // already caps total spend per key — the same trust model as v1.
        uint256 prior = settled[r.viewer][r.creator][r.referrer];
        if (r.cumulativeAmount <= prior) {
            return;
        }

        uint256 delta = r.cumulativeAmount - prior;

        uint256 available = balanceOf[r.viewer];
        uint256 actualDelta = delta <= available ? delta : available;

        if (usingSessionKey) {
            SessionKey storage session = sessionKeys[r.viewer][signer];
            if (uint256(session.spent) + delta > session.spendCap) {
                revert SessionCapExceeded();
            }
            uint256 nextSpent = uint256(session.spent) + actualDelta;
            session.spent = SafeCast.toUint128(nextSpent);
        }

        if (actualDelta < delta) {
            emit PartialSettlement(r.viewer, r.creator, actualDelta, delta);
        }

        // Referral is valid iff:
        //   - referrer is non-zero
        //   - referrer != viewer  (no self-referral)
        //   - referrer != creator (creator cannot earn referral on own content)
        //   - paidTo[referrer][creator] > 0 (referrer must already have paid to watch
        //     this creator — prevents a fresh wallet from bootstrapping a referral chain)
        bool validReferral = r.referrer != address(0)
            && r.referrer != r.viewer
            && r.referrer != r.creator
            && paidTo[r.referrer][r.creator] > 0;

        // Compute split: invalid referrer gets 0 and creator absorbs that share
        uint256 fee = (actualDelta * feeBps) / 10_000;
        uint256 referralAmount = validReferral ? (actualDelta * referralBps) / 10_000 : 0;
        uint256 creatorAmount = actualDelta - fee - referralAmount;

        // Effects before interactions (CEI)
        settled[r.viewer][r.creator][r.referrer] = prior + actualDelta;
        paidTo[r.viewer][r.creator] += actualDelta;
        balanceOf[r.viewer] = available - actualDelta;

        // Interactions
        if (actualDelta > 0) {
            usdc.safeTransfer(r.creator, creatorAmount);
            if (fee > 0) {
                usdc.safeTransfer(feeRecipient, fee);
            }
            if (referralAmount > 0) {
                usdc.safeTransfer(r.referrer, referralAmount);
            }
        }

        emit Settled(r.viewer, r.creator, r.referrer, actualDelta, fee, referralAmount, r.cumulativeAmount);
    }

    function _authorizeSessionKey(address viewer, address key, uint64 expiry, uint128 spendCap) internal {
        if (key == address(0)) {
            revert ZeroAddress();
        }
        if (expiry <= block.timestamp) {
            revert SessionKeyExpired();
        }

        sessionKeys[viewer][key] = SessionKey({expiry: expiry, spendCap: spendCap, spent: 0});

        emit SessionKeyAuthorized(viewer, key, expiry, spendCap);
    }

    function _validatePrice(uint128 pricePerHour) internal pure {
        if (pricePerHour == 0 || pricePerHour > MAX_PRICE) {
            revert InvalidPrice();
        }
    }
}
