# Contracts (reference copy)

Snapshot of the deployed PayPerWatch contract, **v4, live on Arc mainnet** at
[`0xb5AEE9b6421fdDAe63F31E5A7B2E4E4B54A51eF4`](https://explorer.arc.io/address/0xb5AEE9b6421fdDAe63F31E5A7B2E4E4B54A51eF4)
(chain 5042, deploy block 27732474). The same v4 source runs on Arc Testnet at `0x9da4403e212804081cd0d5bab0ea9d0bcc3d96e1`.
The Foundry project it was first built from (tests, `out/`, `foundry.toml`) lives in git history under `contract/` (commit a2148d9).

- `src/PayPerWatch.sol` — contract source (v4)
- `artifacts/PayPerWatch.json` — Arc Studio's audited build, which `scripts/deploy-mainnet.ts` deployed (it checks the source hash first)
- `abi/PayPerWatch.json` — ABI; the app imports the identical copy in `lib/abi/PayPerWatch.ts`
- `deployments.json` — addresses and deploy txs for Arc mainnet (v4) and Arc Testnet (v4 current, v1–v3 legacy). The app reads its default contract from here
- `docs/security-review-v4.md` — Arc Studio's security review of v4
- `script/` — Foundry deploy scripts
- `HANDOFF.md`, `CONTRACT_README.md` — EIP-712 domain, receipt types, function notes

`NEXT_PUBLIC_PPW_CONTRACT` (and `NEXT_PUBLIC_PPW_LEGACY_CONTRACTS`) override the address from `deployments.json`;
set them in Vercel → Project → Environment Variables.
