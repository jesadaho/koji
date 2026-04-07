import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { kv } from "@vercel/kv";

export type PriceAlert = {
  id: string;
  userId: string;
  /** สัญญา MEXC เช่น BTC_USDT */
  coinId: string;
  symbolLabel: string;
  direction: "above" | "below";
  /** เป้าราคา (USDT) */
  targetUsd: number;
  createdAt: string;
};

const KV_KEY = "koji:alerts";
const filePath = join(process.cwd(), "data", "alerts.json");

function useKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useKv()) {
    throw new Error(
      "บน Vercel ต้องเชื่อม Vercel KV (ให้มี KV_REST_API_URL) เพื่อเก็บการแจ้งเตือน"
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

export async function loadAlerts(): Promise<PriceAlert[]> {
  if (useKv()) {
    try {
      const data = await kv.get<PriceAlert[]>(KV_KEY);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[alertsStore] kv.get failed", e);
      throw new Error(
        `อ่าน Vercel KV ไม่สำเร็จ (${hint}) — เชื่อม KV กับโปรเจกต์และตรวจ KV_REST_API_URL / KV_REST_API_TOKEN`
      );
    }
  }

  if (isVercel()) {
    return [];
  }

  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as PriceAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAlerts(alerts: PriceAlert[]): Promise<void> {
  if (useKv()) {
    await kv.set(KV_KEY, alerts);
    return;
  }

  assertWritableStorage();

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(alerts, null, 2), "utf-8");
}

export async function addAlert(alert: Omit<PriceAlert, "id" | "createdAt">): Promise<PriceAlert> {
  const all = await loadAlerts();
  const row: PriceAlert = {
    ...alert,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  all.push(row);
  await saveAlerts(all);
  return row;
}

export async function removeAlertById(userId: string, id: string): Promise<boolean> {
  const all = await loadAlerts();
  const idx = all.findIndex((a) => a.userId === userId && a.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await saveAlerts(all);
  return true;
}

export async function removeAlertByIndex(userId: string, index1Based: number): Promise<boolean> {
  const mine = (await loadAlerts())
    .filter((a) => a.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const i = index1Based - 1;
  if (i < 0 || i >= mine.length) return false;
  return removeAlertById(userId, mine[i]!.id);
}

export async function listAlertsForUser(userId: string): Promise<PriceAlert[]> {
  return (await loadAlerts())
    .filter((a) => a.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function markFired(id: string): Promise<void> {
  const all = await loadAlerts();
  const next = all.filter((a) => a.id !== id);
  await saveAlerts(next);
}
