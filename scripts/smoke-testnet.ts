/**
 * Smoke test against a running instance in real (Arc Testnet) mode. Needs no funds:
 * pages, headers, chain reads, SIWE, local upload + range playback, and the server-side
 * verification paths that must reject bad input.
 *   npx tsx scripts/smoke-testnet.ts http://localhost:3000
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { eip712Domain, receiptTypes } from "../lib/contract";

const BASE = process.argv[2] ?? "http://localhost:3000";
let failures = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? `  ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  for (const p of ["/", "/videos", "/upload", "/wallet", "/dashboard", "/about", "/developers", "/embed/browse", "/embed/upload", "/embed.js"]) {
    const r = await fetch(BASE + p);
    check(`GET ${p}`, r.status === 200, r.status);
  }
  const home = await fetch(BASE + "/");
  check("app pages refuse cross-site framing", (home.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'self'"));
  const emb = await fetch(BASE + "/embed/browse");
  check("embed pages allow framing", (emb.headers.get("content-security-policy") ?? "").includes("frame-ancestors *"));
  check("mock chain endpoint disabled", (await fetch(BASE + "/api/mock/contract", { method: "POST", body: "{}" })).status === 404);

  const stats = await (await fetch(BASE + "/api/stats")).json();
  check("stats read from Arc Testnet", typeof stats.totalSettled === "string", stats);
  const status = await (await fetch(BASE + "/api/settlement/status")).json();
  check("settlement status", !!status.nextRunAt, status);

  // SIWE with a fresh (unfunded) wallet: verified via the Arc RPC.
  const acct = privateKeyToAccount(generatePrivateKey());
  const n = await fetch(BASE + "/api/auth/siwe");
  let cookie = n.headers.get("set-cookie")!.split(";")[0];
  const { nonce } = await n.json();
  const message = createSiweMessage({ address: acct.address, chainId: 5042002, domain: new URL(BASE).host, nonce, uri: BASE, version: "1" });
  const login = await fetch(BASE + "/api/auth/siwe", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ message, signature: await acct.signMessage({ message }) }),
  });
  cookie = login.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  check("SIWE sign-in on testnet", login.status === 200, await login.text());

  // Local storage: presign, stream upload, then ranged playback.
  const target = await (await fetch(BASE + "/api/storage/upload", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "clip.mp4", type: "video/mp4" }) })).json();
  check("upload target is local", target.provider === "local", target);
  const bytes = process.argv[3] ? readFileSync(process.argv[3]) : randomBytes(256 * 1024);
  const put = await fetch(BASE + target.uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4", cookie }, body: bytes });
  check("upload streamed to disk", put.status === 200, await put.text());
  const raw = await fetch(BASE + target.playbackUrl, { headers: { range: "bytes=0-99" } });
  check("raw media URL refused without a stream token", raw.status === 403, raw.status);
  const forged = await fetch(BASE + target.playbackUrl + "?t=eyJ4IjoxfQ.forged", { headers: { range: "bytes=0-99" } });
  check("forged stream token refused", forged.status === 403, forged.status);
  const dl = await fetch(BASE + "/api/downloads/file?t=eyJ4IjoxfQ.forged");
  check("forged download token refused", dl.status === 401, dl.status);
  const anon = await fetch(BASE + "/api/storage/upload", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("upload requires sign-in", anon.status === 401);

  // Metadata is only stored after on-chain verification.
  const fake = await fetch(BASE + "/api/videos", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ txHash: "0x1d7bee340f88fd0173d222536c0f81a020bb625adc9b6224feadd3bff87f043d", contentCid: target.contentId, title: "x", playbackUrl: target.playbackUrl, durationSeconds: 1 }),
  });
  check("unregistered video rejected", fake.status === 422, await fake.text());

  // Receipts from a key the viewer never authorized are rejected (on-chain sessionKeys lookup).
  const msg = { viewer: acct.address, creator: privateKeyToAccount(generatePrivateKey()).address, referrer: "0x0000000000000000000000000000000000000000" as const, cumulativeAmount: 1000n, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) };
  const sig = await privateKeyToAccount(generatePrivateKey()).signTypedData({ domain: eip712Domain, types: receiptTypes, primaryType: "Receipt", message: msg });
  const rec = await fetch(BASE + "/api/receipts", {
    method: "POST",
    body: JSON.stringify({ receipt: { ...msg, cumulativeAmount: "1000", deadline: msg.deadline.toString() }, signature: sig }),
  });
  check("receipt from unauthorized key rejected", rec.status === 401, await rec.text());

  check("cron refuses without secret", (await fetch(BASE + "/api/cron/settle")).status === 401);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
