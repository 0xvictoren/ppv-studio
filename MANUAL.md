# PayPerWatch manual

PayPerWatch is video you pay for by the second, in USDC, only while it plays. Creators upload videos and set a price per hour. Viewers put a few dollars into the PayPerWatch contract once and then watch with no popups. Creators are paid straight to their wallet.

This manual covers everything in the app: watching, paying, downloading, sharing, publishing, the dashboard, embedding PayPerWatch on another site, the paid API for AI agents, and running your own copy.

> PayPerWatch currently runs on **Arc Testnet**. The USDC is free test money from Circle's faucet, so nothing you do here costs real money.

## The basics

### Words used in this manual

| Term | What it means |
|---|---|
| **Wallet** | Your browser wallet (MetaMask, Rabby, Coinbase Wallet and others). It is your account: there's no email or password. |
| **USDC** | A digital dollar. Everything on PayPerWatch is priced and paid in USDC. On Arc, USDC also pays the network fees, so you never need a second token. |
| **Balance** | USDC you've added to the PayPerWatch contract. Watching spends from it. Whatever you don't use stays yours and can be withdrawn. |
| **Session key** | A temporary key your browser creates when you add funds. It signs your watch payments in the background so you aren't asked to confirm every few seconds. It can only spend up to the limit you set, and it expires after 24 hours. |
| **Receipt** | A small signed note your browser sends while you watch, saying how much you owe a creator in total. Receipts are collected and paid onchain in batches. |
| **Settlement** | When receipts are paid onchain: the money moves from your balance to the creator's wallet. |
| **Pass** | Free replays of a video for 30 days, which you get by finishing it or downloading it. |

### The menu

| Item | What it's for |
|---|---|
| **Dashboard** | For creators: your videos, prices, earnings and payouts. |
| **Spendings** | Your balance, withdrawals, spending, referral earnings and history. |
| **Downloads** | Videos you saved to watch offline. |
| **Developers** | Embed codes for other websites, and the API for AI agents. |
| **Manual** | This page. |

The **Upload** button in the top right corner publishes a video. To browse videos, click the PayPerWatch logo, then **Start watching**. The button next to the sun and moon icon connects your wallet. Once you're connected, it shows how much you have available to watch. Click it for your address, your wallet's USDC, **Sign in**, **Get test USDC**, **View on explorer** and **Disconnect**. The sun and moon icon next to it switches between light and dark mode.

## Getting started

### 1. Install a wallet

Install a browser wallet such as MetaMask, Rabby or Coinbase Wallet, and create an account in it. On a phone, open PayPerWatch in your wallet app's built-in browser.

### 2. Connect

Click **Connect wallet** in the top right corner and approve the connection in your wallet. PayPerWatch adds the Arc Testnet network to your wallet automatically. Approve that too if your wallet asks.

### 3. Get test USDC

Open the menu under your address and choose **Get test USDC**, or go to [faucet.circle.com](https://faucet.circle.com). Choose **Arc Testnet**, paste your wallet address and request USDC. It arrives within seconds.

### 4. Sign in (only when needed)

Some things need you to prove you own the wallet: uploading, the dashboard, getting a referral link, and restoring your watch progress on a new device. For those, PayPerWatch asks you to **Sign in**. Your wallet shows a message to sign. Signing is free and doesn't send a transaction.

Watching doesn't need signing in. Adding funds is enough.

## Watching videos

### Finding something to watch

Open the catalog: click the PayPerWatch logo, then **Start watching** on the home page. You can also use **Browse** in the footer of any page.

- **Categories:** All, Movies, Tutorials, Exclusive and Other.
- **Search:** searches titles and descriptions.
- **Sort:** Newest, Top rated, Lowest price or Most watched.

Each video card shows its length, its price per hour and its rating.

### Adding funds

The first time you press play, PayPerWatch asks you to add funds:

1. Choose an amount ($1, $2, $5 or $10) or type another amount. The dialog shows how much USDC is in your wallet.
2. Click **Add**. Your wallet asks you to confirm up to two transactions:
   - **Approve USDC**: lets the PayPerWatch contract take that amount. This is only needed the first time, or when you add more than you approved before.
   - **Deposit**: moves the USDC into your PayPerWatch balance and sets up a session key for this browser.
3. Press play. For the next 24 hours, you won't see any more popups.

You can also add funds any time from the **Spendings** page or the **Add funds** button beside the player.

### How billing works

- **You pay only while the video plays.** Paused, seeking or buffering costs nothing.
- **Each second, once.** You pay for a second of a video the first time you watch it. If you stop at minute 30 and come back later, billing picks up at minute 31. Parts you've already paid for replay free.
- **Speed doesn't matter.** At 2× speed you pay for the footage, not for the time on the clock.
- **Finish it, replay free.** Watch at least 97% of a video and every replay is free for 30 days from when you first started it.
- **Nothing pauses for you.** PayPerWatch never pauses the video on its own, not when you switch tabs and not during long sessions. Pause it yourself when you step away. The only automatic stop is when your balance runs out.
- **The fee isn't added to your price.** The 5% platform fee comes out of the creator's share.

### The panel beside the player

| Part | What it shows |
|---|---|
| **Available** | What you can still spend, after counting what you owe but hasn't been paid onchain yet. |
| **This session** | Time watched and money spent since you opened the page, and how much is left before you need to top up. It also tells you when what you're watching is free (already paid for, or covered by a pass). |
| **Paid for** | How much of the video you've paid for, with marks at 10%, 25%, 50% and 75%. |
| **Last settled / next in** | When payments were last sent onchain and when the next run is due. |

Below the video, a note tells you if you've already paid for part of it, if you have a free-replay pass, or if someone shared the video with you.

### When your balance runs out

The video stops, and a dialog suggests a top-up and tells you how many more minutes it buys. Add funds and press play to carry on from the same spot.

### Watched it before on another device?

Your progress is stored with your wallet, not your browser. On a new device, choose **Watched it before? Sign in** on the player. Parts you've paid for, and any pass, carry over.

### Ratings

There are no like buttons. Ratings come from how people actually watch:

- Each paying viewer scores a video from 1 to 5. Sampling it scores about 1, watching to the end scores 4, and coming back for more full watches scores 5.
- A video's rating is weighted toward 3.0 until enough people have watched it, so one fan can't make a video 5 stars.
- Only paid watch time counts.

The watch page shows the rating, how many people rated it, the share of viewers who finish it, and the share who come back.

### How streaming is protected

Most videos are delivered in encrypted pieces of about 6 seconds each. Your player only gets the key for a piece once you've paid for it, or while it's within a short buffer of about a minute ahead of where you're watching. You won't notice anything while watching. It just means a video can't be saved from the page without paying for it.

## Downloads (watch offline)

1. On a video's page, click **Download**.
2. The dialog shows the price: the part of the video you haven't paid for yet. You're never charged twice for the same second. If you have a pass, it's free.
3. Click **Pay and download**. The video is saved in this browser.
4. Open **Downloads** to watch it, even with no internet connection.

Things to know:

- Downloads play only inside PayPerWatch, like offline videos in other streaming apps.
- A download lasts 30 days. Downloading also gives you a 30-day pass, so replays and re-downloads are free during that time. When it ends, the download is removed and the page tells you.
- The trash icon deletes a download from this device. You can download it again for free while the pass lasts.
- The Downloads page shows how much space your downloads use.
- Downloads are saved per browser. Another device needs its own download, which is free during the pass.

## Sharing and earning (referrals)

Click **Share** under any video to copy its link.

If the creator has turned on **Share and earn** for that video, the button reads **Share and earn**, and you can earn **5%** of what the people you bring in spend on it:

1. Watch the video yourself first. Referral links only unlock after that.
2. Click **Share and earn**, then **Get my referral link**. If you aren't signed in, it asks you to sign in first.
3. Send the link to people. When someone watches through it, you get 5% of what they spend on that video.

How it works:

- The 5% comes out of the creator's share. The viewer's price doesn't change.
- If someone has followed more than one referral link for a video, the first one counts, for 30 days.
- You can't refer yourself, and creators can't earn referrals on their own videos.
- Your earnings are paid straight to your wallet whenever settlements run. You can follow them on **Spendings → Referral earnings**.

## Your spendings page

**Spendings** brings together everything about your money.

### Summary

| Figure | What it means |
|---|---|
| **Escrowed balance** | USDC in the PayPerWatch contract. If you've watched something that hasn't settled yet, the note under it shows how much. |
| **Available to watch** | Your balance minus what you owe. The USDC still in your wallet itself is shown underneath. |
| **Total spent** | Everything that has been paid onchain from your balance. |
| **Total watch time** | How long you've watched, across all your sessions. |

The top of the page also has **Add funds** and, on testnet, **Get test USDC**.

### Withdrawing unused funds

1. Under **Withdraw unused funds**, enter an amount, or click **Max** for everything you aren't owing.
2. Click **Request withdrawal** and confirm in your wallet.
3. Wait **24 hours**. The card counts down the time left.
4. Click **Withdraw**. The USDC goes back to your wallet.

Why the wait: payments for what you watch are sent onchain in batches. The wait gives the last batch time to pay creators for anything you watched just before asking for your money back. You're never charged for anything you didn't watch. If what you owe has reduced your balance by the time the wait ends, you receive the rest.

You can **Cancel** a request at any time, and you can keep watching while it's pending.

### Session keys

This lists the temporary keys in this browser, with each one's expiry and how much of its limit it has used.

- **Revoke** turns a key off onchain straight away. Use it if you think someone else used your browser.
- **Remove** clears an expired key from the list.

A new key is created every time you add funds.

### Balance on an earlier contract

When PayPerWatch moves to a new version of its contract, any balance you had on the old one shows here in a highlighted card. Click **Request**, wait for the old contract's delay (1 hour on the previous version), click **Withdraw**, and then add funds again on the new contract. The card disappears once the old balance is empty.

### Referral earnings

This shows what you've earned from referral links, what's still pending, how many people you've brought in, and a breakdown by video.

### Spending by video and history

- **Spending by video:** what you've watched and spent, per video and creator.
- **History:** every deposit, settlement, withdrawal and session key change, straight from the contract, with links to the block explorer.

## Publishing a video (creators)

Open **Upload**. You'll need to be signed in.

### Step 1: Video

- Drag a file onto the box or click **Choose file**. MP4, MOV and WebM files up to 2 GB are supported.
- PayPerWatch reads the length and suggests thumbnails taken from the video. Pick one, or click **Upload your own** to use a JPEG, PNG or WebP image.

### Step 2: Details

- **Title** (up to 140 characters). It's filled in from the file name to start with.
- **Description** (optional, up to 5,000 characters).
- **Category:** Movies (films and shorts), Tutorials (courses, lessons and how-tos), Exclusive (members-style gated content) or Other.

### Step 3: Price per hour

Pick **$0.25**, **$0.50**, **$1** or **$2** an hour, or type your own price, up to $100 an hour with at most 2 decimals. The form shows:

- what viewers pay per minute,
- what a full watch of this video costs,
- roughly what 100 full watches pay you after the 5% platform fee.

### Step 4: Share and earn

Turn this on to let viewers earn 5% (paid from your share) for bringing in new viewers. It's off by default, which means you keep everything. You can change it later in the dashboard.

### Step 5: Publish

Click **Publish**. The button shows each stage:

1. **Uploading.** A progress bar. If a later step fails, the upload is kept, so trying again doesn't upload the file again.
2. **Checking originality.** The video is compared with every video on PayPerWatch. Long videos can take a few minutes, so keep the tab open.
3. **Confirm in wallet.** Your wallet asks you to confirm one transaction, which registers the video and its price on the contract.
4. **Pending, then Saving.** There's a link to the transaction while it confirms.
5. **Your video is live.** Links to the video, your dashboard and the transaction. If the video got an originality score, it's shown here too.

### The originality check

Every upload gets an originality score from 0 to 100. The check compares:

- **Picture and sound:** the footage and the audio. Re-encoded, resized, slightly cropped and screen-recorded copies still match.
- **Speech:** what's said in the video, compared with every other video's transcript.

There are three possible outcomes:

| Outcome | When | What happens |
|---|---|---|
| **Published** | It's original enough. | Publishing carries on as normal. |
| **Held for a note** | The score is under 50 because it covers much the same topic as other videos. | You see the similar videos and a box asking **What does your video add?** Write at least 40 characters (for example: worked examples, a different method, more depth on one part) and click **Publish with this note**. |
| **Blocked** | Large parts of the picture or sound are the same as a video already on PayPerWatch. | It can't be published. The matching video is listed. If you made the original, contact the PayPerWatch team with proof. |

Each matching video shows how much it overlaps, as either "same footage" or "same topic".

## Your dashboard (creators)

Open **Dashboard** and sign in.

### Earnings

- **Earned (paid to your wallet):** everything paid out to you, after the platform fee and any referral rewards.
- **Pending (unsettled):** what viewers have watched that hasn't been paid onchain yet, after the fee.
- **Total watch time** across all your videos.
- **Daily earnings:** a chart of the last 30 days.

There's no claim button and no minimum payout. Earnings go straight to your wallet whenever settlements run: as viewers reach 10%, 25%, 50%, 75% and 100% of a video, and in a regular sweep of everything else.

### My videos

Each row shows the thumbnail, title, views, minutes watched, and the value of that watch time. Each video has these controls:

| Control | What it does |
|---|---|
| **Edit price** | Change the price per hour. This is an onchain transaction you confirm in your wallet, and the new price applies from then on. |
| **Unpublish / Republish** | Hides or restores the video (also onchain). Viewers see "This video has been unpublished by its creator" while it's hidden. |
| **Share and earn** | Turns referral rewards on or off for this video. Takes effect immediately, with no transaction. |
| **Embed** | Copies the code to put this video on another website. |
| **Move to new contract** | Only shown after PayPerWatch moves to a new contract version. One click, one transaction, and the video is live again. Nothing is uploaded again: the file, price, stats and transcript stay the same. When more than one video needs moving, a **Move all** button at the top of the list does them together (your wallet asks once per video). |
| **Delete** | Removes the video for good: the listing, the uploaded file, its stream and its transcript. Type **delete** to confirm. If the video is still published, your wallet first asks you to confirm one transaction to unpublish it. Money you've already earned stays yours, payments for watching up to then still settle, and people who downloaded it can keep watching until their 30-day pass ends. This can't be undone. To hide a video temporarily instead, use **Unpublish**. |

### Settlements

A table of every payout to you, with the amount, the platform fee, any referral reward, and a link to the transaction.

## Fees and payouts

| Who | Gets |
|---|---|
| **Creator** | 95% of what viewers pay, or 90% when a viewer came through someone's referral link. |
| **Platform** | 5%, taken from the creator's share. |
| **Referrer** | 5%, taken from the creator's share, and only on videos with Share and earn turned on. |

- The viewer always pays exactly the creator's price. Fees are never added on top.
- Fee rates are set in the contract. Any change has to be announced onchain in advance, so it can't change without notice.
- Payouts go straight from the contract to wallets. PayPerWatch never holds creators' earnings.

## Putting PayPerWatch on your own site

Open **Developers** for ready-to-copy code and a live preview. Everything runs in a frame served by PayPerWatch, so your site never handles keys or money. Viewers connect their own wallet inside the frame.

| What | Code |
|---|---|
| Your whole catalog (one line) | `<script src="https://ppv-studio.vercel.app/embed.js" data-ppw="catalog" async></script>` |
| One video | `<div data-ppw="video" data-video="0xVIDEO_ID"></div>` plus the script |
| One category or creator | `<div data-ppw="catalog" data-category="tutorials" data-creator="0xWALLET"></div>` |
| Earn as a platform | add `data-ref="0xYOUR_WALLET"` to earn 5% of what viewers you bring in spend |
| Uploads | `<div data-ppw="upload"></div>` |
| Plain iframe, no script | `<iframe src="https://ppv-studio.vercel.app/embed/watch/0xVIDEO_ID" style="width:100%;height:640px;border:0" allow="fullscreen; clipboard-write" allowfullscreen></iframe>` |

- Find a video's ID in your dashboard. Each video's **Embed** button copies the full code.
- The frame grows and shrinks to fit its content.
- Earning as a platform with `data-ref` works only if your wallet has paid that creator before. This stops people earning from referrals with brand-new wallets.
- Signing in to upload from inside a frame needs third-party cookies over https. If a browser blocks them, the frame offers to open in a new tab.
- Downloads open in the full PayPerWatch app.

## AI agents: paid transcripts

AI agents can search everything said in PayPerWatch videos and buy full transcripts, paying in USDC through Circle Gateway nanopayments (the x402 standard). The creator is paid for every purchase, just like when a person watches.

### The endpoint to give an agent

```
https://ppv-studio.vercel.app/api/agent/search?q=your+topic
```

This is also on the **Developers** page, with a copy button.

### How it works

1. **Search (free).** `GET /api/agent/search?q=fibonacci+retracement&limit=10` returns matching videos with the moments in their transcripts that matched, and the price of each full transcript. It allows up to 30 searches a minute per IP and up to 12 search words.
2. **Buy a transcript.** Each result has a `transcript.url`. Without payment, it returns `402 Payment Required` along with the payment details. Any x402 client with a Gateway balance on Arc pays and retries automatically.
3. **What's included.** The full transcript with timestamps.
4. **Price.** The same as watching the whole video: duration × price per hour.

### Example (TypeScript)

```
import { GatewayClient } from "@circle-fin/x402-batching/client";

const agent = new GatewayClient({ chain: "arcTestnet", privateKey: AGENT_KEY });
await agent.deposit("1"); // once: fund the agent's Gateway balance

const { results } = await (await fetch("https://ppv-studio.vercel.app/api/agent/search?q=fibonacci")).json();
const { data } = await agent.pay(results[0].transcript.url);
console.log(data.transcript);
```

To try it from this repository:

1. Run `npx tsx scripts/agent-demo.ts new` and put the key it prints into `.env.local` as `TEST_AGENT_PRIVATE_KEY`.
2. Send that wallet test USDC from the faucet.
3. Run `npx tsx scripts/agent-demo.ts deposit 1` to fund its Gateway balance.
4. Run `npx tsx scripts/agent-demo.ts ask "fibonacci retracement"`.

## Running your own PayPerWatch

This section is for whoever operates the site. Viewers and creators can skip it.

### What runs where

| Piece | Where it runs | What it does |
|---|---|---|
| **Web app** | Vercel, or any Node server (`npm run build && npm start`) | The site and its API. |
| **Database** | MongoDB Atlas, or a file in `./data` when self-hosted | Videos, receipts, watch progress, reviews and transcripts. |
| **Video storage** | Cloudflare R2, or `./data/uploads` | The uploaded files and the encrypted streaming pieces. |
| **Review worker** | Any computer with ffmpeg (`python worker/review_worker.py`) | Originality checks, transcripts, and encrypting published videos for streaming. |
| **Contract** | Arc (testnet for now) | Holds balances, pays creators, and enforces fees and withdrawal delays. |

Setup steps and environment variables are in `README.md`.

### The review worker

- **Needs:** Python 3.10+, `numpy`, `cryptography`, and an ffmpeg build with Whisper and Chromaprint. Install the Python packages with `pip install numpy cryptography`.
- **Start it:** `python worker/review_worker.py`. It reads `REVIEW_WORKER_SECRET` and the site address from `.env.local`.
- **Configuration:** `WHISPER_MODEL` (default `worker/models/ggml-base.bin`) and `WHISPER_PROCS` (parallel transcription, default 4).
- **When it's off:** uploads wait at "Checking originality", and new videos stream without encryption until it's back. Keep it running.

### Settlement (paying creators)

- Payments settle as viewers reach 10%, 25%, 50%, 75% and 100% of a video, whenever a download is bought, and in a scheduled sweep of everything else.
- On Vercel's free plan, the built-in schedule runs once a day (`vercel.json`). For an hourly sweep, create a free job at cron-job.org that calls `GET /api/cron/settle` every hour with the header `Authorization: Bearer <CRON_SECRET>`. A self-hosted server runs it hourly on its own.
- The settler wallet (`SETTLER_PRIVATE_KEY`) pays the network fees in USDC, so keep a little USDC in it.
- A payment the contract refuses three times in a row is retried once a day instead of every run, and each settlement run that skips one is recorded as an error.
- Platform fees build up in the contract and are sent to the fee wallet automatically once they reach $1.

### Owner tasks

| Task | How |
|---|---|
| Change the platform fee | `npx tsx scripts/set-fee.ts`. It proposes the new fee onchain, and you apply it after the notice period. |
| Change the withdrawal wait | The contract owner calls `setWithdrawDelay` (1 hour to 7 days, default 24 hours). |
| Fund the agent account | `npx tsx scripts/agent-wallet.ts` shows balances, `withdraw 5` moves agent earnings out of Gateway, and `deposit 5` funds creator payouts. |
| Move to a new contract | Deploy it, set `NEXT_PUBLIC_PPW_CONTRACT`, `NEXT_PUBLIC_PPW_DEPLOY_BLOCK` and `NEXT_PUBLIC_PPW_LEGACY_CONTRACTS`, then run `npx tsx scripts/migrate-contract.ts <old address>`. Creators republish from the dashboard, and viewers withdraw old balances from the Spendings page. |
| Check the deployment | `npx tsx scripts/smoke-testnet.ts <site url>` runs the end-to-end checks without spending funds. |

## Troubleshooting

**My wallet doesn't show Arc Testnet.**
Disconnect and connect again. PayPerWatch offers to add the network. You can also add it by hand: chain ID 5042002, with USDC as the currency.

**I can't add funds: "Not enough USDC in your wallet".**
Get test USDC from the faucet, and keep a few cents in your wallet for network fees.

**The video won't start.**
Check the message on the player. You may need to connect your wallet, add funds, or wait for the creator to republish the video. If your session key has expired (after 24 hours), adding funds creates a new one.

**I watched part of a video on another device and it's charging me again.**
Choose **Watched it before? Sign in** on the player so PayPerWatch can load your progress.

**My withdrawal says it isn't ready.**
Withdrawals are ready 24 hours after you request them. The card shows the countdown.

**My upload is stuck on "Checking originality".**
The review worker may be offline. Keep the tab open, or come back and publish again later. Your upload is kept.

**"This video matches one already on PayPerWatch".**
The picture or sound matches an existing video, so it can't be published. If it's your original, contact the PayPerWatch team with proof.

**I don't see my earnings yet.**
Earnings show under **Pending** until the next settlement, then move to **Earned**. Check **Settlements** on your dashboard for the transaction.

**The embed asks me to open a new tab to sign in.**
Your browser blocks third-party cookies inside frames. Open it in a new tab, sign in there, and come back.
