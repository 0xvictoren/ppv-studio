# Going live on Arc mainnet

This is the checklist for running PayPerWatch with real USDC. Do the steps in order. Nothing here is automatic, and no step should be skipped because the testnet site works.

Mainnet runs as a **separate deployment** next to the testnet site, with its own Vercel project, database, storage bucket and keys. The testnet site stays as the staging copy, where changes are tried first.

## What's different on mainnet

| | Testnet site | Mainnet site |
|---|---|---|
| Network | Arc Testnet (5042002) | Arc (5042), USDC `0x3600…0000`, 6 decimals |
| Review worker (originality check, transcripts, encrypted streaming) | On | **Off** (`CONTENT_REVIEW=off`) until a worker runs around the clock |
| Paid agent transcripts | On | **Off** (`NEXT_PUBLIC_AGENT_API=off`): Circle Gateway nanopayments aren't on Arc mainnet yet, and there are no transcripts while the worker is off |
| Deposit limit | None | $50 per wallet while soft-launching (`NEXT_PUBLIC_DEPOSIT_CAP_USDC`), enforced in the app |
| Contract owner | Settler hot key | A hardware wallet or Safe multisig. Never the settler key |
| Settlement sweep | Daily (Vercel cron) | Hourly (cron-job.org) |

With the worker off, uploads publish straight away without an originality score, and videos stream as plain files behind short-lived signed links instead of encrypted pieces. A paying viewer could save the file. That's the trade-off until the worker comes back.

## 1. Accounts and money

- **Vercel Pro** for the mainnet project. The free plan doesn't allow commercial use.
- **MongoDB Atlas**: a new project or cluster for mainnet. Back it up (paid tiers have scheduled backups).
- **Cloudflare R2**: a new bucket, with a CORS rule allowing `GET` from the mainnet site address.
- **A domain** (recommended) instead of a `*.vercel.app` address.

## 2. Keys

Create every key new. Never reuse a testnet key on mainnet.

| Key | Who holds it | What it does | Funds |
|---|---|---|---|
| **Owner** | You, in a hardware wallet or a Safe multisig (check that Safe supports Arc mainnet first) | Pauses the contract, changes fees and the withdrawal wait, sets the fee recipient | A few dollars of USDC for gas |
| **Fee recipient** | You (can be the owner) | Receives the 5% platform fee | — |
| **Settler** (`SETTLER_PRIVATE_KEY`) | The server only | Sends viewers' signed receipts onchain. Can't take funds or change settings | $5–20 USDC for gas. Top up when `/api/health` warns |

To make a new hot key for the settler: `node -e "console.log(require('viem/accounts').generatePrivateKey())"`, then put it straight into Vercel and nowhere else.

## 3. The contract

1. **Audit.** The v4 contract is reviewed by Arc Studio (max preset). Fix anything critical, high or medium, and re-run the Foundry tests. An outside audit is strongly recommended before deposits grow.
2. **Deploy through Arc Studio** to Arc mainnet with: `USDC_ADDRESS=0x3600000000000000000000000000000000000000`, `FEE_BPS=500`, `FEE_RECIPIENT=<fee wallet>`, `INITIAL_OWNER=<owner wallet>`. Only with the owner's explicit go-ahead.
3. Record the address, deploy transaction and block in `contracts/deployments.json` under `arcMainnet`.
4. Check the contract on the explorer (https://explorer.arc.io): owner, fee recipient, USDC, 5% fee, 24-hour withdrawal wait.

## 4. The mainnet Vercel project

1. Create a new Vercel project from the same GitHub repo.
2. Copy every variable from `.env.mainnet.example` and fill it in. Leave `AGENT_PRIVATE_KEY` and `REVIEW_WORKER_SECRET` unset.
3. Fill in a local copy (`.env.mainnet.local`, which git ignores) and run:
   ```
   npx tsx scripts/mainnet-preflight.ts .env.mainnet.local
   ```
   Every line must say PASS before you deploy.
4. Deploy. Then run the same command with the site address added to also check the live site:
   ```
   npx tsx scripts/mainnet-preflight.ts .env.mainnet.local https://your-mainnet-domain
   ```

## 5. Scheduled jobs and monitoring

- **Hourly settlement.** At cron-job.org, create a job that calls `GET https://your-mainnet-domain/api/cron/settle` every hour with the header `Authorization: Bearer <CRON_SECRET>`. (Vercel's built-in daily job also runs as a backup.)
- **Health alerts.** Point an uptime monitor (UptimeRobot, Better Stack or cron-job.org) at `https://your-mainnet-domain/api/health` every 5–15 minutes with email alerts. It returns 503 when the settler is low on gas, the contract is paused, or no settlement has run for `HEALTH_MAX_SETTLE_HOURS`.

## 6. Legal

- The Terms (`legal/terms.md`) and Privacy (`legal/privacy.md`) pages are plain-language drafts. **Have a lawyer review them** for where you operate, especially: holding user deposits in a contract you control, the 5% fee, and copyright takedowns.
- Set `NEXT_PUBLIC_OPERATOR_NAME` and `NEXT_PUBLIC_CONTACT_EMAIL`. The contact address receives copyright complaints, so someone must read it.
- Check the SF Pro font licence for use on a public commercial site, or switch fonts.

## 7. Soft launch

1. Do a full run yourself with small amounts: add $2, watch, download, publish a video, settle, withdraw after 24 hours, check the creator was paid and the fee arrived.
2. Invite a small group. Keep the $50 cap.
3. Watch `/api/health`, the settler balance and the settlement history daily for the first two weeks.
4. Raise or remove the cap when you're confident (`NEXT_PUBLIC_DEPOSIT_CAP_USDC`, then redeploy).

## If something goes wrong

- **Pause the contract** from the owner wallet (`pause()`). Deposits, new receipts and settlement stop. Viewers can still request withdrawals and withdraw.
- **A bad deploy:** roll back in Vercel (Deployments → Promote an earlier one).
- **The settler key leaks:** move its USDC out, put a new key in `SETTLER_PRIVATE_KEY` and redeploy. It can't touch user funds or settings.

## Bringing the review worker back

When there's a machine that stays on (a small VPS with ffmpeg):

1. Set a new `REVIEW_WORKER_SECRET` and `CONTENT_REVIEW=on` in the mainnet project, then redeploy.
2. Start `python worker/review_worker.py` on that machine with the mainnet site address and secret.
3. Existing videos are transcribed and packaged for encrypted streaming as the worker catches up.
4. Paid agent transcripts can follow once Circle Gateway supports nanopayments on Arc mainnet: `NEXT_PUBLIC_AGENT_API=on` plus a new `AGENT_PRIVATE_KEY`.
