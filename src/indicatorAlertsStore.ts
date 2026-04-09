import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:indicator_alerts";
const filePath = join(process.cwd(), "data", "indicator_alerts.json");

/** Phase 1.5: RSI 1h — ขยายเป็น 4h/1D และ EMA ภายหลัง */
export type IndicatorTimeframe = "1h";

export type IndicatorType = "RSI";

export type IndicatorAlertDirection = "above" | "below";

export type RsiParameters = {
  period: number;
};

export type IndicatorAlert = {
  id: string;
  userId: string;
  /** สัญญา MEXC เช่น BTC_USDT */
  symbol: string;
  symbolLabel: string;
  indicatorType: IndicatorType;
  parameters: RsiParameters;
  timeframe: IndicatorTimeframe;
  /** เช่น RSI ข้ามเหนือ 70 → threshold 70, direction above */
  threshold: number;
  direction: IndicatorAlertDirection;
  createdAt: string;
  lastTriggeredAt?: string;
  /** Unix sec เวลาเปิดแท่งที่แจ้งล่าสุด — กันยิงซ้ำขณะแท่งเดิม */
  lastFiredBarTimeSec?: number;
};

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับ indicator alerts"
    );
  }
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "[]", "utf-8");
  }
}

export async function loadIndicatorAlerts(): Promise<IndicatorAlert[]> {
  if (useCloudStorage()) {
    const data = await cloudGet<IndicatorAlert[]>(KV_KEY);
    return Array.isArray(data) ? data : [];
  }
  if (isVercel()) return [];
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as IndicatorAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(rows: IndicatorAlert[]): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, rows);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(rows, null, 2), "utf-8");
}

export function maxIndicatorAlertsPerUser(): number {
  const v = Number(process.env.INDICATOR_ALERT_MAX_PER_USER);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 100) : 30;
}

export async function listIndicatorAlertsForUser(userId: string): Promise<IndicatorAlert[]> {
  return (await loadIndicatorAlerts())
    .filter((a) => a.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** แถว RSI 1h ทั้งหมด (สำหรับ worker) */
export async function loadActiveRsi1hAlerts(): Promise<IndicatorAlert[]> {
  return (await loadIndicatorAlerts()).filter(
    (a) => a.indicatorType === "RSI" && a.timeframe === "1h"
  );
}

export async function replaceUserRsi1hAlerts(
  userId: string,
  rows: Omit<IndicatorAlert, "id" | "createdAt" | "lastTriggeredAt" | "lastFiredBarTimeSec">[]
): Promise<IndicatorAlert[]> {
  const all = await loadIndicatorAlerts();
  const others = all.filter(
    (a) => !(a.userId === userId && a.indicatorType === "RSI" && a.timeframe === "1h")
  );
  if (rows.length > maxIndicatorAlertsPerUser()) {
    throw new Error(`สูงสุด ${maxIndicatorAlertsPerUser()} รายการ RSI 1h ต่อผู้ใช้`);
  }
  const now = new Date().toISOString();
  const created: IndicatorAlert[] = rows.map((r) => ({
    ...r,
    id: randomUUID(),
    createdAt: now,
  }));
  await saveAll([...others, ...created]);
  return created;
}

export async function removeIndicatorAlertById(userId: string, id: string): Promise<boolean> {
  const all = await loadIndicatorAlerts();
  const idx = all.findIndex((a) => a.userId === userId && a.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await saveAll(all);
  return true;
}

export async function updateIndicatorAlertAfterFire(
  id: string,
  iso: string,
  firedBarTimeSec: number
): Promise<boolean> {
  const all = await loadIndicatorAlerts();
  const a = all.find((x) => x.id === id);
  if (!a) return false;
  a.lastTriggeredAt = iso;
  a.lastFiredBarTimeSec = firedBarTimeSec;
  await saveAll(all);
  return true;
}
