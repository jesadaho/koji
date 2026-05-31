import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import { snowballStatsAnchorCloseSec } from "@/lib/snowballStatsClient";
import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import {
  statsTpSlPlanCacheKey,
  type ViewerStatsTpSlPlan,
} from "@/lib/statsTpSlPlanForUser";
import type { StrategyProfitByPlanEntry, StrategyProfitByPlanMap } from "@/lib/statsStrategyProfitClient";
import {
  simulateStatsTpSlProfit,
  type StatsTpSlPlan,
} from "@/lib/tpSlStrategySimulate";
import {
  fetchBinanceUsdmKlinesRange,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

const KLINE_15M_SEC = 900;
const HOUR_SEC = 3600;
const DAY_SEC = 24 * HOUR_SEC;

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
  plan: StatsTpSlPlan,
  row: {
    pct4h: number | null;
    pct12h: number | null;
    pct24h: number | null;
    pct48h: number | null;
  },
): number | null {
  const h = plan.maxHoldHours;
  if (h <= 4 && row.pct4h != null && Number.isFinite(row.pct4h)) return row.pct4h;
  if (h <= 12 && row.pct12h != null && Number.isFinite(row.pct12h)) return row.pct12h;
  if (h <= 24 && row.pct24h != null && Number.isFinite(row.pct24h)) return row.pct24h;
  if (row.pct48h != null && Number.isFinite(row.pct48h)) return row.pct48h;
  return null;
}

function simulateFromPack(input: {
  side: "long" | "short";
  entry: number;
  pack: BinanceKlinePack;
  ac: number;
  windowEndSec: number;
  pctAtClose: number;
  plan: ViewerStatsTpSlPlan;
}): StrategyProfitByPlanEntry | null {
  if (!input.plan.tpSlEnabled) {
    return { profitPct: input.pctAtClose, exitReason: "time_48h" };
  }

  const { timeSec, high, low } = input.pack;
  const iFirst = timeSec.findIndex((t) => t + KLINE_15M_SEC >= input.ac);
  if (iFirst < 0) return null;
  const iLast = indexRangeThrough(timeSec, KLINE_15M_SEC, iFirst, input.windowEndSec);
  if (iLast < iFirst) return null;

  const sim = simulateStatsTpSlProfit({
    side: input.side,
    entry: input.entry,
    high,
    low,
    iFirst,
    iLast,
    pctAt48h: input.pctAtClose,
    plan: input.plan,
  });
  if (!sim) return null;
  return { profitPct: sim.profitPct, exitReason: sim.exitReason };
}

function reversalAnchorCloseSec(row: CandleReversalStatsRow): number {
  const dur = row.signalBarTf === "1h" ? HOUR_SEC : DAY_SEC;
  return row.signalBarOpenSec + dur;
}

async function fetchPackForRow(
  symbol: string,
  signalBarOpenSec: number,
  windowEndSec: number,
): Promise<BinanceKlinePack | null> {
  try {
    return await fetchBinanceUsdmKlinesRange(symbol, "15m", {
      startTimeMs: signalBarOpenSec * 1000,
      endTimeMs: windowEndSec * 1000 + KLINE_15M_SEC * 1000,
      limit: 500,
    });
  } catch (e) {
    console.error("[statsStrategyProfitEnrich] klines", symbol, e);
    return null;
  }
}

function applyCachedOrComputed(
  row: {
    strategyProfitByPlan?: StrategyProfitByPlanMap | null;
    strategyProfitPct?: number | null;
    strategyExitReason?: StrategyProfitByPlanEntry["exitReason"] | null;
  },
  cacheKey: string,
  computed: StrategyProfitByPlanEntry | null,
): boolean {
  if (!computed) return false;
  const prev = row.strategyProfitByPlan?.[cacheKey];
  if (
    prev &&
    prev.profitPct === computed.profitPct &&
    prev.exitReason === computed.exitReason &&
    row.strategyProfitPct === computed.profitPct &&
    row.strategyExitReason === computed.exitReason
  ) {
    return false;
  }
  row.strategyProfitByPlan = { ...row.strategyProfitByPlan, [cacheKey]: computed };
  row.strategyProfitPct = computed.profitPct;
  row.strategyExitReason = computed.exitReason;
  return true;
}

export async function enrichCandleReversalStatsWithViewerStrategyProfit(
  rows: CandleReversalStatsRow[],
  plan: ViewerStatsTpSlPlan,
): Promise<number> {
  const cacheKey = statsTpSlPlanCacheKey(plan);
  const packBySymbol = new Map<string, BinanceKlinePack | null>();
  let dirty = 0;

  for (const row of rows) {
    if (row.signalBarTf !== "1h" || row.pct48h == null) continue;

    const cached = row.strategyProfitByPlan?.[cacheKey];
    if (cached) {
      if (row.strategyProfitPct !== cached.profitPct || row.strategyExitReason !== cached.exitReason) {
        row.strategyProfitPct = cached.profitPct;
        row.strategyExitReason = cached.exitReason;
        dirty += 1;
      }
      continue;
    }

    const pctClose = pctAtPlanMaxHold(plan, row) ?? row.pct48h;
    if (pctClose == null) continue;

    const ac = reversalAnchorCloseSec(row);
    const windowEndSec = ac + Math.min(plan.maxHoldHours, 48) * HOUR_SEC;
    const sym = row.symbol.trim().toUpperCase();
    let pack = packBySymbol.get(sym);
    if (pack === undefined) {
      pack = await fetchPackForRow(sym, row.signalBarOpenSec, windowEndSec);
      packBySymbol.set(sym, pack);
    }
    if (!pack?.timeSec.length) continue;

    const side = row.tradeSide === "long" ? "long" : "short";
    const computed = simulateFromPack({
      side,
      entry: row.entryPrice,
      pack,
      ac,
      windowEndSec,
      pctAtClose: pctClose,
      plan,
    });
    if (applyCachedOrComputed(row, cacheKey, computed)) dirty += 1;
  }

  return dirty;
}

export async function enrichSnowballStatsWithViewerStrategyProfit(
  rows: SnowballStatsRow[],
  plan: ViewerStatsTpSlPlan,
): Promise<number> {
  const cacheKey = statsTpSlPlanCacheKey(plan);
  const packBySymbol = new Map<string, BinanceKlinePack | null>();
  let dirty = 0;

  for (const row of rows) {
    if (row.pct48h == null) continue;

    const cached = row.strategyProfitByPlan?.[cacheKey];
    if (cached) {
      if (row.strategyProfitPct !== cached.profitPct || row.strategyExitReason !== cached.exitReason) {
        row.strategyProfitPct = cached.profitPct;
        row.strategyExitReason = cached.exitReason;
        dirty += 1;
      }
      continue;
    }

    const pctClose = pctAtPlanMaxHold(plan, row) ?? row.pct48h;
    if (pctClose == null) continue;

    const ac = snowballStatsAnchorCloseSec(row);
    const windowEndSec = ac + Math.min(plan.maxHoldHours, 48) * HOUR_SEC;
    const sym = row.symbol.trim().toUpperCase();
    let pack = packBySymbol.get(sym);
    if (pack === undefined) {
      pack = await fetchPackForRow(sym, row.signalBarOpenSec, windowEndSec);
      packBySymbol.set(sym, pack);
    }
    if (!pack?.timeSec.length) continue;

    const computed = simulateFromPack({
      side: row.side,
      entry: row.entryPrice,
      pack,
      ac,
      windowEndSec,
      pctAtClose: pctClose,
      plan,
    });
    if (applyCachedOrComputed(row, cacheKey, computed)) dirty += 1;
  }

  return dirty;
}
