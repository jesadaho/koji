import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:spark_autotrade_state";
const filePath = join(process.cwd(), "data", "spark_autotrade_state.json");

/** ลบซ้ำตามลำดับเข้าก่อน — ไม่พึ่งการวน iterable ของ Set (รองรับ target เก่าที่ไม่เปิด downlevelIteration) */
function dedupeStringsInOrder(upperSymbols: string[]): string[] {
  const seen = Object.create(null) as Record<string, true>;
  const out: string[] = [];
  for (let i = 0; i < upperSymbols.length; i += 1) {
    const u = upperSymbols[i]!.trim();
    if (!u || seen[u]) continue;
    seen[u] = true;
    out.push(u);
  }
  return out;
}

export function bkkSparkAutoTradeDayKeyNow(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export type SparkAutoTradePerUserState = {
  dailyKeyBkk: string;
  /** สัญญาที่เรียก MEXC เปิดสำเร็จแล้วในวันไทยนี้ — อย่างมากหนึ่งครั้งต่อ symbol */
  openedContractSymbolsToday: string[];
};

export type SparkAutoTradeState = Record<string, SparkAutoTradePerUserState>;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องมี REDIS_URL หรือ Vercel KV สำหรับ spark autotrade state");
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

function normalizeState(raw: unknown): SparkAutoTradeState {
  if (!raw || typeof raw !== "object") return {};
  const out: SparkAutoTradeState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as { dailyKeyBkk?: unknown; openedContractSymbolsToday?: unknown };
    const dk = typeof o.dailyKeyBkk === "string" && o.dailyKeyBkk.trim() ? o.dailyKeyBkk.trim() : "";
    let syms: string[] = [];
    if (Array.isArray(o.openedContractSymbolsToday)) {
      syms = o.openedContractSymbolsToday
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim().toUpperCase());
    }
    if (!dk) continue;
    out[k.trim()] = { dailyKeyBkk: dk, openedContractSymbolsToday: dedupeStringsInOrder(syms) };
  }
  return out;
}

/** ให้เป็น state ใน-vocab ของวันไทย — ถ้าวันเก่าให้เก็บว่าง */
function userStateFresh(u: SparkAutoTradePerUserState | undefined, dayKey: string): SparkAutoTradePerUserState {
  if (!u || u.dailyKeyBkk !== dayKey) return { dailyKeyBkk: dayKey, openedContractSymbolsToday: [] };
  return {
    ...u,
    openedContractSymbolsToday: dedupeStringsInOrder(u.openedContractSymbolsToday.map((s) => s.toUpperCase())),
  };
}

export async function loadSparkAutoTradeState(): Promise<SparkAutoTradeState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<SparkAutoTradeState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[sparkAutoTradeStateStore] cloud get failed", e);
      throw new Error(`อ่าน spark_autotrade_state ไม่สำเร็จ (${hint})`);
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

export async function saveSparkAutoTradeState(state: SparkAutoTradeState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/** คืนค่าว่าวันนี้เคยเปิดสำเร็จเหรียญนี้หรือยัง (หลัง fresh ตามวันไทย) */
export function hasOpenedContractToday(
  entry: SparkAutoTradePerUserState | undefined,
  contractSymbol: string,
  dayKey: string,
): boolean {
  const sym = contractSymbol.trim().toUpperCase();
  const fresh = userStateFresh(entry, dayKey);
  return fresh.openedContractSymbolsToday.includes(sym);
}

/**
 * เพิ่ม symbol เมื่อ MEXC เปิดสำเร็จ — mutate + คืน state ใหม่หรือเขียนเหมือน immut helper
 */
export function withRecordedSuccessfulOpen(
  state: SparkAutoTradeState,
  userId: string,
  contractSymbol: string,
  dayKey: string,
): SparkAutoTradeState {
  const uid = userId.trim();
  const sym = contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  if (fresh.openedContractSymbolsToday.includes(sym)) return state;
  return {
    ...state,
    [uid]: {
      dailyKeyBkk: dayKey,
      openedContractSymbolsToday: [...fresh.openedContractSymbolsToday, sym],
    },
  };
}

