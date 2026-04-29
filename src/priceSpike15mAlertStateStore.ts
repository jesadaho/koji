import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:price_spike_15m_alert_state";
const filePath = join(process.cwd(), "data", "price_spike_15m_alert_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ Spark signal state"
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

/** จุดอ้างอิงราคา last (ticker) — ไม่อิงแท่งเทียน */
export type SparkPriceSample = {
  tsSec: number;
  lastPrice: number;
};

export type SparkSignalCheckpointState = {
  checkpointPrice: number;
  checkpointSec: number;
  /** ราคา last ย้อนหลังแบบ sample จากรอบ cron (โดยทั่วไปทุก ~5 นาที) */
  priceSamples?: SparkPriceSample[];
  /** เวลา (epoch seconds) ที่ส่ง Spark alert ล่าสุดสำเร็จ — ใช้ทำ cooldown */
  lastNotifiedSec?: number;
};

export type PriceSpike15mAlertState = Record<string, SparkSignalCheckpointState>;

function normalizeState(raw: unknown): PriceSpike15mAlertState {
  if (!raw || typeof raw !== "object") return {};
  const out: PriceSpike15mAlertState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if ("checkpointPrice" in o && "checkpointSec" in o) {
      const cp = Number(o.checkpointPrice);
      const cs = Number(o.checkpointSec);
      if (!Number.isFinite(cp) || cp <= 0 || !Number.isFinite(cs) || cs <= 0) continue;
      const ln = Number(o.lastNotifiedSec);
      const lastNotifiedSec =
        Number.isFinite(ln) && ln > 0 ? Math.floor(ln) : undefined;
      const samplesRaw = Array.isArray(o.priceSamples) ? o.priceSamples : [];
      const samples: SparkPriceSample[] = [];
      for (const it of samplesRaw) {
        if (!it || typeof it !== "object") continue;
        const row = it as Record<string, unknown>;
        const ts = Number(row.tsSec);
        const lp = Number(row.lastPrice);
        if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(lp) || lp <= 0) continue;
        samples.push({ tsSec: Math.floor(ts), lastPrice: lp });
      }
      out[k.trim()] =
        samples.length > 0
          ? { checkpointPrice: cp, checkpointSec: cs, priceSamples: samples, lastNotifiedSec }
          : { checkpointPrice: cp, checkpointSec: cs, lastNotifiedSec };
    }
  }
  return out;
}

export async function loadPriceSpike15mAlertState(): Promise<PriceSpike15mAlertState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<PriceSpike15mAlertState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[priceSpike15mAlertStateStore] cloud get failed", e);
      throw new Error(`อ่าน price_spike_15m_alert_state ไม่สำเร็จ (${hint})`);
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

export async function savePriceSpike15mAlertState(state: PriceSpike15mAlertState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}
