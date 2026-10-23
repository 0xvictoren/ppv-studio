import { NextResponse, type NextRequest } from "next/server";

// The session cookie is SameSite=None (so sign-in works inside embeds), which means other sites
// could otherwise make a signed-in visitor's browser call our API. Browsers label every
// cross-site POST/PUT/PATCH/DELETE (fetch, forms, sendBeacon) with Origin / Sec-Fetch-Site, so
// refuse those. Our own pages and embeds are same-origin; cron and the review worker are
// server-to-server and send neither header; agents only GET.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const appOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin;
  } catch {
    return null;
  }
})();

export function middleware(req: NextRequest) {
  if (SAFE.has(req.method)) return NextResponse.next();
  const origin = req.headers.get("origin");
  const fromOtherSite = req.headers.get("sec-fetch-site") === "cross-site" || (!!origin && origin !== req.nextUrl.origin && origin !== appOrigin);
  if (fromOtherSite) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
