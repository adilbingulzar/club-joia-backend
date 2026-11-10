import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/config/env";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/crypto";
import type { FilePurpose } from "@/generated/prisma/enums";

/**
 * StorageService — object storage abstraction.
 *   local → files under STORAGE_LOCAL_DIR (development / single-server hosting)
 *   s3    → any S3-compatible bucket (AWS S3, Cloudflare R2, Supabase Storage S3 API, MinIO)
 * Objects are private; they are only ever streamed through /api/files/[key] after an
 * authorization check. Keys are random and never derived from user input.
 */

interface Driver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

const localDriver = (): Driver => {
  const root = path.resolve(env().STORAGE_LOCAL_DIR);
  const resolve = (key: string) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    async put(key, body) {
      const p = resolve(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      try {
        return await readFile(resolve(key));
      } catch {
        return null;
      }
    },
    async remove(key) {
      await unlink(resolve(key)).catch(() => {});
    },
  };
};

const s3Driver = (): Driver => {
  const e = env();
  if (!e.S3_BUCKET || !e.S3_REGION) throw new AppError("NOT_CONFIGURED", "File storage is not configured.");
  const client = new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials:
      e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
      } catch {
        return null;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
    },
  };
};

let driver: Driver | undefined;
const getDriver = () => (driver ??= env().STORAGE_DRIVER === "s3" ? s3Driver() : localDriver());

// ─── Upload validation ──────────────────────────────────────────────────────

const SIGNATURES: { type: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  { type: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-" },
];

const POLICY: Record<FilePurpose, { maxBytes: number; types: string[] }> = {
  PROFILE_PHOTO: { maxBytes: 5 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] },
  CONCIERGE_ATTACHMENT: { maxBytes: 8 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp", "application/pdf"] },
  EVENT_IMAGE: { maxBytes: 8 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] },
  PROGRAMME_IMAGE: { maxBytes: 8 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] },
};

/** Validate by size and magic bytes (never trust the browser-provided MIME type or filename). */
export function sniffFile(buf: Buffer, purpose: FilePurpose): { type: string; ext: string } {
  const policy = POLICY[purpose];
  if (buf.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (buf.length > policy.maxBytes) {
    throw new AppError("VALIDATION", `Files must be ${Math.round(policy.maxBytes / 1024 / 1024)} MB or smaller.`);
  }
  const match = SIGNATURES.find((s) => s.test(buf));
  if (!match || !policy.types.includes(match.type)) {
    throw new AppError("VALIDATION", purpose === "CONCIERGE_ATTACHMENT" ? "Attach a JPG, PNG, WebP or PDF file." : "Upload a JPG, PNG or WebP image.");
  }
  return match;
}

export async function storeUpload(file: File, purpose: FilePurpose, ownerUserId: string) {
  const buf = Buffer.from(await file.arrayBuffer());
  const { type, ext } = sniffFile(buf, purpose);
  const key = `${purpose.toLowerCase()}/${randomToken(18)}.${ext}`;
  await getDriver().put(key, buf, type);
  await db.storedFile.create({ data: { key, ownerUserId, purpose, contentType: type, size: buf.length } });
  return { key, contentType: type };
}

export async function readStoredObject(key: string) {
  const meta = await db.storedFile.findUnique({ where: { key } });
  if (!meta) return null;
  const body = await getDriver().get(key);
  return body ? { meta, body } : null;
}

export async function deleteStoredObject(key: string) {
  await getDriver().remove(key);
  await db.storedFile.deleteMany({ where: { key } });
}
