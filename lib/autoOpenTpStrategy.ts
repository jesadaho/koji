import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { resolveAutoOpenStrategyFromProfitPct } from "@/lib/autoOpenStrategyOutcome";
import {
  resolveStatsStrategyProfitOutcome,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  type StatsStrategyProfitHorizon,
  type StrategyProfitByPlanEntry,
  type StrategyProfitByPlanMap,
} from "@/lib/statsStrategyProfitClient";
import {
  resolveTpSlPlanForUserId,
  statsTpSlPlanCacheKey,
  viewerStatsTpSlPlanPayload,
  type ViewerStatsTpSlPlan,
} from "@/lib/statsTpSlPlanForUser";
import { simulateStatsTpSlProfit } from "@/lib/tpSlStrategySimulate";
import type { loadTradingViewMexcSettingsFullMap } from "@/src/tradingViewCloseSettingsStore";

const KLINE_15M_SEC = 900;
const HOUR_SEC = 3600;

type KlineSlice = {
  timeSec: number[];
  high: number[];
  low: number[];
};

function indexRangeThrough(
  timeSec: number[],
  barDurSec: number,
  iFirst: number,
  windowEndSec: number,
): number {
  let iLast = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + barDurSec <= windowEndSec) iLast = i;
  }
  return iLast;
}

function pctAtPlanMaxHold(
  plan: ViewerStatsTpSlPlan,
  row: Pick<AutoOpenOrderLogRow, "pct4h" | "pct12h" | "pct24h" | "pct48h">,
): number | null {
  const h = plan.maxHoldHours;
  if (h <= 4 && row.pct4h != null && Number.isFinite(row.pct4h)) return row.pct4h;
  if (h <= 12 && row.pct12h != null && Number.isFinite(row.pct12h)) return row.pct12h;
  if (h <= 24 && row.pct24h != null && Number.isFinite(row.pct24h)) return row.pct24h;
  if (row.pct48h != null && Number.isFinite(row.pct48h)) return row.pct48h;
  return null;
}

function simulateAutoOpenTpFromPack(input: {
  side: "long" | "short";
  entry: number;
  pack: KlineSlice;
  ac: number;
  windowEndSec: number;
  pctAtClose: number;
  pctAtPhase1: number | null;
  plan: ViewerStatsTpSlPlan;
  leverage?: number | null;
  maxDrawdownPct?: number | null;
}): StrategyProfitByPlanEntry | null {
  if (!input.plan.tpSlEnabled) {
    return {
      profitPct: input.pctAtClose,
      exitReason: input.plan.maxHoldHours <= 24 ? "time_24h" : "time_48h",
    };
  }

  const { timeSec, high, low } = input.pack;
  const iFirst = timeSec.findIndex((t) => t + KLINE_15M_SEC >= input.ac);
  if (iFirst < 0) return null;
  const iLast = indexRangeThrough(timeSec, KLINE_15M_SEC, iFirst, input.windowEndSec);
  if (iLast < iFirst) return null;
  const phase1EndSec = input.ac + input.plan.maxHoldHours * HOUR_SEC;
  const iPhase1Last = indexRangeThrough(timeSec, KLINE_15M_SEC, iFirst, phase1EndSec);
  const pctPhase1 =
    input.pctAtPhase1 != null && Number.isFinite(input.pctAtPhase1)
      ? input.pctAtPhase1
      : input.pctAtClose;

  const sim = simulateStatsTpSlProfit({
    side: input.side,
    entry: input.entry,
    high,
    low,
    iFirst,
    iLast,
    iPhase1Last,
    pctAtPhase1: pctPhase1,
    pctAt48h: input.pctAtClose,
    plan: input.plan,
    leverage: input.leverage,
  });
  if (!sim) return null;

  const resolved = resolveStatsStrategyProfitOutcome({
    profitPct: sim.profitPct,
    exitReason: sim.exitReason,
    leverage: input.leverage,
    liquidationMetrics: { maxDrawdownPct: input.maxDrawdownPct ?? null },
  });
  return {
    profitPct: resolved.profitPct,
    exitReason: resolved.exitReason ?? sim.exitReason,
  };
}

export function autoOpenTpStrategyCacheKey(
  plan: ViewerStatsTpSlPlan,
  holdHours: StatsStrategyProfitHorizon,
): string {
  return statsTpSlPlanCacheKey(viewerStatsTpSlPlanPayload(plan), holdHours);
}

export function computeAutoOpenTpStrategyAtHorizon(input: {
  row: AutoOpenOrderLogRow;
  side: "long" | "short";
  entry: number;
  pack: KlineSlice;
  ac: number;
  holdHours: StatsStrategyProfitHorizon;
  plan: ViewerStatsTpSlPlan;
}): StrategyProfitByPlanEntry | null {
  const { row, holdHours } = input;
  const pctClose =
    pctAtPlanMaxHold({ ...input.plan, maxHoldHours: holdHours }, row) ??
    (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H ? row.pct24h : row.pct48h);
  if (pctClose == null || !Number.isFinite(pctClose)) return null;

  const pctPhase1Raw =
    pctAtPlanMaxHold(input.plan, row) ??
    (input.plan.maxHoldHours <= 24 ? row.pct24h : row.pct48h);
  const pctPhase1 =
    pctPhase1Raw != null && Number.isFinite(pctPhase1Raw) ? pctPhase1Raw : null;

  return simulateAutoOpenTpFromPack({
    side: input.side,
    entry: input.entry,
    pack: input.pack,
    ac: input.ac,
    windowEndSec: input.ac + holdHours * HOUR_SEC,
    pctAtClose: pctClose,
    pctAtPhase1: pctPhase1,
    plan: input.plan,
    leverage: input.row.leverage,
    maxDrawdownPct: input.row.maxDrawdownPct,
  });
}

export function applyAutoOpenTpStrategyHorizon(
  row: AutoOpenOrderLogRow,
  holdHours: StatsStrategyProfitHorizon,
  computed: StrategyProfitByPlanEntry | null,
  plan: ViewerStatsTpSlPlan,
): boolean {
  if (!computed) return false;
  const cacheKey = autoOpenTpStrategyCacheKey(plan, holdHours);
  const prev = row.strategyProfitByPlan?.[cacheKey];
  const sameCached =
    prev &&
    prev.profitPct === computed.profitPct &&
    prev.exitReason === computed.exitReason;

  const outcome = resolveAutoOpenStrategyFromProfitPct(row.source, computed.profitPct).strategyOutcome;
  const is24 = holdHours === STATS_STRATEGY_PROFIT_HOLD_24H;
  const sameFields = is24
    ? row.strategyPct24h === computed.profitPct &&
      row.strategyOutcome24h === outcome &&
      row.strategyExitReason24h === computed.exitReason
    : row.strategyPct === computed.profitPct &&
      row.strategyOutcome === outcome &&
      row.strategyExitReason === computed.exitReason;

  if (sameCached && sameFields) return false;

  row.strategyProfitByPlan = { ...row.strategyProfitByPlan, [cacheKey]: computed };
  if (is24) {
    row.strategyPct24h = computed.profitPct;
    row.strategyOutcome24h = outcome;
    row.strategyExitReason24h = computed.exitReason;
  } else {
    row.strategyPct = computed.profitPct;
    row.strategyOutcome = outcome;
    row.strategyExitReason = computed.exitReason;
  }
  return true;
}

export function withAutoOpenTpStrategyDisplayFields(
  row: AutoOpenOrderLogRow,
  plan: ViewerStatsTpSlPlan,
): AutoOpenOrderLogRow {
  let out = row;
  for (const holdHours of [STATS_STRATEGY_PROFIT_HOLD_24H, STATS_STRATEGY_PROFIT_HOLD_48H] as const) {
    const cacheKey = autoOpenTpStrategyCacheKey(plan, holdHours);
    const cached = row.strategyProfitByPlan?.[cacheKey];
    if (!cached) continue;

    const outcome = resolveAutoOpenStrategyFromProfitPct(row.source, cached.profitPct).strategyOutcome;
    if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H) {
      if (
        out.strategyPct24h === cached.profitPct &&
        out.strategyOutcome24h === outcome &&
        out.strategyExitReason24h === cached.exitReason
      ) {
        continue;
      }
      out = {
        ...out,
        strategyPct24h: cached.profitPct,
        strategyOutcome24h: outcome,
        strategyExitReason24h: cached.exitReason,
      };
    } else if (
      out.strategyPct !== cached.profitPct ||
      out.strategyOutcome !== outcome ||
      out.strategyExitReason !== cached.exitReason
    ) {
      out = {
        ...out,
        strategyPct: cached.profitPct,
        strategyOutcome: outcome,
        strategyExitReason: cached.exitReason,
      };
    }
  }
  return out;
}

export function autoOpenNeedsTpStrategyRecompute(
  row: AutoOpenOrderLogRow,
  plan: ViewerStatsTpSlPlan,
  nowSec: number,
  ac: number,
): boolean {
  if (nowSec >= ac + 24 * HOUR_SEC && row.pct24h != null) {
    const key24 = autoOpenTpStrategyCacheKey(plan, STATS_STRATEGY_PROFIT_HOLD_24H);
    if (row.strategyExitReason24h == null || row.strategyProfitByPlan?.[key24] == null) {
      return true;
    }
  }
  if (nowSec >= ac + 48 * HOUR_SEC && row.pct48h != null) {
    const key48 = autoOpenTpStrategyCacheKey(plan, STATS_STRATEGY_PROFIT_HOLD_48H);
    if (row.strategyExitReason == null || row.strategyProfitByPlan?.[key48] == null) {
      return true;
    }
  }
  return false;
}

export function resolveAutoOpenTpSlPlanForRow(
  row: AutoOpenOrderLogRow,
  map: Awaited<ReturnType<typeof loadTradingViewMexcSettingsFullMap>>,
): ViewerStatsTpSlPlan {
  return resolveTpSlPlanForUserId(row.userId, row.source, map);
}

export type { StrategyProfitByPlanMap };
