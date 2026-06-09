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
  holdExtendIfRedEnabled: boolean;
  slArmRoiPct: number;
  slEntryOffsetPct: number;
};

type SnowballTpSlPlanFieldKeys = {
  enabled: keyof TradingViewMexcUserSettings;
  tp1PricePct: keyof TradingViewMexcUserSettings;
  tp1PartialPct: keyof TradingViewMexcUserSettings;
  tp2PricePct: keyof TradingViewMexcUserSettings;
  maxHoldHours: keyof TradingViewMexcUserSettings;
  holdExtendIfRedEnabled: keyof TradingViewMexcUserSettings;
  slArmRoiPct: keyof TradingViewMexcUserSettings;
  slEntryOffsetPct: keyof TradingViewMexcUserSettings;
};

const SNOWBALL_DEFAULT_TP_SL_KEYS: SnowballTpSlPlanFieldKeys = {
  enabled: "snowballAutoTradeTpSlEnabled",
  tp1PricePct: "snowballAutoTradeTp1PricePct",
  tp1PartialPct: "snowballAutoTradeTp1PartialPct",
  tp2PricePct: "snowballAutoTradeTp2PricePct",
  maxHoldHours: "snowballAutoTradeMaxHoldHours",
  holdExtendIfRedEnabled: "snowballAutoTradeHoldExtendIfRedEnabled",
  slArmRoiPct: "snowballAutoTradeSlArmRoiPct",
  slEntryOffsetPct: "snowballAutoTradeSlEntryOffsetPct",
};

const SNOWBALL_QUALITY_SHORT_TP_SL_KEYS: SnowballTpSlPlanFieldKeys = {
  enabled: "snowballAutoTradeQualityShortTpSlEnabled",
  tp1PricePct: "snowballAutoTradeQualityShortTp1PricePct",
  tp1PartialPct: "snowballAutoTradeQualityShortTp1PartialPct",
  tp2PricePct: "snowballAutoTradeQualityShortTp2PricePct",
  maxHoldHours: "snowballAutoTradeQualityShortMaxHoldHours",
  holdExtendIfRedEnabled: "snowballAutoTradeQualityShortHoldExtendIfRedEnabled",
  slArmRoiPct: "snowballAutoTradeQualityShortSlArmRoiPct",
  slEntryOffsetPct: "snowballAutoTradeQualityShortSlEntryOffsetPct",
};

function readPositiveNumber(
  row: TradingViewMexcUserSettings,
  key: keyof TradingViewMexcUserSettings,
): number | undefined {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function resolveSnowballTpSlPlanFromRowKeys(
  row: TradingViewMexcUserSettings,
  keys: SnowballTpSlPlanFieldKeys,
): SnowballTpSlPlan {
  const enabled = row[keys.enabled] !== false;
  const t1 = readPositiveNumber(row, keys.tp1PricePct) ?? SNOWBALL_TPSL_DEFAULT_TP1_PCT;
  const t1p = readPositiveNumber(row, keys.tp1PartialPct) ?? SNOWBALL_TPSL_DEFAULT_TP1_PARTIAL;
  const t2 = readPositiveNumber(row, keys.tp2PricePct) ?? SNOWBALL_TPSL_DEFAULT_TP2_PCT;
  const mh = readPositiveNumber(row, keys.maxHoldHours) ?? SNOWBALL_TPSL_DEFAULT_MAX_HOURS;
  return {
    enabled,
    tp1PricePct: t1,
    tp1PartialPct: Math.min(100, t1p),
    tp2PricePct: t2,
    maxHoldHours: mh,
    holdExtendIfRedEnabled: row[keys.holdExtendIfRedEnabled] === true,
    slArmRoiPct: parseSlArmRoiPct(row[keys.slArmRoiPct] as number | null | undefined, DEFAULT_SL_ARM_ROI_PCT),
    slEntryOffsetPct: parseSlEntryOffsetPct(
      row[keys.slEntryOffsetPct] as number | null | undefined,
      DEFAULT_SL_ENTRY_OFFSET_PCT,
    ),
  };
}

/** Snowball auto-open ทั่วไป (Long / Bear / Sunday / Grade C fade ฯลฯ) */
export function resolveSnowballTpSlPlanFromRow(row: TradingViewMexcUserSettings): SnowballTpSlPlan {
  return resolveSnowballTpSlPlanFromRowKeys(row, SNOWBALL_DEFAULT_TP_SL_KEYS);
}

/** ✨ Quality Short Signal → Short — แผน TP/SL แยกจาก default */
export function resolveSnowballQualityShortTpSlPlanFromRow(row: TradingViewMexcUserSettings): SnowballTpSlPlan {
  return resolveSnowballTpSlPlanFromRowKeys(row, SNOWBALL_QUALITY_SHORT_TP_SL_KEYS);
}
