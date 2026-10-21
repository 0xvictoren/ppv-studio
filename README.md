# PayPerWatch

**Pay only for what you watch.** Movies, tutorials and exclusive videos you pay for by the second in USDC on
Arc. Creators upload, choose a category and set a price per hour. Viewers connect their own wallet, deposit once and
watch with no popups. Receipts are settled on-chain every hour, and any site can embed it with one line.

Runs on **Arc Testnet** against the deployed contract
[`0xfff2…93e7`](https://explorer.testnet.arc.io/address/0xfff200a3921d18ae09616901a1aaf9434ce693e7) (v3).

## Run it for real people (self-hosted, no third-party accounts)

```bash
npm install
cp .env.example .env.local      # then fill in SESSION_SECRET, CRON_SECRET, SETTLER_PRIVATE_KEY
npm run build && npm start      # http://localhost:3000
```

- Videos are stored on disk in `./data/uploads` and metadata in `./data/ppw-db.json`. Back up `./data`.
- The server settles receipts at the top of every hour (`instrumentation.ts`). The settler wallet needs a little
  test USDC for gas: get it at https://faucet.circle.com (Arc Testnet).
- Each person needs a browser wallet (MetaMask, Rabby, Coinbase Wallet) and test USDC from the same faucet. The app
  adds Arc Testnet to the wallet automatically.
- To let others in, put the server behind a public https URL (a VPS or a tunnel) and set `NEXT_PUBLIC_APP_URL` to
  it. Sign-in checks the domain, and https enables sign-in inside embeds.
- Optional: `npm run seed` publishes 3 Creative Commons films from `SEED_CREATOR_PRIVATE_KEY`, so the catalog isn't
  empty on day one.

Checks (no funds needed): `npx tsx scripts/smoke-testnet.ts http://localhost:3000` (23 checks: pages, framing
headers, Arc reads, SIWE, upload and ranged playback, on-chain verification and rejection paths) and
`npx tsx scripts/check-eip712.ts` (frontend receipt digest equals the contract's `hashReceipt()`).

## Deploying on Vercel (MongoDB Atlas + Cloudflare R2)

Vercel functions can't keep files, so metadata goes to **MongoDB Atlas** and videos to **Cloudflare R2**. Browsers
upload straight to R2 through signed links, which avoids Vercel's ~4.5 MB request limit, and play through
short-lived signed links.

**1. MongoDB Atlas (free M0)**
1. Create a free cluster at cloud.mongodb.com.
2. *Database Access*: add a user with a password. *Network Access*: allow `0.0.0.0/0`, since Vercel has no fixed IPs.
3. *Connect → Drivers*: copy the connection string into `MONGODB_URI` (put your password in it). `MONGODB_DB=payperwatch`.
   Collections and indexes are created automatically on first use.

**2. Cloudflare R2**
1. dash.cloudflare.com → *R2*: create a bucket such as `payperwatch-videos` and leave it private.
2. *R2 → Manage API tokens*: create a token with **Object Read & Write** on that bucket. Copy the Access Key ID,
   Secret Access Key and your Account ID into `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_ACCOUNT_ID`. Set `R2_BUCKET`.
3. Bucket → *Settings → CORS policy*: paste this, replacing the origins with your URLs:
   ```json
   [{ "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:3000"],
      "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["content-type", "range"],
      "ExposeHeaders": ["content-length", "content-range", "etag"], "MaxAgeSeconds": 3600 }]
   ```

**3. Vercel**
1. Import the repo, with the project root set to `web`.
2. Environment variables: everything from `.env.local` (`NEXT_PUBLIC_ARC_*`, `NEXT_PUBLIC_PPW_*`,
   `SESSION_SECRET`, `CRON_SECRET`, `SETTLER_PRIVATE_KEY`), plus `MONGODB_URI`, `MONGODB_DB`, `R2_*`,
   `NEXT_PUBLIC_STORAGE_PROVIDER=r2` and `NEXT_PUBLIC_APP_URL=https://YOUR-APP.vercel.app`.
3. Deploy. If the URL changes, update `NEXT_PUBLIC_APP_URL` and redeploy, because it's baked in at build time.

**4. Hourly payouts.** Vercel Hobby only allows daily cron jobs (`vercel.json`). Milestone settlements
(10/25/50/75/100%) happen on their own while people watch. For the hourly sweep, create a free job at cron-job.org:
`GET https://YOUR-APP.vercel.app/api/cron/settle`, every hour, with header `Authorization: Bearer <CRON_SECRET>`.

**5. Move this PC's videos and data up (once):** with the Atlas and R2 values in `.env.local`, run
`npx tsx scripts/migrate-to-cloud.ts` (dry run) and then `--apply`. It uploads `data/uploads` to R2, copies all
metadata to Atlas, and leaves the local `data/` folder untouched.

Checks: `npx tsx --conditions=react-server scripts/test-r2.ts` (with the `R2_*` env set) exercises signed upload,
ranged playback and the unsigned-read refusal against your real bucket.

## Embedding on another platform

```html
<script src="https://YOUR-HOST/embed.js" data-ppw="catalog" async></script>
```

| What | Markup |
|---|---|
| One video | `<div data-ppw="video" data-video="0x…videoId"></div>` |
| Catalog (optionally one category or creator) | `<div data-ppw="catalog" data-category="tutorials" data-creator="0x…"></div>` |
| Upload flow | `<div data-ppw="upload"></div>` |
| No script | `<iframe src="https://YOUR-HOST/embed/watch/0x…">` |

The embed is an auto-resizing iframe (`/embed/*` may be framed by any site, the rest of the app may not).
Viewers connect their own wallet inside it. The `/developers` page has copyable snippets and a live preview,
and every video in the creator dashboard has a "copy embed code" button.

## Ratings (watch-based)

There are no like buttons. A video is rated by how people actually watch it (`lib/server/rating.ts`):
- Each paying viewer scores 1 to 5 from their total watch time *t* on a video of length *D*:
  `1 + 3·min(1, t/D) + min(1, (t/D − 1)/2)`. Sampling it scores about 1, watching to the end 4, and coming back for
  two more full watches 5.
- The video's rating is a Bayesian average with a prior of 3.0 weighted as 3 viewers, so one fan can't make it 5 stars.
- Only **paid** watch time counts. Each receipt can credit a session with at most the seconds it actually paid for,
  so farming a rating with throwaway wallets costs real watch money. Browse can sort by "Top rated".

## Referrals ("Share and earn", 5%)

Creators choose per video, at upload or later in the dashboard, whether viewers can earn for sharing it (off by
default). When it's on, a signed-in viewer who has watched the video can open **Share and earn** to get a link:
`/watch/<id>?ref=<their wallet>`. Anyone who watches through it is attributed to them for that video (first link wins,
for 30 days). At settlement the **contract** pays the referrer 5% (`referralBps`, owner-adjustable up to 10%) of that
viewer's spend, taken from the creator's share. The viewer's price and the 5% platform fee don't change. With sharing
off, the server refuses referral receipts for that video. (A viewer colluding with a sharer could still sign one and
submit it to the contract directly; the rate is enforced on-chain, the per-video opt-out by the platform.)

Rules enforced on-chain (contract v3): the referrer can't be the viewer or the creator, and must already have paid that
creator, which stops free self-referral with a fresh wallet. Settlement runs unreferred receipts first so a referrer's
own payment lands before receipts that depend on it. Earnings show under **Wallet → Referral earnings**.
Platforms can pass their wallet as the referrer in embeds with `data-ref="0x…"`.

## Categories

Movies, Tutorials, Exclusive (members-style gated content) and Other. Categories are metadata; every video is
gated the same way, by pay-per-second on-chain.

## Design

The design follows Apple's HIG: clarity, deference to content and quiet depth. It uses SF Pro (Text for UI,
Display for large type), with one cream hue for the primary and a caramel secondary derived from it. Light and dark
themes share the same primary, and colours cross-fade between themes. Motion is limited to opacity and transform, and
fixed heights keep loading states from shifting the layout. Icons come from Radix. The landing photos are from
Unsplash, hotlinked and credited per the Unsplash API guidelines (see `lib/unsplash.ts`).

**Font licence:** SF Pro is licensed by Apple for use in mockups of Apple-platform software. Before a public launch,
confirm you may serve it on the web, or switch `app/layout.tsx` to the system stack. `-apple-system` is already the
first fallback, so Apple devices render the system SF Pro regardless.

## How the money works

| Piece | Where |
|---|---|
| Contract address, ABI, EIP-712 domain and types, `videoId` | `lib/contract.ts`, `lib/abi/PayPerWatch.ts` |
| USDC math (bigint base units, never floats) | `lib/money.ts` |
| Metering and receipt signing | `lib/client/meter.ts` |
| Session keys (browser, per viewer, spend-capped) | `lib/client/session-key.ts` |
| Receipt verification (signer, on-chain session key, monotonic) | `app/api/receipts/route.ts` |
| Hourly settlement | `lib/server/settle.ts`, `app/api/cron/settle`, `instrumentation.ts` |
| Storage (local disk, Supabase, Livepeer, Pinata) | `app/api/storage/*`, `app/media/[file]`, `lib/storage/client.ts` |

**Billing rules** (`lib/progress.ts`, `lib/client/meter.ts`, `lib/server/progress.ts`):
- Each second of a video is paid for once per 30-day window (a per-viewer bitmap). Resume after a break and billing
  starts at the first unwatched second; rewatching paid parts is free. 2× speed pays for content, not wall time.
- Watching ≥97% grants a free-replay pass until 30 days after first starting the video.
- Billing happens only while the video plays (not paused, seeking or buffering). Nothing is ever paused automatically:
  not on tab switches, not during long sessions. The only automatic stop is an empty balance.
- Receipts are posted every 60 paid seconds, on pause and on exit (`sendBeacon`), and the server settles on-chain as
  soon as paid progress crosses 10%, 25%, 50%, 75% and 100%, plus an hourly sweep.
- Each receipt can unlock at most as many new paid seconds as its amount covers, so the bitmap can't be inflated.
- **Downloads** (`/api/downloads`, `/library`): pay the unpaid remainder of the full price, settled on-chain before
  release, then the video is saved in the browser (IndexedDB) for in-app offline playback with a 30-day pass.
  Re-downloads within the pass are free. Local uploads stream only via short-lived viewer-bound tokens, and the player
  hides the browser's download control. Determined users can still capture a stream; real protection needs DRM.

**Moving to a new contract:** stop the server, run `npx tsx scripts/migrate-contract.ts <old address>` (archives old
receipts to `data/archive/`, keeps videos, progress and passes), set the new address and add the old one to
`NEXT_PUBLIC_PPW_LEGACY_CONTRACTS`. Creators re-publish from the dashboard; viewers withdraw old balances from Wallet.

## Known limitations

- View counts and minutes watched are reported by the client and used for analytics only. Money is governed by signed receipts and on-chain caps.
- The file store suits a single server. Use Supabase to run more than one instance.
- Events are scanned from the RPC in 10k-block chunks with a short cache. A long-lived deployment should use an indexer.
- Owner and fee recipient are the settler wallet in `.env.local` (`0x85a5…8c98`). Use a separate, hardware-held owner before mainnet.
- `NEXT_PUBLIC_MOCK_MODE=true` (a simulated chain) exists only for `scripts/e2e-mock.ts`.
