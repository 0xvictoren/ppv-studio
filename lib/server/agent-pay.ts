import "server-only";
import { createGatewayMiddleware, type GatewayMiddleware } from "@circle-fin/x402-batching/server";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eip712Domain, receiptTypes, ZERO_ADDRESS } from "../contract";
import { isTestnet } from "../env";
import { costForSeconds, toDecimal } from "../money";
import { addAgentPurchase, agentTotalForCreator } from "./content-db";
import { upsertReceipt, type VideoRow } from "./db";
import { requestMilestoneSettlement } from "./settle";

// Paid agent access (x402 via Circle Gateway Nanopayments).
// Agents pay the platform's agent account (AGENT_PRIVATE_KEY) in USDC through Gateway. The same
// account then acts as a "viewer" on PayPerWatch: it signs a cumulative receipt to the video's
// creator, which the normal settlement pays out from its contract balance, minus the platform fee.
// Keep that account's PayPerWatch balance topped up from its Gateway earnings (scripts/agent-wallet.ts).

/** Smallest charge, in USDC base units ($0.0001). */
const MIN_PRICE = 100n;
/** Agent receipts stay valid for a year; each purchase re-signs a higher cumulative amount. */
const RECEIPT_TTL_S = 365n * 24n * 60n * 60n;

export function agentAccount() {
  const pk = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  return pk ? privateKeyToAccount(pk) : null;
}

/** A transcript costs what a person pays to watch the whole video. */
export function transcriptPrice(video: Pick<VideoRow, "price_per_hour" | "duration_seconds">): bigint {
  const full = costForSeconds(BigInt(video.price_per_hour), video.duration_seconds);
  return full > MIN_PRICE ? full : MIN_PRICE;
}

const g = globalThis as unknown as { __ppwGateway?: GatewayMiddleware };

function gateway(seller: Address): GatewayMiddleware {
  g.__ppwGateway ??= createGatewayMiddleware({
    sellerAddress: seller,
    facilitatorUrl: process.env.GATEWAY_FACILITATOR_URL || (isTestnet ? "https://gateway-api-testnet.circle.com" : "https://gateway-api.circle.com"),
    description: "PayPerWatch video transcript",
  });
  return g.__ppwGateway;
}

export type Payment = { payer: string; amount: string; network: string; transaction?: string };

/**
 * Run the Gateway x402 middleware (written for Express) against a fetch Request.
 * Returns the payment once it has been verified and settled, or the 402/error response to send.
 * The payment is taken before this returns, so check the resource exists first.
 */
export async function requirePayment(req: Request, amount: bigint): Promise<{ payment: Payment; headers: Record<string, string> } | { response: Response }> {
  const account = agentAccount();
  if (!account) return { response: Response.json({ error: "Agent payments aren't set up on this server (AGENT_PRIVATE_KEY)." }, { status: 503 }) };

  const url = new URL(req.url);
  const fakeReq: { headers: Record<string, string>; url: string; method: string; payment?: Payment } = {
    headers: Object.fromEntries([...req.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])),
    url: url.pathname + url.search,
    method: req.method,
  };
  const out = { statusCode: 200, headers: {} as Record<string, string>, body: "" };
  const fakeRes = {
    get statusCode() {
      return out.statusCode;
    },
    set statusCode(v: number) {
      out.statusCode = v;
    },
    setHeader: (k: string, v: string) => void (out.headers[k] = String(v)),
    end: (b?: string) => void (out.body = b ?? ""),
  };
  let passed = false;
  await gateway(account.address).require(`$${toDecimal(amount, 6)}`)(fakeReq as never, fakeRes as never, () => {
    passed = true;
  });
  if (!passed || !fakeReq.payment) return { response: new Response(out.body || "{}", { status: out.statusCode === 200 ? 402 : out.statusCode, headers: out.headers }) };
  return { payment: fakeReq.payment, headers: out.headers };
}

/** Record an agent purchase and owe the creator through a signed receipt from the agent account. */
export async function creditCreator(video: VideoRow, payment: Payment, purchaseId: string): Promise<void> {
  const account = agentAccount()!;
  await addAgentPurchase({
    id: purchaseId,
    video_id: video.id,
    creator: video.creator,
    payer: payment.payer,
    amount: payment.amount,
    network: payment.network,
    transaction: payment.transaction ?? null,
  });
  // Cumulative over every purchase from this creator, so concurrent purchases converge on the total.
  const cumulative = await agentTotalForCreator(video.creator);
  const receipt = {
    viewer: account.address,
    creator: getAddress(video.creator),
    referrer: ZERO_ADDRESS,
    cumulativeAmount: cumulative,
    deadline: BigInt(Math.floor(Date.now() / 1000)) + RECEIPT_TTL_S,
  };
  const signature = await account.signTypedData({ domain: eip712Domain, types: receiptTypes, primaryType: "Receipt", message: receipt });
  await upsertReceipt({
    viewer: receipt.viewer,
    creator: receipt.creator,
    referrer: receipt.referrer,
    cumulative_amount: cumulative.toString(),
    deadline: receipt.deadline.toString(),
    signature,
    signer: account.address,
  });
  requestMilestoneSettlement({ viewer: receipt.viewer, creator: receipt.creator, referrer: receipt.referrer });
}
