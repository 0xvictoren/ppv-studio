/**
 * End-to-end check of the money flow against a running app in mock mode.
 *   NEXT_PUBLIC_MOCK_MODE=true NEXT_DIST_DIR=.next-mock npx next build
 *   NEXT_PUBLIC_MOCK_MODE=true NEXT_DIST_DIR=.next-mock PPW_DATA_DIR=.mock-data CRON_SECRET= npx next start -p 3100
 *   npx tsx scripts/e2e-mock.ts http://localhost:3100
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { eip712Domain, receiptTypes, ZERO_ADDRESS } from "../lib/contract";
import { costForSeconds } from "../lib/money";
import { emptyBitmap, fullBitmap, setBit, toBase64 } from "../lib/progress";
import { DEMO_ACCOUNTS } from "../lib/samples";
import { viewerAuthMessage } from "../lib/viewer-auth";

const BASE = process.argv[2] ?? "http://localhost:3100";
const FEE_BPS = 500n;
const viewer = privateKeyToAccount(DEMO_ACCOUNTS[0].privateKey);
const creator = privateKeyToAccount(DEMO_ACCOUNTS[2].privateKey);
let failures = 0;
const check = (name: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
  if (!ok) failures++;
};
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chain(op: string, fn: string, args: unknown[], from?: string) {
  const r = await fetch(`${BASE}/api/mock/contract`, { method: "POST", headers: { "content-type": "application/json" }, body: j({ op, fn, args, from }) });
  return r.json();
}
const read = async (fn: string, args: unknown[]) => (await chain("read", fn, args)).result;

async function signReceipt(pk: `0x${string}`, cumulative: bigint, who = viewer.address, referrer: `0x${string}` = ZERO_ADDRESS) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const message = { viewer: who, creator: creator.address, referrer, cumulativeAmount: cumulative, deadline };
  const signature = await privateKeyToAccount(pk).signTypedData({ domain: eip712Domain, types: receiptTypes, primaryType: "Receipt", message });
  return { receipt: { ...message, cumulativeAmount: cumulative.toString(), deadline: deadline.toString() }, signature };
}
async function post(body: unknown) {
  const r = await fetch(`${BASE}/api/receipts`, { method: "POST", headers: { "content-type": "text/plain" }, body: j(body) });
  return { status: r.status, body: await r.json() };
}
const bits = (duration: number, from: number, to: number) => {
  const b = emptyBitmap(duration);
  for (let i = from; i < Math.min(to, duration); i++) setBit(b, i);
  return toBase64(b);
};
async function auth(who: string, keyPk: `0x${string}`) {
  const ts = Math.floor(Date.now() / 1000);
  return { "x-ppw-auth": `${ts}.${await privateKeyToAccount(keyPk).signMessage({ message: viewerAuthMessage(who, ts) })}` };
}
async function progressOf(who: string, keyPk: `0x${string}`, videoId: string) {
  const r = await fetch(`${BASE}/api/progress?viewer=${who}&videoId=${videoId}`, { headers: await auth(who, keyPk) });
  return (await r.json()).progress;
}
const settledOf = async (v: string, r: string = ZERO_ADDRESS) => BigInt(await read("settled", [v, creator.address, r]));

async function main() {
  const { videos } = await (await fetch(`${BASE}/api/videos`)).json();
  check("3 seeded videos", videos.length >= 3, videos.length);
  const byTitle = (t: string) => videos.find((v: { title: string }) => v.title === t);
  const bunny = byTitle("Big Buck Bunny"); // 596s @ $0.50/hr
  const sintel = byTitle("Sintel"); // 888s @ $1/hr
  const tears = byTitle("Tears of Steel"); // 734s @ $2/hr
  const [vc, vprice, vactive] = await read("videos", [bunny.id]);
  check("video registered on mock chain", vc.toLowerCase() === creator.address.toLowerCase() && vprice === "500000" && vactive === true);
  check("fee is 5%", BigInt(await read("feeBps", [])) === FEE_BPS);

  // SIWE
  const nonceRes = await fetch(`${BASE}/api/auth/siwe`);
  const cookie = nonceRes.headers.get("set-cookie")!.split(";")[0];
  const { nonce } = await nonceRes.json();
  const message = createSiweMessage({ address: viewer.address, chainId: 5042002, domain: new URL(BASE).host, nonce, uri: BASE, version: "1" });
  const siwe = await fetch(`${BASE}/api/auth/siwe`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ message, signature: await viewer.signMessage({ message }) }) });
  const siweCookie = siwe.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: siweCookie } })).json();
  check("SIWE sign-in", siwe.status === 200 && me.address === viewer.address.toLowerCase(), me);

  // Deposit + session key
  const usdcBefore = BigInt(await read("usdc.balanceOf", [viewer.address]));
  const deposit = 2_000_000n;
  const skPk = generatePrivateKey();
  await chain("write", "usdc.approve", [viewer.address, deposit], viewer.address);
  const dep = await chain("write", "depositAndAuthorize", [deposit, privateKeyToAccount(skPk).address, BigInt(Math.floor(Date.now() / 1000) + 86400), deposit], viewer.address);
  check("depositAndAuthorize", !!dep.hash, dep);
  const bal0 = BigInt(await read("balanceOf", [viewer.address]));

  // Watch the first 5 minutes of Big Buck Bunny.
  const sessionA = `e2e-a-${Date.now()}`;
  const owed = costForSeconds(500_000n, 300); // 41666
  const r1 = await post({ ...(await signReceipt(skPk, owed)), watch: { sessionId: sessionA, videoId: bunny.id, coverage: bits(596, 0, 300) } });
  check("receipt + paid seconds accepted", r1.status === 200 && r1.body.coveredSeconds === 300, r1.body);
  check("lower cumulative rejected (409)", (await post(await signReceipt(skPk, owed - 1n))).status === 409);
  check("unauthorized signer rejected (401)", (await post(await signReceipt(generatePrivateKey(), owed + 5n))).status === 401);

  // Resume later: minutes 0–5 are free, so only new seconds can be paid for.
  const p1 = await progressOf(viewer.address, skPk, bunny.id);
  check("progress remembers paid seconds", p1.coveredSeconds === 300 && p1.remainingCost === costForSeconds(500_000n, 296).toString(), p1);
  const over = await post({ ...(await signReceipt(skPk, owed + costForSeconds(500_000n, 10))), watch: { sessionId: sessionA, videoId: bunny.id, coverage: bits(596, 0, 596) } });
  check("can't claim more new seconds than paid for", over.body.coveredSeconds <= 300 + 10 + 15 && over.body.coveredSeconds > 300, over.body);
  check("progress API requires auth", (await fetch(`${BASE}/api/progress?viewer=${viewer.address}&videoId=${bunny.id}`)).status === 401);

  // Hourly settlement
  const adaCum = owed + costForSeconds(500_000n, 10);
  const creatorBefore = BigInt(await read("usdc.balanceOf", [creator.address]));
  const settle = await (await fetch(`${BASE}/api/cron/settle`, { method: "POST" })).json();
  check("cron settle ran", settle.status === "success" && settle.count >= 1, settle);
  check("settled == cumulative", (await settledOf(viewer.address)) === adaCum);
  const creatorGot = BigInt(await read("usdc.balanceOf", [creator.address])) - creatorBefore;
  check("creator paid delta minus 5% fee", creatorGot === adaCum - (adaCum * FEE_BPS) / 10_000n, creatorGot.toString());
  check("second run is a no-op", (await (await fetch(`${BASE}/api/cron/settle`, { method: "POST" })).json()).status === "noop");

  // Withdraw (request -> blocked -> fast-forward -> withdraw)
  const bal1 = BigInt(await read("balanceOf", [viewer.address]));
  check("escrow debited by settlement", bal1 === bal0 - adaCum, bal1.toString());
  await chain("write", "requestWithdraw", [bal1], viewer.address);
  check("withdraw before delay reverts", (await chain("write", "withdraw", [], viewer.address)).revert === "WithdrawDelayNotMet");
  await chain("fastForwardWithdrawal", "", [], viewer.address);
  check("withdraw after delay", !!(await chain("write", "withdraw", [], viewer.address)).hash);
  check("viewer got unused USDC back", usdcBefore - BigInt(await read("usdc.balanceOf", [viewer.address])) === adaCum + (bal0 - deposit));

  // Ben: deposit, then watch Bunny to the end through Ada's referral link.
  const ben = privateKeyToAccount(DEMO_ACCOUNTS[1].privateKey);
  const benKey = generatePrivateKey();
  await chain("write", "usdc.approve", [ben.address, deposit], ben.address);
  await chain("write", "depositAndAuthorize", [deposit, privateKeyToAccount(benKey).address, BigInt(Math.floor(Date.now() / 1000) + 86400), deposit], ben.address);
  const benOwed = costForSeconds(500_000n, 596);
  const rr = await post({ ...(await signReceipt(benKey, benOwed, ben.address, viewer.address)), watch: { sessionId: `e2e-b1-${Date.now()}`, videoId: bunny.id, coverage: toBase64(fullBitmap(596)) } });
  check("finishing a video grants a 30-day replay pass", rr.status === 200 && !!rr.body.passUntil && new Date(rr.body.passUntil).getTime() > Date.now() + 29 * 86400_000, rr.body);
  const adaBefore = BigInt(await read("usdc.balanceOf", [viewer.address]));
  const creatorBefore2 = BigInt(await read("usdc.balanceOf", [creator.address]));
  await fetch(`${BASE}/api/cron/settle`, { method: "POST" });
  await sleep(6000); // let the 100% milestone settlement (if any) finish too
  const refPaid = BigInt(await read("usdc.balanceOf", [viewer.address])) - adaBefore;
  const creatorPaid2 = BigInt(await read("usdc.balanceOf", [creator.address])) - creatorBefore2;
  check("referrer earned 5% of spend", refPaid === (benOwed * 500n) / 10_000n, refPaid.toString());
  check("creator got spend - 5% fee - 5% referral", creatorPaid2 === benOwed - (benOwed * FEE_BPS) / 10_000n - (benOwed * 500n) / 10_000n, creatorPaid2.toString());
  const refSummary = await (await fetch(`${BASE}/api/referrals?referrer=${viewer.address}`)).json();
  check("referral summary", BigInt(refSummary.earned) === (benOwed * 500n) / 10_000n && refSummary.referredViewers === 1, refSummary);

  // Replay under the pass is free; free time is credited by wall clock (feeds the rating).
  const ping = await fetch(`${BASE}/api/progress/play`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await auth(ben.address, benKey)) },
    body: JSON.stringify({ viewer: ben.address, videoId: bunny.id, sessionId: `e2e-b2-${Date.now()}`, freeSeconds: 5000 }),
  });
  const pingBody = await ping.json();
  check("free replay time capped by wall clock", ping.status === 200 && pingBody.freeSeconds > 0 && pingBody.freeSeconds <= 75, pingBody);

  // Milestone settlement: Ben watches 10% of Sintel; it settles on-chain without waiting for the hour.
  const sintelCost = costForSeconds(1_000_000n, 90);
  const ms = await post({ ...(await signReceipt(benKey, sintelCost, ben.address)), watch: { sessionId: `e2e-b3-${Date.now()}`, videoId: sintel.id, coverage: bits(888, 0, 90) } });
  check("10% of Sintel paid", ms.status === 200 && ms.body.coveredSeconds === 90, ms.body);
  await sleep(7000);
  check("settles on-chain at the 10% milestone (no cron)", (await settledOf(ben.address)) === sintelCost, (await settledOf(ben.address)).toString());

  // In-app download of Tears of Steel: pays the full price once, then re-downloads are free.
  const dlCost = costForSeconds(2_000_000n, 734);
  const quote = await fetch(`${BASE}/api/downloads`, { method: "POST", headers: { "content-type": "application/json", ...(await auth(ben.address, benKey)) }, body: JSON.stringify({ viewer: ben.address, videoId: tears.id }) });
  const quoteBody = await quote.json();
  check("download asks for the full-watch price", quote.status === 402 && quoteBody.amount === dlCost.toString(), quoteBody);
  const dl = await fetch(`${BASE}/api/downloads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await auth(ben.address, benKey)) },
    body: j({ viewer: ben.address, videoId: tears.id, ...(await signReceipt(benKey, sintelCost + dlCost, ben.address)) }),
  });
  const dlBody = await dl.json();
  check("paid download returns a link + 30-day pass", dl.status === 200 && dlBody.url?.startsWith("/api/downloads/file") && !!dlBody.passUntil, dlBody);
  check("download settled on-chain before release", (await settledOf(ben.address)) === sintelCost + dlCost);
  const file = await fetch(BASE + dlBody.url);
  check("download link serves the video", file.ok && (file.headers.get("content-type") ?? "").startsWith("video"), file.status);
  await file.body?.cancel();
  const again = await fetch(`${BASE}/api/downloads`, { method: "POST", headers: { "content-type": "application/json", ...(await auth(ben.address, benKey)) }, body: JSON.stringify({ viewer: ben.address, videoId: tears.id }) });
  check("re-download within 30 days is free", again.status === 200, again.status);
  const pt = await progressOf(ben.address, benKey, tears.id);
  check("download marks every second paid", pt.coveredSeconds === 734 && pt.remainingCost === "0" && !!pt.downloadedAt, pt);
  check("download link rejects tampering", (await fetch(`${BASE}/api/downloads/file?t=x.y`)).status === 401);

  // A creator can switch "Share and earn" off for a video; referral receipts for it are then refused.
  const cn = await fetch(`${BASE}/api/auth/siwe`);
  let cCookie = cn.headers.get("set-cookie")!.split(";")[0];
  const cMsg = createSiweMessage({ address: creator.address, chainId: 5042002, domain: new URL(BASE).host, nonce: (await cn.json()).nonce, uri: BASE, version: "1" });
  const cLogin = await fetch(`${BASE}/api/auth/siwe`, { method: "POST", headers: { "content-type": "application/json", cookie: cCookie }, body: JSON.stringify({ message: cMsg, signature: await creator.signMessage({ message: cMsg }) }) });
  cCookie = cLogin.headers.get("set-cookie")?.split(";")[0] ?? cCookie;
  const off = await fetch(`${BASE}/api/videos/${sintel.id}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: cCookie }, body: JSON.stringify({ referralsEnabled: false }) });
  check("creator turns Share and earn off", off.status === 200 && (await off.json()).referrals_enabled === false);
  const blocked = await post({ ...(await signReceipt(benKey, 1_000n, ben.address, viewer.address)), watch: { sessionId: `e2e-b4-${Date.now()}`, videoId: sintel.id, coverage: bits(888, 0, 1) } });
  check("referral receipt refused when sharing is off", blocked.status === 422, blocked.body);

  // Rating comes only from verified watch time.
  const v = (await (await fetch(`${BASE}/api/videos/${bunny.id}`)).json()).video;
  check("rating computed from verified watch time", v.rating !== null && v.raters >= 2, { rating: v.rating, raters: v.raters, completion: v.completionRate });

  const events = (await (await fetch(`${BASE}/api/events?viewer=${viewer.address}`)).json()).events.map((e: { name: string }) => e.name);
  check("events include Deposited/Settled/Withdrawn", ["Deposited", "Settled", "Withdrawn"].every((n) => events.includes(n)), events);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
