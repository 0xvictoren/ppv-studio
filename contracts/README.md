# Contracts (reference copy)

Snapshot of the deployed PayPerWatch contract (v3 on Arc Testnet). The Foundry project it was
built from (tests, `out/`, `foundry.toml`) lives in git history under `contract/` (commit a2148d9).

- `src/PayPerWatch.sol` — contract source (v3)
- `abi/PayPerWatch.json` — ABI; the app imports the identical copy in `lib/abi/PayPerWatch.ts`
- `deployments.json` — addresses and deploy txs on Arc Testnet (v3 current, v1/v2 legacy)
- `script/` — Foundry deploy scripts
- `HANDOFF.md`, `CONTRACT_README.md` — EIP-712 domain, receipt types, function notes

The app reads the live address from `NEXT_PUBLIC_PPW_CONTRACT` (and legacy ones from
`NEXT_PUBLIC_PPW_LEGACY_CONTRACTS`), so set those in Vercel → Project → Environment Variables.
