import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:ema612_15m_watch_cross_state";
const filePath = join(process.cwd(), "data", "ema612_15m_watch_cross_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ EMA6/12 watch cross state"
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

/** คีย์ = `${userId}\t${coinId}` — เวลาเปิดแท่ง 15m ที่ปิดล่าสุดตอนแจ้งครั้งล่าสุด */
export type Ema612WatchCrossState = Record<string, { lastFiredBarTimeSec: number }>;

function normalizeState(raw: unknown): Ema612WatchCrossState {
  if (!raw || typeof raw !== "object") return {};
  const out: Ema612WatchCrossState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    if (!v || typeof v !== "object") continue;
    const t = Number((v as { lastFiredBarTimeSec?: unknown }).lastFiredBarTimeSec);
    if (!Number.isFinite(t) || t <= 0) continue;
    out[k.trim()] = { lastFiredBarTimeSec: t };
  }
  return out;
}

export function stateKey(userId: string, coinId: string): string {
  return `${userId}\t${coinId}`;
}

export async function loadEma612WatchCrossState(): Promise<Ema612WatchCrossState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<Ema612WatchCrossState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[ema612WatchCrossStateStore] cloud get failed", e);
      throw new Error(`อ่าน ema612_15m_watch_cross_state ไม่สำเร็จ (${hint})`);
    }
  }
  if (isVercel()) return {};
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export async function saveEma612WatchCrossState(state: Ema612WatchCrossState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/** ลบคีย์ที่ไม่มีใน watches ที่ส่งมา — key รูปแบบ userId\tcoinId */
export function pruneEma612WatchCrossState(
  state: Ema612WatchCrossState,
  validKeys: Set<string>
): Ema612WatchCrossState {
  const out: Ema612WatchCrossState = {};
  for (const k of Object.keys(state)) {
    if (validKeys.has(k)) out[k] = state[k]!;
  }
  return out;
}
