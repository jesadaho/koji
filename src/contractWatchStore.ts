import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { kv } from "@vercel/kv";

export type ContractWatch = {
  id: string;
  userId: string;
  /** สัญญา MEXC เช่น BTC_USDT */
  coinId: string;
  symbolLabel: string;
  createdAt: string;
};

export type FundingSnapshotRow = {
  fundingRate: number;
  collectCycle: number;
  nextSettleTime: number;
  updatedAt: string;
};

export type OrderSnapshotRow = {
  minVol: number;
  maxVol: number;
  limitMaxVol: number | null;
  updatedAt: string;
};

const KV_WATCHES = "koji:contract_watches";
const KV_SNAP_FUNDING = "koji:snap:funding";
const KV_SNAP_ORDER = "koji:snap:order";

const fileWatches = join(process.cwd(), "data", "contract_watches.json");
const fileSnapFunding = join(process.cwd(), "data", "contract_snap_funding.json");
const fileSnapOrder = join(process.cwd(), "data", "contract_snap_order.json");

function useKv(): boolean {
  return Boolean(process.env.KV_REST_API_URL);
}

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useKv()) {
    throw new Error("บน Vercel ต้องมี Vercel KV สำหรับ contract watches / snapshots");
  }
}

async function ensureJsonFile(path: string, initial: string): Promise<void> {
  try {
    await readFile(path, "utf-8");
  } catch {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, initial, "utf-8");
  }
}

export async function loadContractWatches(): Promise<ContractWatch[]> {
  if (useKv()) {
    try {
      const data = await kv.get<ContractWatch[]>(KV_WATCHES);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[contractWatchStore] kv.get watches failed", e);
      throw new Error(`อ่าน KV contract_watches ไม่สำเร็จ (${hint})`);
    }
  }
  if (isVercel()) return [];
  await ensureJsonFile(fileWatches, "[]");
  const raw = await readFile(fileWatches, "utf-8");
  try {
    const parsed = JSON.parse(raw) as ContractWatch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveContractWatches(rows: ContractWatch[]): Promise<void> {
  if (useKv()) {
    await kv.set(KV_WATCHES, rows);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(fileWatches), { recursive: true });
  await writeFile(fileWatches, JSON.stringify(rows, null, 2), "utf-8");
}

export async function loadFundingSnapshots(): Promise<Record<string, FundingSnapshotRow>> {
  if (useKv()) {
    const data = await kv.get<Record<string, FundingSnapshotRow>>(KV_SNAP_FUNDING);
    return data && typeof data === "object" ? data : {};
  }
  if (isVercel()) return {};
  await ensureJsonFile(fileSnapFunding, "{}");
  const raw = await readFile(fileSnapFunding, "utf-8");
  try {
    const parsed = JSON.parse(raw) as Record<string, FundingSnapshotRow>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveFundingSnapshots(map: Record<string, FundingSnapshotRow>): Promise<void> {
  if (useKv()) {
    await kv.set(KV_SNAP_FUNDING, map);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(fileSnapFunding), { recursive: true });
  await writeFile(fileSnapFunding, JSON.stringify(map, null, 2), "utf-8");
}

export async function loadOrderSnapshots(): Promise<Record<string, OrderSnapshotRow>> {
  if (useKv()) {
    const data = await kv.get<Record<string, OrderSnapshotRow>>(KV_SNAP_ORDER);
    return data && typeof data === "object" ? data : {};
  }
  if (isVercel()) return {};
  await ensureJsonFile(fileSnapOrder, "{}");
  const raw = await readFile(fileSnapOrder, "utf-8");
  try {
    const parsed = JSON.parse(raw) as Record<string, OrderSnapshotRow>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveOrderSnapshots(map: Record<string, OrderSnapshotRow>): Promise<void> {
  if (useKv()) {
    await kv.set(KV_SNAP_ORDER, map);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(fileSnapOrder), { recursive: true });
  await writeFile(fileSnapOrder, JSON.stringify(map, null, 2), "utf-8");
}

export async function addContractWatch(row: Omit<ContractWatch, "id" | "createdAt">): Promise<ContractWatch> {
  const all = await loadContractWatches();
  const dup = all.some((w) => w.userId === row.userId && w.coinId === row.coinId);
  if (dup) {
    const existing = all.find((w) => w.userId === row.userId && w.coinId === row.coinId)!;
    return existing;
  }
  const next: ContractWatch = {
    ...row,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  all.push(next);
  await saveContractWatches(all);
  return next;
}

export async function removeContractWatchById(userId: string, id: string): Promise<boolean> {
  const all = await loadContractWatches();
  const idx = all.findIndex((w) => w.userId === userId && w.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await saveContractWatches(all);
  return true;
}

export async function listContractWatchesForUser(userId: string): Promise<ContractWatch[]> {
  return (await loadContractWatches())
    .filter((w) => w.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** userId ที่ watch symbol นี้ (ไม่ซ้ำ) */
export function userIdsForSymbol(watches: ContractWatch[], symbol: string): string[] {
  const set = new Set<string>();
  for (const w of watches) {
    if (w.coinId === symbol) set.add(w.userId);
  }
  return Array.from(set);
}

export function uniqueWatchedSymbols(watches: ContractWatch[]): string[] {
  const set = new Set<string>();
  for (const w of watches) set.add(w.coinId);
  return Array.from(set);
}
