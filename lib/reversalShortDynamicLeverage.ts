/** Dynamic leverage — Reversal Short (สัญญาณ Short → เปิด SHORT บน MEXC) ตาม Trend Gain + EMA20∠4h */

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

export const REVERSAL_SHORT_DYNAMIC_LEVERAGE_CRITERIA_TH = [
  `TG <${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_LT20}% + EMA20∠4h <0 → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_LT20_EMA_LT0}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_LT20_EMA_LT0} ไม้)`,
  `TG ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN}–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX}% + EMA20∠4h <0 → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_LT0} ไม้)`,
  `TG ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN}–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX}% + EMA20∠4h 0–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX}% → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_0_10} ไม้)`,
  `TG ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN}–${REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX}% + EMA20∠4h >${REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX}% → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_GT10} ไม้)`,
  `Fallback → ${REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_FALLBACK}x (${REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_FALLBACK} ไม้)`,
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

export function resolveReversalShortTradeLeverage(input: {
  baseLeverage: number;
  dynamicLeverageEnabled: boolean;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
}): ReversalShortDynamicLeverageResult {
  const base = Math.floor(input.baseLeverage);
  if (!input.dynamicLeverageEnabled) {
    return {
      leverage: base,
      dynamicApplied: false,
      trendGainPct: null,
      ema4hSlopePct7d: null,
      tier: null,
      maxSlots: null,
    };
  }

  const tg = input.trendGainPct;
  const ema4h = coinEma4hSlopePct7d(input);
  const tgOk = tg != null && Number.isFinite(tg);
  const emaOk = ema4h != null && Number.isFinite(ema4h);

  if (!tgOk || !emaOk) {
    return {
      leverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_FALLBACK,
      dynamicApplied: true,
      trendGainPct: tgOk ? tg! : null,
      ema4hSlopePct7d: emaOk ? ema4h! : null,
      tier: "fallback",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_FALLBACK,
    };
  }

  if (tg! < REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_LT20 && ema4h! < 0) {
    return {
      leverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_LT20_EMA_LT0,
      dynamicApplied: true,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_lt20_ema4h_lt0",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_LT20_EMA_LT0,
    };
  }

  const inTgBand =
    tg! >= REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MIN &&
    tg! <= REVERSAL_SHORT_DYNAMIC_LEVERAGE_TG_BAND_MAX;

  if (inTgBand && ema4h! < 0) {
    return {
      leverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50,
      dynamicApplied: true,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_20_50_ema4h_lt0",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_LT0,
    };
  }
  if (inTgBand && ema4h! >= 0 && ema4h! <= REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX) {
    return {
      leverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50,
      dynamicApplied: true,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_20_50_ema4h_0_10",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_0_10,
    };
  }
  if (inTgBand && ema4h! > REVERSAL_SHORT_DYNAMIC_LEVERAGE_EMA4H_MID_MAX) {
    return {
      leverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_TG_20_50,
      dynamicApplied: true,
      trendGainPct: tg!,
      ema4hSlopePct7d: ema4h!,
      tier: "tg_20_50_ema4h_gt10",
      maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_TG_20_50_EMA_GT10,
    };
  }

  return {
    leverage: REVERSAL_SHORT_DYNAMIC_LEVERAGE_LEV_FALLBACK,
    dynamicApplied: true,
    trendGainPct: tg!,
    ema4hSlopePct7d: ema4h!,
    tier: "fallback",
    maxSlots: REVERSAL_SHORT_DYNAMIC_LEVERAGE_SLOTS_FALLBACK,
  };
}

export function reversalShortDynamicLeverageNote(
  result: Pick<
    ReversalShortDynamicLeverageResult,
    "dynamicApplied" | "trendGainPct" | "ema4hSlopePct7d" | "tier" | "leverage" | "maxSlots"
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
  if (result.tier === "tg_lt20_ema4h_lt0") {
    return `Dynamic leverage (Short): TG ${tg} <20 · EMA20∠4h ${ema} <0 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${slots}`;
  }
  if (result.tier === "tg_20_50_ema4h_lt0") {
    return `Dynamic leverage (Short): TG ${tg} 20–50 · EMA20∠4h ${ema} <0 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${slots}`;
  }
  if (result.tier === "tg_20_50_ema4h_0_10") {
    return `Dynamic leverage (Short): TG ${tg} 20–50 · EMA20∠4h ${ema} 0–10 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${slots}`;
  }
  if (result.tier === "tg_20_50_ema4h_gt10") {
    return `Dynamic leverage (Short): TG ${tg} 20–50 · EMA20∠4h ${ema} >10 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${slots}`;
  }
  return `Dynamic leverage (Short): Fallback → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)${slots}`;
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
    }).leverage;
  }
  return Math.floor(input.baseLeverage);
}
