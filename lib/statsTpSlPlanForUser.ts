import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  parseSlArmRoiPct,
  parseSlEntryOffsetPct,
} from "@/lib/tpSlBreakevenPlan";
import {
  DEFAULT_STATS_TPSL_PLAN,
  statsTpSlPlanSummary,
  type StatsTpSlPlan,
} from "@/lib/tpSlStrategySimulate";
import { loadTradingViewMexcSettingsFullMap } from "@/src/tradingViewCloseSettingsStore";
import { resolveSnowballTpSlPlanFromRow } from "@/src/snowballAutoTradeTpSlPlan";

export type StatsTpSlPlanSource = "reversal" | "snowball";

export type ViewerStatsTpSlPlan = StatsTpSlPlan & {
  tpSlEnabled: boolean;
};

export function statsTpSlPlanCacheKey(plan: StatsTpSlPlan): string {
  const slArm = plan.slAtEntryArmRoiPct ?? DEFAULT_SL_ARM_ROI_PCT;
  const slOff = plan.slAtEntryOffsetPct ?? DEFAULT_SL_ENTRY_OFFSET_PCT;
  return `${plan.tp1PricePct}-${plan.tp1PartialPct}-${plan.tp2PricePct}-${plan.maxHoldHours}-${slArm}-${slOff}`;
}

function reversalTpSlPlanFromSettings(
  row: NonNullable<Awaited<ReturnType<typeof loadTradingViewMexcSettingsFullMap>>[string]>,
): ViewerStatsTpSlPlan {
  const en = row.reversalAutoTradeTpSlEnabled !== false;
  const t1 =
    typeof row.reversalAutoTradeTp1PricePct === "number" &&
    Number.isFinite(row.reversalAutoTradeTp1PricePct) &&
    row.reversalAutoTradeTp1PricePct > 0
      ? row.reversalAutoTradeTp1PricePct
      : DEFAULT_STATS_TPSL_PLAN.tp1PricePct;
  const t1p =
    typeof row.reversalAutoTradeTp1PartialPct === "number" &&
    Number.isFinite(row.reversalAutoTradeTp1PartialPct) &&
    row.reversalAutoTradeTp1PartialPct > 0
      ? row.reversalAutoTradeTp1PartialPct
      : DEFAULT_STATS_TPSL_PLAN.tp1PartialPct;
  const t2 =
    typeof row.reversalAutoTradeTp2PricePct === "number" &&
    Number.isFinite(row.reversalAutoTradeTp2PricePct) &&
    row.reversalAutoTradeTp2PricePct > 0
      ? row.reversalAutoTradeTp2PricePct
      : DEFAULT_STATS_TPSL_PLAN.tp2PricePct;
  const mh =
    typeof row.reversalAutoTradeMaxHoldHours === "number" &&
    Number.isFinite(row.reversalAutoTradeMaxHoldHours) &&
    row.reversalAutoTradeMaxHoldHours > 0
      ? row.reversalAutoTradeMaxHoldHours
      : DEFAULT_STATS_TPSL_PLAN.maxHoldHours;
  return {
    tpSlEnabled: en,
    tp1PricePct: t1,
    tp1PartialPct: Math.min(100, t1p),
    tp2PricePct: t2,
    maxHoldHours: mh,
    slAtEntryArmRoiPct: parseSlArmRoiPct(row.reversalAutoTradeSlArmRoiPct, DEFAULT_SL_ARM_ROI_PCT),
    slAtEntryOffsetPct: parseSlEntryOffsetPct(
      row.reversalAutoTradeSlEntryOffsetPct,
      DEFAULT_SL_ENTRY_OFFSET_PCT,
    ),
  };
}

function snowballTpSlPlanFromSettings(
  row: NonNullable<Awaited<ReturnType<typeof loadTradingViewMexcSettingsFullMap>>[string]>,
): ViewerStatsTpSlPlan {
  const p = resolveSnowballTpSlPlanFromRow(row);
  return {
    tpSlEnabled: p.enabled,
    tp1PricePct: p.tp1PricePct,
    tp1PartialPct: p.tp1PartialPct,
    tp2PricePct: p.tp2PricePct,
    maxHoldHours: p.maxHoldHours,
    slAtEntryArmRoiPct: p.slArmRoiPct,
    slAtEntryOffsetPct: p.slEntryOffsetPct,
  };
}

export async function resolveViewerStatsTpSlPlan(
  telegramUserId: number,
  source: StatsTpSlPlanSource,
): Promise<ViewerStatsTpSlPlan> {
  const userId = `tg:${telegramUserId}`;
  const map = await loadTradingViewMexcSettingsFullMap();
  const row = map[userId];
  if (!row) {
    return {
      tpSlEnabled: true,
      ...DEFAULT_STATS_TPSL_PLAN,
      slAtEntryArmRoiPct: DEFAULT_SL_ARM_ROI_PCT,
      slAtEntryOffsetPct: DEFAULT_SL_ENTRY_OFFSET_PCT,
    };
  }
  return source === "reversal"
    ? reversalTpSlPlanFromSettings(row)
    : snowballTpSlPlanFromSettings(row);
}

export function viewerStatsTpSlPlanPayload(plan: ViewerStatsTpSlPlan): StatsTpSlPlan {
  return {
    tp1PricePct: plan.tp1PricePct,
    tp1PartialPct: plan.tp1PartialPct,
    tp2PricePct: plan.tp2PricePct,
    maxHoldHours: plan.maxHoldHours,
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
    };
  }
  return {
    marginUsdt: positiveNum(row.snowballAutoTradeMarginUsdt),
    leverage: positiveNum(row.snowballAutoTradeLeverage),
  };
}
