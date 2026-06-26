import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  parseSlArmRoiPct,
  parseSlEntryOffsetPct,
  slAtEntryAfter24hIfGreenEnabledFromSetting,
} from "@/lib/tpSlBreakevenPlan";
import { DEFAULT_STATS_TPSL_PLAN, type StatsTpSlPlan } from "@/lib/tpSlStrategySimulate";
import type { TradingViewMexcUserSettings } from "@/src/tradingViewCloseSettingsStore";

export type ReversalViewerStatsTpSlPlan = StatsTpSlPlan & {
  tpSlEnabled: boolean;
  reversalTp12hCloseEnabled?: boolean;
};

export type ReversalTpSlSignalKind = "short" | "long";

export type ReversalTpSlPlan = {
  enabled: boolean;
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  maxHoldHours: number;
  holdExtendIfRedEnabled: boolean;
  holdExtendRedHours?: number;
  slArmRoiPct: number;
  slEntryOffsetPct: number;
  slAtEntryAfter24hIfGreenEnabled: boolean;
  tp12hCloseEnabled: boolean;
};

function positiveNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function positiveInt(v: unknown): number | undefined {
  const n = positiveNum(v);
  return n != null ? Math.floor(n) : undefined;
}

/** ค่า legacy / Short — ฟิลด์เดิมก่อนแยก Long */
function reversalLegacyTpSlPlan(row: TradingViewMexcUserSettings): ReversalTpSlPlan {
  const en = row.reversalAutoTradeTpSlEnabled !== false;
  const t1 = positiveNum(row.reversalAutoTradeTp1PricePct) ?? DEFAULT_STATS_TPSL_PLAN.tp1PricePct;
  const t1p =
    positiveNum(row.reversalAutoTradeTp1PartialPct) ?? DEFAULT_STATS_TPSL_PLAN.tp1PartialPct;
  const t2 = positiveNum(row.reversalAutoTradeTp2PricePct) ?? DEFAULT_STATS_TPSL_PLAN.tp2PricePct;
  const mh = positiveInt(row.reversalAutoTradeMaxHoldHours) ?? DEFAULT_STATS_TPSL_PLAN.maxHoldHours;
  const extH = positiveInt(row.reversalAutoTradeHoldExtendRedHours);
  return {
    enabled: en,
    tp1PricePct: t1,
    tp1PartialPct: Math.min(100, t1p),
    tp2PricePct: t2,
    maxHoldHours: mh,
    holdExtendIfRedEnabled: row.reversalAutoTradeHoldExtendIfRedEnabled === true,
    holdExtendRedHours: extH,
    slArmRoiPct: parseSlArmRoiPct(row.reversalAutoTradeSlArmRoiPct, DEFAULT_SL_ARM_ROI_PCT),
    slEntryOffsetPct: parseSlEntryOffsetPct(
      row.reversalAutoTradeSlEntryOffsetPct,
      DEFAULT_SL_ENTRY_OFFSET_PCT,
    ),
    slAtEntryAfter24hIfGreenEnabled: slAtEntryAfter24hIfGreenEnabledFromSetting(
      row.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled,
    ),
    tp12hCloseEnabled: row.reversalAutoTradeTp12hCloseEnabled !== false,
  };
}

/** TP/SL แยก Short signal vs Long (Market LONG) — Long ว่าง = fallback ค่า Short */
export function reversalTpSlPlanFromRow(
  row: TradingViewMexcUserSettings,
  signalKind: ReversalTpSlSignalKind = "short",
): ReversalTpSlPlan {
  const legacy = reversalLegacyTpSlPlan(row);
  if (signalKind === "short") return legacy;

  const longTpSlEnabled =
    row.reversalAutoTradeLongTpSlEnabled !== undefined
      ? row.reversalAutoTradeLongTpSlEnabled !== false
      : legacy.enabled;
  const longTp12hCloseEnabled =
    row.reversalAutoTradeLongTp12hCloseEnabled !== undefined
      ? row.reversalAutoTradeLongTp12hCloseEnabled !== false
      : legacy.tp12hCloseEnabled;

  return {
    enabled: longTpSlEnabled,
    tp1PricePct: positiveNum(row.reversalAutoTradeLongTp1PricePct) ?? legacy.tp1PricePct,
    tp1PartialPct: Math.min(
      100,
      positiveNum(row.reversalAutoTradeLongTp1PartialPct) ?? legacy.tp1PartialPct,
    ),
    tp2PricePct: positiveNum(row.reversalAutoTradeLongTp2PricePct) ?? legacy.tp2PricePct,
    maxHoldHours: positiveInt(row.reversalAutoTradeLongMaxHoldHours) ?? legacy.maxHoldHours,
    holdExtendIfRedEnabled:
      row.reversalAutoTradeLongHoldExtendIfRedEnabled !== undefined
        ? row.reversalAutoTradeLongHoldExtendIfRedEnabled === true
        : legacy.holdExtendIfRedEnabled,
    holdExtendRedHours:
      row.reversalAutoTradeLongHoldExtendRedHours !== undefined
        ? positiveInt(row.reversalAutoTradeLongHoldExtendRedHours)
        : legacy.holdExtendRedHours,
    slArmRoiPct: parseSlArmRoiPct(row.reversalAutoTradeLongSlArmRoiPct, legacy.slArmRoiPct),
    slEntryOffsetPct: parseSlEntryOffsetPct(
      row.reversalAutoTradeLongSlEntryOffsetPct,
      legacy.slEntryOffsetPct,
    ),
    slAtEntryAfter24hIfGreenEnabled:
      row.reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled !== undefined
        ? slAtEntryAfter24hIfGreenEnabledFromSetting(
            row.reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled,
          )
        : legacy.slAtEntryAfter24hIfGreenEnabled,
    tp12hCloseEnabled: longTp12hCloseEnabled,
  };
}

export type ReversalViewerTpSlPlans = {
  short: ReversalViewerStatsTpSlPlan;
  long: ReversalViewerStatsTpSlPlan;
};

export function reversalTpSlPlanToViewerStats(plan: ReversalTpSlPlan): ReversalViewerStatsTpSlPlan {
  return {
    tpSlEnabled: plan.enabled,
    tp1PricePct: plan.tp1PricePct,
    tp1PartialPct: plan.tp1PartialPct,
    tp2PricePct: plan.tp2PricePct,
    maxHoldHours: plan.maxHoldHours,
    holdExtendIfRedEnabled: plan.holdExtendIfRedEnabled,
    holdExtendRedHours: plan.holdExtendRedHours,
    slAtEntryArmRoiPct: plan.slArmRoiPct,
    slAtEntryOffsetPct: plan.slEntryOffsetPct,
    reversalTp12hCloseEnabled: plan.tp12hCloseEnabled,
  };
}

export function reversalViewerTpSlPlansFromRow(
  row: TradingViewMexcUserSettings,
): ReversalViewerTpSlPlans {
  return {
    short: reversalTpSlPlanToViewerStats(reversalTpSlPlanFromRow(row, "short")),
    long: reversalTpSlPlanToViewerStats(reversalTpSlPlanFromRow(row, "long")),
  };
}
