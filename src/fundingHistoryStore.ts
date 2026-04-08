import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

export type FundingHistoryPoint = {
  /** ISO timestamp ต้นชั่วโมง UTC ที่ sample */
  t: string;
  /** funding rate จาก ticker (ตัวเดียวกับหน้า Markets) */
  r: number;
};

const KV_KEY = "koji:funding_history_24h";
const MAX_POINTS = 24;
const filePath = join(process.cwd(), "data", "funding_history_24h.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับ funding history"
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

export type FundingHistoryBlob = Record<string, FundingHistoryPoint[]>;

export async function loadFundingHistoryBlob(): Promise<FundingHistoryBlob> {
  if (useCloudStorage()) {
    const data = await cloudGet<FundingHistoryBlob>(KV_KEY);
    return data && typeof data === "object" ? data : {};
  }
  if (isVercel()) return {};
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as FundingHistoryBlob;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveFundingHistoryBlob(blob: FundingHistoryBlob): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, blob);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(blob, null, 2), "utf-8");
}

function mergePoint(series: FundingHistoryPoint[], bucketIso: string, r: number): FundingHistoryPoint[] {
  const next = [...series];
  const last = next[next.length - 1];
  if (last && last.t === bucketIso) {
    next[next.length - 1] = { t: bucketIso, r };
  } else {
    next.push({ t: bucketIso, r });
  }
  return next.slice(-MAX_POINTS);
}

/**
 * อัปเดตเฉพาะ symbol ในรายการ — ลบ symbol อื่นออกจาก blob (เก็บแค่ top ชุดล่าสุด)
 */
export async function appendFundingHistorySamples(
  entries: Array<{ symbol: string; fundingRate: number }>,
  hourBucketUtcIso: string
): Promise<void> {
  const blob = await loadFundingHistoryBlob();
  const keep = new Set(entries.map((e) => e.symbol));
  for (const key of Object.keys(blob)) {
    if (!keep.has(key)) delete blob[key];
  }
  for (const { symbol, fundingRate } of entries) {
    const prev = blob[symbol] ?? [];
    blob[symbol] = mergePoint(prev, hourBucketUtcIso, fundingRate);
  }
  await saveFundingHistoryBlob(blob);
}

export async function getFundingHistoryForSymbol(symbol: string): Promise<FundingHistoryPoint[]> {
  const blob = await loadFundingHistoryBlob();
  const series = blob[symbol];
  return Array.isArray(series) ? [...series].reverse() : [];
}
