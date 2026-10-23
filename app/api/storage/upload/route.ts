import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { error, json } from "@/lib/server/http";
import { sessionAddress } from "@/lib/server/session";
import { presignUpload } from "@/lib/server/r2";
import { signUpload, signUploadRef } from "@/lib/server/upload-token";

export const dynamic = "force-dynamic";

const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
};

/** An upload target plus the signed ref that lets /api/reviews and /api/videos trust its location. */
function issued(me: string, t: { provider: string; uploadUrl: string; contentId: string; playbackUrl: string; contentType?: string }) {
  return json({ ...t, uploadRef: signUploadRef({ addr: me, contentId: t.contentId, playbackUrl: t.playbackUrl }) });
}

/**
 * Hands the browser a direct-upload target so video bytes never pass through a JSON API.
 * Provider is NEXT_PUBLIC_STORAGE_PROVIDER: local (default) | r2 | supabase | livepeer | pinata.
 */
export async function POST(req: Request) {
  const me = await sessionAddress();
  if (!me) return error("Sign in with your wallet first.", 401);
  const { name, type } = (await req.json()) as { name?: string; type?: string };

  if (env.storageProvider === "local") {
    const ext = EXTENSIONS[type ?? ""] ?? "mp4";
    const id = randomUUID();
    const token = signUpload({ id, ext, addr: me, exp: Date.now() + 60 * 60 * 1000 });
    return issued(me, {
      provider: "local",
      uploadUrl: `/api/storage/local?token=${encodeURIComponent(token)}`,
      contentId: `local-${id}`,
      playbackUrl: `/media/${id}.${ext}`,
    });
  }

  if (env.storageProvider === "r2") {
    // Browser PUTs straight to the private R2 bucket (no size limit from our server or Vercel).
    const ext = EXTENSIONS[type ?? ""] ?? "mp4";
    const contentType = type && EXTENSIONS[type] ? type : "video/mp4";
    const id = randomUUID();
    const key = `videos/${me}/${id}.${ext}`;
    return issued(me, {
      provider: "r2",
      uploadUrl: await presignUpload(key, contentType),
      contentType,
      contentId: `r2-${id}`,
      playbackUrl: `r2:${key}`,
    });
  }

  if (env.storageProvider === "supabase") {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set", 500);
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const ext = EXTENSIONS[type ?? ""] ?? "mp4";
    const objectPath = `${me}/${randomUUID()}.${ext}`;
    const { data, error: e } = await sb.storage.from("videos").createSignedUploadUrl(objectPath);
    if (e || !data) return error(`Storage error: ${e?.message ?? "no upload URL"}`, 502);
    return issued(me, {
      provider: "supabase",
      uploadUrl: data.signedUrl,
      contentId: `sb-${objectPath}`,
      playbackUrl: sb.storage.from("videos").getPublicUrl(objectPath).data.publicUrl,
    });
  }

  if (env.storageProvider === "livepeer") {
    const lpKey = process.env.LIVEPEER_API_KEY;
    if (!lpKey) return error("LIVEPEER_API_KEY is not set", 500);
    const res = await fetch("https://livepeer.studio/api/asset/request-upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${lpKey}`, "content-type": "application/json" },
      body: JSON.stringify({ name: name ?? "video" }),
    });
    if (!res.ok) return error(`Livepeer error: ${await res.text()}`, 502);
    const data = (await res.json()) as { url: string; asset: { id: string; playbackId: string } };
    return issued(me, {
      provider: "livepeer",
      uploadUrl: data.url,
      contentId: data.asset.playbackId,
      playbackUrl: `https://livepeercdn.studio/hls/${data.asset.playbackId}/index.m3u8`,
    });
  }

  if (env.storageProvider === "pinata") {
    const jwt = process.env.PINATA_JWT;
    const gateway = process.env.PINATA_GATEWAY;
    if (!jwt || !gateway) return error("PINATA_JWT / PINATA_GATEWAY are not set", 500);
    const res = await fetch("https://uploads.pinata.cloud/v3/files/sign", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ date: Math.floor(Date.now() / 1000), expires: 3600, max_file_size: 2_000_000_000 }),
    });
    if (!res.ok) return error(`Pinata error: ${await res.text()}`, 502);
    const { data } = (await res.json()) as { data: string };
    return json({ provider: "pinata", uploadUrl: data, gateway });
  }

  return json({ provider: "mock" });
}
