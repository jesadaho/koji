import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:portfolio_trailing_alert_state";
const filePath = join(process.cwd(), "data", "portfolio_trailing_alert_state.json");

export type PortfolioTrailingAnchor = {
  userId: string;
  coinId: string;
  trailingAnchorPrice?: number;
  updatedAt: string;
};

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ portfolio trailing alert state"
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

export async function loadPortfolioTrailingAnchors(): Promise<PortfolioTrailingAnchor[]> {
  if (useCloudStorage()) {
    const data = await cloudGet<PortfolioTrailingAnchor[]>(KV_KEY);
    return Array.isArray(data) ? data : [];
  }
  if (isVercel()) return [];
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as PortfolioTrailingAnchor[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(rows: PortfolioTrailingAnchor[]): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, rows);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(rows, null, 2), "utf-8");
}

function rowKey(userId: string, coinId: string): string {
  return `${userId}\0${coinId}`;
}

export async function getAnchorForSymbol(
  userId: string,
  coinId: string
): Promise<number | undefined> {
  const rows = await loadPortfolioTrailingAnchors();
  return rows.find((r) => r.userId === userId && r.coinId === coinId)?.trailingAnchorPrice;
}

/** อัปเดต anchor หลายสัญญาในครั้งเดียว */
export async function upsertPortfolioTrailingAnchors(
  updates: Array<{ userId: string; coinId: string; trailingAnchorPrice: number }>
): Promise<void> {
  if (updates.length === 0) return;
  const all = await loadPortfolioTrailingAnchors();
  const map = new Map(all.map((r) => [rowKey(r.userId, r.coinId), r]));
  const now = new Date().toISOString();
  for (const u of updates) {
    map.set(rowKey(u.userId, u.coinId), {
      userId: u.userId,
      coinId: u.coinId,
      trailingAnchorPrice: u.trailingAnchorPrice,
      updatedAt: now,
    });
  }
  await saveAll(Array.from(map.values()));
}

/** ลบ anchor ของสัญญาที่ไม่อยู่ใน portfolio แล้ว */
export async function pruneUserPortfolioTrailingSymbols(
  userId: string,
  activeCoinIds: string[]
): Promise<void> {
  const active = new Set(activeCoinIds);
  const all = await loadPortfolioTrailingAnchors();
  const next = all.filter((r) => r.userId !== userId || active.has(r.coinId));
  if (next.length !== all.length) await saveAll(next);
}

/** ล้าง state ทั้งหมดของ user — เมื่อปิดฟีเจอร์หรือเปลี่ยน step % */
export async function clearPortfolioTrailingStateForUser(userId: string): Promise<void> {
  const all = await loadPortfolioTrailingAnchors();
  const next = all.filter((r) => r.userId !== userId);
  if (next.length !== all.length) await saveAll(next);
}
