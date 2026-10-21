# PROMPT 1 — Frontend (UI/UX) for the pay-per-watch video platform

You are a senior frontend engineer and product designer. Build the web app for **"PayPerWatch"** (working name), a video streaming platform on **Arc** (Circle's stablecoin-native L1). Viewers pay in USDC **only for the time they actually watch**, and creators set their own price per hour.

All money logic lives in a smart contract that another person is building in Arc Studio. **Do not write Solidity.** Build the UI against the contract interface below. Put the contract address and ABI in one config file, and add a **mock mode** so the whole app works before the contract is deployed.

Tagline: **"Never pay for time you didn't watch."**

---

## 1. Tech stack
- Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui
- wagmi v2, viem and RainbowKit (or ConnectKit) for wallets
- Arc chain added as a custom viem chain. Read the chain ID, RPC, explorer and USDC address from env vars; don't hardcode them:
  `NEXT_PUBLIC_ARC_CHAIN_ID`, `NEXT_PUBLIC_ARC_RPC`, `NEXT_PUBLIC_ARC_EXPLORER`, `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_PPW_CONTRACT`, `NEXT_PUBLIC_MOCK_MODE`
- **Auth:** Sign-In With Ethereum (SIWE). The wallet is the account. No email or password.
- **Video storage:** Livepeer Studio (best, because it gives HLS streaming and transcoding) or IPFS through Pinata. Hide this behind a `storage` adapter.
- **Metadata DB:** Supabase (Postgres) for video title, description, thumbnail, CID/playback ID, creator wallet, `videoId`, price, duration and created date. Also a `receipts` table, described below.
- Player: hls.js or Video.js.
- Deploy to Vercel.

## 2. Pages and flows

### a) Landing `/`
- Hero: "Watch more. Pay less. Only for what you watch." Two buttons: "Browse videos" and "Upload & earn."
- A 3-step explainer: **Deposit USDC → Watch (pay per second) → Withdraw what you don't use.**
- Comparison: "Monthly sub: $10, even if you watch 0 minutes" vs "PayPerWatch: $0.40 for the 25 minutes you actually watched."

### b) Browse `/videos`
- Grid of video cards: thumbnail, title, creator (ENS or shortened address), duration, and a **price badge** such as "$0.50 / hr ≈ $0.008/min."
- Search, and sort by newest, cheapest or most watched.

### c) Upload `/upload` (connected creators only)
1. Connect the wallet and sign in.
2. Drag-and-drop a video file with an upload progress bar. Show a thumbnail picker or auto-generate one.
3. Title and description.
4. **Pricing** (key UX):
   - Preset chips: **$0.25/hr, $0.50/hr, $1/hr, $2/hr**, plus a "Custom" input in USDC with 2 decimals.
   - A live preview that converts the price: "Viewers pay **$0.0083 per minute**. A full watch of this 12-min video costs **$0.10**."
   - An earnings estimator: "100 viewers watching the full video ≈ $9.80 to you (after a 2% platform fee)."
   - Validation: price > 0 and ≤ $100/hr.
5. Publish: upload to storage, compute `videoId = keccak256(abi.encodePacked(creatorAddress, contentCID))`, call `registerVideo(videoId, pricePerHour)` (USDC has **6 decimals**: $0.50 → `500000`), wait for the transaction, save the metadata to the DB and show a success screen with a link to the Arc explorer.
- Handle each state: uploading, waiting for wallet, transaction pending, confirmed and failed (with retry).

### d) Watch `/watch/[id]` (the core)
- Video player, title, creator and price.
- **Wallet panel** next to or under the player:
  - Escrow balance: "**$9.86** available"
  - Live meter while playing: "This session: **00:14:32 · $0.12**," ticking every second
  - Status of the last hourly settlement: "Last settled 23 min ago · next in ~37 min"
- **If the viewer has no balance or session key**, show a modal before playback:
  "Add funds to start watching" → amount presets ($1 / $2 / $5 / $10) → `approve` USDC → `depositAndAuthorize(amount, sessionKeyAddress, expiry=now+24h, spendCap=amount)`. If the user already has an allowance, skip `approve`.
- **Metering rules.** Be strict and fair to the viewer:
  - Count **only while the video is actually playing**: not while paused, buffering or ended.
  - Stop when the tab is hidden (`visibilitychange`) or the window loses focus for more than 30s.
  - Every 30 minutes of continuous play, ask "Still watching?" and pause if there's no answer within 60s.
  - Cost per second = `pricePerHour / 3600`. Keep integers in USDC base units with **no floats** for money.
  - When the balance runs out, pause the player and show a top-up prompt.
- **Signed receipts with no popups.** The session key is generated in the browser with viem `generatePrivateKey()`, stored in `localStorage` and scoped per viewer:
  - Every **60 seconds** of playback, and on pause or exit, sign an **EIP-712 receipt** with the session key:
    ```
    domain: { name: "PayPerWatch", version: "1", chainId, verifyingContract }
    Receipt { viewer: address, creator: address, cumulativeAmount: uint256, deadline: uint64 }
    ```
  - `cumulativeAmount` is the **all-time total** this viewer owes this creator across all of the creator's videos. Keep it in the DB and in local state, and always increase it, never reset it.
  - POST it to `/api/receipts`, which verifies the signature server-side and stores **only the latest receipt per (viewer, creator)**.
  - Use `navigator.sendBeacon` on page unload so the final receipt isn't lost.
- **Settlement happens hourly** on the backend: a cron job, Vercel Cron or Supabase scheduled function, every hour calls `settleBatch(receipts, sigs)` on the contract. The frontend only displays its status.

### e) Wallet `/wallet` (viewer)
- Escrowed balance, total spent, total watch time, and spending per video and creator.
- **Add funds** (deposit).
- **Withdraw unused funds**, following the contract's 1-hour delay:
  1. "Request withdrawal" → `requestWithdraw(amount)`
  2. A countdown: "Available in 42:10. We're settling your final watch time."
  3. "Withdraw" button → `withdraw()`. "Cancel" → `cancelWithdraw()`.
- History table built from contract events (`Deposited`, `Settled`, `Withdrawn`), with explorer links.
- Manage session keys: view, and "Revoke" → `revokeSessionKey`.

### f) Creator dashboard `/dashboard`
- My videos: views, total watch time, earned USDC and the current price.
- **Edit price** inline → `updatePrice(videoId, newPrice)`. **Unpublish** → `setVideoActive(false)`.
- Earnings chart (daily) from `Settled` events, plus "Pending (unsettled)" earnings from the receipts table.
- Earnings are paid automatically to the creator's wallet at each hourly settlement, so there's no claim button. Say this clearly in the UI.

## 3. Backend API routes (Next.js route handlers)
- `POST /api/auth/siwe`: SIWE nonce and verification.
- `POST /api/videos`: save metadata after on-chain registration. Verify the `VideoRegistered` event on-chain before trusting it.
- `GET /api/videos`, `GET /api/videos/[id]`.
- `POST /api/receipts`: verify the EIP-712 signature (signer must be the viewer or a session key registered on-chain for the viewer), check that `cumulativeAmount` ≥ the stored value, and upsert it.
- `GET /api/settlement/status`: last run time and next run time.
- `/api/cron/settle`: **runs hourly** and is protected by a secret header. Loads all receipts with `cumulativeAmount > settled on-chain`, calls `settleBatch` with a settler wallet whose key is in `SETTLER_PRIVATE_KEY` (server-only), and logs the transaction hash.

## 4. Contract interface (use exactly this; the ABI file will be swapped in later)
```
registerVideo(bytes32 videoId, uint128 pricePerHour)
updatePrice(bytes32 videoId, uint128 newPrice)
setVideoActive(bytes32 videoId, bool active)
deposit(uint256 amount)
depositAndAuthorize(uint256 amount, address key, uint64 expiry, uint128 spendCap)
authorizeSessionKey(address key, uint64 expiry, uint128 spendCap)
revokeSessionKey(address key)
requestWithdraw(uint256 amount)
withdraw()
cancelWithdraw()
settleBatch(Receipt[] receipts, bytes[] sigs)        // backend only
views: videos(bytes32), balanceOf(address), settled(address viewer, address creator),
       pendingWithdrawal(address), sessionKeys(address viewer, address key), feeBps()
events: VideoRegistered, PriceUpdated, Deposited, SessionKeyAuthorized, SessionKeyRevoked,
        WithdrawRequested, Withdrawn, Settled, PartialSettlement
```
Put this in `lib/contract.ts` along with a typed ABI. In mock mode, simulate every call with in-memory state and fake transaction hashes.

## 5. UX and design requirements
- Clean, dark-first streaming look, like a mix of YouTube and Stripe. Light mode supported. Mobile-first.
- Always show money as `$0.12 USDC`, and never show raw base units.
- Every transaction button shows: "Confirm in wallet…" → "Pending…" with an explorer link → a success or error toast.
- Plain-language errors: "Not enough USDC. Add $2 to keep watching."
- Empty states: no videos yet, no balance, no earnings.
- Accessible: keyboard-operable player controls, ARIA labels, contrast ratio ≥ 4.5:1.
- Add a small **"How billing works"** explainer on the watch page. Trust is the product.

## 6. Grant demo support
- An `/about` page explaining the problem, the solution, why it needs Arc (USDC as gas, sub-second finality, fees low enough for per-minute billing) and links to the contract and transactions.
- A public **stats** strip on the landing page: total USDC settled, minutes watched and creators paid. Read these live from contract events. This is the "real USDC activity" story judges score at 30%.

## 7. Deliverables
- A working repo with a README covering setup, env vars and how to switch from mock mode to the real contract.
- A Supabase SQL schema (`videos`, `receipts`, `settlement_runs`).
- Seed script with 3 sample Creative Commons videos.
- The app must run end to end in mock mode. Once I paste the contract address and ABI, it must work on Arc mainnet.
