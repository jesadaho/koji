import {
  reversalStatsMeasureSide,
  STATS_MAX_ROI_15M_VERSION,
  type CandleReversalSignalBarTf,
} from "@/lib/candleReversalStatsClient";
import { lenPercentilePctFromRank, statsRangeRankInWindow, statsValueRankInWindow } from "@/lib/statsLenPercentile";
import { backfillReversalBarRangePctSignalEstimate, statsBarRangePctSignal } from "@/lib/statsBarRangePct";
import {
  computeFollowUpMaxAdversePct,
  firstFollowUpKlineIndexAfterAnchorClose,
} from "@/lib/statsFollowUpAdverse";
import { favorablePctInBar } from "@/lib/tpSlStrategySimulate";
import {
  reversalTpStrategyCacheKey,
  reversalTpStrategyCacheKeyLong,
  reversalStatsLongHorizonPct,
  simulateReversalTpStrategyProfit,
} from "@/lib/reversalTpStrategy";
import { reversalRowIsSuggestedLong } from "@/lib/reversalMatrixFilters";
import {
  reversalIsObserveSignal,
  reversalResolveObserveReason,
  reversalStatsRowIsObserve,
} from "@/lib/reversalStatsPlayMode";
import {
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
} from "@/lib/statsStrategyProfitClient";
import { candleLowerWickRatio } from "./candleReversalDetect";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  candleReversalSignalVolVsSmaAt,
  candleReversalVolSmaPeriod,
} from "./candleReversalSignalVolVsSma";
import { backfillAllStatsRowsBtcEmaSlopes } from "./statsEmaSlope";
import { backfillAllStatsRowsEma20Dist } from "./statsEma20Dist";
import { backfillAllStatsRowsEma20_15mEntry } from "./statsEma20_15mEntry";
import { backfillAllStatsRowsPsar4h } from "./statsPsar4h";
import { backfillAllStatsRowsAtrPct4h } from "./statsAtrPct4h";
import { backfillAllStatsRowsQuoteVol24h } from "./statsQuoteVol24h";
import { backfillAllStatsRowsOpenInterest } from "./statsOpenInterest";
import { backfillAllStatsRowsBtcDomEma20_4h } from "./statsBtcDominanceEma";
import { backfillAllStatsRowsMarketCapUsd } from "./statsMarketCapUsd";
import { fetchReversalAlertMarketSnapshot } from "./reversalMarketContext";
import { backfillAllStatsMarketSentiment } from "./marketSentimentSnapshotStore";
import { candleReversalStatsAnchorCloseSec } from "@/lib/candleReversalStatsClient";
import { backfillPumpCycleSwingLowForRows } from "./statsPumpCycleSwingLow";
import { backfillAllStatsRowsTradFiFlag } from "./statsTradFiFlag";
import {
  isCandleReversal1dStatsEnabled,
  isCandleReversal1hLongStatsEnabled,
  isCandleReversalStatsEnabled,
  loadCandleReversalStatsState,
  saveCandleReversalStatsState,
  type CandleReversalStatsRow,
} from "./candleReversalStatsStore";
import { backfillReversalKlineAiAnalysis } from "./reversalKlineAiAnalysis";

const DAY_SEC = 24 * 3600;
const HOUR_SEC = 3600;
const KLINE_15M_SEC = 900;

function signalBarTf(row: CandleReversalStatsRow): CandleReversalSignalBarTf {
  return row.signalBarTf === "1h" ? "1h" : "1d";
}

function signalBarDurationSec(row: CandleReversalStatsRow): number {
  return signalBarTf(row) === "1h" ? HOUR_SEC : DAY_SEC;
}

function anchorCloseSec(row: CandleReversalStatsRow): number {
  return row.signalBarOpenSec + signalBarDurationSec(row);
}

function followup1hHours(): number {
  const v = Number(process.env.CANDLE_REVERSAL_1H_STATS_FOLLOWUP_HOURS?.trim());
  if (Number.isFinite(v) && v >= 4 && v <= 168) return Math.max(48, Math.floor(v));
  return 48;
}

function followup1dDays(): number {
  const v = Number(process.env.CANDLE_REVERSAL_1D_STATS_FOLLOWUP_DAYS?.trim());
  if (Number.isFinite(v) && v >= 1 && v <= 30) return Math.floor(v);
  return 7;
}

function reversalMeasureSide(row: CandleReversalStatsRow): "short" | "long" {
  return reversalStatsMeasureSide(row);
}

function pctVsEntry(entry: number, price: number, side: "short" | "long"): number {
  if (side === "long") return ((price - entry) / entry) * 100;
  return ((entry - price) / entry) * 100;
}

function pctVsEntryShort(entry: number, price: number): number {
  return pctVsEntry(entry, price, "short");
}

function outcomeWinMinPct(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_WIN_MIN_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return 2;
}

function outcomeLossMaxPct(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_LOSS_MAX_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return -2;
}

function applyOutcomeFromPct(row: CandleReversalStatsRow, pct: number): void {
  if (pct >= outcomeWinMinPct()) row.outcome = "win";
  else if (pct <= outcomeLossMaxPct()) row.outcome = "loss";
  else row.outcome = "flat";
}

function pickHorizonClose(
  timeSec: number[],
  close: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  nowSec: number,
  horizonEndSec: number,
  entry: number,
  side: "short" | "long" = "short",
): { price: number; pct: number } | null {
  /** ยังไม่ถึง checkpoint — ไม่ใส่ราคา interim (กัน 4h/12h/24h/48h ซ้ำกัน) */
  if (nowSec < horizonEndSec) return null;
  let best = -1;
  for (let i = iFirst; i <= iLast; i++) {
    const barClose = timeSec[i]! + barDurSec;
    if (barClose <= horizonEndSec) best = i;
  }
  if (best < 0) return null;
  const price = close[best]!;
  return { price, pct: pctVsEntry(entry, price, side) };
}

function computeMfeFromPack(
  timeSec: number[],
  high: number[],
  low: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  ac: number,
  entry: number,
): { maxRoi: number; mfeIdx: number; maxDd: number; durationHours: number } | null {
  let maxRoi = -Infinity;
  let mfeIdx = iFirst;
  for (let i = iFirst; i <= iLast; i++) {
    const roi = ((entry - low[i]!) / entry) * 100;
    if (roi > maxRoi) {
      maxRoi = roi;
      mfeIdx = i;
    }
  }
  if (!Number.isFinite(maxRoi)) return null;

  let maxHigh = -Infinity;
  for (let i = iFirst; i <= mfeIdx; i++) {
    maxHigh = Math.max(maxHigh, high[i]!);
  }
  let maxDd = ((maxHigh - entry) / entry) * 100;
  if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;

  const durationHours = (timeSec[mfeIdx]! + barDurSec - ac) / 3600;
  return { maxRoi, mfeIdx, maxDd, durationHours };
}

function computeMfeFromPackLong(
  timeSec: number[],
  high: number[],
  low: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  ac: number,
  entry: number,
): { maxRoi: number; mfeIdx: number; maxDd: number; durationHours: number } | null {
  return computeMfeForMeasureSide("long", timeSec, high, low, barDurSec, iFirst, iLast, ac, entry);
}

/** MFE / Max DD ก่อน MFE — ใช้ทิศวัดผลเดียวกับกำไรกลยุทธ์ (เช่น Long 1H fade → short) */
function computeMfeForMeasureSide(
  side: "short" | "long",
  timeSec: number[],
  high: number[],
  low: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  ac: number,
  entry: number,
): { maxRoi: number; mfeIdx: number; maxDd: number; durationHours: number } | null {
  let maxRoi = -Infinity;
  let mfeIdx = iFirst;
  for (let i = iFirst; i <= iLast; i++) {
    const roi = favorablePctInBar(side, entry, high[i]!, low[i]!);
    if (Number.isFinite(roi) && roi > maxRoi) {
      maxRoi = roi;
      mfeIdx = i;
    }
  }
  if (!Number.isFinite(maxRoi)) return null;

  let maxDd = 0;
  if (side === "short") {
    let maxHigh = -Infinity;
    for (let i = iFirst; i <= mfeIdx; i++) {
      maxHigh = Math.max(maxHigh, high[i]!);
    }
    maxDd = ((maxHigh - entry) / entry) * 100;
  } else {
    let minLow = Infinity;
    for (let i = iFirst; i <= mfeIdx; i++) {
      minLow = Math.min(minLow, low[i]!);
    }
    maxDd = ((entry - minLow) / entry) * 100;
  }
  if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;

  const durationHours = (timeSec[mfeIdx]! + barDurSec - ac) / 3600;
  return { maxRoi, mfeIdx, maxDd, durationHours };
}

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

function signalBarDurationSecByTf(tf: CandleReversalSignalBarTf): number {
  return tf === "1h" ? HOUR_SEC : DAY_SEC;
}

function resolveReversalLookbackBars(row: CandleReversalStatsRow): number | null {
  if (row.lookbackBars != null && Number.isFinite(row.lookbackBars) && row.lookbackBars >= 2) {
    return Math.floor(row.lookbackBars);
  }
  if (row.model === "marubozu") return 48;
  if (row.model === "inverted_doji" || row.model === "longest_red_body") return 200;
  if (row.model === "longest_green_body") return 24;
  return null;
}

function computeRangeRankInLookbackFromPack(pack: BinanceKlinePack, i: number, lookbackBars: number): number | null {
  const lb = Math.floor(lookbackBars);
  if (!(Number.isFinite(lb) && lb >= 2)) return null;
  const start = Math.max(0, i - lb + 1);
  return statsRangeRankInWindow(pack.high, pack.low, start, i, i);
}

function computeVolRankInLookbackFromPack(pack: BinanceKlinePack, i: number, lookbackBars: number): number | null {
  const lb = Math.floor(lookbackBars);
  if (!(Number.isFinite(lb) && lb >= 2)) return null;
  const start = Math.max(0, i - lb + 1);
  return statsValueRankInWindow(pack.volume, start, i, i);
}

async function backfillLookbackRanksInWindow(rows: CandleReversalStatsRow[]): Promise<number> {
  let updated = 0;
  for (const row of rows) {
    const needRange = row.rangeRankInLookback == null || !Number.isFinite(row.rangeRankInLookback);
    const needVol = row.volRankInLookback == null || !Number.isFinite(row.volRankInLookback);
    const needBarRange = row.barRangePctSignal == null || !Number.isFinite(row.barRangePctSignal);
    if (!needRange && !needVol && !needBarRange) continue;

    const lb = resolveReversalLookbackBars(row);
    if (lb == null && !needBarRange) continue;

    const tf = signalBarTf(row);
    const barDur = signalBarDurationSecByTf(tf);
    const windowStartSec = row.signalBarOpenSec - ((lb ?? 20) + 2) * barDur;
    const windowEndSec = row.signalBarOpenSec + barDur;

    try {
      const pack = await fetchBinanceUsdmKlinesRange(row.symbol, tf, {
        startTimeMs: windowStartSec * 1000,
        endTimeMs: windowEndSec * 1000,
        limit: 800,
      });
      if (!pack || pack.timeSec.length === 0) continue;
      const iSig = pack.timeSec.findIndex((t) => t === row.signalBarOpenSec);
      if (iSig < 0) continue;

      let rowTouched = false;
      if (needRange && lb != null) {
        const rank = computeRangeRankInLookbackFromPack(pack, iSig, lb);
        if (rank != null) {
          row.rangeRankInLookback = rank;
          rowTouched = true;
        }
      }
      if (needVol && lb != null) {
        const volRank = computeVolRankInLookbackFromPack(pack, iSig, lb);
        if (volRank != null) {
          row.volRankInLookback = volRank;
          rowTouched = true;
        }
      }
      if (needBarRange) {
        const barRange = statsBarRangePctSignal(pack.high[iSig], pack.low[iSig], pack.close[iSig]);
        if (barRange != null) {
          row.barRangePctSignal = barRange;
          rowTouched = true;
        }
      }
      if (row.lookbackBars == null && rowTouched && lb != null) {
        row.lookbackBars = lb;
      }
      if (rowTouched) updated += 1;
    } catch (e) {
      console.error("[candleReversalStatsTick] backfill lookback ranks", row.symbol, tf, e);
    }
  }
  return updated;
}

function backfillLenPercentilePct(rows: CandleReversalStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (row.lenPercentilePct != null && Number.isFinite(row.lenPercentilePct)) continue;
    const pct = lenPercentilePctFromRank(row.rangeRankInLookback, row.lookbackBars);
    if (pct == null) continue;
    row.lenPercentilePct = pct;
    updated += 1;
  }
  return updated;
}

async function backfillReversalEmaSlopes(rows: CandleReversalStatsRow[]): Promise<number> {
  const snapCache = new Map<string, Awaited<ReturnType<typeof fetchReversalAlertMarketSnapshot>>>();
  let updated = 0;
  for (const row of rows) {
    const need1h = row.ema1hSlopePct7d == null || !Number.isFinite(row.ema1hSlopePct7d);
    const need4h = row.ema4hSlopePct7d == null || !Number.isFinite(row.ema4hSlopePct7d);
    const need1d = row.ema1dSlopePct7d == null || !Number.isFinite(row.ema1dSlopePct7d);
    if (!need1h && !need4h && !need1d) continue;
    const sym = row.symbol.trim().toUpperCase();
    const atMs =
      row.alertedAtMs != null && Number.isFinite(row.alertedAtMs)
        ? row.alertedAtMs
        : Date.parse(row.alertedAtIso);
    const cacheKey = `${sym}:${atMs}`;
    let snap = snapCache.get(cacheKey);
    if (!snap) {
      try {
        snap = await fetchReversalAlertMarketSnapshot(sym, atMs);
        snapCache.set(cacheKey, snap);
      } catch {
        continue;
      }
    }
    let rowDirty = false;
    if (need1h && snap.ema1hSlopePct7d != null && Number.isFinite(snap.ema1hSlopePct7d)) {
      row.ema1hSlopePct7d = snap.ema1hSlopePct7d;
      rowDirty = true;
    }
    if (need4h && snap.ema4hSlopePct7d != null && Number.isFinite(snap.ema4hSlopePct7d)) {
      row.ema4hSlopePct7d = snap.ema4hSlopePct7d;
      rowDirty = true;
    }
    if (need1d && snap.ema1dSlopePct7d != null && Number.isFinite(snap.ema1dSlopePct7d)) {
      row.ema1dSlopePct7d = snap.ema1dSlopePct7d;
      rowDirty = true;
    }
    if (rowDirty) updated += 1;
  }
  return updated;
}

async function backfillRangeRankInLookback(rows: CandleReversalStatsRow[]): Promise<number> {
  return backfillLookbackRanksInWindow(rows);
}

async function backfillLowerWickRatioPct(rows: CandleReversalStatsRow[]): Promise<number> {
  let updated = 0;
  for (const row of rows) {
    if (signalBarTf(row) !== "1h" || (row.tradeSide ?? "short") !== "short") continue;
    if (row.lowerWickRatioPct != null && Number.isFinite(row.lowerWickRatioPct)) continue;
    if (!Number.isFinite(row.signalBarOpenSec) || row.signalBarOpenSec <= 0) continue;
    const tf = signalBarTf(row);
    const barDur = signalBarDurationSecByTf(tf);
    try {
      const pack = await fetchBinanceUsdmKlinesRange(row.symbol, tf, {
        startTimeMs: row.signalBarOpenSec * 1000,
        endTimeMs: (row.signalBarOpenSec + barDur) * 1000,
        limit: 8,
      });
      if (!pack || pack.timeSec.length === 0) continue;
      const iSig = pack.timeSec.findIndex((t) => t === row.signalBarOpenSec);
      if (iSig < 0) continue;
      const ratio = candleLowerWickRatio(pack, iSig);
      if (!Number.isFinite(ratio)) continue;
      row.lowerWickRatioPct = ratio * 100;
      updated += 1;
    } catch (e) {
      console.error("[candleReversalStatsTick] backfill lowerWickRatioPct", row.symbol, e);
    }
  }
  return updated;
}

async function backfillSignalVolVsSma(rows: CandleReversalStatsRow[]): Promise<number> {
  const period = candleReversalVolSmaPeriod();
  let updated = 0;
  for (const row of rows) {
    if (row.signalVolVsSma != null && Number.isFinite(row.signalVolVsSma) && row.signalVolVsSma > 0) {
      continue;
    }
    const tf = signalBarTf(row);
    const barDur = signalBarDurationSecByTf(tf);
    const windowStartSec = row.signalBarOpenSec - (period + 4) * barDur;
    const windowEndSec = row.signalBarOpenSec + barDur;
    try {
      const pack = await fetchBinanceUsdmKlinesRange(row.symbol, tf, {
        startTimeMs: windowStartSec * 1000,
        endTimeMs: windowEndSec * 1000,
        limit: 800,
      });
      if (!pack || pack.timeSec.length === 0) continue;
      const iSig = pack.timeSec.findIndex((t) => t === row.signalBarOpenSec);
      if (iSig < 0) continue;
      const ratio = candleReversalSignalVolVsSmaAt(pack, iSig, period);
      if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) continue;
      row.signalVolVsSma = ratio;
      updated += 1;
    } catch (e) {
      console.error("[candleReversalStatsTick] backfill signalVolVsSma", row.symbol, tf, e);
    }
  }
  return updated;
}

function applyReversal1hStrategyProfitAtHorizon(
  row: CandleReversalStatsRow,
  timeSec: number[],
  high: number[],
  low: number[],
  iFirst: number,
  iLast: number,
  anchorCloseSec: number,
  holdHours: typeof STATS_STRATEGY_PROFIT_HOLD_24H | typeof STATS_STRATEGY_PROFIT_HOLD_48H,
): void {
  if (row.pct12h == null || row.pct24h == null || row.pct48h == null) return;
  const side = reversalMeasureSide(row);
  const sim = simulateReversalTpStrategyProfit({
    side,
    entry: row.entryPrice,
    high,
    low,
    timeSec,
    anchorCloseSec,
    iFirst,
    iLast,
    pct12h: row.pct12h,
    pct24h: row.pct24h,
    pct48h: row.pct48h,
    ema20_1hSlopePct7d: row.ema20_1hSlopePct7d,
    maxHorizonHours: holdHours,
    close12hEnabled: true,
  });
  if (sim) {
    const key = reversalTpStrategyCacheKey(holdHours, { close12hEnabled: true });
    row.strategyProfitByPlan = {
      ...row.strategyProfitByPlan,
      [key]: { profitPct: sim.profitPct, exitReason: sim.exitReason },
    };
  }

  if (!reversalRowIsSuggestedLong(row)) return;
  const simLong = simulateReversalTpStrategyProfit({
    side: "long",
    entry: row.entryPrice,
    high,
    low,
    timeSec,
    anchorCloseSec,
    iFirst,
    iLast,
    pct12h: reversalStatsLongHorizonPct(row.pct12h),
    pct24h: reversalStatsLongHorizonPct(row.pct24h),
    pct48h: reversalStatsLongHorizonPct(row.pct48h),
    ema20_1hSlopePct7d: row.ema20_1hSlopePct7d,
    maxHorizonHours: holdHours,
    close12hEnabled: true,
  });
  if (!simLong) return;
  const longKey = reversalTpStrategyCacheKeyLong(holdHours, { close12hEnabled: true });
  row.strategyProfitByPlan = {
    ...row.strategyProfitByPlan,
    [longKey]: { profitPct: simLong.profitPct, exitReason: simLong.exitReason },
  };
  /* ไม่เขียน strategyProfitPct* ระดับแถว — enrich ตามแผนผู้ชม */
}

async function followUpCandleReversal1hRow(
  row: CandleReversalStatsRow,
  nowMs: number,
  nowSec: number,
): Promise<boolean> {
  const entry = row.entryPrice;
  const ac = anchorCloseSec(row);
  const side = reversalMeasureSide(row);
  const followSec = followup1hHours() * HOUR_SEC;
  const windowEndSec = Math.min(nowSec, ac + followSec);

  const pack15 = await fetchBinanceUsdmKlinesRange(row.symbol, "15m", {
    startTimeMs: row.signalBarOpenSec * 1000,
    endTimeMs: nowMs,
    limit: 500,
  });
  if (!pack15 || pack15.timeSec.length === 0) return false;

  const { timeSec: t15, high: h15, low: l15, close: c15 } = pack15;
  const i15First = t15.findIndex((t) => t + KLINE_15M_SEC >= ac);
  if (i15First < 0) return false;
  const i15Last = indexRangeThrough(t15, KLINE_15M_SEC, i15First, windowEndSec);
  if (i15Last < i15First) return false;

  const i15FollowFirst = firstFollowUpKlineIndexAfterAnchorClose(t15, ac);
  const h48End = ac + 48 * HOUR_SEC;
  const mfeWindowEnd = Math.min(windowEndSec, h48End);
  const i15LastMfe = indexRangeThrough(t15, KLINE_15M_SEC, i15First, mfeWindowEnd);
  const mfe =
    i15FollowFirst >= 0 && i15LastMfe >= i15FollowFirst
      ? computeMfeForMeasureSide(
          side,
          t15,
          h15,
          l15,
          KLINE_15M_SEC,
          i15FollowFirst,
          i15LastMfe,
          ac,
          entry,
        )
      : null;
  if (!mfe) return false;

  const iAdverseFirst = firstFollowUpKlineIndexAfterAnchorClose(t15, ac);
  if (iAdverseFirst >= 0 && i15Last >= iAdverseFirst) {
    const adverse = computeFollowUpMaxAdversePct(h15, l15, iAdverseFirst, i15Last, entry, side);
    if (adverse != null) row.followUpMaxAdversePct = adverse;
  }

  const h4End = ac + 4 * HOUR_SEC;
  const h12End = ac + 12 * HOUR_SEC;
  const h24End = ac + 24 * HOUR_SEC;
  const h4 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, h4End, entry, side);
  const h12 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, h12End, entry, side);
  const h24 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, h24End, entry, side);
  let h48 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, h48End, entry, side);
  if (h48 == null && nowSec >= h48End && i15Last >= i15First) {
    const p = c15[i15Last]!;
    h48 = { price: p, pct: pctVsEntry(entry, p, side) };
  }

  row.maxRoiPct = mfe.maxRoi;
  row.maxRoi15mV = STATS_MAX_ROI_15M_VERSION;
  row.durationToMfeHours = mfe.durationHours;
  row.maxDrawdownPct = mfe.maxDd;
  if (h4) {
    row.price4h = h4.price;
    row.pct4h = h4.pct;
  } else if (nowSec < h4End) {
    row.price4h = null;
    row.pct4h = null;
  }
  if (h12) {
    row.price12h = h12.price;
    row.pct12h = h12.pct;
  } else if (nowSec < h12End) {
    row.price12h = null;
    row.pct12h = null;
  }
  if (h24) {
    row.price24h = h24.price;
    row.pct24h = h24.pct;
  } else if (nowSec < h24End) {
    row.price24h = null;
    row.pct24h = null;
  }
  if (h48) {
    row.price48h = h48.price;
    row.pct48h = h48.pct;
  } else if (nowSec < h48End) {
    row.price48h = null;
    row.pct48h = null;
  }

  if (row.pct24h != null && nowSec >= h24End) {
    const i15Last24 = indexRangeThrough(t15, KLINE_15M_SEC, i15First, h24End);
    if (i15FollowFirst >= 0 && i15Last24 >= i15FollowFirst) {
      applyReversal1hStrategyProfitAtHorizon(
        row,
        t15,
        h15,
        l15,
        i15FollowFirst,
        i15Last24,
        ac,
        STATS_STRATEGY_PROFIT_HOLD_24H,
      );
    }
  } else if (nowSec < h24End) {
    row.strategyProfitPct24h = null;
    row.strategyExitReason24h = null;
    row.strategyProfitPctLong24h = null;
    row.strategyExitReasonLong24h = null;
  }

  if (row.pct48h != null && nowSec >= h48End) {
    const i15Last48 = indexRangeThrough(t15, KLINE_15M_SEC, i15First, h48End);
    if (i15FollowFirst >= 0 && i15Last48 >= i15FollowFirst) {
      applyReversal1hStrategyProfitAtHorizon(
        row,
        t15,
        h15,
        l15,
        i15FollowFirst,
        i15Last48,
        ac,
        STATS_STRATEGY_PROFIT_HOLD_48H,
      );
    }
  } else if (nowSec < h48End) {
    row.strategyProfitPct = null;
    row.strategyExitReason = null;
    row.strategyProfitPctLong = null;
    row.strategyExitReasonLong = null;
  }

  // Reversal 1H: ปิดผลเร็วขึ้นที่ 24h (ใช้ pct24h)
  // pct48h ยังคำนวณเก็บไว้สำหรับ winrate horizon 48h ในตาราง
  // เซต outcome เฉพาะตอนที่ยัง pending — ป้องกัน follow-up ครั้งหลัง flip ผล
  const finalized = nowSec >= ac + 24 * HOUR_SEC && row.pct24h != null;
  if (finalized && row.outcome === "pending") {
    applyOutcomeFromPct(row, row.pct24h ?? 0);
  }

  return true;
}

/** ตัดสินว่าควรเรียก follow-up เพิ่มเติมไหม — ใช่ ถ้า pending หรือมี pct horizon ใดยังว่างทั้งที่เลย horizon นั้นแล้ว */
function shouldFollowUpReversalRow(row: CandleReversalStatsRow, nowSec: number): boolean {
  if (row.outcome === "pending") return true;
  const ac = anchorCloseSec(row);
  if (signalBarTf(row) === "1h") {
    if (row.maxRoi15mV !== STATS_MAX_ROI_15M_VERSION && nowSec >= ac + 24 * HOUR_SEC) return true;
    if (nowSec < ac + 4 * HOUR_SEC && row.pct4h != null) return true;
    if (nowSec < ac + 12 * HOUR_SEC && row.pct12h != null) return true;
    if (nowSec < ac + 24 * HOUR_SEC && row.pct24h != null) return true;
    if (nowSec < ac + 48 * HOUR_SEC && row.pct48h != null) return true;
    if (row.pct4h == null && nowSec >= ac + 4 * HOUR_SEC) return true;
    if (row.pct12h == null && nowSec >= ac + 12 * HOUR_SEC) return true;
    if (row.pct24h == null && nowSec >= ac + 24 * HOUR_SEC) return true;
    if (row.pct48h == null && nowSec >= ac + 48 * HOUR_SEC) return true;
    if (row.pct24h != null && row.strategyProfitPct24h == null) return true;
    if (row.pct48h != null && row.strategyProfitPct == null) return true;
    if (
      reversalRowIsSuggestedLong(row) &&
      row.pct24h != null &&
      row.strategyProfitPctLong24h == null
    ) {
      return true;
    }
    if (
      reversalRowIsSuggestedLong(row) &&
      row.pct48h != null &&
      row.strategyProfitPctLong == null
    ) {
      return true;
    }
    if (row.pct12h == null && nowSec >= ac + 12 * HOUR_SEC) return true;
    return false;
  }
  if (nowSec < ac + DAY_SEC && row.pct1d != null) return true;
  if (nowSec < ac + 3 * DAY_SEC && row.pct3d != null) return true;
  if (nowSec < ac + followup1dDays() * DAY_SEC && row.pct7d != null) return true;
  if (row.pct1d == null && nowSec >= ac + DAY_SEC) return true;
  if (row.pct3d == null && nowSec >= ac + 3 * DAY_SEC) return true;
  if (row.pct7d == null && nowSec >= ac + followup1dDays() * DAY_SEC) return true;
  return false;
}

/**
 * Backfill: แถว 1H เก่าเคยปิดผลที่ 48h → re-evaluate ใหม่ที่ 24h
 * (รันต่อแต่ละ tick · no-op หลังครั้งแรกเมื่อ outcome ตรงกับ pct24h แล้ว)
 */
function backfill1hOutcomeTo24h(rows: CandleReversalStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (signalBarTf(row) !== "1h") continue;
    if (row.outcome === "pending") continue;
    if (row.pct24h == null || !Number.isFinite(row.pct24h)) continue;
    const prev = row.outcome;
    applyOutcomeFromPct(row, row.pct24h);
    if (row.outcome !== prev) updated += 1;
  }
  return updated;
}

async function followUpCandleReversal1dRow(
  row: CandleReversalStatsRow,
  nowMs: number,
  nowSec: number,
): Promise<boolean> {
  const entry = row.entryPrice;
  const ac = anchorCloseSec(row);
  const followSec = followup1dDays() * DAY_SEC;
  const windowEndSec = Math.min(nowSec, ac + followSec);

  const dayPack = await fetchBinanceUsdmKlinesRange(row.symbol, "1d", {
    startTimeMs: row.signalBarOpenSec * 1000,
    endTimeMs: nowMs,
    limit: 20,
  });
  if (!dayPack || dayPack.timeSec.length === 0) return false;

  const { timeSec: dayT, close: dayC } = dayPack;
  const iDayFirst = dayT.findIndex((t) => t + DAY_SEC >= ac);
  if (iDayFirst < 0) return false;
  const iDayLast = indexRangeThrough(dayT, DAY_SEC, iDayFirst, windowEndSec);
  if (iDayLast < iDayFirst) return false;

  const mfe = computeMfeFromPack(dayT, dayPack.high, dayPack.low, DAY_SEC, iDayFirst, iDayLast, ac, entry);
  if (!mfe) return false;

  const iAdverseFirst = firstFollowUpKlineIndexAfterAnchorClose(dayT, ac);
  const adverse =
    iAdverseFirst >= 0 && iDayLast >= iAdverseFirst
      ? computeFollowUpMaxAdversePct(dayPack.high, dayPack.low, iAdverseFirst, iDayLast, entry, "short")
      : null;
  if (adverse != null) row.followUpMaxAdversePct = adverse;

  const h1dEnd = ac + DAY_SEC;
  const h3dEnd = ac + 3 * DAY_SEC;
  const h7dEnd = ac + followSec;
  const h1d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, h1dEnd, entry);
  const h3d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, h3dEnd, entry);
  let h7d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, h7dEnd, entry);
  if (h7d == null && nowSec >= h7dEnd && iDayLast >= iDayFirst) {
    const p = dayC[iDayLast]!;
    h7d = { price: p, pct: pctVsEntryShort(entry, p) };
  }

  row.maxRoiPct = mfe.maxRoi;
  row.durationToMfeHours = mfe.durationHours;
  row.maxDrawdownPct = mfe.maxDd;
  if (h1d) {
    row.price1d = h1d.price;
    row.pct1d = h1d.pct;
  } else if (nowSec < h1dEnd) {
    row.price1d = null;
    row.pct1d = null;
  }
  if (h3d) {
    row.price3d = h3d.price;
    row.pct3d = h3d.pct;
  } else if (nowSec < h3dEnd) {
    row.price3d = null;
    row.pct3d = null;
  }
  if (h7d) {
    row.price7d = h7d.price;
    row.pct7d = h7d.pct;
  } else if (nowSec < h7dEnd) {
    row.price7d = null;
    row.pct7d = null;
  }

  const finalized = nowSec >= ac + followSec && row.pct7d != null;
  if (finalized && row.outcome === "pending") {
    applyOutcomeFromPct(row, row.pct7d ?? 0);
  }

  return true;
}

function backfillObserveStatsPlayMode(rows: CandleReversalStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (reversalStatsRowIsObserve(row)) continue;
    if (!reversalIsObserveSignal(row)) continue;
    const reason = reversalResolveObserveReason(row);
    if (!reason) continue;
    row.statsPlayMode = "observe";
    row.observeReason = reason;
    updated += 1;
  }
  return updated;
}

async function backfillGreenDaysBeforeSignal(rows: CandleReversalStatsRow[]): Promise<number> {
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
        console.error("[candleReversalStatsTick] backfill green days 1d", sym, e);
        pack = null;
      }
      packBySymbol.set(sym, pack);
    }
    const tf = signalBarTf(row);
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

/**
 * Admin — force-recompute outcome ทุกแถวจาก horizon pct ที่บันทึกอยู่
 *   1H signal → ใช้ pct24h
 *   1D signal → ใช้ pct7d
 * ข้าม pending guard (ถ้า pct ที่ใช้สรุปผลมีค่าแล้ว → re-evaluate ทันที)
 */
export async function correctCandleReversalStatsOutcome(opts?: {
  symbol?: string;
}): Promise<{ scanned: number; changedOutcome: number }> {
  const symbolFilter = opts?.symbol?.trim().toUpperCase() || undefined;
  const state = await loadCandleReversalStatsState();
  const nowSec = Math.floor(Date.now() / 1000);
  let scanned = 0;
  let changedOutcome = 0;

  for (const row of state.rows) {
    if (symbolFilter && row.symbol.trim().toUpperCase() !== symbolFilter) continue;
    const tf = signalBarTf(row);
    const pct = tf === "1h" ? row.pct24h : row.pct7d;
    if (pct == null || !Number.isFinite(pct)) continue;
    const ac = anchorCloseSec(row);
    const horizonOk = tf === "1h" ? nowSec >= ac + 24 * HOUR_SEC : nowSec >= ac + followup1dDays() * DAY_SEC;
    if (!horizonOk) continue;
    scanned += 1;

    const prev = row.outcome;
    applyOutcomeFromPct(row, pct);
    if (row.outcome !== prev) changedOutcome += 1;
  }

  if (changedOutcome > 0) await saveCandleReversalStatsState(state);
  return { scanned, changedOutcome };
}

/** คำนวณ follow-up Long 1H ใหม่ด้วย measure side fade SHORT (หลังเปลี่ยน logic) */
async function refreshLong1hFadeShortFollowUp(
  rows: CandleReversalStatsRow[],
  nowMs: number,
  nowSec: number,
): Promise<number> {
  let dirty = 0;
  for (const row of rows) {
    if (signalBarTf(row) !== "1h" || row.tradeSide !== "long") continue;
    const ac = anchorCloseSec(row);
    if (nowSec < ac + 24 * HOUR_SEC) continue;
    row.strategyProfitByPlan = undefined;
    row.strategyProfitPct = null;
    row.strategyProfitPct24h = null;
    row.strategyExitReason = null;
    row.strategyExitReason24h = null;
    if (await followUpCandleReversal1hRow(row, nowMs, nowSec)) dirty += 1;
  }
  return dirty;
}

export async function runCandleReversalStatsFollowUpTick(
  nowMs: number,
  opts?: { forceLong1hFadeShort?: boolean },
): Promise<number> {
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isCandleReversalStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return 0;

  const state = await loadCandleReversalStatsState();
  let dirty = 0;
  const nowSec = Math.floor(nowMs / 1000);

  // รันก่อน backfill ช้า — สัญญาณใหม่ไม่ควรค้างเพราะ cron timeout
  dirty += (await backfillReversalKlineAiAnalysis(state.rows)).succeeded;

  dirty += backfillReversalBarRangePctSignalEstimate(state.rows);
  dirty += await backfillRangeRankInLookback(state.rows);
  dirty += backfillLenPercentilePct(state.rows);
  dirty += await backfillReversalEmaSlopes(state.rows);
  dirty += await backfillAllStatsRowsBtcEmaSlopes(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  dirty += await backfillAllStatsRowsEma20Dist(state.rows, { maxRowsPerPass: 40, maxPasses: 10 });
  dirty += await backfillAllStatsRowsEma20_15mEntry(state.rows, {
    maxRowsPerPass: 25,
    maxPasses: 10,
    nowMs,
  });
  dirty += await backfillAllStatsRowsPsar4h(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  dirty += await backfillAllStatsRowsAtrPct4h(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  dirty += await backfillAllStatsRowsQuoteVol24h(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  dirty += await backfillAllStatsRowsMarketCapUsd(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  dirty += await backfillAllStatsRowsOpenInterest(state.rows, { maxRowsPerPass: 20, maxPasses: 5 });
  dirty += await backfillAllStatsRowsBtcDomEma20_4h(state.rows, { maxRowsPerPass: 15, maxPasses: 5 });
  dirty += await backfillSignalVolVsSma(state.rows);
  dirty += await backfillLowerWickRatioPct(state.rows);
  dirty += await backfillGreenDaysBeforeSignal(state.rows);
  dirty += await backfillPumpCycleSwingLowForRows(state.rows, (row) =>
    candleReversalStatsAnchorCloseSec(row),
  );
  dirty += backfillObserveStatsPlayMode(state.rows);
  dirty += backfill1hOutcomeTo24h(state.rows);
  dirty += await backfillAllStatsRowsTradFiFlag(state.rows);
  dirty += await backfillAllStatsMarketSentiment(state.rows, { maxPasses: 5 });
  if (opts?.forceLong1hFadeShort && isCandleReversal1hLongStatsEnabled()) {
    dirty += await refreshLong1hFadeShortFollowUp(state.rows, nowMs, nowSec);
  }

  const long1hStatsEnabled = isCandleReversal1hLongStatsEnabled();
  const day1StatsEnabled = isCandleReversal1dStatsEnabled();
  for (const row of state.rows) {
    if (!day1StatsEnabled && signalBarTf(row) === "1d") {
      continue;
    }
    if (
      !long1hStatsEnabled &&
      signalBarTf(row) === "1h" &&
      row.tradeSide === "long"
    ) {
      continue;
    }
    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const ac = anchorCloseSec(row);
    if (nowSec < ac) continue;

    const followWindowEnd =
      signalBarTf(row) === "1h" ? ac + followup1hHours() * HOUR_SEC : ac + followup1dDays() * DAY_SEC;
    const needsFollowUpAdverse = row.followUpMaxAdversePct == null || nowSec < followWindowEnd;
    if (!shouldFollowUpReversalRow(row, nowSec) && !needsFollowUpAdverse) continue;

    const ok =
      signalBarTf(row) === "1h"
        ? await followUpCandleReversal1hRow(row, nowMs, nowSec)
        : await followUpCandleReversal1dRow(row, nowMs, nowSec);
    if (ok) dirty += 1;
  }

  if (dirty > 0) await saveCandleReversalStatsState(state);
  return dirty;
}
