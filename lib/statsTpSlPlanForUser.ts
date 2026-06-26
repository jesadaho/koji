import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
} from "@/lib/tpSlBreakevenPlan";
import { statsTpSlPlanCacheKey } from "@/lib/statsTpSlPlanCacheKey";
import {
  DEFAULT_STATS_TPSL_PLAN,
  statsTpSlPlanSummary,
  type StatsTpSlPlan,
} from "@/lib/tpSlStrategySimulate";
import type { ReversalStatsPlaySides } from "@/lib/reversalMatrixFilters";
import { reversalStatsPlaySidesFromSettings } from "@/lib/reversalMatrixFilters";
import {
  reversalTpSlPlanFromRow,
  reversalTpSlPlanToViewerStats,
  reversalViewerTpSlPlansFromRow,
  type ReversalViewerTpSlPlans,
  type ReversalViewerStatsTpSlPlan,
} from "@/lib/reversalTpSlSettings";
import { resolveSnowballTpSlPlanFromRow } from "@/src/snowballAutoTradeTpSlPlan";
import {
  loadTradingViewMexcSettingsFullMap,
  type TradingViewMexcUserSettings,
} from "@/src/tradingViewCloseSettingsStore";

export type ViewerStatsTpSlPlan = ReversalViewerStatsTpSlPlan;

export type { ReversalViewerTpSlPlans } from "@/lib/reversalTpSlSettings";

export { statsTpSlPlanCacheKey };

function reversalTpSlPlanFromSettings(
  row: TradingViewMexcUserSettings,
  side: "short" | "long" = "short",
): ViewerStatsTpSlPlan {
  return reversalTpSlPlanToViewerStats(reversalTpSlPlanFromRow(row, side));
}

export function reversalViewerTpSlPlansForUserId(
  userId: string,
  map: Record<string, TradingViewMexcUserSettings>,
): ReversalViewerTpSlPlans {
  const row = map[userId.trim()];
  if (!row) {
    const fallback = {
      tpSlEnabled: true,
      ...DEFAULT_STATS_TPSL_PLAN,
      slAtEntryArmRoiPct: DEFAULT_SL_ARM_ROI_PCT,
      slAtEntryOffsetPct: DEFAULT_SL_ENTRY_OFFSET_PCT,
      reversalTp12hCloseEnabled: true,
    };
    return { short: fallback, long: fallback };
  }
  return reversalViewerTpSlPlansFromRow(row);
}

export async function resolveViewerReversalTpSlPlans(
  telegramUserId: number,
): Promise<ReversalViewerTpSlPlans> {
  const userId = `tg:${telegramUserId}`;
  const map = await loadTradingViewMexcSettingsFullMap();
  return reversalViewerTpSlPlansForUserId(userId, map);
}

function snowballTpSlPlanFromSettings(row: TradingViewMexcUserSettings): ViewerStatsTpSlPlan {
  const p = resolveSnowballTpSlPlanFromRow(row);
  return {
    tpSlEnabled: p.enabled,
    tp1PricePct: p.tp1PricePct,
    tp1PartialPct: p.tp1PartialPct,
    tp2PricePct: p.tp2PricePct,
    maxHoldHours: p.maxHoldHours,
    holdExtendIfRedEnabled: p.holdExtendIfRedEnabled,
    holdExtendRedHours: p.holdExtendRedHours,
    slAtEntryArmRoiPct: p.slArmRoiPct,
    slAtEntryOffsetPct: p.slEntryOffsetPct,
  };
}

export function resolveTpSlPlanForUserId(
  userId: string,
  source: StatsTpSlPlanSource,
  map: Record<string, TradingViewMexcUserSettings>,
): ViewerStatsTpSlPlan {
  const row = map[userId.trim()];
  if (!row) {
    return {
      tpSlEnabled: true,
      ...DEFAULT_STATS_TPSL_PLAN,
      slAtEntryArmRoiPct: DEFAULT_SL_ARM_ROI_PCT,
      slAtEntryOffsetPct: DEFAULT_SL_ENTRY_OFFSET_PCT,
      reversalTp12hCloseEnabled: true,
    };
  }
  return source === "reversal"
    ? reversalTpSlPlanFromSettings(row)
    : snowballTpSlPlanFromSettings(row);
}

export async function resolveViewerStatsTpSlPlan(
  telegramUserId: number,
  source: StatsTpSlPlanSource,
): Promise<ViewerStatsTpSlPlan> {
  const userId = `tg:${telegramUserId}`;
  const map = await loadTradingViewMexcSettingsFullMap();
  return resolveTpSlPlanForUserId(userId, source, map);
}

export function viewerStatsTpSlPlanPayload(plan: ViewerStatsTpSlPlan): StatsTpSlPlan {
  return {
    tp1PricePct: plan.tp1PricePct,
    tp1PartialPct: plan.tp1PartialPct,
    tp2PricePct: plan.tp2PricePct,
    maxHoldHours: plan.maxHoldHours,
    holdExtendIfRedEnabled: plan.holdExtendIfRedEnabled,
    holdExtendRedHours: plan.holdExtendRedHours,
    slAtEntryArmRoiPct: plan.slAtEntryArmRoiPct ?? DEFAULT_SL_ARM_ROI_PCT,
    slAtEntryOffsetPct: plan.slAtEntryOffsetPct ?? DEFAULT_SL_ENTRY_OFFSET_PCT,
  };
}

export function viewerStatsTpSlPlanSummary(plan: ViewerStatsTpSlPlan): string {
  if (!plan.tpSlEnabled) {
    return `ปิด TP/SL — ถือครบ ${plan.maxHoldHours}h (ปิดที่ horizon)`;
  }
  return statsTpSlPlanSummary(plan);
}

export type ViewerStatsTradeSizing = {
  marginUsdt: number | null;
  leverage: number | null;
  /** Reversal Long → SHORT: ปรับ leverage ต่อแถวตาม ATR%14D (เหมือน auto-open) */
  reversalLongDynamicLeverageEnabled?: boolean;
  /** ทิศที่เล่น — ตาราง Reversal Short 1H */
  reversalStatsPlaySides?: ReversalStatsPlaySides;
};

function positiveNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export async function resolveViewerStatsTradeSizing(
  telegramUserId: number,
  source: StatsTpSlPlanSource,
): Promise<ViewerStatsTradeSizing> {
  const userId = `tg:${telegramUserId}`;
  const map = await loadTradingViewMexcSettingsFullMap();
  const row = map[userId];
  if (!row) {
    return { marginUsdt: null, leverage: null };
  }
  if (source === "reversal") {
    return {
      marginUsdt: positiveNum(row.reversalAutoTradeMarginUsdt),
      leverage: positiveNum(row.reversalAutoTradeLeverage),
      reversalLongDynamicLeverageEnabled: row.reversalAutoTradeLongDynamicLeverageEnabled === true,
      reversalStatsPlaySides: reversalStatsPlaySidesFromSettings(row),
    };
  }
  return {
    marginUsdt: positiveNum(row.snowballAutoTradeMarginUsdt),
    leverage: positiveNum(row.snowballAutoTradeLeverage),
  };
}
