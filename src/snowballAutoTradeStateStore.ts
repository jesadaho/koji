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
  slPlanOrderId?: string;
  /** plan TP บน MEXC — วางทันทีหลัง open */
  tp1PlanOrderId?: string;
  tp2PlanOrderId?: string;
  initialHoldVol?: number;
  tp1PlanVol?: number;
};

export type SnowballAutoTradePerUserState = {
  dailyKeyBkk: string;
  openedContractSymbolsToday: string[];
  active?: SnowballAutoTradeActive[];
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
    if (hasTpSlPlan) {
      row.tpSlEnabled = tpSlEn !== false;
      row.tp1Done = tp1Done;
      row.tp1PricePct = Number.isFinite(tp1Pct) && tp1Pct > 0 ? tp1Pct : 10;
      row.tp1PartialPct = Number.isFinite(tp1Part) && tp1Part > 0 ? Math.min(100, tp1Part) : 50;
      row.tp2PricePct = Number.isFinite(tp2Pct) && tp2Pct > 0 ? tp2Pct : 25;
      row.maxHoldHours = Number.isFinite(maxH) && maxH > 0 ? maxH : 48;
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
    const entry: SnowballAutoTradePerUserState = {
      dailyKeyBkk: dk,
      openedContractSymbolsToday: dedupeStringsInOrder(syms),
    };
    if (active.length) entry.active = active;
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
    const base: SnowballAutoTradePerUserState = {
      dailyKeyBkk: dayKey,
      openedContractSymbolsToday: [],
    };
    if (active.length) base.active = active;
    return base;
  }
  const activeIn = normalizeActive(u.active);
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: dedupeStringsInOrder(u.openedContractSymbolsToday.map((s) => s.toUpperCase())),
  };
  if (activeIn.length) next.active = activeIn;
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
  if (plan?.enabled && typeof mexcE === "number" && Number.isFinite(mexcE) && mexcE > 0) {
    activeRow.tpSlEnabled = true;
    activeRow.tp1Done = false;
    activeRow.tp1PricePct = plan.tp1PricePct;
    activeRow.tp1PartialPct = plan.tp1PartialPct;
    activeRow.tp2PricePct = plan.tp2PricePct;
    activeRow.maxHoldHours = plan.maxHoldHours;
    if (plan.tp1PlanOrderId?.trim()) activeRow.tp1PlanOrderId = plan.tp1PlanOrderId.trim();
    if (plan.tp2PlanOrderId?.trim()) activeRow.tp2PlanOrderId = plan.tp2PlanOrderId.trim();
    if (typeof plan.initialHoldVol === "number" && plan.initialHoldVol > 0) {
      activeRow.initialHoldVol = plan.initialHoldVol;
    }
    if (typeof plan.tp1PlanVol === "number" && plan.tp1PlanVol > 0) {
      activeRow.tp1PlanVol = plan.tp1PlanVol;
    }
  } else if (p.quickTpEnabled) {
    activeRow.quickTpEnabled = true;
    activeRow.quickTpRoiPct = (p.quickTpRoiPct ?? 0) > 0 ? (p.quickTpRoiPct as number) : 30;
    activeRow.quickTpMaxHours = (p.quickTpMaxHours ?? 0) > 0 ? (p.quickTpMaxHours as number) : 4;
  }
  activeNext.push(activeRow);
  return {
    ...state,
    [uid]: {
      dailyKeyBkk: dayKey,
      openedContractSymbolsToday: opened,
      active: activeNext,
    },
  };
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
  return {
    ...state,
    [uid]: {
      ...prev,
      active: nextActive.length ? nextActive : undefined,
    },
  };
}

