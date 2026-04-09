import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:pct_step_alerts";
const filePath = join(process.cwd(), "data", "pct_step_alerts.json");

export type PctStepMode = "daily_07_bkk" | "trailing";

export type PctStepAlert = {
  id: string;
  userId: string;
  coinId: string;
  symbolLabel: string;
  /** เปอร์เซ็นต์ เช่น 1 = 1% */
  stepPct: number;
  mode: PctStepMode;
  createdAt: string;
  /** daily: วันเซสชัน YYYY-MM-DD (bkkTradingSessionId) ที่ anchor ใช้อยู่ */
  anchorDateBkk?: string;
  anchorPrice?: number;
  maxUpStep?: number;
  maxDownStep?: number;
  /** trailing: ราคาอ้างอิงล่าสุด */
  trailingAnchorPrice?: number;
};

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับ pct step alerts"
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

export async function loadPctStepAlerts(): Promise<PctStepAlert[]> {
  if (useCloudStorage()) {
    const data = await cloudGet<PctStepAlert[]>(KV_KEY);
    return Array.isArray(data) ? data : [];
  }
  if (isVercel()) return [];
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as PctStepAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(rows: PctStepAlert[]): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, rows);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(rows, null, 2), "utf-8");
}

export async function addPctStepAlert(
  row: Omit<PctStepAlert, "id" | "createdAt">
): Promise<PctStepAlert> {
  const all = await loadPctStepAlerts();
  const next: PctStepAlert = {
    ...row,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  all.push(next);
  await saveAll(all);
  return next;
}

export async function removePctStepAlertById(userId: string, id: string): Promise<boolean> {
  const all = await loadPctStepAlerts();
  const idx = all.findIndex((a) => a.userId === userId && a.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await saveAll(all);
  return true;
}

export async function removePctStepAlertByIndex(userId: string, index1Based: number): Promise<boolean> {
  const mine = (await listPctStepAlertsForUser(userId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const i = index1Based - 1;
  if (i < 0 || i >= mine.length) return false;
  return removePctStepAlertById(userId, mine[i]!.id);
}

export async function listPctStepAlertsForUser(userId: string): Promise<PctStepAlert[]> {
  return (await loadPctStepAlerts())
    .filter((a) => a.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function replacePctStepAlerts(rows: PctStepAlert[]): Promise<void> {
  await saveAll(rows);
}
