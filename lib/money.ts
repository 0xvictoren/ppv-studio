// All money is USDC base units (6 decimals) as bigint. No floats touch amounts.
export const USDC_DECIMALS = 6;
export const ONE_USDC = 1_000_000n;
export const MAX_PRICE_PER_HOUR = 100n * ONE_USDC;
export const PLATFORM_FEE_BPS = 500n; // 5%, set onchain via setFee(500)
export const PLATFORM_FEE_LABEL = `${Number(PLATFORM_FEE_BPS) / 100}%`;

/** "0.50" -> 500000n. Returns null for anything that isn't a plain non-negative decimal. */
export function parseUsdc(input: string, maxDecimals = USDC_DECIMALS): bigint | null {
  const s = input.trim().replace(/^\$/, "");
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > maxDecimals) return null;
  return BigInt(whole || "0") * ONE_USDC + BigInt(frac.padEnd(USDC_DECIMALS, "0") || "0");
}

/** Plain decimal string with at least `minDecimals` and trailing zeros trimmed beyond that. */
export function toDecimal(units: bigint, minDecimals = 2): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / ONE_USDC;
  let frac = (abs % ONE_USDC).toString().padStart(USDC_DECIMALS, "0");
  while (frac.length > minDecimals && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

/** "$0.12 USDC". Sub-cent amounts keep up to 4 decimals so per-minute prices stay meaningful. */
export function formatUsdc(units: bigint, opts: { suffix?: boolean; decimals?: number } = {}): string {
  const { suffix = true } = opts;
  let decimals = opts.decimals ?? 2;
  if (opts.decimals === undefined && units !== 0n && (units < 0n ? -units : units) < 10_000n) decimals = 4;
  const factor = 10n ** BigInt(USDC_DECIMALS - decimals);
  // round half up to `decimals`
  const rounded = ((units + factor / 2n) / factor) * factor;
  return `$${toDecimal(rounded, decimals)}${suffix ? " USDC" : ""}`;
}

/** Cost of `seconds` of watching at `pricePerHour`, rounded down in the viewer's favour. */
export function costForSeconds(pricePerHour: bigint, seconds: bigint | number): bigint {
  return (pricePerHour * BigInt(seconds)) / 3600n;
}

export function perMinute(pricePerHour: bigint): bigint {
  return pricePerHour / 60n;
}

export function feeOf(amount: bigint, feeBps: bigint = PLATFORM_FEE_BPS): bigint {
  return (amount * feeBps) / 10_000n;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatMinutes(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function shortAddress(a?: string | null) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
