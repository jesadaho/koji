import {
  reversalStatsMeasureSide,
  STATS_MAX_ROI_15M_VERSION,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { snowballStatsAnchorCloseSec } from "@/lib/snowballStatsClient";
import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import type { ViewerStatsTpSlPlan } from "@/lib/statsTpSlPlanForUser";
import type { StrategyProfitByPlanEntry, StrategyProfitByPlanMap } from "@/lib/statsStrategyProfitClient";
import {
  STATS_STRATEGY_PROFIT_48H_BYPASS_TPSL,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  statsStrategyProfitCacheKey,
  statsStrategyProfitFromHorizonPct,
  type StatsStrategyProfitHorizon,
} from "@/lib/statsStrategyProfitClient";
import {
  reversalTpStrategyCacheKey,
  simulateReversalTpStrategyProfit,
} from "@/lib/reversalTpStrategy";
import { firstFollowUpKlineIndexAfterAnchorClose } from "@/lib/statsFollowUpAdverse";
import {
  maxFavorablePctInRange,
  simulateStatsTpSlProfit,
  tpExitExceedsMaxRoi,
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

function simulateReversalFromPack(input: {
  side: "long" | "short";
  entry: number;
  pack: BinanceKlinePack;
  ac: number;
  windowEndSec: number;
  row: Pick<
    CandleReversalStatsRow,
    "pct12h" | "pct24h" | "pct48h" | "ema4hSlopePct7d"
  >;
  holdHours: StatsStrategyProfitHorizon;
}): StrategyProfitByPlanEntry | null {
  if (input.row.pct12h == null || input.row.pct24h == null || input.row.pct48h == null) {
    return null;
  }
  const { timeSec, high, low } = input.pack;
  const iFirst = firstFollowUpKlineIndexAfterAnchorClose(timeSec, input.ac);
  if (iFirst < 0) return null;
  const iLast = indexRangeThrough(timeSec, KLINE_15M_SEC, iFirst, input.windowEndSec);
  if (iLast < iFirst) return null;
  const sim = simulateReversalTpStrategyProfit({
    side: input.side,
    entry: input.entry,
    high,
    low,
    timeSec,
    iFirst,
    iLast,
    pct12h: input.row.pct12h,
    pct24h: input.row.pct24h,
    pct48h: input.row.pct48h,
    ema4hSlopePct7d: input.row.ema4hSlopePct7d,
    maxHorizonHours: input.holdHours,
  });
  if (!sim) return null;
  return { profitPct: sim.profitPct, exitReason: sim.exitReason };
}

function simulateFromPack(input: {
  side: "long" | "short";
  entry: number;
  pack: BinanceKlinePack;
  ac: number;
  windowEndSec: number;
  pctAtClose: number;
  pctAtPhase1: number | null;
  plan: ViewerStatsTpSlPlan;
}): StrategyProfitByPlanEntry | null {
  if (!input.plan.tpSlEnabled) {
    return {
      profitPct: input.pctAtClose,
      exitReason: input.plan.maxHoldHours <= 24 ? "time_24h" : "time_48h",
    };
  }

  const { timeSec, high, low } = input.pack;
  const iFirst = firstFollowUpKlineIndexAfterAnchorClose(timeSec, input.ac);
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
  });
  if (!sim) return null;
  return { profitPct: sim.profitPct, exitReason: sim.exitReason };
}

function reversalAnchorCloseSec(row: CandleReversalStatsRow): number {
  const dur = row.signalBarTf === "1h" ? HOUR_SEC : DAY_SEC;
  return row.signalBarOpenSec + dur;
}

function packCacheKey(symbol: string, signalBarOpenSec: number, windowEndSec: number): string {
  return `${symbol}:${signalBarOpenSec}:${windowEndSec}`;
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

function applyHorizonFields(
  row: {
    strategyProfitByPlan?: StrategyProfitByPlanMap | null;
    strategyProfitPct?: number | null;
    strategyExitReason?: StrategyProfitByPlanEntry["exitReason"] | null;
    strategyProfitPct24h?: number | null;
    strategyExitReason24h?: StrategyProfitByPlanEntry["exitReason"] | null;
  },
  holdHours: StatsStrategyProfitHorizon,
  cacheKey: string,
  computed: StrategyProfitByPlanEntry | null,
): boolean {
  if (!computed) return false;
  const prev = row.strategyProfitByPlan?.[cacheKey];
  const sameCached =
    prev &&
    prev.profitPct === computed.profitPct &&
    prev.exitReason === computed.exitReason;
  const sameFields =
    holdHours === STATS_STRATEGY_PROFIT_HOLD_24H
      ? row.strategyProfitPct24h === computed.profitPct &&
        row.strategyExitReason24h === computed.exitReason
      : row.strategyProfitPct === computed.profitPct &&
        row.strategyExitReason === computed.exitReason;
  if (sameCached && sameFields) return false;

  row.strategyProfitByPlan = { ...row.strategyProfitByPlan, [cacheKey]: computed };
  if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H) {
    row.strategyProfitPct24h = computed.profitPct;
    row.strategyExitReason24h = computed.exitReason;
  } else {
    row.strategyProfitPct = computed.profitPct;
    row.strategyExitReason = computed.exitReason;
  }
  return true;
}

/** อัปเดต Max ROI จาก 15m สำหรับแถวเก่าที่ยังใช้ค่าจากแท่ง 1H */
async function refreshCandleReversal1hMaxRoiFrom15m(rows: CandleReversalStatsRow[]): Promise<number> {
  const packCache = new Map<string, BinanceKlinePack | null>();
  const nowSec = Math.floor(Date.now() / 1000);
  let dirty = 0;

  for (const row of rows) {
    if (row.signalBarTf !== "1h" || row.pct24h == null) continue;
    if (row.maxRoi15mV === STATS_MAX_ROI_15M_VERSION && row.maxRoiPct != null) continue;

    const ac = reversalAnchorCloseSec(row);
    if (nowSec < ac + 24 * HOUR_SEC) continue;
    const windowEndSec = Math.min(nowSec, ac + 48 * HOUR_SEC);

    const sym = row.symbol.trim().toUpperCase();
    const key = packCacheKey(sym, row.signalBarOpenSec, windowEndSec);
    let pack = packCache.get(key);
    if (pack === undefined) {
      pack = await fetchPackForRow(sym, row.signalBarOpenSec, windowEndSec);
      packCache.set(key, pack);
    }
    if (!pack?.timeSec.length) continue;

    const side = reversalStatsMeasureSide(row);
    const { timeSec, high, low } = pack;
    const iFirst = firstFollowUpKlineIndexAfterAnchorClose(timeSec, ac);
    if (iFirst < 0) continue;
    const iLast = indexRangeThrough(timeSec, KLINE_15M_SEC, iFirst, windowEndSec);
    if (iLast < iFirst) continue;

    const maxRoi = maxFavorablePctInRange(side, row.entryPrice, high, low, iFirst, iLast);
    if (maxRoi == null) continue;

    if (row.maxRoiPct !== maxRoi || row.maxRoi15mV !== STATS_MAX_ROI_15M_VERSION) {
      row.maxRoiPct = maxRoi;
      row.maxRoi15mV = STATS_MAX_ROI_15M_VERSION;
      row.strategyProfitByPlan = undefined;
      row.strategyProfitPct = null;
      row.strategyProfitPct24h = null;
      row.strategyExitReason = null;
      row.strategyExitReason24h = null;
      dirty += 1;
    }
  }

  return dirty;
}

async function enrichRowsWithViewerStrategyProfit<T extends CandleReversalStatsRow | SnowballStatsRow>(opts: {
  rows: T[];
  plan: ViewerStatsTpSlPlan;
  anchorCloseSec: (row: T) => number;
  sideForRow: (row: T) => "long" | "short";
  includeRow: (row: T) => boolean;
}): Promise<number> {
  const packCache = new Map<string, BinanceKlinePack | null>();
  let dirty = 0;

  for (const holdHours of [STATS_STRATEGY_PROFIT_HOLD_24H, STATS_STRATEGY_PROFIT_HOLD_48H] as const) {
    const planAtHorizon: ViewerStatsTpSlPlan = {
      ...opts.plan,
      maxHoldHours: holdHours,
      holdExtendIfRedEnabled: false,
    };
    const cacheKey = statsStrategyProfitCacheKey(opts.plan, holdHours);

    for (const row of opts.rows) {
      if (!opts.includeRow(row)) continue;
      if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H && row.pct24h == null) continue;
      if (holdHours === STATS_STRATEGY_PROFIT_HOLD_48H && row.pct48h == null) continue;

      let cached = row.strategyProfitByPlan?.[cacheKey];
      if (cached && tpExitExceedsMaxRoi(cached.exitReason, planAtHorizon, row.maxRoiPct)) {
        const rest = { ...row.strategyProfitByPlan };
        delete rest[cacheKey];
        row.strategyProfitByPlan = Object.keys(rest).length > 0 ? rest : undefined;
        cached = undefined;
      }
      if (cached) {
        if (applyHorizonFields(row, holdHours, cacheKey, cached)) {
          dirty += 1;
        }
        continue;
      }

      const pctClose =
        holdHours === STATS_STRATEGY_PROFIT_HOLD_24H ? row.pct24h : row.pct48h;
      if (pctClose == null) continue;

      if (
        holdHours === STATS_STRATEGY_PROFIT_HOLD_48H &&
        STATS_STRATEGY_PROFIT_48H_BYPASS_TPSL
      ) {
        const computed = statsStrategyProfitFromHorizonPct({
          holdHours,
          pctAtHorizon: pctClose,
        });
        if (applyHorizonFields(row, holdHours, cacheKey, computed)) dirty += 1;
        continue;
      }

      const pctPhase1 = pctAtPlanMaxHold(planAtHorizon, row) ?? pctClose;

      const ac = opts.anchorCloseSec(row);
      const windowEndSec = ac + holdHours * HOUR_SEC;
      const sym = row.symbol.trim().toUpperCase();
      const pKey = packCacheKey(sym, row.signalBarOpenSec, windowEndSec);
      let pack = packCache.get(pKey);
      if (pack === undefined) {
        pack = await fetchPackForRow(sym, row.signalBarOpenSec, windowEndSec);
        packCache.set(pKey, pack);
      }
      if (!pack?.timeSec.length) continue;

      const computed = simulateFromPack({
        side: opts.sideForRow(row),
        entry: row.entryPrice,
        pack,
        ac,
        windowEndSec,
        pctAtClose: pctClose,
        pctAtPhase1: pctPhase1,
        plan: planAtHorizon,
      });
      if (applyHorizonFields(row, holdHours, cacheKey, computed)) dirty += 1;
    }
  }

  return dirty;
}

export async function enrichCandleReversalStatsWithViewerStrategyProfit(
  rows: CandleReversalStatsRow[],
  _plan: ViewerStatsTpSlPlan,
): Promise<number> {
  let dirty = await refreshCandleReversal1hMaxRoiFrom15m(rows);
  dirty += await enrichReversalRowsStrategyProfit(rows);
  return dirty;
}

async function enrichReversalRowsStrategyProfit(rows: CandleReversalStatsRow[]): Promise<number> {
  const packCache = new Map<string, BinanceKlinePack | null>();
  let dirty = 0;

  for (const holdHours of [STATS_STRATEGY_PROFIT_HOLD_24H, STATS_STRATEGY_PROFIT_HOLD_48H] as const) {
    const cacheKey = reversalTpStrategyCacheKey(holdHours);

    for (const row of rows) {
      if (row.signalBarTf !== "1h") continue;
      if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H && row.pct24h == null) continue;
      if (holdHours === STATS_STRATEGY_PROFIT_HOLD_48H && row.pct48h == null) continue;
      if (row.pct12h == null) continue;

      const cached = row.strategyProfitByPlan?.[cacheKey];
      if (cached) {
        if (applyHorizonFields(row, holdHours, cacheKey, cached)) dirty += 1;
        continue;
      }

      const ac = reversalAnchorCloseSec(row);
      const windowEndSec = ac + holdHours * HOUR_SEC;
      const sym = row.symbol.trim().toUpperCase();
      const pKey = packCacheKey(sym, row.signalBarOpenSec, windowEndSec);
      let pack = packCache.get(pKey);
      if (pack === undefined) {
        pack = await fetchPackForRow(sym, row.signalBarOpenSec, windowEndSec);
        packCache.set(pKey, pack);
      }
      if (!pack?.timeSec.length) continue;

      const computed = simulateReversalFromPack({
        side: reversalStatsMeasureSide(row),
        entry: row.entryPrice,
        pack,
        ac,
        windowEndSec,
        row,
        holdHours,
      });
      if (applyHorizonFields(row, holdHours, cacheKey, computed)) dirty += 1;
    }
  }

  return dirty;
}

export async function enrichSnowballStatsWithViewerStrategyProfit(
  rows: SnowballStatsRow[],
  plan: ViewerStatsTpSlPlan,
): Promise<number> {
  return enrichRowsWithViewerStrategyProfit({
    rows,
    plan,
    anchorCloseSec: snowballStatsAnchorCloseSec,
    sideForRow: (row) => row.side,
    includeRow: () => true,
  });
}

/** ใส่กำไรกลยุทธ์ Reversal จาก cache (ไม่ดึง Binance) */
export function withReversalStrategyProfitDisplayFields<
  T extends {
    strategyProfitByPlan?: StrategyProfitByPlanMap | null;
    strategyProfitPct?: number | null;
    strategyExitReason?: StrategyProfitByPlanEntry["exitReason"] | null;
    strategyProfitPct24h?: number | null;
    strategyExitReason24h?: StrategyProfitByPlanEntry["exitReason"] | null;
  },
>(row: T): T {
  let out = row;
  for (const holdHours of [STATS_STRATEGY_PROFIT_HOLD_24H, STATS_STRATEGY_PROFIT_HOLD_48H] as const) {
    const cacheKey = reversalTpStrategyCacheKey(holdHours);
    const cached = row.strategyProfitByPlan?.[cacheKey];
    if (!cached) {
      if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H) {
        if (out.strategyProfitPct24h != null || out.strategyExitReason24h != null) {
          out = { ...out, strategyProfitPct24h: null, strategyExitReason24h: null };
        }
      } else if (out.strategyProfitPct != null || out.strategyExitReason != null) {
        out = { ...out, strategyProfitPct: null, strategyExitReason: null };
      }
      continue;
    }
    if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H) {
      if (
        out.strategyProfitPct24h === cached.profitPct &&
        out.strategyExitReason24h === cached.exitReason
      ) {
        continue;
      }
      out = {
        ...out,
        strategyProfitPct24h: cached.profitPct,
        strategyExitReason24h: cached.exitReason,
      };
    } else if (
      out.strategyProfitPct !== cached.profitPct ||
      out.strategyExitReason !== cached.exitReason
    ) {
      out = {
        ...out,
        strategyProfitPct: cached.profitPct,
        strategyExitReason: cached.exitReason,
      };
    }
  }
  return out;
}

/** ใส่กำไรกลยุทธ์จาก cache ตามแผนผู้ชม (ไม่ดึง Binance) — ใช้บน GET */
export function withViewerStrategyProfitDisplayFields<
  T extends {
    strategyProfitByPlan?: StrategyProfitByPlanMap | null;
    strategyProfitPct?: number | null;
    strategyExitReason?: StrategyProfitByPlanEntry["exitReason"] | null;
    strategyProfitPct24h?: number | null;
    strategyExitReason24h?: StrategyProfitByPlanEntry["exitReason"] | null;
  },
>(row: T, plan: ViewerStatsTpSlPlan): T {
  let out = row;
  for (const holdHours of [STATS_STRATEGY_PROFIT_HOLD_24H, STATS_STRATEGY_PROFIT_HOLD_48H] as const) {
    const cacheKey = statsStrategyProfitCacheKey(plan, holdHours);
    const cached = row.strategyProfitByPlan?.[cacheKey];
    if (!cached) {
      if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H) {
        if (out.strategyProfitPct24h != null || out.strategyExitReason24h != null) {
          out = {
            ...out,
            strategyProfitPct24h: null,
            strategyExitReason24h: null,
          };
        }
      } else if (out.strategyProfitPct != null || out.strategyExitReason != null) {
        out = {
          ...out,
          strategyProfitPct: null,
          strategyExitReason: null,
        };
      }
      continue;
    }
    if (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H) {
      if (
        out.strategyProfitPct24h === cached.profitPct &&
        out.strategyExitReason24h === cached.exitReason
      ) {
        continue;
      }
      out = {
        ...out,
        strategyProfitPct24h: cached.profitPct,
        strategyExitReason24h: cached.exitReason,
      };
    } else if (
      out.strategyProfitPct !== cached.profitPct ||
      out.strategyExitReason !== cached.exitReason
    ) {
      out = {
        ...out,
        strategyProfitPct: cached.profitPct,
        strategyExitReason: cached.exitReason,
      };
    }
  }
  return out;
}
