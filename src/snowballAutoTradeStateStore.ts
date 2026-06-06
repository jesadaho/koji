import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:snowball_autotrade_state";
const filePath = join(process.cwd(), "data", "snowball_autotrade_state.json");

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

export function bkkSnowballAutoTradeDayKeyNow(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

/** 0 = Sunday … 6 = Saturday (Asia/Bangkok, no DST) */
export function bkkWeekdayIndexNow(): number {
  const w =
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", weekday: "short" }).format(
      new Date(),
    ) ?? "";
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] ?? 0;
}

export function bkkIsSundayNow(): boolean {
  return bkkWeekdayIndexNow() === 0;
}

export function bkkIsSaturdayNow(): boolean {
  return bkkWeekdayIndexNow() === 6;
}

export type SnowballAutoTradeSide = "long" | "short";

export type SnowballAutoTradeActive = {
  contractSymbol: string;
  /** Snowball universe symbol (Binance-style) ใช้ fetch kline สำหรับกติกา 24h */
  binanceSymbol: string;
  side: SnowballAutoTradeSide;
  openedAtMs: number;
  /** จุดเข้าซื้อที่บอทแนะนำ (Binance แท่งสัญญาณ) — กติกา 24h / แสดงผล */
  referenceEntryPrice: number;
  /** ราคาเข้าเฉลี่ยจาก MEXC หลังเปิด (ถ้ามี) — TP/SL ใช้คำนวณ % เคลื่อน */
  mexcAvgEntryPrice?: number;
  signalBarOpenSec: number;
  signalBarTf: "15m" | "1h" | "4h";
  signalBarLow: number | null;
  svpHoleYn: "Y" | "N";
  leverage: number;
  /** @deprecated active เก่า — ใช้ quick TP tick */
  quickTpEnabled?: boolean;
  quickTpRoiPct?: number;
  quickTpMaxHours?: number;
  /** TP/SL plan snapshot ตอนเปิด (เหมือน Reversal) */
  tpSlEnabled?: boolean;
  tp1Done?: boolean;
  tp1PricePct?: number;
  tp1PartialPct?: number;
  tp2PricePct?: number;
  maxHoldHours?: number;
  slArmRoiPct?: number;
  slEntryOffsetPct?: number;
  slPlanOrderId?: string;
  /** plan TP บน MEXC — วางทันทีหลัง open */
  tp1PlanOrderId?: string;
  tp2PlanOrderId?: string;
  initialHoldVol?: number;
  tp1PlanVol?: number;
  /** ประเมินกติกา 24h แล้ว — ไม่รันซ้ำ (ยังคง track TP/SL ต่อ) */
  guard24hEvaluated?: boolean;
};

export type SnowballAutoTradePendingLimit = {
  contractSymbol: string;
  binanceSymbol: string;
  side: SnowballAutoTradeSide;
  orderId: string;
  placedAtMs: number;
  expireAtMs: number;
  limitPrice: number;
  leverage: number;
  referenceEntryPrice: number;
  signalBarOpenSec: number;
  signalBarTf: "15m" | "1h" | "4h";
  signalBarLow: number | null;
  svpHoleYn: "Y" | "N";
  tpSlEnabled: boolean;
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  maxHoldHours: number;
  slArmRoiPct: number;
  slEntryOffsetPct: number;
};

export type SnowballAutoTradePerUserState = {
  dailyKeyBkk: string;
  openedContractSymbolsToday: string[];
  active?: SnowballAutoTradeActive[];
  pendingLimits?: SnowballAutoTradePendingLimit[];
};

export type SnowballAutoTradeState = Record<string, SnowballAutoTradePerUserState>;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องมี REDIS_URL หรือ Vercel KV สำหรับ snowball autotrade state");
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

function normalizePendingLimits(raw: unknown): SnowballAutoTradePendingLimit[] {
  if (!Array.isArray(raw)) return [];
  const out: SnowballAutoTradePendingLimit[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const sym = typeof o.contractSymbol === "string" ? o.contractSymbol.trim().toUpperCase() : "";
    const binanceSymbol =
      typeof o.binanceSymbol === "string" ? o.binanceSymbol.trim().toUpperCase() : "";
    const side = o.side === "long" || o.side === "short" ? (o.side as SnowballAutoTradeSide) : null;
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
    const signalBarOpenSec =
      typeof o.signalBarOpenSec === "number" && Number.isFinite(o.signalBarOpenSec)
        ? o.signalBarOpenSec
        : NaN;
    const signalBarTf =
      o.signalBarTf === "15m" || o.signalBarTf === "1h" || o.signalBarTf === "4h"
        ? o.signalBarTf
        : null;
    const signalBarLow =
      o.signalBarLow === null
        ? null
        : typeof o.signalBarLow === "number" && Number.isFinite(o.signalBarLow)
          ? o.signalBarLow
          : null;
    const svpHoleYn = o.svpHoleYn === "Y" || o.svpHoleYn === "N" ? o.svpHoleYn : "N";
    const tpSlEnabled = o.tpSlEnabled === true;
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
      !side ||
      !orderId ||
      !Number.isFinite(placedAtMs) ||
      !Number.isFinite(expireAtMs) ||
      !Number.isFinite(limitPrice) ||
      !Number.isFinite(lev) ||
      lev < 1 ||
      !Number.isFinite(refEntry) ||
      !Number.isFinite(signalBarOpenSec) ||
      !signalBarTf
    ) {
      continue;
    }
    out.push({
      contractSymbol: sym,
      binanceSymbol,
      side,
      orderId,
      placedAtMs,
      expireAtMs,
      limitPrice,
      leverage: lev,
      referenceEntryPrice: refEntry,
      signalBarOpenSec,
      signalBarTf,
      signalBarLow,
      svpHoleYn,
      tpSlEnabled,
      tp1PricePct: tp1Pct,
      tp1PartialPct: tp1Partial,
      tp2PricePct: tp2Pct,
      maxHoldHours: maxH,
      slArmRoiPct: slArm,
      slEntryOffsetPct: slOff,
    });
  }
  const byKey = new Map<string, SnowballAutoTradePendingLimit>();
  for (const e of out) byKey.set(`${e.contractSymbol}|${e.side}|${e.orderId}`, e);
  return Array.from(byKey.values());
}

function normalizeActive(raw: unknown): SnowballAutoTradeActive[] {
  if (!Array.isArray(raw)) return [];
  const out: SnowballAutoTradeActive[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const sym = typeof o.contractSymbol === "string" ? o.contractSymbol.trim().toUpperCase() : "";
    const binanceSymbol = typeof o.binanceSymbol === "string" ? o.binanceSymbol.trim().toUpperCase() : "";
    const side = o.side === "long" || o.side === "short" ? (o.side as SnowballAutoTradeSide) : null;
    const openedAtMs = typeof o.openedAtMs === "number" && Number.isFinite(o.openedAtMs) ? o.openedAtMs : NaN;
    const entry = typeof o.referenceEntryPrice === "number" && Number.isFinite(o.referenceEntryPrice) ? o.referenceEntryPrice : NaN;
    const mexcEntryRaw = (o as { mexcAvgEntryPrice?: unknown }).mexcAvgEntryPrice;
    const mexcAvgEntryPrice =
      typeof mexcEntryRaw === "number" && Number.isFinite(mexcEntryRaw) && mexcEntryRaw > 0 ? mexcEntryRaw : undefined;
    const signalBarOpenSec =
      typeof o.signalBarOpenSec === "number" && Number.isFinite(o.signalBarOpenSec) ? o.signalBarOpenSec : NaN;
    const signalBarTf =
      o.signalBarTf === "4h" || o.signalBarTf === "1h" || o.signalBarTf === "15m"
        ? (o.signalBarTf as "15m" | "1h" | "4h")
        : "15m";
    const signalBarLowRaw = (o as { signalBarLow?: unknown }).signalBarLow;
    const signalBarLow =
      typeof signalBarLowRaw === "number" && Number.isFinite(signalBarLowRaw) && signalBarLowRaw > 0
        ? signalBarLowRaw
        : null;
    const svpHoleYn = o.svpHoleYn === "Y" || o.svpHoleYn === "N" ? (o.svpHoleYn as "Y" | "N") : "N";
    const lev = typeof o.leverage === "number" && Number.isFinite(o.leverage) ? Math.floor(o.leverage) : NaN;
    const qEn = Boolean(o.quickTpEnabled);
    const qRoi = typeof o.quickTpRoiPct === "number" && Number.isFinite(o.quickTpRoiPct) ? o.quickTpRoiPct : NaN;
    const qH = typeof o.quickTpMaxHours === "number" && Number.isFinite(o.quickTpMaxHours) ? o.quickTpMaxHours : NaN;
    const tpSlEn = o.tpSlEnabled === true || o.tpSlEnabled === false ? Boolean(o.tpSlEnabled) : null;
    const tp1Done = Boolean(o.tp1Done);
    const tp1Pct = typeof o.tp1PricePct === "number" && Number.isFinite(o.tp1PricePct) ? o.tp1PricePct : NaN;
    const tp1Part = typeof o.tp1PartialPct === "number" && Number.isFinite(o.tp1PartialPct) ? o.tp1PartialPct : NaN;
    const tp2Pct = typeof o.tp2PricePct === "number" && Number.isFinite(o.tp2PricePct) ? o.tp2PricePct : NaN;
    const maxH = typeof o.maxHoldHours === "number" && Number.isFinite(o.maxHoldHours) ? o.maxHoldHours : NaN;
    const slArm =
      typeof o.slArmRoiPct === "number" && Number.isFinite(o.slArmRoiPct) && o.slArmRoiPct > 0
        ? o.slArmRoiPct
        : undefined;
    const slOff =
      typeof o.slEntryOffsetPct === "number" && Number.isFinite(o.slEntryOffsetPct) && o.slEntryOffsetPct >= 0
        ? o.slEntryOffsetPct
        : undefined;
    const slPlan =
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
    if (
      !sym ||
      !binanceSymbol ||
      !side ||
      !Number.isFinite(openedAtMs) ||
      !Number.isFinite(entry) ||
      !(entry > 0) ||
      !Number.isFinite(signalBarOpenSec) ||
      !Number.isFinite(lev) ||
      lev < 1
    ) {
      continue;
    }
    const hasTpSlPlan =
      tpSlEn === true ||
      (Number.isFinite(tp1Pct) && tp1Pct > 0 && Number.isFinite(tp2Pct) && tp2Pct > 0 && Number.isFinite(maxH) && maxH > 0);
    const row: SnowballAutoTradeActive = {
      contractSymbol: sym,
      binanceSymbol,
      side,
      openedAtMs,
      referenceEntryPrice: entry,
      signalBarOpenSec,
      signalBarTf,
      signalBarLow,
      svpHoleYn,
      leverage: lev,
    };
    if (mexcAvgEntryPrice != null) row.mexcAvgEntryPrice = mexcAvgEntryPrice;
    if (o.guard24hEvaluated === true) row.guard24hEvaluated = true;
    if (hasTpSlPlan) {
      row.tpSlEnabled = tpSlEn !== false;
      row.tp1Done = tp1Done;
      row.tp1PricePct = Number.isFinite(tp1Pct) && tp1Pct > 0 ? tp1Pct : 10;
      row.tp1PartialPct = Number.isFinite(tp1Part) && tp1Part > 0 ? Math.min(100, tp1Part) : 50;
      row.tp2PricePct = Number.isFinite(tp2Pct) && tp2Pct > 0 ? tp2Pct : 25;
      row.maxHoldHours = Number.isFinite(maxH) && maxH > 0 ? maxH : 48;
      if (slArm != null) row.slArmRoiPct = slArm;
      if (slOff != null) row.slEntryOffsetPct = slOff;
      if (slPlan) row.slPlanOrderId = slPlan;
      if (tp1Plan) row.tp1PlanOrderId = tp1Plan;
      if (tp2Plan) row.tp2PlanOrderId = tp2Plan;
      if (initHold != null) row.initialHoldVol = initHold;
      if (tp1PlanVol != null) row.tp1PlanVol = tp1PlanVol;
    } else if (qEn) {
      row.quickTpEnabled = true;
      row.quickTpRoiPct = Number.isFinite(qRoi) && qRoi > 0 ? qRoi : 30;
      row.quickTpMaxHours = Number.isFinite(qH) && qH > 0 ? qH : 4;
    }
    out.push(row);
  }
  const bySym = new Map<string, SnowballAutoTradeActive>();
  for (const e of out) bySym.set(`${e.contractSymbol}|${e.side}`, e);
  const deduped: SnowballAutoTradeActive[] = [];
  bySym.forEach((v) => deduped.push(v));
  return deduped;
}

function normalizeState(raw: unknown): SnowballAutoTradeState {
  if (!raw || typeof raw !== "object") return {};
  const out: SnowballAutoTradeState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as {
      dailyKeyBkk?: unknown;
      openedContractSymbolsToday?: unknown;
      active?: unknown;
      pendingLimits?: unknown;
    };
    const dk = typeof o.dailyKeyBkk === "string" && o.dailyKeyBkk.trim() ? o.dailyKeyBkk.trim() : "";
    let syms: string[] = [];
    if (Array.isArray(o.openedContractSymbolsToday)) {
      syms = o.openedContractSymbolsToday
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim().toUpperCase());
    }
    if (!dk) continue;
    const active = normalizeActive(o.active);
    const pendingLimits = normalizePendingLimits(o.pendingLimits);
    const entry: SnowballAutoTradePerUserState = {
      dailyKeyBkk: dk,
      openedContractSymbolsToday: dedupeStringsInOrder(syms),
    };
    if (active.length) entry.active = active;
    if (pendingLimits.length) entry.pendingLimits = pendingLimits;
    out[k.trim()] = entry;
  }
  return out;
}

function userStateFresh(
  u: SnowballAutoTradePerUserState | undefined,
  dayKey: string
): SnowballAutoTradePerUserState {
  if (!u || u.dailyKeyBkk !== dayKey) {
    const active = normalizeActive(u?.active);
    const pendingLimits = normalizePendingLimits(u?.pendingLimits);
    const base: SnowballAutoTradePerUserState = {
      dailyKeyBkk: dayKey,
      openedContractSymbolsToday: [],
    };
    if (active.length) base.active = active;
    if (pendingLimits.length) base.pendingLimits = pendingLimits;
    return base;
  }
  const activeIn = normalizeActive(u.active);
  const pendingIn = normalizePendingLimits(u.pendingLimits);
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: dedupeStringsInOrder(u.openedContractSymbolsToday.map((s) => s.toUpperCase())),
  };
  if (activeIn.length) next.active = activeIn;
  if (pendingIn.length) next.pendingLimits = pendingIn;
  return next;
}

export async function loadSnowballAutoTradeState(): Promise<SnowballAutoTradeState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<SnowballAutoTradeState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[snowballAutoTradeStateStore] cloud get failed", e);
      throw new Error(`อ่าน snowball_autotrade_state ไม่สำเร็จ (${hint})`);
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

export async function saveSnowballAutoTradeState(state: SnowballAutoTradeState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function withRecordedSnowballPlaced(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  dayKey: string,
): SnowballAutoTradeState {
  const uid = userId.trim();
  const sym = contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const opened = fresh.openedContractSymbolsToday.includes(sym)
    ? fresh.openedContractSymbolsToday
    : [...fresh.openedContractSymbolsToday, sym];
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: opened,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  if (fresh.pendingLimits && fresh.pendingLimits.length) next.pendingLimits = fresh.pendingLimits;
  return { ...state, [uid]: next };
}

export function withSnowballOpenedUnlocked(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  dayKey: string,
): SnowballAutoTradeState {
  const uid = userId.trim();
  const sym = contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const opened = fresh.openedContractSymbolsToday.filter((s) => s !== sym);
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: opened,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  if (fresh.pendingLimits && fresh.pendingLimits.length) next.pendingLimits = fresh.pendingLimits;
  return { ...state, [uid]: next };
}

export function withSnowballPendingLimitAdded(
  state: SnowballAutoTradeState,
  userId: string,
  pending: SnowballAutoTradePendingLimit,
  dayKey: string,
): SnowballAutoTradeState {
  const uid = userId.trim();
  const sym = pending.contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const pendingPrev = normalizePendingLimits(fresh.pendingLimits);
  const pendingNext = pendingPrev.filter(
    (x) => !(x.contractSymbol === sym && x.side === pending.side && x.orderId === pending.orderId),
  );
  pendingNext.push({
    ...pending,
    contractSymbol: sym,
    binanceSymbol: pending.binanceSymbol.trim().toUpperCase(),
    orderId: pending.orderId.trim(),
  });
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: fresh.openedContractSymbolsToday,
    pendingLimits: pendingNext,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  return { ...state, [uid]: next };
}

export function withSnowballPendingLimitRemoved(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: SnowballAutoTradeSide,
  orderId: string,
  dayKey: string,
): SnowballAutoTradeState {
  const uid = userId.trim();
  const sym = contractSymbol.trim().toUpperCase();
  const oid = orderId.trim();
  const prev = state[uid];
  if (!prev?.pendingLimits?.length) return state;
  const fresh = userStateFresh(prev, dayKey);
  const pendingNext = normalizePendingLimits(fresh.pendingLimits).filter(
    (x) => !(x.contractSymbol === sym && x.side === side && x.orderId === oid),
  );
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: fresh.openedContractSymbolsToday,
  };
  if (fresh.active && fresh.active.length) next.active = fresh.active;
  if (pendingNext.length) next.pendingLimits = pendingNext;
  return { ...state, [uid]: next };
}

export function hasOpenedSnowballContractToday(
  entry: SnowballAutoTradePerUserState | undefined,
  contractSymbol: string,
  dayKey: string
): boolean {
  const sym = contractSymbol.trim().toUpperCase();
  const fresh = userStateFresh(entry, dayKey);
  return fresh.openedContractSymbolsToday.includes(sym);
}

export function withRecordedSnowballSuccessfulOpen(
  state: SnowballAutoTradeState,
  userId: string,
  p: {
    contractSymbol: string;
    binanceSymbol: string;
    side: SnowballAutoTradeSide;
    openedAtMs: number;
    referenceEntryPrice: number;
    signalBarOpenSec: number;
    signalBarTf: "15m" | "1h" | "4h";
    signalBarLow: number | null;
    svpHoleYn: "Y" | "N";
    leverage: number;
    mexcAvgEntryPrice?: number | null;
    tpSlPlan?: {
      enabled: boolean;
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
    } | null;
    /** legacy Quick TP เมื่อ tpSlPlan ปิด */
    quickTpEnabled?: boolean;
    quickTpRoiPct?: number;
    quickTpMaxHours?: number;
  },
  dayKey: string
): SnowballAutoTradeState {
  const uid = userId.trim();
  const sym = p.contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const opened = fresh.openedContractSymbolsToday.includes(sym)
    ? fresh.openedContractSymbolsToday
    : [...fresh.openedContractSymbolsToday, sym];
  const activePrev = normalizeActive(fresh.active);
  const activeNext = activePrev.filter((x) => !(x.contractSymbol === sym && x.side === p.side));
  const activeRow: SnowballAutoTradeActive = {
    contractSymbol: sym,
    binanceSymbol: p.binanceSymbol.trim().toUpperCase(),
    side: p.side,
    openedAtMs: p.openedAtMs,
    referenceEntryPrice: p.referenceEntryPrice,
    signalBarOpenSec: p.signalBarOpenSec,
    signalBarTf: p.signalBarTf,
    signalBarLow: p.signalBarLow,
    svpHoleYn: p.svpHoleYn,
    leverage: Math.max(1, Math.floor(p.leverage)),
  };
  const mexcE = p.mexcAvgEntryPrice;
  if (typeof mexcE === "number" && Number.isFinite(mexcE) && mexcE > 0) {
    activeRow.mexcAvgEntryPrice = mexcE;
  }
  const plan = p.tpSlPlan;
  if (plan?.enabled) {
    activeRow.tp1Done = false;
    activeRow.tp1PricePct = plan.tp1PricePct;
    activeRow.tp1PartialPct = plan.tp1PartialPct;
    activeRow.tp2PricePct = plan.tp2PricePct;
    activeRow.maxHoldHours = plan.maxHoldHours;
    activeRow.slArmRoiPct = plan.slArmRoiPct;
    activeRow.slEntryOffsetPct = plan.slEntryOffsetPct;
    if (typeof mexcE === "number" && Number.isFinite(mexcE) && mexcE > 0) {
      activeRow.tpSlEnabled = true;
      if (plan.tp1PlanOrderId?.trim()) activeRow.tp1PlanOrderId = plan.tp1PlanOrderId.trim();
      if (plan.tp2PlanOrderId?.trim()) activeRow.tp2PlanOrderId = plan.tp2PlanOrderId.trim();
      if (typeof plan.initialHoldVol === "number" && plan.initialHoldVol > 0) {
        activeRow.initialHoldVol = plan.initialHoldVol;
      }
      if (typeof plan.tp1PlanVol === "number" && plan.tp1PlanVol > 0) {
        activeRow.tp1PlanVol = plan.tp1PlanVol;
      }
    }
  } else if (p.quickTpEnabled) {
    activeRow.quickTpEnabled = true;
    activeRow.quickTpRoiPct = (p.quickTpRoiPct ?? 0) > 0 ? (p.quickTpRoiPct as number) : 30;
    activeRow.quickTpMaxHours = (p.quickTpMaxHours ?? 0) > 0 ? (p.quickTpMaxHours as number) : 4;
  }
  activeNext.push(activeRow);
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: opened,
    active: activeNext,
  };
  if (fresh.pendingLimits && fresh.pendingLimits.length) next.pendingLimits = fresh.pendingLimits;
  return { ...state, [uid]: next };
}

/** ROI ถึง TP1% — ตั้ง SL@entry โดยยังไม่ปิด partial TP1 */
export function withSnowballSlAtEntryArmed(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: SnowballAutoTradeSide,
  slPlanOrderId?: string,
): SnowballAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).map((x) => {
    if (x.contractSymbol === sym && x.side === side) {
      const updated: SnowballAutoTradeActive = { ...x };
      if (slPlanOrderId?.trim()) updated.slPlanOrderId = slPlanOrderId.trim();
      return updated;
    }
    return x;
  });
  return { ...state, [uid]: { ...prev, active: nextActive } };
}

export function withSnowballTp1Done(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: SnowballAutoTradeSide,
  slPlanOrderId?: string
): SnowballAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).map((x) => {
    if (x.contractSymbol === sym && x.side === side) {
      const updated: SnowballAutoTradeActive = { ...x, tp1Done: true };
      if (slPlanOrderId?.trim()) updated.slPlanOrderId = slPlanOrderId.trim();
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

export function withSnowballGuard24hEvaluated(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: SnowballAutoTradeSide,
): SnowballAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).map((x) => {
    if (x.contractSymbol === sym && x.side === side) {
      return { ...x, guard24hEvaluated: true };
    }
    return x;
  });
  return { ...state, [uid]: { ...prev, active: nextActive } };
}

export function withSnowballActiveRemoved(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: SnowballAutoTradeSide
): SnowballAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).filter((x) => !(x.contractSymbol === sym && x.side === side));
  const nextEntry: SnowballAutoTradePerUserState = {
    dailyKeyBkk: prev.dailyKeyBkk,
    openedContractSymbolsToday: prev.openedContractSymbolsToday,
  };
  if (nextActive.length) nextEntry.active = nextActive;
  if (prev.pendingLimits && prev.pendingLimits.length) {
    nextEntry.pendingLimits = normalizePendingLimits(prev.pendingLimits);
  }
  return { ...state, [uid]: nextEntry };
}

