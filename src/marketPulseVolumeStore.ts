import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:market_pulse_volume_snapshots";
const filePath = join(process.cwd(), "data", "market_pulse_volume_snapshots.json");
/** เก็บ snapshot ย้อนหลังพอหาแท่งใกล้ 24 ชม. (รอบ cron Market Pulse ทุกชั่วโมง) */
const MAX_SNAPSHOTS = 24;

export type VolumeSnapshot = {
  /** ISO-8601 */
  t: string;
  totalVolumeUsd: number;
};

export type MarketPulseVolumeBlob = {
  snapshots: VolumeSnapshot[];
};

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับ market pulse volume snapshots"
    );
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ snapshots: [] }, null, 2), "utf-8");
  }
}

function normalizeBlob(raw: unknown): MarketPulseVolumeBlob {
  if (!raw || typeof raw !== "object") return { snapshots: [] };
  const s = (raw as MarketPulseVolumeBlob).snapshots;
  if (!Array.isArray(s)) return { snapshots: [] };
  const snapshots: VolumeSnapshot[] = [];
  for (const x of s) {
    if (!x || typeof x !== "object") continue;
    const t = (x as VolumeSnapshot).t;
    const v = (x as VolumeSnapshot).totalVolumeUsd;
    if (typeof t !== "string" || typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    snapshots.push({ t, totalVolumeUsd: v });
  }
  snapshots.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
  return { snapshots: snapshots.slice(-MAX_SNAPSHOTS) };
}

export async function loadMarketPulseVolumeBlob(): Promise<MarketPulseVolumeBlob> {
  if (useCloudStorage()) {
    const data = await cloudGet<MarketPulseVolumeBlob>(KV_KEY);
    return normalizeBlob(data);
  }
  if (isVercel()) return { snapshots: [] };
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeBlob(JSON.parse(raw) as unknown);
  } catch {
    return { snapshots: [] };
  }
}

export async function saveMarketPulseVolumeBlob(blob: MarketPulseVolumeBlob): Promise<void> {
  const trimmed = normalizeBlob(blob);
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, trimmed);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(trimmed, null, 2), "utf-8");
}

const TARGET_MS = 24 * 3600 * 1000;
const MIN_AGE_MS = 18 * 3600 * 1000;

/**
 * หา snapshot ที่อายุใกล้ 24 ชม. ที่สุด (อย่างน้อย ~18 ชม.) เทียบกับปริมาณปัจจุบัน
 * คืน % เปลี่ยน หรือ null ถ้ายังไม่มีข้อมูลพอ
 */
export function computeVolumeChangeVs24hApprox(
  snapshots: VolumeSnapshot[],
  nowIso: string,
  currentVolumeUsd: number,
): number | null {
  if (!Number.isFinite(currentVolumeUsd) || currentVolumeUsd <= 0) return null;
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(now)) return null;

  let best: VolumeSnapshot | null = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const ts = new Date(s.t).getTime();
    if (!Number.isFinite(ts) || ts >= now) continue;
    const age = now - ts;
    if (age < MIN_AGE_MS) continue;
    const diff = Math.abs(age - TARGET_MS);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }

  if (!best || best.totalVolumeUsd <= 0) return null;
  return ((currentVolumeUsd - best.totalVolumeUsd) / best.totalVolumeUsd) * 100;
}

/** บันทึก snapshot ปัจจุบัน (หลังคำนวณแล้ว) — กันซ้ำเวลาเดียวกัน */
export async function appendVolumeSnapshot(nowIso: string, totalVolumeUsd: number): Promise<void> {
  const blob = await loadMarketPulseVolumeBlob();
  const next = [...blob.snapshots];
  const last = next[next.length - 1];
  if (last && last.t === nowIso) {
    next[next.length - 1] = { t: nowIso, totalVolumeUsd };
  } else {
    next.push({ t: nowIso, totalVolumeUsd });
  }
  await saveMarketPulseVolumeBlob({ snapshots: next.slice(-MAX_SNAPSHOTS) });
}
