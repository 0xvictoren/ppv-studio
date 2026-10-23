import "server-only";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { sessionSecret } from "./secret";

export type SessionData = { nonce?: string; address?: string; chainId?: number };

// Over https the cookie is SameSite=None so sign-in also works inside embeds on other sites.
// Cross-site requests are refused by middleware.ts, so that cookie can't be ridden from elsewhere.
const https = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
const options = (): SessionOptions => ({
  cookieName: "ppw_session",
  password: sessionSecret(),
  cookieOptions: { secure: https, sameSite: https ? "none" : "lax", httpOnly: true, path: "/" },
});

export function getSession() {
  return getIronSession<SessionData>(cookies(), options());
}

/** The signed-in wallet (lowercase), or null. */
export async function sessionAddress(): Promise<string | null> {
  const s = await getSession();
  return s.address?.toLowerCase() ?? null;
}
