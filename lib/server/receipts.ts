import "server-only";
import { getAddress, isAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { eip712Domain, receiptTypes, ZERO_ADDRESS, type Receipt } from "../contract";
import { isMock } from "../env";
import { isActiveSessionKey, publicClient, readPpw } from "./chain";
import { getReceipt, getVideo, upsertReceipt } from "./db";

export type RawReceipt = { viewer: string; creator: string; referrer?: string; cumulativeAmount: string; deadline: string };

export class ReceiptError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Verify a signed EIP-712 receipt and store it if it raises the cumulative amount.
 * Signer must be the viewer (EOA or EIP-1271) or an unexpired session key authorized on-chain.
 * Returns the parsed receipt and the cumulative amount that was stored before it.
 */
export async function verifyAndStoreReceipt(
  raw: RawReceipt | undefined,
  signature: Hex | undefined,
  opts: { videoId?: string } = {},
): Promise<{ receipt: Receipt; previous: bigint; signer: Address }> {
  const rawRef = raw?.referrer ?? ZERO_ADDRESS;
  if (!raw || !signature || !isAddress(raw.viewer) || !isAddress(raw.creator) || !isAddress(rawRef)) throw new ReceiptError("Malformed receipt");

  let receipt: Receipt;
  try {
    receipt = {
      viewer: getAddress(raw.viewer),
      creator: getAddress(raw.creator),
      referrer: getAddress(rawRef),
      cumulativeAmount: BigInt(raw.cumulativeAmount),
      deadline: BigInt(raw.deadline),
    };
  } catch {
    throw new ReceiptError("Malformed amounts");
  }
  if (receipt.deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new ReceiptError("Receipt expired");
  if (receipt.cumulativeAmount < 0n) throw new ReceiptError("Negative amount");
  // Referral rewards only where the creator turned on "Share and earn".
  if (receipt.referrer !== ZERO_ADDRESS && opts.videoId) {
    const video = await getVideo(opts.videoId);
    if (video && !video.referrals_enabled) throw new ReceiptError("The creator hasn't turned on Share and earn for this video", 422);
  }

  const typed = { domain: eip712Domain, types: receiptTypes, primaryType: "Receipt" as const, message: receipt };
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...typed, signature });
  } catch {
    throw new ReceiptError("Bad signature", 401);
  }
  if (signer !== receipt.viewer) {
    const ok = await isActiveSessionKey(receipt.viewer, signer);
    // Smart-contract wallets sign directly; verify via EIP-1271 on-chain.
    const ok1271 = !ok && !isMock && (await publicClient.verifyTypedData({ ...typed, address: receipt.viewer, signature }).catch(() => false));
    if (!ok && !ok1271) throw new ReceiptError("Signer isn't the viewer or an active session key", 401);
    if (ok1271) signer = receipt.viewer;
  }

  const [stored, settled] = await Promise.all([
    getReceipt(receipt.viewer, receipt.creator, receipt.referrer),
    readPpw<bigint>("settled", [receipt.viewer, receipt.creator, receipt.referrer]),
  ]);
  const previous = stored ? BigInt(stored.cumulative_amount) : 0n;
  if (previous > receipt.cumulativeAmount) throw new ReceiptError("A newer receipt is already stored", 409);
  if (receipt.cumulativeAmount < settled) throw new ReceiptError("Receipt is below the settled amount", 409);

  const accepted = await upsertReceipt({
    viewer: receipt.viewer,
    creator: receipt.creator,
    referrer: receipt.referrer,
    cumulative_amount: receipt.cumulativeAmount.toString(),
    deadline: receipt.deadline.toString(),
    signature,
    signer,
  });
  if (!accepted) throw new ReceiptError("A newer receipt is already stored", 409);
  return { receipt, previous, signer };
}
