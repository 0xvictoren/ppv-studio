# PROMPT 2 — Smart Contract (build in Arc Studio)

You are a senior Solidity engineer. Build a production-quality smart contract called **`PayPerWatch`** for deployment on **Arc mainnet** (Circle's stablecoin-native L1) using **Arc Studio**. It powers a pay-as-you-watch video platform: viewers deposit USDC, creators set a price per hour of watch time, viewing is metered off-chain with signed receipts, receipts are settled on-chain **every hour**, and viewers can withdraw any unused USDC at any time.

Tagline: **"Never pay for time you didn't watch."**

---

## 1. Context and constraints

- Chain: Arc mainnet. Before you write code, look up these values in the Arc docs or Arc Studio and **do not hardcode guesses**: chain ID, RPC, USDC ERC-20 interface address, and USDC decimals. Arc uses USDC as its gas token, and I believe the ERC-20 interface uses **6 decimals**. Confirm this and make the contract's decimals handling correct.
- Interact with USDC only through the **ERC-20 interface** (`IERC20` with `SafeERC20`).
- Use Solidity ^0.8.24 and OpenZeppelin (`SafeERC20`, `EIP712`, `ECDSA`, `ReentrancyGuard`, `Ownable2Step`, `Pausable`).
- Keep the contract small, readable and auditable. This is a grant MVP, so correctness matters more than features.
- Real USDC must move on mainnet through this contract. The grant judges score "real USDC activity" at 30%.

## 2. Roles

- **Viewer**: deposits USDC, watches, can withdraw unused USDC.
- **Creator**: registers videos with a price per hour and receives earnings.
- **Settler**: the platform's backend relayer, which submits signed receipts hourly. `settle` must be callable by **anyone**, because funds always go to the creator named in the receipt, so the settler is trusted only for liveness.
- **Owner**: the platform. Sets the platform fee (max 10%), the fee recipient and pause. The owner can **never** move viewer or creator funds.

## 3. Storage

```solidity
struct Video {
    address creator;
    uint128 pricePerHour;   // USDC base units (6 decimals): 0.5 USDC = 500_000
    bool active;
}
mapping(bytes32 => Video) public videos;                 // videoId => Video

mapping(address => uint256) public balanceOf;            // viewer's escrowed, unspent USDC
mapping(address => mapping(address => uint256)) public settled; // viewer => creator => cumulative amount already paid

struct SessionKey { uint64 expiry; uint128 spendCap; uint128 spent; }
mapping(address => mapping(address => SessionKey)) public sessionKeys; // viewer => key => data

struct Withdrawal { uint128 amount; uint64 availableAt; }
mapping(address => Withdrawal) public pendingWithdrawal;

uint16 public feeBps;            // platform fee, <= 1000
address public feeRecipient;
uint64 public constant WITHDRAW_DELAY = 1 hours; // matches the hourly settlement cycle
```

## 4. Functions

### Creator
- `registerVideo(bytes32 videoId, uint128 pricePerHour)`: the caller becomes the creator. Revert if the ID already exists. Price must be > 0 and <= a sane max (for example 100 USDC/hour). The frontend derives `videoId = keccak256(abi.encodePacked(creator, contentCID))`.
- `updatePrice(bytes32 videoId, uint128 newPrice)`: creator only. The new price applies to future receipts. The frontend reads the price live.
- `setVideoActive(bytes32 videoId, bool active)`: creator only.

### Viewer
- `deposit(uint256 amount)`: pulls USDC with `safeTransferFrom` and credits `balanceOf[msg.sender]`.
- `depositAndAuthorize(uint256 amount, address key, uint64 expiry, uint128 spendCap)`: one transaction for the best UX.
- `authorizeSessionKey(address key, uint64 expiry, uint128 spendCap)`: the browser generates a temporary key. Receipts signed by that key count as the viewer's signature, up to `spendCap` and until `expiry`. This means the viewer **doesn't get a wallet popup every minute**.
- `revokeSessionKey(address key)`.
- `requestWithdraw(uint256 amount)`: amount <= balance. Sets `availableAt = now + WITHDRAW_DELAY`. This gives the settler one hourly cycle to submit outstanding receipts so a viewer can't watch and then run off with the money.
- `withdraw()`: after the delay, pays `min(requested, balanceOf)` and clears the request.
- `cancelWithdraw()`.

### Settlement (the core)
EIP-712 typed receipt. It is **cumulative**, so only the latest receipt matters and replay is harmless:

```solidity
struct Receipt {
    address viewer;
    address creator;
    uint256 cumulativeAmount; // total ever owed by viewer to creator (base units)
    uint64  deadline;         // receipt expiry
}
// domain: name "PayPerWatch", version "1", chainId, verifyingContract
```

- `settle(Receipt calldata r, bytes calldata sig)`:
  1. `block.timestamp <= r.deadline`.
  2. Recover the signer. It must be `r.viewer`, **or** an unexpired session key authorized by `r.viewer`.
  3. `delta = r.cumulativeAmount - settled[viewer][creator]`. If <= 0, return without reverting, because it's stale.
  4. If the signer is a session key: `spent + delta <= spendCap`, then increase `spent`.
  5. `delta = min(delta, balanceOf[viewer])`, so a viewer can't be overdrawn. Emit `PartialSettlement` if this caps it.
  6. Update `settled` and debit `balanceOf`. Split `fee = delta * feeBps / 10_000`. Transfer `delta - fee` to the creator and `fee` to `feeRecipient`.
  7. Emit `Settled(viewer, creator, delta, fee, cumulativeAmount)`.
- `settleBatch(Receipt[] calldata rs, bytes[] calldata sigs)`: the hourly job calls this. Skip bad entries instead of reverting the whole batch, and emit `SettlementSkipped(index, reason)`.

Receipts are per **viewer → creator** pair, not per video, to keep it simple. The frontend adds up watch time × each video's price into one cumulative number per creator.

### Views (the frontend needs these)
- `getVideo(bytes32)`, `balanceOf(address)`, `settled(viewer, creator)`, `pendingWithdrawal(viewer)`, `sessionKeys(viewer, key)`
- `hashReceipt(Receipt)`, which returns the EIP-712 digest so the frontend can test its signing.
- `DOMAIN_SEPARATOR()`.

### Owner
- `setFee(uint16 bps)` with `bps <= 1000`, `setFeeRecipient(address)`, `pause()` and `unpause()`.
- While paused, deposits and settlement stop, but **`withdraw` keeps working**. Users can always get their money out.

## 5. Events
`VideoRegistered(videoId, creator, pricePerHour)`, `PriceUpdated`, `VideoActiveSet`, `Deposited(viewer, amount)`, `SessionKeyAuthorized(viewer, key, expiry, cap)`, `SessionKeyRevoked`, `WithdrawRequested(viewer, amount, availableAt)`, `Withdrawn(viewer, amount)`, `Settled(...)`, `PartialSettlement(...)`, `SettlementSkipped(...)`, `FeeUpdated`.
Index the viewer, creator and videoId. The creator dashboard is built entirely from events.

## 6. Security requirements (must address each one)
- `nonReentrant` on every function that moves funds. Follow checks, effects, interactions.
- Signatures can't be replayed across chains or contracts, because the EIP-712 domain includes the chainId and contract address. Within the contract they can't be replayed either, because receipts are cumulative.
- Use `ECDSA.recover` with malleability protection. Support EIP-1271 for smart-contract wallets if it's cheap with `SignatureChecker`.
- A session key can't spend beyond its cap, after expiry or after revocation.
- The owner has no path to user funds. No upgradeability for the MVP.
- Use custom errors, not revert strings.

## 7. Tests (Foundry, or whatever Arc Studio supports)
Write tests for:
- deposit and withdraw happy path
- withdraw before the delay reverts
- settlement with the viewer's signature
- settlement with a session key, including over the cap, expired and revoked
- a stale receipt is a no-op
- a receipt larger than the balance is capped
- fee math, including fee 0 and fee 10%
- a batch with one bad entry still settles the others
- withdraw works while paused
- a wrong chainId or contract in the domain fails
- fuzz test: viewer balance + total paid to creators + fees == total deposited

## 8. Deployment and demo (for the grant submission)
1. Deploy to Arc **mainnet** through Arc Studio with feeBps = 200 (2%). Verify the contract.
2. Record or screenshot the Arc Studio workflow, because "Arc Studio usage" is worth 25% of the score.
3. Run real mainnet transactions:
   - register 2–3 videos at different prices ($0.50/hr, $1/hr)
   - 3–5 different viewers each deposit $1–2
   - watch, then the hourly settlement runs
   - at least one viewer withdraws the unused balance
4. Collect every transaction hash for the submission.

## 9. Hand-off to the frontend (output this at the end)
Give me:
- the deployed contract address and the USDC address
- the full **ABI JSON**
- the exact EIP-712 domain and types, so the frontend signs identical receipts
- a short `settler` script in TypeScript with viem that loads the latest stored receipt per (viewer, creator), calls `settleBatch` and runs **every hour** (cron)
- a README explaining the flow, the security model and the known limitations
