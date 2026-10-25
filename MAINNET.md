# Going live on Arc mainnet

This is the checklist for running PayPerWatch with real USDC. Do the steps in order. Nothing here is automatic, and no step should be skipped because the testnet site works.

**How it's set up (decided 2026-10-25):** the `main` branch is mainnet and runs on the existing Vercel project, MongoDB and R2 bucket. The `testnet` branch keeps the testnet version of the code. The current wallet (`0x85a5…8c98`, `SETTLER_PRIVATE_KEY`) is the contract owner, fee recipient and settler. That's simpler, but if the server key ever leaks, the attacker also controls the contract (pause, fees, withdrawal wait). Moving ownership to a hardware wallet later is one `transferOwnership` call plus `acceptOwnership`.

## What's different on mainnet

| | Testnet site | Mainnet site |
|---|---|---|
| Network | Arc Testnet (5042002) | Arc (5042), USDC `0x3600…0000`, 6 decimals |
| Review worker (originality check, transcripts, encrypted streaming) | On | **Off** (`CONTENT_REVIEW=off`) until a worker runs around the clock |
| Paid agent transcripts | On | **Off** (`NEXT_PUBLIC_AGENT_API=off`): Circle Gateway nanopayments aren't on Arc mainnet yet, and there are no transcripts while the worker is off |
| Deposit limit | None | $50 per wallet while soft-launching (`NEXT_PUBLIC_DEPOSIT_CAP_USDC`), enforced in the app |
| Contract owner | `0x85a5…8c98` | The same wallet, by choice (see above) |
| Settlement sweep | Daily (Vercel cron) | Hourly (cron-job.org) |

With the worker off, uploads publish straight away without an originality score, and videos stream as plain files behind short-lived signed links instead of encrypted pieces. A paying viewer could save the file. That's the trade-off until the worker comes back.

## 1. Fund the wallet

Send USDC on the **Arc** network to `0x85a5f7C46C86DD219757ec381dfDf2bB72Fa8c98` (the owner, fee recipient and settler). $10 covers the deploy (about $0.10) and months of settlement gas. Top it up when `/api/health` warns.

## 2. Keys

No new keys. `SETTLER_PRIVATE_KEY` stays as it is. `AGENT_PRIVATE_KEY` and `REVIEW_WORKER_SECRET` aren't used on mainnet while those features are off.

## 3. The contract

1. **Audit.** Arc Studio reviewed v4 with the max preset and fixed what it found (`contracts/docs/security-review-v4.md`, 130 tests). An outside audit is still recommended before deposits grow.
2. **Deploy from your own wallet.** Arc Studio doesn't send mainnet transactions, so the deploy uses Arc Studio's audited build (`contracts/artifacts/PayPerWatch.json`). The script refuses to run if `contracts/src/PayPerWatch.sol` differs from that build:
   ```
   npx tsx scripts/deploy-mainnet.ts            # dry run
   npx tsx scripts/deploy-mainnet.ts --confirm  # deploys, about $0.10 of USDC gas
   ```
   It checks owner, fee recipient, USDC, 5% fee, 24-hour wait and the EIP-712 domain, then writes the address and block to `contracts/deployments.json`. The app reads its default contract from there.
3. Commit `contracts/deployments.json` and push.

## 4. Switch the Vercel project to mainnet

In Vercel → the project → Settings → Environment Variables (Production), set these, and delete the ones marked delete:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_ARC_CHAIN_ID` | `5042` |
| `NEXT_PUBLIC_ARC_RPC` | `https://rpc.mainnet.arc.io` |
| `NEXT_PUBLIC_ARC_EXPLORER` | `https://explorer.arc.io` |
| `NEXT_PUBLIC_PPW_CONTRACT` | the address the deploy script printed |
| `NEXT_PUBLIC_PPW_DEPLOY_BLOCK` | the block the deploy script printed |
| `NEXT_PUBLIC_PPW_LEGACY_CONTRACTS` | `none` |
| `NEXT_PUBLIC_USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` (unchanged) |

Leave everything else (Mongo, R2, secrets) as it is. `CONTENT_REVIEW`, `NEXT_PUBLIC_AGENT_API` and `NEXT_PUBLIC_DEPOSIT_CAP_USDC` default to off, off and $50 on mainnet. Only set them to override.

Then, in order:
1. Push `main` (the mainnet code), and redeploy so the new variables apply.
2. Archive the testnet data in the shared database:
   ```
   npx tsx scripts/migrate-contract.ts 0x9da4403e212804081cd0d5bab0ea9d0bcc3d96e1 --chain-switch
   ```
   This moves testnet receipts, agent purchases, watch progress, watch sessions and settlement history into `*_archive_0x9da4…` collections. Seconds paid with test USDC won't play free on mainnet. Videos, reviews and transcripts stay.
3. Creators re-register their videos on mainnet from the dashboard (**Move all to the new contract**), which costs them a little USDC gas.
4. Check the live site: `npx tsx scripts/mainnet-preflight.ts .env https://ppv-studio.vercel.app` (after updating `.env` to the mainnet values).

## 5. Scheduled jobs and monitoring

- **Hourly settlement.** At cron-job.org, create a job that calls `GET https://ppv-studio.vercel.app/api/cron/settle` every hour with the header `Authorization: Bearer <CRON_SECRET>`. (Vercel's built-in daily job also runs as a backup.)
- **Health alerts.** Point an uptime monitor (UptimeRobot, Better Stack or cron-job.org) at `https://ppv-studio.vercel.app/api/health` every 5–15 minutes with email alerts. It returns 503 when the settler is low on gas, the contract is paused, or no settlement has run for `HEALTH_MAX_SETTLE_HOURS`.

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
