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
  /** ครบกี่ ชม. แล้วบังคับปิดทั้งหมด (จังหวะ 1) */
  maxHoldHours: number;
  /** ขยายจังหวะ 2 แล้ว — ครบจังหวะ 1 แต่ยังแดง */
  holdExtendedForRed?: boolean;
  slArmRoiPct?: number;
  slEntryOffsetPct?: number;
  /** orderId ของ plan SL ที่ตั้งหลัง TP1 — ใช้ cancel ตอน TP2/48h */
  slPlanOrderId?: string;
  tp1PlanOrderId?: string;
  tp2PlanOrderId?: string;
  initialHoldVol?: number;
  tp1PlanVol?: number;
};

export type ReversalAutoTradePendingLimit = {
  contractSymbol: string;
  binanceSymbol: string;
  orderId: string;
  placedAtMs: number;
  expireAtMs: number;
  limitPrice: number;
  leverage: number;
  referenceEntryPrice: number;
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  maxHoldHours: number;
  slArmRoiPct: number;
  slEntryOffsetPct: number;
};

export type ReversalAutoTradePerUserState = {
  dailyKeyBkk: string;
  placedContractSymbolsToday: string[];
  active?: ReversalAutoTradeActive[];
  pendingLimits?: ReversalAutoTradePendingLimit[];
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

function normalizePendingLimits(raw: unknown): ReversalAutoTradePendingLimit[] {
  if (!Array.isArray(raw)) return [];
  const out: ReversalAutoTradePendingLimit[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const sym = typeof o.contractSymbol === "string" ? o.contractSymbol.trim().toUpperCase() : "";
    const binanceSymbol =
      typeof o.binanceSymbol === "string" ? o.binanceSymbol.trim().toUpperCase() : "";
    const orderId = typeof o.orderId === "string" ? o.orderId.trim() : "";
    const placedAtMs =
      typeof o.placedAtMs === "number" && Number.isFinite(o.placedAtMs) ? o.placedAtMs : NaN;
    const expireAtMs =
      typeof o.expireAtMs === "number" && Number.isFinite(o.expireAtMs) ? o.expireAtMs : NaN;
    const limitPrice =
      typeof o.limitPrice === "number" && Number.isFinite(o.limitPrice) && o.limitPrice > 0
        ? o.limitPrice
        : NaN;
    const lev =
      typeof o.leverage === "number" && Number.isFinite(o.leverage) ? Math.floor(o.leverage) : NaN;
    const refEntry =
      typeof o.referenceEntryPrice === "number" && Number.isFinite(o.referenceEntryPrice) && o.referenceEntryPrice > 0
        ? o.referenceEntryPrice
        : NaN;
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
    const slArm =
      typeof o.slArmRoiPct === "number" && Number.isFinite(o.slArmRoiPct) && o.slArmRoiPct > 0
        ? o.slArmRoiPct
        : 10;
    const slOff =
      typeof o.slEntryOffsetPct === "number" && Number.isFinite(o.slEntryOffsetPct) && o.slEntryOffsetPct >= 0
        ? o.slEntryOffsetPct
        : 0;
    if (
      !sym ||
      !binanceSymbol ||
      !orderId ||
      !Number.isFinite(placedAtMs) ||
      !Number.isFinite(expireAtMs) ||
      !Number.isFinite(limitPrice) ||
      !Number.isFinite(lev) ||
      lev < 1 ||
      !Number.isFinite(refEntry)
    ) {
      continue;
    }
    out.push({
      contractSymbol: sym,
      binanceSymbol,
      orderId,
      placedAtMs,
      expireAtMs,
      limitPrice,
      leverage: lev,
      referenceEntryPrice: refEntry,
      tp1PricePct: tp1Pct,
      tp1PartialPct: tp1Partial,
      tp2PricePct: tp2Pct,
      maxHoldHours: maxH,
      slArmRoiPct: slArm,
      slEntryOffsetPct: slOff,
    });
  }
  const byKey = new Map<string, ReversalAutoTradePendingLimit>();
  for (const e of out) byKey.set(`${e.contractSymbol}|${e.orderId}`, e);
  return Array.from(byKey.values());
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
    const slArm =
      typeof o.slArmRoiPct === "number" && Number.isFinite(o.slArmRoiPct) && o.slArmRoiPct > 0
        ? o.slArmRoiPct
        : undefined;
    const slOff =
      typeof o.slEntryOffsetPct === "number" && Number.isFinite(o.slEntryOffsetPct) && o.slEntryOffsetPct >= 0
        ? o.slEntryOffsetPct
        : undefined;
    const slId =
      typeof o.slPlanOrderId === "string" && o.slPlanOrderId.trim() ? o.slPlanOrderId.trim() : undefined;
    const tp1Plan =
      typeof o.tp1PlanOrderId === "string" && o.tp1PlanOrderId.trim() ? o.tp1PlanOrderId.trim() : undefined;
    const tp2Plan =
      typeof o.tp2PlanOrderId === "string" && o.tp2PlanOrderId.trim() ? o.tp2PlanOrderId.trim() : undefined;
    const initHold =
      typeof o.initialHoldVol === "number" && Number.isFinite(o.initialHoldVol) && o.initialHoldVol > 0
        ? o.initialHoldVol
        : undefined;
    const tp1PlanVolRaw = (o as { tp1PlanVol?: unknown }).tp1PlanVol;
    const tp1PlanVol =
      typeof tp1PlanVolRaw === "number" && Number.isFinite(tp1PlanVolRaw) && tp1PlanVolRaw > 0
        ? tp1PlanVolRaw
        : undefined;
    const holdExtendedForRed = o.holdExtendedForRed === true;
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
    if (slArm != null) row.slArmRoiPct = slArm;
    if (slOff != null) row.slEntryOffsetPct = slOff;
    if (slId) row.slPlanOrderId = slId;
    if (tp1Plan) row.tp1PlanOrderId = tp1Plan;
    if (tp2Plan) row.tp2PlanOrderId = tp2Plan;
    if (initHold != null) row.initialHoldVol = initHold;
    if (tp1PlanVol != null) row.tp1PlanVol = tp1PlanVol;
    if (holdExtendedForRed) row.holdExtendedForRed = true;
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
    const o = v as {
      dailyKeyBkk?: unknown;
      placedContractSymbolsToday?: unknown;
      active?: unknown;
      pendingLimits?: unknown;
    };
    const dk = typeof o.dailyKeyBkk === "string" && o.dailyKeyBkk.trim() ? o.dailyKeyBkk.trim() : "";
    if (!dk) continue;
    let syms: string[] = [];
    if (Array.isArray(o.placedContractSymbolsToday)) {
      syms = o.placedContractSymbolsToday
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => (x as string).trim().toUpperCase());
    }
    const active = normalizeActive(o.active);
    const pendingLimits = normalizePendingLimits(o.pendingLimits);
    const entry: ReversalAutoTradePerUserState = {
      dailyKeyBkk: dk,
      placedContractSymbolsToday: dedupeStringsInOrder(syms),
    };
    if (active.length) entry.active = active;
    if (pendingLimits.length) entry.pendingLimits = pendingLimits;
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
    const pendingLimits = normalizePendingLimits(u?.pendingLimits);
    const base: ReversalAutoTradePerUserState = {
      dailyKeyBkk: dayKey,
      placedContractSymbolsToday: [],
    };
    if (active.length) base.active = active;
    if (pendingLimits.length) base.pendingLimits = pendingLimits;
    return base;
  }
  const activeIn = normalizeActive(u.active);
  const pendingIn = normalizePendingLimits(u.pendingLimits);
  const next: ReversalAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: dedupeStringsInOrder(
      u.placedContractSymbolsToday.map((s) => s.toUpperCase())
    ),
  };
  if (activeIn.length) next.active = activeIn;
  if (pendingIn.length) next.pendingLimits = pendingIn;
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
  if (fresh.pendingLimits && fresh.pendingLimits.length) next.pendingLimits = fresh.pendingLimits;
  return {
    ...state,
    [uid]: next,
  };
}

export function withReversalPlacedUnlocked(
  state: ReversalAutoTradeState,
  userId: string,
  contractSymbol: string,
  dayKey: string,
): ReversalAutoTradeState {
  const uid = userId.trim();
  const sym = contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const placed = fresh.placedContractSymbolsToday.filter((s) => s !== sym);
  const next: ReversalAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: placed,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  if (fresh.pendingLimits && fresh.pendingLimits.length) next.pendingLimits = fresh.pendingLimits;
  return { ...state, [uid]: next };
}

export function withReversalPendingLimitAdded(
  state: ReversalAutoTradeState,
  userId: string,
  pending: ReversalAutoTradePendingLimit,
  dayKey: string,
): ReversalAutoTradeState {
  const uid = userId.trim();
  const sym = pending.contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const pendingPrev = normalizePendingLimits(fresh.pendingLimits);
  const pendingNext = pendingPrev.filter((x) => !(x.contractSymbol === sym && x.orderId === pending.orderId));
  pendingNext.push({
    ...pending,
    contractSymbol: sym,
    binanceSymbol: pending.binanceSymbol.trim().toUpperCase(),
    orderId: pending.orderId.trim(),
  });
  const next: ReversalAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: fresh.placedContractSymbolsToday,
    pendingLimits: pendingNext,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  return { ...state, [uid]: next };
}

export function withReversalPendingLimitRemoved(
  state: ReversalAutoTradeState,
  userId: string,
  contractSymbol: string,
  orderId: string,
  dayKey: string,
): ReversalAutoTradeState {
  const uid = userId.trim();
  const sym = contractSymbol.trim().toUpperCase();
  const oid = orderId.trim();
  const prev = state[uid];
  if (!prev?.pendingLimits?.length) return state;
  const fresh = userStateFresh(prev, dayKey);
  const pendingNext = normalizePendingLimits(fresh.pendingLimits).filter(
    (x) => !(x.contractSymbol === sym && x.orderId === oid),
  );
  const next: ReversalAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: fresh.placedContractSymbolsToday,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  if (pendingNext.length) next.pendingLimits = pendingNext;
  return { ...state, [uid]: next };
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
    slArmRoiPct: number;
    slEntryOffsetPct: number;
    tp1PlanOrderId?: string;
    tp2PlanOrderId?: string;
    initialHoldVol?: number;
    tp1PlanVol?: number;
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
    slArmRoiPct: p.slArmRoiPct > 0 ? p.slArmRoiPct : 10,
    slEntryOffsetPct:
      typeof p.slEntryOffsetPct === "number" && Number.isFinite(p.slEntryOffsetPct) && p.slEntryOffsetPct >= 0
        ? p.slEntryOffsetPct
        : 0,
  };
  if (p.tp1PlanOrderId?.trim()) row.tp1PlanOrderId = p.tp1PlanOrderId.trim();
  if (p.tp2PlanOrderId?.trim()) row.tp2PlanOrderId = p.tp2PlanOrderId.trim();
  if (typeof p.initialHoldVol === "number" && p.initialHoldVol > 0) row.initialHoldVol = p.initialHoldVol;
  if (typeof p.tp1PlanVol === "number" && p.tp1PlanVol > 0) row.tp1PlanVol = p.tp1PlanVol;
  activeNext.push(row);
  const next: ReversalAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    placedContractSymbolsToday: fresh.placedContractSymbolsToday,
    active: activeNext,
  };
  if (fresh.pendingLimits && fresh.pendingLimits.length) next.pendingLimits = fresh.pendingLimits;
  return {
    ...state,
    [uid]: next,
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
  if (prev.pendingLimits && prev.pendingLimits.length) nextEntry.pendingLimits = normalizePendingLimits(prev.pendingLimits);
  return {
    ...state,
    [uid]: nextEntry,
  };
}

export function withReversalSlAtEntryArmed(
  state: ReversalAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: "short" | "long",
  slPlanOrderId?: string,
): ReversalAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).map((x) => {
    if (x.contractSymbol === sym && x.side === side) {
      const updated: ReversalAutoTradeActive = { ...x };
      if (slPlanOrderId?.trim()) updated.slPlanOrderId = slPlanOrderId.trim();
      return updated;
    }
    return x;
  });
  return { ...state, [uid]: { ...prev, active: nextActive } };
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

export function withReversalHoldExtendedForRed(
  state: ReversalAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: "short" | "long",
): ReversalAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).map((x) => {
    if (x.contractSymbol === sym && x.side === side) {
      return { ...x, holdExtendedForRed: true };
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
