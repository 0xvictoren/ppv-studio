import "server-only";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 (S3-compatible) video storage. The bucket stays private: browsers upload and
// play through short-lived signed URLs, so a copied link stops working after it expires.

const g = globalThis as unknown as { __ppwR2?: S3Client };

export function r2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

function client(): S3Client {
  if (!r2Configured()) throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET are not set");
  g.__ppwR2 ??= new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    forcePathStyle: !!process.env.R2_ENDPOINT, // local S3-compatible test servers
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  return g.__ppwR2;
}

const bucket = () => process.env.R2_BUCKET!;

/** Signed PUT the browser uploads the video to. The Content-Type header must match. */
export function presignUpload(key: string, contentType: string, ttlSeconds = 3600) {
  return getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: ttlSeconds });
}

/** Signed GET for playback (inline) or the in-app download. */
export function presignRead(key: string, ttlSeconds: number) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentDisposition: "inline", ResponseCacheControl: "private, max-age=3600" }),
    { expiresIn: ttlSeconds },
  );
}

/** Server-side upload (used by the migration script). */
export async function putObject(key: string, body: Buffer | NodeJS.ReadableStream, contentType: string, contentLength?: number) {
  await client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body as never, ContentType: contentType, ContentLength: contentLength }));
}
