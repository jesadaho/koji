import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:volume_signal_alerts";
const filePath = join(process.cwd(), "data", "volume_signal_alerts.json");

export type VolumeSignalTimeframe = "1h" | "4h";

/** บันทึกเมื่อแจ้งเตือนล่าสุด (เฟส 3 — แสดงใน LIFF) */
export type VolumeSignalLastEvent = {
  at: string;
  volRatio: number;
  returnPct: number;
  momentumScore: number;
};

export type VolumeSignalAlert = {
  id: string;
  userId: string;
  coinId: string;
  symbolLabel: string;
  timeframe: VolumeSignalTimeframe;
  createdAt: string;
  /** ISO — cooldown หลังแจ้งเตือน */
  lastNotifiedAt?: string;
  /** เกณฑ์เฉพาะรายการ — ถ้าไม่ระบุใช้ค่า default จาก env */
  minVolRatio?: number;
  /** |% เปลี่ยนแท่ง| ขั้นต่ำ (หน่วย % pt ของราคา เช่น 0.15 = 0.15%) */
  minAbsReturnPct?: number;
  /** สรุปครั้งแจ้งล่าสุด */
  lastEvent?: VolumeSignalLastEvent;
};

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับ volume signal alerts"
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

export async function loadVolumeSignalAlerts(): Promise<VolumeSignalAlert[]> {
  if (useCloudStorage()) {
    const data = await cloudGet<VolumeSignalAlert[]>(KV_KEY);
    return Array.isArray(data) ? data : [];
  }
  if (isVercel()) return [];
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as VolumeSignalAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(rows: VolumeSignalAlert[]): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, rows);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(rows, null, 2), "utf-8");
}

export const MAX_VOLUME_SIGNAL_ALERTS_PER_USER = 10;

export async function listVolumeSignalAlertsForUser(userId: string): Promise<VolumeSignalAlert[]> {
  return (await loadVolumeSignalAlerts())
    .filter((a) => a.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addVolumeSignalAlert(
  row: Omit<VolumeSignalAlert, "id" | "createdAt" | "lastEvent">
): Promise<VolumeSignalAlert> {
  const all = await loadVolumeSignalAlerts();
  const mine = all.filter((a) => a.userId === row.userId);
  if (mine.length >= MAX_VOLUME_SIGNAL_ALERTS_PER_USER) {
    throw new Error(`สูงสุด ${MAX_VOLUME_SIGNAL_ALERTS_PER_USER} รายการต่อผู้ใช้`);
  }
  const dup = mine.some((a) => a.coinId === row.coinId && a.timeframe === row.timeframe);
  if (dup) {
    throw new Error("มีการติดตามคู่และช่วงเวลานี้อยู่แล้ว");
  }
  const next: VolumeSignalAlert = {
    ...row,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  all.push(next);
  await saveAll(all);
  return next;
}

export async function removeVolumeSignalAlertById(userId: string, id: string): Promise<boolean> {
  const all = await loadVolumeSignalAlerts();
  const idx = all.findIndex((a) => a.userId === userId && a.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await saveAll(all);
  return true;
}

export async function setVolumeSignalLastNotified(
  id: string,
  iso: string,
  event?: Omit<VolumeSignalLastEvent, "at">
): Promise<boolean> {
  const all = await loadVolumeSignalAlerts();
  const a = all.find((x) => x.id === id);
  if (!a) return false;
  a.lastNotifiedAt = iso;
  if (event) {
    a.lastEvent = {
      at: iso,
      volRatio: event.volRatio,
      returnPct: event.returnPct,
      momentumScore: event.momentumScore,
    };
  }
  await saveAll(all);
  return true;
}
