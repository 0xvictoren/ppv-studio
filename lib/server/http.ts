import "server-only";
import { NextResponse } from "next/server";

/** JSON response that serializes bigints as decimal strings. */
export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function error(message: string, status = 400) {
  return json({ error: message }, { status });
}
