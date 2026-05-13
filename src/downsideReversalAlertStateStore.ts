import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:downside_reversal_alert_state";
const filePath = join(process.cwd(), "data", "downside_reversal_alert_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ downside reversal alert state"
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

export type DownsideSymbolState = {
  /** Low ของแท่งสัญญาณล่าสุด (Weak 15m หรือ Bear 1h) — ใช้ Trend Broken */
  signalBarLow: number | null;
  /** openTime (sec) ของแท่งสัญญาณล่าสุด */
  signalBarOpenSec: number | null;
  lastWeakDemand15mOpenSec?: number;
  lastBearVol1hOpenSec?: number;
  lastTrendBroken1hOpenSec?: number;
  /** กันยิง Trend Broken ซ้ำสำหรับสัญญาณเดียวกัน */
  trendBrokenForSignalOpenSec?: number | null;
};

export type DownsideReversalAlertState = Record<string, DownsideSymbolState>;

function normalizeState(raw: unknown): DownsideReversalAlertState {
  if (!raw || typeof raw !== "object") return {};
  const out: DownsideReversalAlertState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const sym = k.trim().toUpperCase();
    if (!sym) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const sl = Number(o.signalBarLow);
    const so = Number(o.signalBarOpenSec);
    const w = Number(o.lastWeakDemand15mOpenSec);
    const b = Number(o.lastBearVol1hOpenSec);
    const t = Number(o.lastTrendBroken1hOpenSec);
    const tb = o.trendBrokenForSignalOpenSec;
    const tbN = tb == null || tb === "" ? null : Number(tb);
    out[sym] = {
      signalBarLow: Number.isFinite(sl) && sl > 0 ? sl : null,
      signalBarOpenSec: Number.isFinite(so) && so > 0 ? Math.floor(so) : null,
      lastWeakDemand15mOpenSec: Number.isFinite(w) && w > 0 ? Math.floor(w) : undefined,
      lastBearVol1hOpenSec: Number.isFinite(b) && b > 0 ? Math.floor(b) : undefined,
      lastTrendBroken1hOpenSec: Number.isFinite(t) && t > 0 ? Math.floor(t) : undefined,
      trendBrokenForSignalOpenSec:
        tbN != null && Number.isFinite(tbN) && tbN > 0 ? Math.floor(tbN) : tb === null ? null : undefined,
    };
  }
  return out;
}

export async function loadDownsideReversalAlertState(): Promise<DownsideReversalAlertState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<DownsideReversalAlertState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      console.error("[downsideReversalAlertStateStore] cloud get failed", e);
      throw e;
    }
  }
  if (isVercel()) {
    return {};
  }
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export async function saveDownsideReversalAlertState(state: DownsideReversalAlertState): Promise<void> {
  const normalized = normalizeState(state);
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, normalized);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}
