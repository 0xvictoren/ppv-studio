"use client";

/** Fetch JSON from our API; throws an Error with the server's plain-language message. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json: body, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Turn decimal strings in a JSON value back into bigints (for mock chain reads). */
export function reviveBigints<T>(v: unknown): T {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v) as T;
  if (Array.isArray(v)) return v.map((x) => reviveBigints(x)) as T;
  return v as T;
}
