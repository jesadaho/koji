import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGetString, cloudSetStringWithTtl, useCloudStorage } from "./remoteJsonStore";

const TTL_SEC = 7 * 24 * 60 * 60;
const filePath = join(process.cwd(), "data", "tv_webhook_used_nonces.json");

/** สร้างค่า nonce ให้ใส่ใน JSON — แต่ละค่าใช้ได้ครั้งเดียวเมื่อ webhook สำเร็จ (replay ถูกบล็อกจนกว่า TTL จะหมด) */
export function newTvWebhookNonce(): string {
  return randomBytes(16).toString("hex");
}

function nonceKey(userId: string, nonce: string): string {
  return `koji:tv_used_nonce:${userId}:${nonce.slice(0, 200)}`;
}

type FileNonceMap = Record<string, number>;

async function loadFileMap(): Promise<FileNonceMap> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const p = JSON.parse(raw) as FileNonceMap;
    return typeof p === "object" && p !== null && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

async function saveFileMap(m: FileNonceMap): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(m, null, 2), "utf-8");
}

function pruneFileMap(m: FileNonceMap, now: number): FileNonceMap {
  const cutoff = now - TTL_SEC * 1000;
  const next: FileNonceMap = {};
  for (const [k, expMs] of Object.entries(m)) {
    if (typeof expMs === "number" && expMs > cutoff) next[k] = expMs;
  }
  return next;
}

/**
 * คืน true ถ้า nonce นี้เคยใช้แล้ว (ห้ามซ้ำ)
 */
export async function isTvWebhookNonceUsed(userId: string, nonce: string): Promise<boolean> {
  const n = nonce.trim().slice(0, 200);
  if (!n) return false;

  if (useCloudStorage()) {
    try {
      const v = await cloudGetString(nonceKey(userId, n));
      return v != null && v !== "";
    } catch (e) {
      console.error("[tv_webhook_nonce] cloud get", e);
      return false;
    }
  }

  const now = Date.now();
  const m = pruneFileMap(await loadFileMap(), now);
  const hit = m[`${userId}\t${n}`];
  return typeof hit === "number" && hit > now;
}

/**
 * บันทึกว่า nonce ใช้แล้ว (หลังสั่ง MEXC สำเร็จ)
 */
export async function markTvWebhookNonceUsed(userId: string, nonce: string): Promise<void> {
  const n = nonce.trim().slice(0, 200);
  if (!n) return;

  if (useCloudStorage()) {
    try {
      await cloudSetStringWithTtl(nonceKey(userId, n), "1", TTL_SEC);
    } catch (e) {
      console.error("[tv_webhook_nonce] cloud set", e);
    }
    return;
  }

  const now = Date.now();
  let m = pruneFileMap(await loadFileMap(), now);
  m[`${userId}\t${n}`] = now + TTL_SEC * 1000;
  await saveFileMap(m);
}
