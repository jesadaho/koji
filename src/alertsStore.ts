import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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

const path = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "alerts.json");

async function ensureFile(): Promise<void> {
  try {
    await readFile(path, "utf-8");
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "[]", "utf-8");
  }
}

export async function loadAlerts(): Promise<PriceAlert[]> {
  await ensureFile();
  const raw = await readFile(path, "utf-8");
  try {
    const parsed = JSON.parse(raw) as PriceAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAlerts(alerts: PriceAlert[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(alerts, null, 2), "utf-8");
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
