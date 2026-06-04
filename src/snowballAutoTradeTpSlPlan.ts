import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  parseSlArmRoiPct,
  parseSlEntryOffsetPct,
} from "@/lib/tpSlBreakevenPlan";
import type { TradingViewMexcUserSettings } from "./tradingViewCloseSettingsStore";

export const SNOWBALL_TPSL_DEFAULT_TP1_PCT = 10;
export const SNOWBALL_TPSL_DEFAULT_TP1_PARTIAL = 50;
export const SNOWBALL_TPSL_DEFAULT_TP2_PCT = 25;
export const SNOWBALL_TPSL_DEFAULT_MAX_HOURS = 48;

export type SnowballTpSlPlan = {
  enabled: boolean;
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  maxHoldHours: number;
  slArmRoiPct: number;
  slEntryOffsetPct: number;
};

export function resolveSnowballTpSlPlanFromRow(row: TradingViewMexcUserSettings): SnowballTpSlPlan {
  const en = row.snowballAutoTradeTpSlEnabled !== false;
  const t1 =
    typeof row.snowballAutoTradeTp1PricePct === "number" &&
    Number.isFinite(row.snowballAutoTradeTp1PricePct) &&
    row.snowballAutoTradeTp1PricePct > 0
      ? row.snowballAutoTradeTp1PricePct
      : SNOWBALL_TPSL_DEFAULT_TP1_PCT;
  const t1p =
    typeof row.snowballAutoTradeTp1PartialPct === "number" &&
    Number.isFinite(row.snowballAutoTradeTp1PartialPct) &&
    row.snowballAutoTradeTp1PartialPct > 0
      ? row.snowballAutoTradeTp1PartialPct
      : SNOWBALL_TPSL_DEFAULT_TP1_PARTIAL;
  const t2 =
    typeof row.snowballAutoTradeTp2PricePct === "number" &&
    Number.isFinite(row.snowballAutoTradeTp2PricePct) &&
    row.snowballAutoTradeTp2PricePct > 0
      ? row.snowballAutoTradeTp2PricePct
      : SNOWBALL_TPSL_DEFAULT_TP2_PCT;
  const mh =
    typeof row.snowballAutoTradeMaxHoldHours === "number" &&
    Number.isFinite(row.snowballAutoTradeMaxHoldHours) &&
    row.snowballAutoTradeMaxHoldHours > 0
      ? row.snowballAutoTradeMaxHoldHours
      : SNOWBALL_TPSL_DEFAULT_MAX_HOURS;
  return {
    enabled: en,
    tp1PricePct: t1,
    tp1PartialPct: Math.min(100, t1p),
    tp2PricePct: t2,
    maxHoldHours: mh,
    slArmRoiPct: parseSlArmRoiPct(row.snowballAutoTradeSlArmRoiPct, DEFAULT_SL_ARM_ROI_PCT),
    slEntryOffsetPct: parseSlEntryOffsetPct(
      row.snowballAutoTradeSlEntryOffsetPct,
      DEFAULT_SL_ENTRY_OFFSET_PCT,
    ),
  };
}
