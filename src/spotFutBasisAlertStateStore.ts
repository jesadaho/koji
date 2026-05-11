import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:spot_fut_basis_alert_state";
const filePath = join(process.cwd(), "data", "spot_fut_basis_alert_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ spot–fut basis alert state"
    );
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}", "utf-8");
  }
}

export type SpotFutBasisTier = "warning" | "extreme";

/** เก็บใน state รวม "normal" เมื่อ gap หด — ไม่ลบ entry เพื่อไม่ให้ dailyNotifiedCount รีเซ็ตในวันเดียวกัน */
export type SpotFutBasisAlertEntryTier = SpotFutBasisTier | "normal";

export type SpotFutBasisAlertEntry = {
  lastNotifiedBasisPct: number;
  lastTier: SpotFutBasisAlertEntryTier;
  /** วันที่ (เวลาไทย) ที่นับโควต้าการแจ้งล่าสุด เช่น 2026-04-29 */
  dailyKeyBkk?: string;
  /** จำนวนครั้งที่แจ้งใน dailyKeyBkk นั้น */
  dailyNotifiedCount?: number;
};

export type SpotFutBasisAlertState = Record<string, SpotFutBasisAlertEntry>;

function normalizeState(raw: unknown): SpotFutBasisAlertState {
  if (!raw || typeof raw !== "object") return {};
  const out: SpotFutBasisAlertState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    const o = v as {
      lastNotifiedBasisPct?: unknown;
      lastTier?: unknown;
      dailyKeyBkk?: unknown;
      dailyNotifiedCount?: unknown;
    };
    const p = Number(o?.lastNotifiedBasisPct);
    const t =
      o?.lastTier === "extreme" || o?.lastTier === "warning" || o?.lastTier === "normal"
        ? o.lastTier
        : null;
    if (!Number.isFinite(p) || !t) continue;
    const dailyKeyBkk = typeof o.dailyKeyBkk === "string" && o.dailyKeyBkk.trim() ? o.dailyKeyBkk.trim() : undefined;
    const cntRaw = Number(o.dailyNotifiedCount);
    const dailyNotifiedCount =
      Number.isFinite(cntRaw) && cntRaw >= 0 ? Math.floor(cntRaw) : undefined;
    out[k.trim()] = { lastNotifiedBasisPct: p, lastTier: t, dailyKeyBkk, dailyNotifiedCount };
  }
  return out;
}

export async function loadSpotFutBasisAlertState(): Promise<SpotFutBasisAlertState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<SpotFutBasisAlertState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[spotFutBasisAlertStateStore] cloud get failed", e);
      throw new Error(`อ่าน spot_fut_basis_alert_state ไม่สำเร็จ (${hint})`);
    }
  }
  if (isVercel()) return {};
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export async function saveSpotFutBasisAlertState(state: SpotFutBasisAlertState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}
