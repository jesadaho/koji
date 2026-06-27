/** Dynamic leverage — Reversal Short (สัญญาณ Short → เปิด SHORT บน MEXC) ตาม Trend Gain + EMA20∠4h · cap ด้วย ATR14D */

import type { CandleReversalTradeSide } from "@/lib/candleReversalStatsClient";
import { resolveReversalLongTradeLeverage } from "@/lib/reversalLongDynamicLeverage";

export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_LT20 = 20;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN = 20;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX = 50;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX = 10;

export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_LT20_EMA_LT0 = 8;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50 = 6;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_FALLBACK = 4;

export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_LT20_EMA_LT0 = 5;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_LT0 = 8;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_0_10 = 13;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_GT10 = 15;
export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_FALLBACK = 25;

/** ATR14D = Base Risk — เพดาน max leverage (Wilder ATR(14) 1d ÷ close × 100) */
export const REVERSAL_SHORT_ATR14D_LEV_LT10 = 8;
export const REVERSAL_SHORT_ATR14D_LEV_10_20 = 6;
export const REVERSAL_SHORT_ATR14D_LEV_20_30 = 5;
export const REVERSAL_SHORT_ATR14D_LEV_GT30 = 4;

export const REVERSAL_SHORT_ATR14D_LEVERAGE_CAP_CRITERIA_TH =
  "ATR14D cap: <10%→≤8x · 10–20%→≤6x · 20–30%→≤5x · >30%→≤4x";

export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_CRITERIA_TH = [
  `TG <${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_LT20}% + EMA20∠4h <0 → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_LT20_EMA_LT0}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_LT20_EMA_LT0} ไม้)`,
  `TG ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN}–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX}% + EMA20∠4h <0 → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_LT0} ไม้)`,
  `TG ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN}–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX}% + EMA20∠4h 0–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX}% → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_0_10} ไม้)`,
  `TG ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN}–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX}% + EMA20∠4h >${REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX}% → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_GT10} ไม้)`,
  `Fallback → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_FALLBACK}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_FALLBACK} ไม้)`,
  REVERSAL_SHORT_ATR14D_LEVERAGE_CAP_CRITERIA_TH,
].join(" · ");

export type ReversalShortDynamicLeverageTier =
  | "tg_lt20_ema4h_lt0"
  | "tg_20_50_ema4h_lt0"
  | "tg_20_50_ema4h_0_10"
  | "tg_20_50_ema4h_gt10"
  | "fallback";

export type ReversalShortDynamicLeverageResult = {
  leverage: number;
  dynamicApplied: boolean;
  trendGainPct: number | null;
  ema4hSlopePct7d: number | null;
  atrPct14d: number | null;
  /** เพดาน leverage จาก ATR14D — null = ไม่มีค่า ATR */
  atrLeverageCap: number | null;
  /** tier leverage ก่อน cap ATR */
  tierLeverage: number | null;
  tier: ReversalShortDynamicLeverageTier | null;
  /** จำนวนไม้สูงสุดในพอร์ต (อ้างอิง — ยังไม่ enforce auto-open) */
  maxSlots: number | null;
};

function coinEma4hSlopePct7d(input: {
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
}): number | null {
  const ema20 = input.ema20_4hSlopePct7d;
  if (ema20 != null && Number.isFinite(ema20)) return ema20;
  const ema12 = input.ema4hSlopePct7d;
  if (ema12 != null && Number.isFinite(ema12)) return ema12;
  return null;
}

/** เพดาน max leverage จาก ATR14D (Base Risk) */
export function resolveAtr14dMaxLeverageCap(atrPct14d: number | null | undefined): number | null {
  if (atrPct14d == null || !Number.isFinite(atrPct14d) || atrPct14d < 0) return null;
  if (atrPct14d < 10) return REVERSAL_SHORT_ATR14D_LEV_LT10;
  if (atrPct14d < 20) return REVERSAL_SHORT_ATR14D_LEV_10_20;
  if (atrPct14d < 30) return REVERSAL_SHORT_ATR14D_LEV_20_30;
  return REVERSAL_SHORT_ATR14D_LEV_GT30;
}

function applyAtr14dLeverageCap(
  tierLeverage: number,
  atrPct14d: number | null | undefined,
): { leverage: number; atrLeverageCap: number | null } {
  const cap = resolveAtr14dMaxLeverageCap(atrPct14d);
  if (cap == null) return { leverage: tierLeverage, atrLeverageCap: null };
  return { leverage: Math.min(tierLeverage, cap), atrLeverageCap: cap };
}

function finalizeShortLeverage(input: {
  tierLeverage: number;
  atrPct14d?: number | null;
  trendGainPct: number | null;
  ema4hSlopePct7d: number | null;
  tier: ReversalShortDynamicLeverageTier;
  maxSlots: number;
}): ReversalShortDynamicLeverageResult {
  const atr =
    input.atrPct14d != null && Number.isFinite(input.atrPct14d) && input.atrPct14d >= 0
      ? input.atrPct14d
      : null;
  const { leverage, atrLeverageCap } = applyAtr14dLeverageCap(input.tierLeverage, atr);
  return {
    leverage,
    dynamicApplied: true,
    trendGainPct: input.trendGainPct,
    ema4hSlopePct7d: input.ema4hSlopePct7d,
    atrPct14d: atr,
    atrLeverageCap,
    tierLeverage: input.tierLeverage,
    tier: input.tier,
    maxSlots: input.maxSlots,
  };
}

export function resolveReversalShortTradeLeverage(input: {
  baseLeverage: number;
  dynamicLeverageEnabled: boolean;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  atrPct14d?: number | null;
}): ReversalShortDynamicLeverageResult {
  const base = Math.floor(input.baseLeverage);
  if (!input.dynamicLeverageEnabled) {
    return {
      leverage: base,
      dynamicApplied: false,
      trendGainPct: null,
      ema4hSlopePct7d: null,
      atrPct14d: null,
      atrLeverageCap: null,
      tierLeverage: null,
      tier: null,
      maxSlots: null,
    };
  }

  const tg = input.trendGainPct;
  const ema4h = coinEma4hSlopePct7d(input);
  const tgOk = tg != null && Number.isFinite(tg);
  const emaOk = ema4h != null && Number.isFinite(ema4h);

  if (!tgOk || !emaOk) {
    return finalizeShortLeverage({
      tierLeverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_FALLBACK,
      atrPct14d: input.atrPct14d,
      trendGainPct: tgOk ? tg! : null,
      ema4hSlopePct7d: emaOk ? ema4h! : null,
      tier: "fallback",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_FALLBACK,
    });
  }

  if (tg! < REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_LT20 && ema4h! < 0) {
    return finalizeShortLeverage({
      tierLeverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_LT20_EMA_LT0,
      atrPct14d: input.atrPct14d,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_lt20_ema4h_lt0",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_LT20_EMA_LT0,
    });
  }

  const inTgBand =
    tg! >= REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN &&
    tg! <= REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX;

  if (inTgBand && ema4h! < 0) {
    return finalizeShortLeverage({
      tierLeverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50,
      atrPct14d: input.atrPct14d,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_20_50_ema4h_lt0",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_LT0,
    });
  }
  if (inTgBand && ema4h! >= 0 && ema4h! <= REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX) {
    return finalizeShortLeverage({
      tierLeverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50,
      atrPct14d: input.atrPct14d,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_20_50_ema4h_0_10",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_0_10,
    });
  }
  if (inTgBand && ema4h! > REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX) {
    return finalizeShortLeverage({
      tierLeverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50,
      atrPct14d: input.atrPct14d,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_20_50_ema4h_gt10",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_GT10,
    });
  }

  return finalizeShortLeverage({
    tierLeverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_FALLBACK,
    atrPct14d: input.atrPct14d,
    trendGainPct: tg!,
    ema4hSlopePct7d: ema4h!,
    tier: "fallback",
    maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_FALLBACK,
  });
}

export function reversalShortDynamicLeverageNote(
  result: Pick<
    ReversalShortDynamicLeverageResult,
    | "dynamicApplied"
    | "trendGainPct"
    | "ema4hSlopePct7d"
    | "atrPct14d"
    | "atrLeverageCap"
    | "tierLeverage"
    | "tier"
    | "leverage"
    | "maxSlots"
  >,
  baseLeverage: number,
): string | null {
  if (!result.dynamicApplied || result.tier == null) return null;
  const tg =
    result.trendGainPct != null && Number.isFinite(result.trendGainPct)
      ? `${result.trendGainPct.toFixed(1)}%`
      : "—";
  const ema =
    result.ema4hSlopePct7d != null && Number.isFinite(result.ema4hSlopePct7d)
      ? `${result.ema4hSlopePct7d.toFixed(1)}%`
      : "—";
  const slots = result.maxSlots != null ? ` · pool ≤${result.maxSlots} ไม้` : "";
  const atr =
    result.atrPct14d != null && Number.isFinite(result.atrPct14d)
      ? `${result.atrPct14d.toFixed(2)}%`
      : null;
  const atrCap =
    atr != null && result.atrLeverageCap != null
      ? result.tierLeverage != null && result.leverage < result.tierLeverage
        ? ` · ATR14D ${atr} cap ≤${result.atrLeverageCap}x (${result.tierLeverage}x→${result.leverage}x)`
        : ` · ATR14D ${atr} cap ≤${result.atrLeverageCap}x`
      : "";
  if (result.tier === "tg_lt20_ema4h_lt0") {
    return `Dynamic leverage (Short): TG ${tg} <20 · EMA20∠4h ${ema} <0 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${atrCap}${slots}`;
  }
  if (result.tier === "tg_20_50_ema4h_lt0") {
    return `Dynamic leverage (Short): TG ${tg} 20–50 · EMA20∠4h ${ema} <0 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${atrCap}${slots}`;
  }
  if (result.tier === "tg_20_50_ema4h_0_10") {
    return `Dynamic leverage (Short): TG ${tg} 20–50 · EMA20∠4h ${ema} 0–10 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${atrCap}${slots}`;
  }
  if (result.tier === "tg_20_50_ema4h_gt10") {
    return `Dynamic leverage (Short): TG ${tg} 20–50 · EMA20∠4h ${ema} >10 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${atrCap}${slots}`;
  }
  return `Dynamic leverage (Short): Fallback → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${atrCap}${slots}`;
}

/** Leverage สำหรับ auto-open — รวม Long fade + Short */
export function resolveReversalTradeLeverageForRow(input: {
  tradeSide: CandleReversalTradeSide;
  baseLeverage: number;
  longDynamicLeverageEnabled: boolean;
  shortDynamicLeverageEnabled: boolean;
  atrPct14d?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
}): number {
  if (input.tradeSide === "long" && input.longDynamicLeverageEnabled) {
    return resolveReversalLongTradeLeverage({
      alertTradeSide: "long",
      baseLeverage: input.baseLeverage,
      dynamicLeverageEnabled: true,
      atrPct14d: input.atrPct14d,
    }).leverage;
  }
  if (input.tradeSide === "short" && input.shortDynamicLeverageEnabled) {
    return resolveReversalShortTradeLeverage({
      baseLeverage: input.baseLeverage,
      dynamicLeverageEnabled: true,
      trendGainPct: input.trendGainPct,
      ema20_4hSlopePct7d: input.ema20_4hSlopePct7d,
      ema4hSlopePct7d: input.ema4hSlopePct7d,
      atrPct14d: input.atrPct14d,
    }).leverage;
  }
  return Math.floor(input.baseLeverage);
}
