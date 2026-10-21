import "server-only";
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = { nonce?: string; address?: string; chainId?: number };

// Over https the cookie is SameSite=None so sign-in also works inside embeds on other sites.
const https = (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");
const options: SessionOptions = {
  cookieName: "ppw_session",
  password: process.env.SESSION_SECRET ?? "dev-only-insecure-session-secret-change-me-please",
  cookieOptions: { secure: https, sameSite: https ? "none" : "lax", httpOnly: true, path: "/" },
};

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.warn("[ppw] SESSION_SECRET is not set; sessions use an insecure default.");
}

export function getSession() {
  return getIronSession<SessionData>(cookies(), options);
}

/** The signed-in wallet (lowercase), or null. */
export async function sessionAddress(): Promise<string | null> {
  const s = await getSession();
  return s.address?.toLowerCase() ?? null;
}
