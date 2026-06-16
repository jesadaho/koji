import { lenPercentilePctFromRank } from "@/lib/statsLenPercentile";
import {
  backfillAllStatsRowsBtcEmaSlopes,
  backfillAllStatsRowsSymbolEmaSlopes,
} from "./statsEmaSlope";
import {
  computeFollowUpMaxAdversePct,
  firstFollowUpKlineIndexAfterAnchorClose,
} from "@/lib/statsFollowUpAdverse";
import { DEFAULT_STATS_TPSL_PLAN } from "@/lib/tpSlStrategySimulate";
import {
  computeStatsStrategyProfitFromBars,
  statsStrategyProfitCacheKey,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
} from "@/lib/statsStrategyProfitClient";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  isSnowballStatsEnabled,
  loadSnowballStatsState,
  applySnowballStatsRowMigrations,
  backfillSnowballStatsTrendGrades,
  saveSnowballStatsState,
  snowballStatsRowNeedsTrendGradeBackfill,
  type SnowballStatsOutcome,
  type SnowballStatsRow,
} from "./snowballStatsStore";
import { backfillAllStatsRowsPsar4h } from "./statsPsar4h";
import { backfillAllStatsRowsQuoteVol24h } from "./statsQuoteVol24h";
import { backfillAllStatsMarketSentiment } from "./marketSentimentSnapshotStore";
import {
  calculateTrendMomentumVolumeCascadeYn,
  fetchSnowball1hPackForTrendMomentum,
  SNOWBALL_TREND_1H_VOL_LOOKBACK,
} from "./snowballTrendMomentumMetrics";
import { applySnowballStatsGrade4hFollowUp } from "./snowballStatsGrade4hFollowUp";
import { buildSnowballLongConfirmGateStepsForStats } from "./snowballStatsGateSteps";
import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
import { countGreenDaysBeforeSignalBar } from "./greenDayStreak";
import { snowballStatsAnchorCloseSec, snowballStatsHorizonDue } from "@/lib/snowballStatsClient";
import { toBinanceUsdtPerpSymbol } from "./snowballManualSymbolClear";

export type SnowballStatsFollowUpResult = {
  dirty: number;
  migrations: number;
  trendMomentum: number;
  confirmGateSteps: number;
  greenDays: number;
  grade4h: number;
  horizonRows: number;
  emaSlopes: number;
  trendGrades: number;
};

export type SnowballStatsAdminBackfillResult = {
  ok: boolean;
  skippedReason?: string;
  symbol?: string;
  totalRows: number;
  durationMs: number;
  followUp: SnowballStatsFollowUpResult;
  /** แถว 4h ที่ครบเวลา 4h แต่ pct4h ยังว่าง (ก่อนรัน) */
  missingHorizon4hBefore: number;
  /** หลังรัน */
  missingHorizon4hAfter: number;
  /** ยังมีงาน backfill ค้าง — เรียกซ้ำ (chunk) */
  hasMore: boolean;
  /** แถวที่ยังรอ horizon / trend grade (หลังรัน) */
  pendingHorizon: number;
  pendingTrendGrades: number;
  samplesFilled: string[];
};

/** ความละเอียดของ kline ที่ใช้คำนวณ MFE / horizon (คง 15m) */
const KLINE_GRAN_SEC = 900;

function snowballStatsBackfillMaxHorizonPerPass(): number {
  const v = Number(process.env.SNOWBALL_STATS_BACKFILL_MAX_HORIZON_PER_PASS?.trim());
  if (Number.isFinite(v) && v >= 1 && v <= 80) return Math.floor(v);
  return 10;
}

function snowballStatsRowNeedsHorizonFollowUpWork(row: SnowballStatsRow, nowSec: number): boolean {
  const entry = row.entryPrice;
  if (!Number.isFinite(entry) || entry <= 0) return false;

  const ac = snowballStatsAnchorCloseSec(row);
  if (nowSec < ac) return false;

  const SEC_48H = 48 * 3600;
  const SEC_24H = 24 * 3600;
  const pending = row.outcome === "pending";
  const needs48h = row.pct48h == null && nowSec >= ac + SEC_48H;
  const needsHorizonBackfill =
    (row.pct4h == null && nowSec >= ac + 4 * 3600) ||
    (row.pct12h == null && nowSec >= ac + 12 * 3600) ||
    (row.pct24h == null && nowSec >= ac + SEC_24H) ||
    (row.pct48h == null && nowSec >= ac + SEC_48H);
  const needsFollowUpAdverse = row.followUpMaxAdversePct == null || nowSec < ac + SEC_48H;
  const needsStrategyProfit =
    (row.pct24h != null && row.strategyProfitPct24h == null) ||
    (row.pct48h != null && row.strategyProfitPct == null);
  return pending || needs48h || needsHorizonBackfill || needsFollowUpAdverse || needsStrategyProfit;
}

export function countSnowballStatsBackfillPending(
  rows: SnowballStatsRow[],
  nowMs: number,
  symbol?: string,
): { horizon: number; trendGrades: number } {
  const nowSec = Math.floor(nowMs / 1000);
  let horizon = 0;
  let trendGrades = 0;
  for (const row of rows) {
    if (symbol && row.symbol.trim().toUpperCase() !== symbol) continue;
    if (snowballStatsRowNeedsTrendGradeBackfill(row)) trendGrades += 1;
    if (snowballStatsRowNeedsHorizonFollowUpWork(row, nowSec)) horizon += 1;
  }
  return { horizon, trendGrades };
}

async function backfillSnowballEmaSlopes(
  rows: SnowballStatsRow[],
  symbolFilter?: string,
): Promise<number> {
  const scoped = symbolFilter
    ? rows.filter((r) => r.symbol.trim().toUpperCase() === symbolFilter)
    : rows;
  return backfillAllStatsRowsSymbolEmaSlopes(scoped, { maxRowsPerPass: 40, maxPasses: 10 });
}

async function backfillSnowballTrendGradesForTick(
  rows: SnowballStatsRow[],
  symbolFilter?: string,
): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < 10; pass++) {
    const n = backfillSnowballStatsTrendGrades(rows, { maxRows: 80, symbolFilter });
    total += n;
    if (n === 0) break;
  }
  return total;
}

function backfillSnowballLenPercentilePct(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (row.lenPercentilePct != null && Number.isFinite(row.lenPercentilePct)) continue;
    const pct = lenPercentilePctFromRank(row.rangeRankInLookback, row.lenLookbackBars);
    if (pct == null) continue;
    row.lenPercentilePct = pct;
    updated += 1;
  }
  return updated;
}

function pctVsEntry(side: "long" | "short", entry: number, price: number): number {
  if (side === "long") return ((price - entry) / entry) * 100;
  return ((entry - price) / entry) * 100;
}

function klineIndexLastThrough(
  timeSec: number[],
  barDurSec: number,
  iFirst: number,
  windowEndSec: number,
): number {
  let iLast = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + barDurSec <= windowEndSec) iLast = i;
  }
  while (iLast >= iFirst && timeSec[iLast]! + barDurSec > windowEndSec) {
    iLast--;
  }
  return iLast;
}

function applySnowballStrategyProfitAtHorizon(
  row: SnowballStatsRow,
  high: number[],
  low: number[],
  iFirst: number,
  iLast: number,
  holdHours: typeof STATS_STRATEGY_PROFIT_HOLD_24H | typeof STATS_STRATEGY_PROFIT_HOLD_48H,
  pctAtHorizon: number,
): boolean {
  const sim = computeStatsStrategyProfitFromBars({
    side: row.side,
    entry: row.entryPrice,
    high,
    low,
    iFirst,
    iLast,
    holdHours,
    pctAtHorizon,
    plan: DEFAULT_STATS_TPSL_PLAN,
  });
  if (!sim) return false;
  let touched = false;
  const key = statsStrategyProfitCacheKey(DEFAULT_STATS_TPSL_PLAN, holdHours);
  const prev = row.strategyProfitByPlan?.[key];
  if (!prev || prev.profitPct !== sim.profitPct || prev.exitReason !== sim.exitReason) {
    row.strategyProfitByPlan = {
      ...row.strategyProfitByPlan,
      [key]: { profitPct: sim.profitPct, exitReason: sim.exitReason },
    };
    touched = true;
  }
  /* ไม่เขียน strategyProfitPct* ระดับแถว — ใช้ enrich / cache ตามแผนผู้ชม (GET แสดงจาก cache) */
  return touched;
}

function rrRewardSource(): "close_48h" | "mfe" {
  const v = process.env.SNOWBALL_STATS_RR_REWARD_SOURCE?.trim().toLowerCase();
  if (v === "mfe") return "mfe";
  if (v === "close_24h" || v === "close_48h") return "close_48h";
  return "close_48h";
}

/**
 * Threshold สำหรับ win_trend (= pct48h) — pct48h ≥ winMin → win_trend, pct48h ≤ -winMin → loss, else flat
 * Default 3% (เพื่อให้ "flat band" กว้างพอที่จะไม่ตัดสินว่าแพ้/ชนะจากการขยับเล็กน้อย)
 */
function outcomeWinMinPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_WIN_MIN_PCT);
  if (Number.isFinite(v) && v > 0 && v < 100) return v;
  return 3;
}

function applySnowballOutcomeFromPct48h(row: SnowballStatsRow): boolean {
  const pct48 = row.pct48h;
  if (pct48 == null || !Number.isFinite(pct48)) return false;

  const winMin = outcomeWinMinPct();
  let nextOutcome: SnowballStatsOutcome;
  if (pct48 >= winMin) {
    nextOutcome = "win_trend";
  } else if (pct48 <= -winMin) {
    nextOutcome = "loss";
  } else {
    nextOutcome = "flat";
  }

  const reward = rrRewardSource() === "mfe" ? (row.maxRoiPct ?? 0) : pct48;
  const nextRr = formatRr(reward, row.maxDrawdownPct ?? 0);

  let dirty = false;
  if (row.outcome !== nextOutcome) {
    row.outcome = nextOutcome;
    dirty = true;
  }
  if (row.resultRr !== nextRr) {
    row.resultRr = nextRr;
    dirty = true;
  }
  return dirty;
}

/** แถวที่ปิดผลเก่าที่ 24h → คำนวณ outcome ใหม่จาก pct48h */
function backfillSnowballOutcomeTo48h(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (row.pct48h == null || !Number.isFinite(row.pct48h)) continue;
    if (applySnowballOutcomeFromPct48h(row)) updated += 1;
  }
  return updated;
}

async function backfillSnowballGreenDaysBeforeSignal(rows: SnowballStatsRow[]): Promise<number> {
  const need = rows.filter((r) => r.greenDaysBeforeSignal == null || r.greenDaysBeforeSignalBkk == null);
  if (need.length === 0) return 0;

  const packBySymbol = new Map<string, BinanceKlinePack | null>();
  let updated = 0;
  for (const row of need) {
    const sym = row.symbol.trim().toUpperCase();
    let pack = packBySymbol.get(sym);
    if (pack === undefined) {
      try {
        pack = await fetchBinanceUsdmKlines(sym, "1d", 90);
      } catch (e) {
        console.error("[snowballStatsTick] backfill green days 1d", sym, e);
        pack = null;
      }
      packBySymbol.set(sym, pack);
    }
    const tf = row.signalBarTf ?? "15m";
    let touched = false;
    if (row.greenDaysBeforeSignal == null) {
      const n = countGreenDaysBeforeSignalBar(pack, row.signalBarOpenSec, tf);
      if (n != null) {
        row.greenDaysBeforeSignal = n;
        touched = true;
      }
    }
    if (row.greenDaysBeforeSignalBkk == null) {
      const nBkk = countGreenDaysBeforeSignalBar(pack, row.signalBarOpenSec, tf, { dayTzOffsetSec: 7 * 3600 });
      if (nBkk != null) {
        row.greenDaysBeforeSignalBkk = nBkk;
        touched = true;
      }
    }
    if (touched) updated += 1;
  }
  return updated;
}

function formatRr(rewardPct: number, riskPct: number): string {
  if (!Number.isFinite(riskPct) || riskPct <= 1e-9) return "N/A";
  if (!Number.isFinite(rewardPct) || rewardPct <= 0) return "N/A";
  const r = rewardPct / riskPct;
  if (!Number.isFinite(r) || r <= 0) return "N/A";
  return `1:${r.toFixed(2)}`;
}

/** ปิดแท่งล่าสุดที่ปิดไม่เกิน horizonEndSec และไม่เกิน now */
function pickHorizonClose(
  timeSec: number[],
  close: number[],
  iFirst: number,
  iLast: number,
  nowSec: number,
  horizonEndSec: number,
  entry: number,
  side: "long" | "short"
): { price: number; pct: number } | null {
  const limitSec = Math.min(horizonEndSec, nowSec);
  let best = -1;
  for (let i = iFirst; i <= iLast; i++) {
    const barClose = timeSec[i]! + KLINE_GRAN_SEC;
    if (barClose <= limitSec) best = i;
  }
  if (best < 0) return null;
  const price = close[best]!;
  return { price, pct: pctVsEntry(side, entry, price) };
}

function rowNeedsTrendMomentumBackfill(row: SnowballStatsRow): boolean {
  if (row.volumeCascadeYn == null) return true;
  if (row.outcome === "pending") return true;
  return row.trendMomentumVolLookback !== SNOWBALL_TREND_1H_VOL_LOOKBACK;
}

function trendMomentumAnchorSec(row: SnowballStatsRow): number {
  if (Number.isFinite(row.alertedAtMs) && row.alertedAtMs > 0) {
    return Math.floor(row.alertedAtMs / 1000);
  }
  return snowballStatsAnchorCloseSec(row);
}

/** เติม/อัปเดต Vol↗ จากแท่ง 1H ณ เวลาแจ้งสัญญาณ */
async function backfillSnowballTrendMomentumFields(rows: SnowballStatsRow[]): Promise<number> {
  const need = rows.filter(rowNeedsTrendMomentumBackfill);
  if (need.length === 0) return 0;

  const bySymbol = new Map<string, SnowballStatsRow[]>();
  for (const row of need) {
    const sym = row.symbol.trim().toUpperCase();
    const arr = bySymbol.get(sym) ?? [];
    arr.push(row);
    bySymbol.set(sym, arr);
  }

  let updated = 0;
  for (const [symbol, symRows] of Array.from(bySymbol.entries())) {
    const pack1h = await fetchSnowball1hPackForTrendMomentum(symbol);
    if (!pack1h) continue;
    for (const row of symRows) {
      const volumeCascadeYn = calculateTrendMomentumVolumeCascadeYn(pack1h, {
        asOfSec: trendMomentumAnchorSec(row),
      });
      if (volumeCascadeYn == null) continue;
      let touched = false;
      if (row.volumeCascadeYn !== volumeCascadeYn) {
        row.volumeCascadeYn = volumeCascadeYn;
        touched = true;
      }
      if (row.trendMomentumVolLookback !== SNOWBALL_TREND_1H_VOL_LOOKBACK) {
        row.trendMomentumVolLookback = SNOWBALL_TREND_1H_VOL_LOOKBACK;
        touched = true;
      }
      if (touched) updated += 1;
    }
  }
  return updated;
}

function rowNeedsConfirmGateStepsBackfill(row: SnowballStatsRow): boolean {
  if ((row.alertSide ?? "long") === "bear") return false;
  const tf = row.signalBarTf ?? "15m";
  if (tf === "4h") return false;
  return !row.confirmGateSteps?.length;
}

/** เติม confirmGateSteps สำหรับแถว LONG 1h/15m ที่ยังไม่บันทึกขั้น (ณ เวลาแจ้ง) */
export async function backfillSnowballConfirmGateSteps(rows: SnowballStatsRow[]): Promise<number> {
  const need = rows.filter(rowNeedsConfirmGateStepsBackfill);
  if (need.length === 0) return 0;

  const bySymbol = new Map<string, SnowballStatsRow[]>();
  for (const row of need) {
    const sym = row.symbol.trim().toUpperCase();
    const arr = bySymbol.get(sym) ?? [];
    arr.push(row);
    bySymbol.set(sym, arr);
  }

  let updated = 0;
  for (const [symbol, symRows] of Array.from(bySymbol.entries())) {
    const pack1h = await fetchSnowball1hPackForTrendMomentum(symbol);
    if (!pack1h) continue;
    for (const row of symRows) {
      const tf = (row.signalBarTf ?? "15m") as BinanceIndicatorTf;
      const steps = buildSnowballLongConfirmGateStepsForStats(
        tf,
        false,
        pack1h,
        null,
        3,
        trendMomentumAnchorSec(row),
      );
      if (steps.length === 0) continue;
      row.confirmGateSteps = steps;
      updated += 1;
    }
  }
  return updated;
}

function countMissingHorizon4h(rows: SnowballStatsRow[], nowMs: number, symbol?: string): number {
  let n = 0;
  for (const row of rows) {
    if (symbol && row.symbol.trim().toUpperCase() !== symbol) continue;
    if (row.signalBarTf !== "4h") continue;
    if (row.pct4h != null) continue;
    if (!snowballStatsHorizonDue(row, 4, nowMs)) continue;
    n += 1;
  }
  return n;
}

export async function runSnowballStatsFollowUpTick(
  nowMs: number,
  opts?: { symbol?: string; maxHorizonRowsPerTick?: number },
): Promise<SnowballStatsFollowUpResult> {
  const empty: SnowballStatsFollowUpResult = {
    dirty: 0,
    migrations: 0,
    trendMomentum: 0,
    confirmGateSteps: 0,
    greenDays: 0,
    grade4h: 0,
    horizonRows: 0,
    emaSlopes: 0,
    trendGrades: 0,
  };
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isSnowballStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return empty;

  const symbolFilter = opts?.symbol?.trim()
    ? toBinanceUsdtPerpSymbol(opts.symbol.trim()).toUpperCase()
    : undefined;
  const rowInScope = (row: SnowballStatsRow) =>
    !symbolFilter || row.symbol.trim().toUpperCase() === symbolFilter;

  const state = await loadSnowballStatsState();
  let dirty = 0;
  const nowSec = Math.floor(nowMs / 1000);

  const migrations = applySnowballStatsRowMigrations(state.rows);
  dirty += migrations;
  dirty += backfillSnowballOutcomeTo48h(state.rows);
  dirty += backfillSnowballLenPercentilePct(state.rows);
  const greenDays = await backfillSnowballGreenDaysBeforeSignal(state.rows);
  dirty += greenDays;
  const emaSlopes = await backfillSnowballEmaSlopes(state.rows, symbolFilter);
  dirty += emaSlopes;
  dirty += await backfillAllStatsRowsBtcEmaSlopes(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  dirty += await backfillAllStatsRowsPsar4h(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  const trendGrades = await backfillSnowballTrendGradesForTick(state.rows, symbolFilter);
  dirty += trendGrades;
  const trendMomentum = await backfillSnowballTrendMomentumFields(state.rows);
  dirty += trendMomentum;
  const confirmGateSteps = await backfillSnowballConfirmGateSteps(state.rows);
  dirty += confirmGateSteps;
  dirty += await backfillAllStatsMarketSentiment(state.rows, { maxPasses: 5 });
  dirty += await backfillSnowballTrendGradesForTick(state.rows, symbolFilter);
  dirty += await backfillAllStatsRowsQuoteVol24h(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });

  let grade4h = 0;
  const pack1hGradeCache = new Map<string, BinanceKlinePack | null>();
  for (const row of state.rows) {
    if (!rowInScope(row)) continue;
    if (row.qualityTier4hAdjusted) continue;
    const ac = snowballStatsAnchorCloseSec(row);
    if (nowSec < ac + 4 * 3600) continue;
    if (await applySnowballStatsGrade4hFollowUp(row, nowSec, pack1hGradeCache)) {
      grade4h += 1;
      dirty += 1;
    }
  }

  const SEC_48H = 48 * 3600;
  const SEC_24H = 24 * 3600;

  let horizonRows = 0;
  let horizonFetched = 0;
  const maxHorizonRowsPerTick = opts?.maxHorizonRowsPerTick;

  for (const row of state.rows) {
    if (!rowInScope(row)) continue;
    if (maxHorizonRowsPerTick != null && horizonFetched >= maxHorizonRowsPerTick) break;
    if (!snowballStatsRowNeedsHorizonFollowUpWork(row, nowSec)) continue;

    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const ac = snowballStatsAnchorCloseSec(row);
    const pending = row.outcome === "pending";
    horizonFetched += 1;

    const windowEndHorizonSec = Math.min(nowSec, ac + SEC_48H);
    const windowEndMfeSec = Math.min(nowSec, ac + SEC_48H);

    const pack = await fetchBinanceUsdmKlinesRange(row.symbol, "15m", {
      startTimeMs: row.signalBarOpenSec * 1000,
      endTimeMs: nowMs,
      limit: 500,
    });
    if (!pack || pack.timeSec.length === 0) continue;

    const { timeSec, high, low, close } = pack;
    if (row.signalBarLow == null || !Number.isFinite(row.signalBarLow) || row.signalBarLow <= 0) {
      const iSignal = timeSec.findIndex((t) => t === row.signalBarOpenSec);
      if (iSignal >= 0) {
        const lo = low[iSignal];
        if (typeof lo === "number" && Number.isFinite(lo) && lo > 0) row.signalBarLow = lo;
      }
    }
    const iFirst = timeSec.findIndex((t) => t + KLINE_GRAN_SEC >= ac);
    if (iFirst < 0) continue;

    let iLastHorizon = iFirst;
    for (let i = iFirst; i < timeSec.length; i++) {
      if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndHorizonSec) iLastHorizon = i;
    }
    while (iLastHorizon >= iFirst && timeSec[iLastHorizon]! + KLINE_GRAN_SEC > windowEndHorizonSec) {
      iLastHorizon--;
    }
    if (iLastHorizon < iFirst) continue;

    let rowTouched = false;

    const iFollowFirst = firstFollowUpKlineIndexAfterAnchorClose(timeSec, ac);

    const iAdverseFirst = iFollowFirst;
    const adverse =
      iAdverseFirst >= 0 && iLastHorizon >= iAdverseFirst
        ? computeFollowUpMaxAdversePct(high, low, iAdverseFirst, iLastHorizon, entry, row.side)
        : null;
    if (adverse != null && row.followUpMaxAdversePct !== adverse) {
      row.followUpMaxAdversePct = adverse;
      rowTouched = true;
    }

    const h4 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + 4 * 3600,
      entry,
      row.side,
    );
    const h12 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + 12 * 3600,
      entry,
      row.side,
    );
    let h24 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + SEC_24H,
      entry,
      row.side,
    );
    let h48 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + SEC_48H,
      entry,
      row.side,
    );

    if (h4 && nowSec >= ac + 4 * 3600) {
      row.price4h = h4.price;
      row.pct4h = h4.pct;
      rowTouched = true;
    }
    if (h12 && nowSec >= ac + 12 * 3600) {
      row.price12h = h12.price;
      row.pct12h = h12.pct;
      rowTouched = true;
    }
    if (h24 && nowSec >= ac + SEC_24H) {
      row.price24h = h24.price;
      row.pct24h = h24.pct;
      rowTouched = true;
    }
    if (h48 && nowSec >= ac + SEC_48H) {
      row.price48h = h48.price;
      row.pct48h = h48.pct;
      rowTouched = true;
    } else if (nowSec >= ac + SEC_48H && iLastHorizon >= iFirst) {
      const p = close[iLastHorizon]!;
      row.price48h = p;
      row.pct48h = pctVsEntry(row.side, entry, p);
      rowTouched = true;
    }

    if (row.pct24h != null && nowSec >= ac + SEC_24H) {
      const iLast24 = klineIndexLastThrough(timeSec, KLINE_GRAN_SEC, iFirst, ac + SEC_24H);
      if (iFollowFirst >= 0 && iLast24 >= iFollowFirst) {
        rowTouched =
          applySnowballStrategyProfitAtHorizon(
            row,
            high,
            low,
            iFollowFirst,
            iLast24,
            STATS_STRATEGY_PROFIT_HOLD_24H,
            row.pct24h,
          ) || rowTouched;
      }
    } else if (nowSec < ac + SEC_24H) {
      if (row.strategyProfitPct24h != null || row.strategyExitReason24h != null) {
        row.strategyProfitPct24h = null;
        row.strategyExitReason24h = null;
        rowTouched = true;
      }
    }

    if (row.pct48h != null && nowSec >= ac + SEC_48H) {
      const iLast48 = klineIndexLastThrough(timeSec, KLINE_GRAN_SEC, iFirst, ac + SEC_48H);
      if (iFollowFirst >= 0 && iLast48 >= iFollowFirst) {
        rowTouched =
          applySnowballStrategyProfitAtHorizon(
            row,
            high,
            low,
            iFollowFirst,
            iLast48,
            STATS_STRATEGY_PROFIT_HOLD_48H,
            row.pct48h,
          ) || rowTouched;
      }
    } else if (nowSec < ac + SEC_48H) {
      if (row.strategyProfitPct != null || row.strategyExitReason != null) {
        row.strategyProfitPct = null;
        row.strategyExitReason = null;
        rowTouched = true;
      }
    }

    if (pending) {
      let iLastMfe = iFirst;
      for (let i = iFirst; i < timeSec.length; i++) {
        if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndMfeSec) iLastMfe = i;
      }
      while (iLastMfe >= iFirst && timeSec[iLastMfe]! + KLINE_GRAN_SEC > windowEndMfeSec) {
        iLastMfe--;
      }
      if (iLastMfe < iFirst) continue;
      const iMfeFirst = iFollowFirst >= 0 ? Math.max(iFollowFirst, iFirst) : iFirst;
      if (iMfeFirst > iLastMfe) continue;

      if (h24 == null && nowSec >= ac + SEC_24H && iLastMfe >= iMfeFirst) {
        const p = close[iLastMfe]!;
        h24 = { price: p, pct: pctVsEntry(row.side, entry, p) };
        row.price24h = h24.price;
        row.pct24h = h24.pct;
        rowTouched = true;
      }

      let maxRoi = -Infinity;
      let mfeIdx = iMfeFirst;
      if (row.side === "long") {
        for (let i = iMfeFirst; i <= iLastMfe; i++) {
          const roi = ((high[i]! - entry) / entry) * 100;
          if (roi > maxRoi) {
            maxRoi = roi;
            mfeIdx = i;
          }
        }
      } else {
        for (let i = iMfeFirst; i <= iLastMfe; i++) {
          const roi = ((entry - low[i]!) / entry) * 100;
          if (roi > maxRoi) {
            maxRoi = roi;
            mfeIdx = i;
          }
        }
      }

      if (Number.isFinite(maxRoi)) {
        let minLow = Infinity;
        let maxHigh = -Infinity;
        for (let i = iMfeFirst; i <= mfeIdx; i++) {
          minLow = Math.min(minLow, low[i]!);
          maxHigh = Math.max(maxHigh, high[i]!);
        }
        let maxDd = 0;
        if (row.side === "long") {
          maxDd = ((entry - minLow) / entry) * 100;
        } else {
          maxDd = ((maxHigh - entry) / entry) * 100;
        }
        if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;

        row.maxRoiPct = maxRoi;
        row.durationToMfeHours = (timeSec[mfeIdx]! + KLINE_GRAN_SEC - ac) / 3600;
        row.maxDrawdownPct = maxDd;
        rowTouched = true;

        const finalized =
          nowSec >= ac + SEC_48H && row.pct48h != null && row.price48h != null;
        if (finalized && applySnowballOutcomeFromPct48h(row)) {
          rowTouched = true;
        }
      }
    }

    if (rowTouched) {
      horizonRows += 1;
      dirty += 1;
    }
  }

  if (dirty > 0) await saveSnowballStatsState(state);
  return {
    dirty,
    migrations,
    trendMomentum,
    confirmGateSteps,
    greenDays,
    grade4h,
    horizonRows,
    emaSlopes,
    trendGrades,
  };
}

/**
 * Admin — ปรับ `outcome` + `resultRr` ของทุกแถวที่มี `pct48h` แล้ว
 * โดยข้าม pending guard (จะ overwrite แม้ outcome เดิมจะเป็น loss/win_trend/flat)
 *
 * ใช้สำหรับกรณีกฎ outcome เปลี่ยน / เคยถูก finalize ที่ 24h / ต้องการ recalc ให้ตรงกับ pct48h ที่บันทึกอยู่
 *
 * ไม่ refetch kline / ไม่แก้ pct48h — ใช้ค่าที่เก็บไว้ในแถวเท่านั้น
 */
export async function correctSnowballStatsOutcomeFromPct48h(opts?: {
  symbol?: string;
}): Promise<{
  scanned: number;
  changedOutcome: number;
  changedRr: number;
}> {
  const symbolFilter = opts?.symbol?.trim()
    ? toBinanceUsdtPerpSymbol(opts.symbol.trim()).toUpperCase()
    : undefined;

  const state = await loadSnowballStatsState();
  let scanned = 0;
  let changedOutcome = 0;
  let changedRr = 0;

  for (const row of state.rows) {
    if (symbolFilter && row.symbol.trim().toUpperCase() !== symbolFilter) continue;
    if (row.pct48h == null || !Number.isFinite(row.pct48h)) continue;
    scanned += 1;

    const prevOutcome = row.outcome;
    const prevRr = row.resultRr;
    if (applySnowballOutcomeFromPct48h(row)) {
      if (row.outcome !== prevOutcome) changedOutcome += 1;
      if (row.resultRr !== prevRr) changedRr += 1;
    }
  }

  if (changedOutcome > 0 || changedRr > 0) {
    await saveSnowballStatsState(state);
  }

  return { scanned, changedOutcome, changedRr };
}

/** @deprecated ใช้ correctSnowballStatsOutcomeFromPct48h */
export async function correctSnowballStatsOutcomeFromPct24h(
  opts?: { symbol?: string },
): Promise<{
  scanned: number;
  changedOutcome: number;
  changedRr: number;
}> {
  return correctSnowballStatsOutcomeFromPct48h(opts);
}

/** Admin — รีเติม migration / horizon / trend momentum / gate steps (ไม่สแกนสัญญาณใหม่) */
export async function runSnowballStatsAdminBackfill(opts?: {
  symbol?: string;
  nowMs?: number;
}): Promise<SnowballStatsAdminBackfillResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const symbol = opts?.symbol?.trim()
    ? toBinanceUsdtPerpSymbol(opts.symbol.trim()).toUpperCase()
    : undefined;

  if (!isSnowballStatsEnabled()) {
    return {
      ok: false,
      skippedReason: "SNOWBALL_STATS_ENABLED=0",
      symbol,
      totalRows: 0,
      durationMs: 0,
      followUp: {
        dirty: 0,
        migrations: 0,
        trendMomentum: 0,
        confirmGateSteps: 0,
        greenDays: 0,
        grade4h: 0,
        horizonRows: 0,
        emaSlopes: 0,
        trendGrades: 0,
      },
      missingHorizon4hBefore: 0,
      missingHorizon4hAfter: 0,
      hasMore: false,
      pendingHorizon: 0,
      pendingTrendGrades: 0,
      samplesFilled: [],
    };
  }
  if (!isBinanceIndicatorFapiEnabled()) {
    return {
      ok: false,
      skippedReason: "Binance USDM indicator ปิด (BINANCE_INDICATOR_FAPI_ENABLED=0)",
      symbol,
      totalRows: 0,
      durationMs: 0,
      followUp: {
        dirty: 0,
        migrations: 0,
        trendMomentum: 0,
        confirmGateSteps: 0,
        greenDays: 0,
        grade4h: 0,
        horizonRows: 0,
        emaSlopes: 0,
        trendGrades: 0,
      },
      missingHorizon4hBefore: 0,
      missingHorizon4hAfter: 0,
      hasMore: false,
      pendingHorizon: 0,
      pendingTrendGrades: 0,
      samplesFilled: [],
    };
  }

  const before = await loadSnowballStatsState();
  const missingHorizon4hBefore = countMissingHorizon4h(before.rows, nowMs, symbol);
  const started = Date.now();

  const tick = await runSnowballStatsFollowUpTick(nowMs, {
    symbol,
    maxHorizonRowsPerTick: snowballStatsBackfillMaxHorizonPerPass(),
  });
  const followUp = tick;

  const after = await loadSnowballStatsState();
  const missingHorizon4hAfter = countMissingHorizon4h(after.rows, nowMs, symbol);
  const pending = countSnowballStatsBackfillPending(after.rows, nowMs, symbol);
  const hasMore =
    pending.horizon > 0 ||
    pending.trendGrades > 0 ||
    missingHorizon4hAfter > 0 ||
    tick.emaSlopes > 0;

  const samplesFilled: string[] = [];
  for (const row of after.rows) {
    if (symbol && row.symbol.trim().toUpperCase() !== symbol) continue;
    if (row.signalBarTf !== "4h" || row.pct4h == null || !Number.isFinite(row.pct4h)) continue;
    samplesFilled.push(`${row.symbol} pct4h=${row.pct4h.toFixed(2)}%`);
    if (samplesFilled.length >= 8) break;
  }

  return {
    ok: true,
    symbol,
    totalRows: after.rows.length,
    durationMs: Date.now() - started,
    followUp,
    missingHorizon4hBefore,
    missingHorizon4hAfter,
    hasMore,
    pendingHorizon: pending.horizon,
    pendingTrendGrades: pending.trendGrades,
    samplesFilled,
  };
}
