# PayPerWatch

Never pay for time you didn't watch: pay-per-second video streaming in USDC on Arc.

| Folder | What | Built by |
|---|---|---|
| `contract/` | `PayPerWatch.sol` v3 (referrals, configurable rate), Foundry tests (66), deploy script, ABI, `HANDOFF.md`, `CONTRACT_README.md`, standalone `scripts/settler.ts` | Arc Studio (session `ppw`) |
| `arc-demo/` | Vite + React on-chain demo console that exercises every contract path on testnet | Arc Studio |
| `web/` | Production Next.js 14 app on Arc Testnet: real wallets, uploads with categories and pricing, metering, hourly settlement, one-line embeds | Claude Code |

**Arc Testnet deployment (v3):** [`0xfff200a3921d18ae09616901a1aaf9434ce693e7`](https://explorer.testnet.arc.io/address/0xfff200a3921d18ae09616901a1aaf9434ce693e7)
(chain 5042002, block 68357629, deploy tx `0xc0c42b94…05f8`, platform fee 5%, referral 5% owner-adjustable). Owner and fee recipient: `0x85a5…8c98` (key in `web/.env.local`).
v1 (`0x5ce5…d51d`) and v2 (`0xdde5…c89b`) are retired. Arc Studio workspace: https://studio.arc.io/app/7b7bbfcb-5458-4232-adff-9c9d0deb895f

Start with `web/README.md`.

> Contract tests: 66/66 pass locally (`cd contract && forge test`), and the deployed bytecode matches the tested source byte-for-byte.
