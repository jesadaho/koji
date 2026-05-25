import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:reversal_autotrade_state";
const filePath = join(process.cwd(), "data", "reversal_autotrade_state.json");

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

export function bkkReversalAutoTradeDayKeyNow(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export type ReversalAutoTradePerUserState = {
  dailyKeyBkk: string;
  placedContractSymbolsToday: string[];
};

export type ReversalAutoTradeState = Record<string, ReversalAutoTradePerUserState>;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องมี REDIS_URL หรือ Vercel KV สำหรับ reversal autotrade state");
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

function normalizeState(raw: unknown): ReversalAutoTradeState {
  if (!raw || typeof raw !== "object") return {};
  const out: ReversalAutoTradeState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as { dailyKeyBkk?: unknown; placedContractSymbolsToday?: unknown };
    const dk = typeof o.dailyKeyBkk === "string" && o.dailyKeyBkk.trim() ? o.dailyKeyBkk.trim() : "";
    if (!dk) continue;
    let syms: string[] = [];
    if (Array.isArray(o.placedContractSymbolsToday)) {
      syms = o.placedContractSymbolsToday
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => (x as string).trim().toUpperCase());
    }
    out[k.trim()] = {
      dailyKeyBkk: dk,
      placedContractSymbolsToday: dedupeStringsInOrder(syms),
    };
  }
  return out;
}

function userStateFresh(
  u: ReversalAutoTradePerUserState | undefined,
  dayKey: string
): ReversalAutoTradePerUserState {
  if (!u || u.dailyKeyBkk !== dayKey) {
    return { dailyKeyBkk: dayKey, placedContractSymbolsToday: [] };
  }
  return {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: dedupeStringsInOrder(
      u.placedContractSymbolsToday.map((s) => s.toUpperCase())
    ),
  };
}

export async function loadReversalAutoTradeState(): Promise<ReversalAutoTradeState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<ReversalAutoTradeState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[reversalAutoTradeStateStore] cloud get failed", e);
      throw new Error(`อ่าน reversal_autotrade_state ไม่สำเร็จ (${hint})`);
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

export async function saveReversalAutoTradeState(state: ReversalAutoTradeState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function hasPlacedReversalContractToday(
  entry: ReversalAutoTradePerUserState | undefined,
  contractSymbol: string,
  dayKey: string
): boolean {
  const sym = contractSymbol.trim().toUpperCase();
  const fresh = userStateFresh(entry, dayKey);
  return fresh.placedContractSymbolsToday.includes(sym);
}

export function withRecordedReversalPlaced(
  state: ReversalAutoTradeState,
  userId: string,
  contractSymbol: string,
  dayKey: string
): ReversalAutoTradeState {
  const uid = userId.trim();
  const sym = contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const placed = fresh.placedContractSymbolsToday.includes(sym)
    ? fresh.placedContractSymbolsToday
    : [...fresh.placedContractSymbolsToday, sym];
  return {
    ...state,
    [uid]: {
      dailyKeyBkk: dayKey,
      placedContractSymbolsToday: placed,
    },
  };
}
