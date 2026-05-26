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

export type ReversalAutoTradeActive = {
  contractSymbol: string;
  binanceSymbol: string;
  /** ปัจจุบัน Reversal auto-open เปิดเฉพาะ SHORT — เก็บไว้เผื่ออนาคต */
  side: "short" | "long";
  openedAtMs: number;
  /** Binance close ของแท่งสัญญาณ — เผื่อ fallback / แสดงผล */
  referenceEntryPrice: number;
  /** ราคาเข้าเฉลี่ยจาก MEXC — ใช้คำนวณ % drop จริง */
  mexcAvgEntryPrice: number;
  leverage: number;
  /** TP1 ปิด partial แล้วหรือยัง — กันยิงซ้ำ */
  tp1Done: boolean;
  /** % drop จาก entry ที่จะปิดบางส่วน */
  tp1PricePct: number;
  /** % ของ holdVol ที่จะปิดเมื่อ TP1 hit */
  tp1PartialPct: number;
  /** % drop จาก entry ที่จะปิดทั้งหมด */
  tp2PricePct: number;
  /** ครบกี่ ชม. แล้วบังคับปิดทั้งหมด */
  maxHoldHours: number;
  /** orderId ของ plan SL ที่ตั้งหลัง TP1 — ใช้ cancel ตอน TP2/48h */
  slPlanOrderId?: string;
};

export type ReversalAutoTradePerUserState = {
  dailyKeyBkk: string;
  placedContractSymbolsToday: string[];
  active?: ReversalAutoTradeActive[];
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

function normalizeActive(raw: unknown): ReversalAutoTradeActive[] {
  if (!Array.isArray(raw)) return [];
  const out: ReversalAutoTradeActive[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const sym = typeof o.contractSymbol === "string" ? o.contractSymbol.trim().toUpperCase() : "";
    const binanceSymbol =
      typeof o.binanceSymbol === "string" ? o.binanceSymbol.trim().toUpperCase() : "";
    const side: "short" | "long" = o.side === "long" ? "long" : "short";
    const openedAtMs =
      typeof o.openedAtMs === "number" && Number.isFinite(o.openedAtMs) ? o.openedAtMs : NaN;
    const refEntry =
      typeof o.referenceEntryPrice === "number" && Number.isFinite(o.referenceEntryPrice)
        ? o.referenceEntryPrice
        : NaN;
    const mexcEntry =
      typeof o.mexcAvgEntryPrice === "number" && Number.isFinite(o.mexcAvgEntryPrice) && o.mexcAvgEntryPrice > 0
        ? o.mexcAvgEntryPrice
        : NaN;
    const lev =
      typeof o.leverage === "number" && Number.isFinite(o.leverage) ? Math.floor(o.leverage) : NaN;
    const tp1Done = Boolean(o.tp1Done);
    const tp1Pct =
      typeof o.tp1PricePct === "number" && Number.isFinite(o.tp1PricePct) && o.tp1PricePct > 0
        ? o.tp1PricePct
        : 10;
    const tp1Partial =
      typeof o.tp1PartialPct === "number" && Number.isFinite(o.tp1PartialPct) && o.tp1PartialPct > 0
        ? o.tp1PartialPct
        : 50;
    const tp2Pct =
      typeof o.tp2PricePct === "number" && Number.isFinite(o.tp2PricePct) && o.tp2PricePct > 0
        ? o.tp2PricePct
        : 25;
    const maxH =
      typeof o.maxHoldHours === "number" && Number.isFinite(o.maxHoldHours) && o.maxHoldHours > 0
        ? o.maxHoldHours
        : 48;
    const slId =
      typeof o.slPlanOrderId === "string" && o.slPlanOrderId.trim() ? o.slPlanOrderId.trim() : undefined;
    if (
      !sym ||
      !binanceSymbol ||
      !Number.isFinite(openedAtMs) ||
      !Number.isFinite(refEntry) ||
      !(refEntry > 0) ||
      !Number.isFinite(mexcEntry) ||
      !Number.isFinite(lev) ||
      lev < 1
    ) {
      continue;
    }
    const row: ReversalAutoTradeActive = {
      contractSymbol: sym,
      binanceSymbol,
      side,
      openedAtMs,
      referenceEntryPrice: refEntry,
      mexcAvgEntryPrice: mexcEntry,
      leverage: lev,
      tp1Done,
      tp1PricePct: tp1Pct,
      tp1PartialPct: tp1Partial,
      tp2PricePct: tp2Pct,
      maxHoldHours: maxH,
    };
    if (slId) row.slPlanOrderId = slId;
    out.push(row);
  }
  const bySym = new Map<string, ReversalAutoTradeActive>();
  for (const e of out) bySym.set(`${e.contractSymbol}|${e.side}`, e);
  const deduped: ReversalAutoTradeActive[] = [];
  bySym.forEach((v) => deduped.push(v));
  return deduped;
}

function normalizeState(raw: unknown): ReversalAutoTradeState {
  if (!raw || typeof raw !== "object") return {};
  const out: ReversalAutoTradeState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as { dailyKeyBkk?: unknown; placedContractSymbolsToday?: unknown; active?: unknown };
    const dk = typeof o.dailyKeyBkk === "string" && o.dailyKeyBkk.trim() ? o.dailyKeyBkk.trim() : "";
    if (!dk) continue;
    let syms: string[] = [];
    if (Array.isArray(o.placedContractSymbolsToday)) {
      syms = o.placedContractSymbolsToday
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => (x as string).trim().toUpperCase());
    }
    const active = normalizeActive(o.active);
    const entry: ReversalAutoTradePerUserState = {
      dailyKeyBkk: dk,
      placedContractSymbolsToday: dedupeStringsInOrder(syms),
    };
    if (active.length) entry.active = active;
    out[k.trim()] = entry;
  }
  return out;
}

function userStateFresh(
  u: ReversalAutoTradePerUserState | undefined,
  dayKey: string
): ReversalAutoTradePerUserState {
  if (!u || u.dailyKeyBkk !== dayKey) {
    const active = normalizeActive(u?.active);
    const base: ReversalAutoTradePerUserState = {
      dailyKeyBkk: dayKey,
      placedContractSymbolsToday: [],
    };
    if (active.length) base.active = active;
    return base;
  }
  const activeIn = normalizeActive(u.active);
  const next: ReversalAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: dedupeStringsInOrder(
      u.placedContractSymbolsToday.map((s) => s.toUpperCase())
    ),
  };
  if (activeIn.length) next.active = activeIn;
  return next;
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
  const next: ReversalAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: placed,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  return {
    ...state,
    [uid]: next,
  };
}

export function withReversalActiveOpen(
  state: ReversalAutoTradeState,
  userId: string,
  p: {
    contractSymbol: string;
    binanceSymbol: string;
    side: "short" | "long";
    openedAtMs: number;
    referenceEntryPrice: number;
    mexcAvgEntryPrice: number;
    leverage: number;
    tp1PricePct: number;
    tp1PartialPct: number;
    tp2PricePct: number;
    maxHoldHours: number;
  },
  dayKey: string
): ReversalAutoTradeState {
  const uid = userId.trim();
  const sym = p.contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const activePrev = normalizeActive(fresh.active);
  const activeNext = activePrev.filter((x) => !(x.contractSymbol === sym && x.side === p.side));
  const row: ReversalAutoTradeActive = {
    contractSymbol: sym,
    binanceSymbol: p.binanceSymbol.trim().toUpperCase(),
    side: p.side,
    openedAtMs: p.openedAtMs,
    referenceEntryPrice: p.referenceEntryPrice,
    mexcAvgEntryPrice: p.mexcAvgEntryPrice,
    leverage: Math.max(1, Math.floor(p.leverage)),
    tp1Done: false,
    tp1PricePct: p.tp1PricePct > 0 ? p.tp1PricePct : 10,
    tp1PartialPct: p.tp1PartialPct > 0 ? p.tp1PartialPct : 50,
    tp2PricePct: p.tp2PricePct > 0 ? p.tp2PricePct : 25,
    maxHoldHours: p.maxHoldHours > 0 ? p.maxHoldHours : 48,
  };
  activeNext.push(row);
  return {
    ...state,
    [uid]: {
      dailyKeyBkk: dayKey,
      placedContractSymbolsToday: fresh.placedContractSymbolsToday,
      active: activeNext,
    },
  };
}

export function withReversalActiveRemoved(
  state: ReversalAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: "short" | "long"
): ReversalAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).filter(
    (x) => !(x.contractSymbol === sym && x.side === side)
  );
  const nextEntry: ReversalAutoTradePerUserState = {
    dailyKeyBkk: prev.dailyKeyBkk,
    placedContractSymbolsToday: prev.placedContractSymbolsToday,
  };
  if (nextActive.length) nextEntry.active = nextActive;
  return {
    ...state,
    [uid]: nextEntry,
  };
}

export function withReversalTp1Done(
  state: ReversalAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: "short" | "long",
  slPlanOrderId?: string
): ReversalAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).map((x) => {
    if (x.contractSymbol === sym && x.side === side) {
      const updated: ReversalAutoTradeActive = { ...x, tp1Done: true };
      if (slPlanOrderId && slPlanOrderId.trim()) updated.slPlanOrderId = slPlanOrderId.trim();
      return updated;
    }
    return x;
  });
  return {
    ...state,
    [uid]: {
      ...prev,
      active: nextActive,
    },
  };
}
