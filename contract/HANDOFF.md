# PayPerWatch — Contract Hand-off

## Deployed Contracts

### v3 (CURRENT — use this)
| Field | Value |
|---|---|
| **Contract address** | `0xfff200a3921d18ae09616901a1aaf9434ce693e7` |
| **Network** | Arc Testnet |
| **Chain ID** | `5042002` |
| **Deploy tx hash** | `0xc0c42b940b43a07e2ceec70f9a5ea549c057a47312d9d157e28189059afb05f8` |
| **Explorer** | https://explorer.testnet.arc.io/address/0xfff200a3921d18ae09616901a1aaf9434ce693e7 |
| **feeBps at deploy** | `500` (5%) |
| **referralBps at deploy** | `500` (5% default, owner-adjustable 0–10% via `setReferralBps`) |
| **feeRecipient / owner** | `0x85a5f7C46C86DD219757ec381dfDf2bB72Fa8c98` |

### v2 (superseded)
| Field | Value |
|---|---|
| **Contract address** | `0xdde5bd885455291429ae262a06d1aabaddf1c89b` |
| **Deploy tx hash** | `0x76e3077c2788f5f0f169ba5f7efabc9f534fda96cb722807b400dde454f33a35` |

### v1 (superseded)
| Field | Value |
|---|---|
| **Contract address** | `0x5ce5d5b34a09a0406b4b9c2e9da7ffafb006d51d` |
| **Deploy tx hash** | `0x1d7bee340f88fd0173d222536c0f81a020bb625adc9b6224feadd3bff87f043d` |

---

## Chain Constants

### Arc Testnet (chain 5042002)
| Field | Value |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | `6` |
| Native gas decimals | `18` (Arc's native IS USDC; use 6-decimal ERC-20 for all USDC math) |

### Arc Mainnet (chain 5042)
| Field | Value |
|---|---|
| Chain ID | `5042` |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | `6` |
| Native gas decimals | `18` |

---

## EIP-712 Domain (v3)

```typescript
const domain = {
  name: "PayPerWatch",
  version: "3",                                               // bumped from v2
  chainId: 5042002,                                          // 5042 for mainnet
  verifyingContract: "0xfff200a3921d18ae09616901a1aaf9434ce693e7",
} as const;
```

---

## Receipt Type (v3 — includes referrer)

```typescript
const types = {
  Receipt: [
    { name: "viewer",           type: "address" },
    { name: "creator",          type: "address" },
    { name: "referrer",         type: "address" },   // NEW in v2; use address(0) for no referrer
    { name: "cumulativeAmount", type: "uint256" },
    { name: "deadline",         type: "uint64"  },
  ],
} as const;
```

Full viem example:

```typescript
import { signTypedData } from "viem/accounts";

const signature = await walletClient.signTypedData({
  domain: {
    name: "PayPerWatch",
    version: "3",
    chainId: 5042002n,
    verifyingContract: "0xfff200a3921d18ae09616901a1aaf9434ce693e7",
  },
  types: {
    Receipt: [
      { name: "viewer",           type: "address" },
      { name: "creator",          type: "address" },
      { name: "referrer",         type: "address" },
      { name: "cumulativeAmount", type: "uint256" },
      { name: "deadline",         type: "uint64"  },
    ],
  },
  primaryType: "Receipt",
  message: {
    viewer:           "0x...",
    creator:          "0x...",
    referrer:         "0x0000000000000000000000000000000000000000", // or a referrer address
    cumulativeAmount: 500000n,   // USDC 6-decimal base units
    deadline:         BigInt(Math.floor(Date.now() / 1000) + 3600),
  },
});
```

> **Lane keying:** receipts are cumulative per `(viewer, creator, referrer)` — each distinct `referrer` value is a separate lane tracked by `settled[viewer][creator][referrer]`. The referrer in a signed receipt is bound to that signature; only the viewer (or their authorized session key) can create a receipt for a given lane.

---

## Key Storage Getters (v3)

```solidity
// Cumulative settled for a specific (viewer, creator, referrer) lane
settled(address viewer, address creator, address referrer) returns (uint256)

// Total settled by viewer to creator across ALL referrer lanes
paidTo(address viewer, address creator) returns (uint256)

// Referral rate — owner-adjustable, 0–10%; default 5%
referralBps() returns (uint16)         // 500 at deploy (5%)
MAX_REFERRAL_BPS() returns (uint16)    // 1000 (ceiling, constant)
setReferralBps(uint16 bps)             // onlyOwner; reverts ReferralTooHigh if bps > 1000

// Platform fee — configurable by owner (max 10%)
feeBps() returns (uint16)              // 500 at deploy (5%)
```

---

## Settlement Split (per actualDelta)

```
fee             = actualDelta * feeBps / 10_000
referralAmount  = validReferral ? actualDelta * referralBps / 10_000 : 0
creatorAmount   = actualDelta - fee - referralAmount
```

`referralBps` defaults to 500 (5%) and is owner-adjustable from 0 to 1000.

Referral is **valid** iff:
- `referrer != address(0)`
- `referrer != viewer`
- `referrer != creator`
- `paidTo[referrer][creator] > 0` (referrer has previously paid this creator)

An invalid referrer silently reduces `referralAmount` to 0 — the receipt still settles and creator receives the extra share.

---

## USDC Amounts

USDC uses **6 decimals**. All contract values are in base units:

| Human amount | Base units |
|---|---|
| $0.50 / hr | `500_000` |
| $1.00 / hr | `1_000_000` |
| $2.00 / hr | `2_000_000` |
| $100.00 / hr (max price) | `100_000_000` |

Cost per second in base units: `pricePerHour / 3600` (integer truncation).

---

## ABI

See `abi/PayPerWatch.json`.

## Settler Script

See `scripts/settler.ts`.
