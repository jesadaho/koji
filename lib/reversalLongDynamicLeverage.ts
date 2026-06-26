/** Dynamic leverage — Reversal Long → SHORT (fade) ตาม ATR%14D */

import type { CandleReversalTradeSide } from "@/lib/candleReversalStatsClient";

export const REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_LT5 = 18;
export const REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_5_TO_10 = 9;
export const REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_LOW_BOUND = 5;
export const REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_HIGH_BOUND = 10;

export const REVERSAL_LONG_DYNAMIC_LEVERAGE_CRITERIA_TH =
  "ATR%14D < 5 → 18x · 5 < ATR%14D < 10 → 9x · อื่นๆ ใช้ Leverage ที่ตั้ง";

export type ReversalLongDynamicLeverageTier = "lt5" | "between5and10" | "base";

export type ReversalLongDynamicLeverageResult = {
  leverage: number;
  dynamicApplied: boolean;
  atrPct14d: number | null;
  tier: ReversalLongDynamicLeverageTier | null;
};

export function resolveReversalLongTradeLeverage(input: {
  alertTradeSide: CandleReversalTradeSide;
  baseLeverage: number;
  dynamicLeverageEnabled: boolean;
  atrPct14d?: number | null;
}): ReversalLongDynamicLeverageResult {
  const base = Math.floor(input.baseLeverage);
  if (input.alertTradeSide !== "long" || !input.dynamicLeverageEnabled) {
    return { leverage: base, dynamicApplied: false, atrPct14d: null, tier: null };
  }

  const atr = input.atrPct14d;
  if (atr == null || !Number.isFinite(atr) || atr <= 0) {
    return { leverage: base, dynamicApplied: false, atrPct14d: null, tier: "base" };
  }

  if (atr < REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_LOW_BOUND) {
    return {
      leverage: REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_LT5,
      dynamicApplied: true,
      atrPct14d: atr,
      tier: "lt5",
    };
  }
  if (
    atr > REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_LOW_BOUND &&
    atr < REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_HIGH_BOUND
  ) {
    return {
      leverage: REVERSAL_LONG_DYNAMIC_LEVERAGE_ATR_5_TO_10,
      dynamicApplied: true,
      atrPct14d: atr,
      tier: "between5and10",
    };
  }

  return { leverage: base, dynamicApplied: false, atrPct14d: atr, tier: "base" };
}

export { resolveReversalStatsRowLeverage } from "@/lib/reversalStatsRowLeverage";

export function reversalLongDynamicLeverageNote(
  result: Pick<ReversalLongDynamicLeverageResult, "dynamicApplied" | "atrPct14d" | "tier" | "leverage">,
  baseLeverage: number,
): string | null {
  if (!result.dynamicApplied || result.tier == null) return null;
  const atr = result.atrPct14d != null ? `${result.atrPct14d.toFixed(2)}%` : "—";
  if (result.tier === "lt5") {
    return `Dynamic leverage: ATR%14D ${atr} < 5 → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)`;
  }
  if (result.tier === "between5and10") {
    return `Dynamic leverage: ATR%14D ${atr} (5–10) → ${result.leverage}x (ตั้งไว้ ${baseLeverage}x)`;
  }
  return null;
}
