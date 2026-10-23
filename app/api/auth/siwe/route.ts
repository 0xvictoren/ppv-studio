import { verifyMessage, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { env, isMock } from "@/lib/env";
import { publicClient } from "@/lib/server/chain";
import { error, json } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET: issue a fresh nonce for the SIWE message. */
export async function GET() {
  const session = await getSession();
  session.nonce = generateSiweNonce();
  await session.save();
  return json({ nonce: session.nonce });
}

/** POST { message, signature }: verify the SIWE message and start a session. */
export async function POST(req: Request) {
  const { message, signature } = (await req.json()) as { message?: string; signature?: Hex };
  if (!message || !signature) return error("Missing message or signature");

  const session = await getSession();
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !session.nonce || parsed.nonce !== session.nonce) return error("Sign-in expired. Please try again.", 401);
  if (parsed.chainId !== env.chainId) return error("Wrong network. Switch to Arc and try again.", 401);
  const host = req.headers.get("host");
  if (host && parsed.domain !== host) return error("Sign-in message was for a different site.", 401);
  if (parsed.expirationTime && parsed.expirationTime.getTime() < Date.now()) return error("Sign-in expired. Please try again.", 401);

  // Real mode verifies onchain too, so smart-contract wallets (EIP-1271) work.
  const valid = isMock
    ? await verifyMessage({ address: parsed.address, message, signature })
    : await publicClient.verifySiweMessage({ message, signature, nonce: session.nonce });
  if (!valid) return error("Signature didn't match this wallet.", 401);

  session.address = parsed.address.toLowerCase();
  session.chainId = parsed.chainId;
  session.nonce = undefined;
  await session.save();
  return json({ address: session.address });
}

/** DELETE: sign out. */
export async function DELETE() {
  const session = await getSession();
  session.destroy();
  return json({ ok: true });
}
