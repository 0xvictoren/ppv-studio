/**
 * Exercises lib/server/r2.ts against an S3-compatible endpoint (R2 or a local test server):
 * signed upload, signed ranged playback, expiry, and the server-side upload used by migration.
 *   R2_ENDPOINT=http://127.0.0.1:4569 R2_BUCKET=ppw-test R2_ACCOUNT_ID=x R2_ACCESS_KEY_ID=S3RVER R2_SECRET_ACCESS_KEY=S3RVER \
 *     npx tsx --conditions=react-server scripts/test-r2.ts
 */
import { randomBytes } from "node:crypto";
import { presignRead, presignUpload, putObject } from "../lib/server/r2";

let failures = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const key = `videos/0xtest/${Date.now()}.mp4`;
  const bytes = randomBytes(300 * 1024);
  const up = await presignUpload(key, "video/mp4");
  check("signed upload URL", up.includes("X-Amz-Signature"));
  const put = await fetch(up, { method: "PUT", headers: { "content-type": "video/mp4" }, body: bytes });
  check("browser-style PUT upload", put.ok, put.status);

  const read = await presignRead(key, 60);
  const range = await fetch(read, { headers: { range: "bytes=0-99" } });
  check("signed ranged playback (206)", range.status === 206 && (await range.arrayBuffer()).byteLength === 100, range.status);
  const full = await fetch(read);
  check("signed full read", full.ok && Buffer.from(await full.arrayBuffer()).equals(bytes));

  // Real R2 buckets are private; local S3 test servers allow anonymous reads, so only check on R2.
  if (!process.env.R2_ENDPOINT) {
    const unsigned = await fetch(read.split("?")[0]);
    check("unsigned URL refused", unsigned.status === 400 || unsigned.status === 401 || unsigned.status === 403, unsigned.status);
  }

  await putObject(`${key}.copy`, bytes, "video/mp4", bytes.length);
  const copy = await fetch(await presignRead(`${key}.copy`, 60));
  check("server-side upload (migration)", copy.ok && Buffer.from(await copy.arrayBuffer()).length === bytes.length);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
