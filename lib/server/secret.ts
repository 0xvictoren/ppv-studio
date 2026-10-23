import "server-only";

const DEV_SECRET = "dev-only-insecure-session-secret-change-me-please";

/**
 * Key for session cookies and signed links (streams, downloads, uploads). The dev fallback is
 * public, so anyone could forge those with it: production refuses to run without a real one.
 */
export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_MOCK_MODE !== "true") {
    throw new Error("SESSION_SECRET must be set to 32+ random characters in production.");
  }
  return DEV_SECRET;
}
