import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:market_pulse_alert_state";
const filePath = join(process.cwd(), "data", "market_pulse_alert_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับ market pulse alert state"
    );
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ lastNotifiedFngValue: null, lastPushAtIso: null }, null, 2),
      "utf-8"
    );
  }
}

export type MarketPulseAlertState = {
  /** ค่า Fear & Greed (0–100) ตอนที่แจ้ง push ล่าสุด */
  lastNotifiedFngValue: number | null;
  /** ISO เวลา — push สำเร็จล่าสุด (ใช้เกณฑ์อย่างน้อยวันละครั้ง) */
  lastPushAtIso?: string | null;
};

function normalize(raw: unknown): MarketPulseAlertState {
  if (!raw || typeof raw !== "object") {
    return { lastNotifiedFngValue: null, lastPushAtIso: null };
  }
  const o = raw as MarketPulseAlertState;
  const v = o.lastNotifiedFngValue;
  let fng: number | null = null;
  if (v !== null && v !== undefined) {
    const n = Number(v);
    if (Number.isFinite(n)) fng = n;
  }
  const isoRaw = o.lastPushAtIso;
  let lastPushAtIso: string | null = null;
  if (typeof isoRaw === "string" && isoRaw.trim()) {
    const t = Date.parse(isoRaw.trim());
    lastPushAtIso = Number.isFinite(t) ? isoRaw.trim() : null;
  }
  return { lastNotifiedFngValue: fng, lastPushAtIso };
}

export async function loadMarketPulseAlertState(): Promise<MarketPulseAlertState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<MarketPulseAlertState>(KV_KEY);
      return normalize(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[marketPulseAlertStateStore] cloud get failed", e);
      throw new Error(`อ่าน market_pulse_alert_state ไม่สำเร็จ (${hint})`);
    }
  }
  if (isVercel()) return { lastNotifiedFngValue: null, lastPushAtIso: null };
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalize(JSON.parse(raw) as unknown);
  } catch {
    return { lastNotifiedFngValue: null, lastPushAtIso: null };
  }
}

export async function saveMarketPulseAlertState(state: MarketPulseAlertState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, normalize(state));
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(normalize(state), null, 2), "utf-8");
}
