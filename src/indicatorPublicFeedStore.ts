import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:indicator_public_feed_state";
const filePath = join(process.cwd(), "data", "indicator_public_feed_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ indicator public feed state");
  }
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}", "utf-8");
  }
}

/** key = เช่น "BTCUSDT|RSI|4h" | "SOLUSDT|EMA_GOLDEN|4h" | "ETHUSDT|RSI_DIV|1h|BEARISH" | "BTCUSDT|SNOWBALL|4h|BULL" → bar open time sec (RSI divergence 2-wave = แท่งยืนยัน/ปิดล่าสุด) */
export type IndicatorPublicFeedState = {
  lastFiredBarSec: Record<string, number>;
  /** cooldown ต่อ key (wall clock ms) */
  lastNotifyMs?: Record<string, number>;
  lastTriggeredAt?: string;
  /** Snowball TF=4h: bar open time (unix sec) ที่ส่งสรุปสแกนลง Telegram แล้ว — กันยิงซ้ำทุก cron */
  lastSnowballScanSummaryBarOpenSec?: number;
};

export async function loadIndicatorPublicFeedState(): Promise<IndicatorPublicFeedState> {
  if (useCloudStorage()) {
    const data = await cloudGet<IndicatorPublicFeedState>(KV_KEY);
    if (data && typeof data.lastFiredBarSec === "object" && data.lastFiredBarSec !== null) {
      const sum =
        typeof data.lastSnowballScanSummaryBarOpenSec === "number" &&
        Number.isFinite(data.lastSnowballScanSummaryBarOpenSec)
          ? data.lastSnowballScanSummaryBarOpenSec
          : undefined;
      return {
        lastFiredBarSec: { ...data.lastFiredBarSec },
        lastNotifyMs: data.lastNotifyMs ? { ...data.lastNotifyMs } : {},
        lastTriggeredAt: data.lastTriggeredAt,
        lastSnowballScanSummaryBarOpenSec: sum,
      };
    }
    return { lastFiredBarSec: {}, lastNotifyMs: {} };
  }
  if (isVercel()) return { lastFiredBarSec: {}, lastNotifyMs: {} };
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as IndicatorPublicFeedState;
    if (parsed && typeof parsed.lastFiredBarSec === "object" && parsed.lastFiredBarSec !== null) {
      const sum =
        typeof parsed.lastSnowballScanSummaryBarOpenSec === "number" &&
        Number.isFinite(parsed.lastSnowballScanSummaryBarOpenSec)
          ? parsed.lastSnowballScanSummaryBarOpenSec
          : undefined;
      return {
        lastFiredBarSec: { ...parsed.lastFiredBarSec },
        lastNotifyMs: parsed.lastNotifyMs ? { ...parsed.lastNotifyMs } : {},
        lastTriggeredAt: parsed.lastTriggeredAt,
        lastSnowballScanSummaryBarOpenSec: sum,
      };
    }
  } catch {
    /* empty */
  }
  return { lastFiredBarSec: {}, lastNotifyMs: {} };
}

export async function saveIndicatorPublicFeedState(state: IndicatorPublicFeedState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function updatePublicFeedFiredKey(
  state: IndicatorPublicFeedState,
  key: string,
  barTimeSec: number,
  triggeredAtIso: string,
  notifyWallMs: number
): Promise<void> {
  state.lastFiredBarSec[key] = barTimeSec;
  if (!state.lastNotifyMs) state.lastNotifyMs = {};
  state.lastNotifyMs[key] = notifyWallMs;
  state.lastTriggeredAt = triggeredAtIso;
  await saveIndicatorPublicFeedState(state);
}
