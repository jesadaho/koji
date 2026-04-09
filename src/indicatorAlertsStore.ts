import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:indicator_alerts";
const filePath = join(process.cwd(), "data", "indicator_alerts.json");

export type IndicatorTimeframe = "1h" | "4h";

/** RSI: both = เตือนทุกครั้งที่ข้ามเกณฑ์ (ขึ้นหรือลง) — above/below รองรับข้อมูลเก่า */
export type IndicatorAlertDirection = "above" | "below" | "both";

export type EmaCrossKind = "golden" | "death";

export type RsiIndicatorAlert = {
  id: string;
  userId: string;
  symbol: string;
  symbolLabel: string;
  indicatorType: "RSI";
  parameters: { period: number };
  timeframe: IndicatorTimeframe;
  threshold: number;
  direction: IndicatorAlertDirection;
  createdAt: string;
  lastTriggeredAt?: string;
  lastFiredBarTimeSec?: number;
};

export type EmaCrossIndicatorAlert = {
  id: string;
  userId: string;
  symbol: string;
  symbolLabel: string;
  indicatorType: "EMA_CROSS";
  parameters: { fast: number; slow: number };
  timeframe: IndicatorTimeframe;
  emaCrossKind: EmaCrossKind;
  createdAt: string;
  lastTriggeredAt?: string;
  lastFiredBarTimeSec?: number;
};

export type IndicatorAlert = RsiIndicatorAlert | EmaCrossIndicatorAlert;

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

function countUserRows(all: IndicatorAlert[], userId: string): number {
  return all.filter((a) => a.userId === userId).length;
}

export async function listIndicatorAlertsForUser(userId: string): Promise<IndicatorAlert[]> {
  return (await loadIndicatorAlerts())
    .filter((a) => a.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** RSI ทุก timeframe (1h / 4h) สำหรับ worker */
export async function loadActiveRsiAlerts(): Promise<RsiIndicatorAlert[]> {
  return (await loadIndicatorAlerts()).filter((a): a is RsiIndicatorAlert => a.indicatorType === "RSI");
}

export async function loadActiveEmaCrossAlerts(): Promise<EmaCrossIndicatorAlert[]> {
  return (await loadIndicatorAlerts()).filter((a): a is EmaCrossIndicatorAlert => a.indicatorType === "EMA_CROSS");
}

/** แทนที่ชุด RSI ของ user ต่อ timeframe (เหมือน EMA) */
export async function replaceUserRsiAlerts(
  userId: string,
  timeframe: IndicatorTimeframe,
  rows: Array<
    Omit<RsiIndicatorAlert, "id" | "createdAt" | "lastTriggeredAt" | "lastFiredBarTimeSec">
  >
): Promise<RsiIndicatorAlert[]> {
  const all = await loadIndicatorAlerts();
  const others = all.filter(
    (a) => !(a.userId === userId && a.indicatorType === "RSI" && a.timeframe === timeframe)
  );
  const afterCount = countUserRows(others, userId) + rows.length;
  if (afterCount > maxIndicatorAlertsPerUser()) {
    throw new Error(`สูงสุด ${maxIndicatorAlertsPerUser()} รายการ indicator ต่อผู้ใช้ (รวม RSI + EMA)`);
  }
  const now = new Date().toISOString();
  const created: RsiIndicatorAlert[] = rows.map((r) => ({
    ...r,
    id: randomUUID(),
    createdAt: now,
  }));
  await saveAll([...others, ...created]);
  return created;
}

export async function replaceUserEmaCrossAlerts(
  userId: string,
  timeframe: IndicatorTimeframe,
  rows: Array<
    Omit<EmaCrossIndicatorAlert, "id" | "createdAt" | "lastTriggeredAt" | "lastFiredBarTimeSec">
  >
): Promise<EmaCrossIndicatorAlert[]> {
  const all = await loadIndicatorAlerts();
  const others = all.filter(
    (a) =>
      !(
        a.userId === userId &&
        a.indicatorType === "EMA_CROSS" &&
        a.timeframe === timeframe
      )
  );
  const afterCount = countUserRows(others, userId) + rows.length;
  if (afterCount > maxIndicatorAlertsPerUser()) {
    throw new Error(`สูงสุด ${maxIndicatorAlertsPerUser()} รายการ indicator ต่อผู้ใช้ (รวม RSI + EMA)`);
  }
  const now = new Date().toISOString();
  const created: EmaCrossIndicatorAlert[] = rows.map((r) => ({
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
