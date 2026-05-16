import type { CandleReversalSignalBarTf } from "@/lib/candleReversalStatsClient";
import {
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
} from "./binanceIndicatorKline";
import {
  isCandleReversalStatsEnabled,
  loadCandleReversalStatsState,
  saveCandleReversalStatsState,
  type CandleReversalStatsRow,
} from "./candleReversalStatsStore";

const DAY_SEC = 24 * 3600;
const HOUR_SEC = 3600;
const FOLLOWUP_DAYS = 7;

function signalBarTf(row: CandleReversalStatsRow): CandleReversalSignalBarTf {
  return row.signalBarTf === "1h" ? "1h" : "1d";
}

function signalBarDurationSec(row: CandleReversalStatsRow): number {
  return signalBarTf(row) === "1h" ? HOUR_SEC : DAY_SEC;
}

function anchorCloseSec(row: CandleReversalStatsRow): number {
  return row.signalBarOpenSec + signalBarDurationSec(row);
}

function pctVsEntryShort(entry: number, price: number): number {
  return ((entry - price) / entry) * 100;
}

function outcomeWinMinPct(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_WIN_MIN_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return 0.5;
}

function outcomeLossMaxPct(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_LOSS_MAX_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return -0.5;
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
): { price: number; pct: number } | null {
  const limitSec = Math.min(horizonEndSec, nowSec);
  let best = -1;
  for (let i = iFirst; i <= iLast; i++) {
    const barClose = timeSec[i]! + barDurSec;
    if (barClose <= limitSec) best = i;
  }
  if (best < 0) return null;
  const price = close[best]!;
  return { price, pct: pctVsEntryShort(entry, price) };
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

export async function runCandleReversalStatsFollowUpTick(nowMs: number): Promise<number> {
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isCandleReversalStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return 0;

  const state = await loadCandleReversalStatsState();
  let dirty = 0;
  const nowSec = Math.floor(nowMs / 1000);

  for (const row of state.rows) {
    if (row.outcome !== "pending") continue;

    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const tf = signalBarTf(row);
    const barDur = signalBarDurationSec(row);
    const ac = anchorCloseSec(row);
    if (nowSec < ac) continue;

    const followSec = FOLLOWUP_DAYS * DAY_SEC;
    const windowEndSec = Math.min(nowSec, ac + followSec);

    const dayPack = await fetchBinanceUsdmKlinesRange(row.symbol, "1d", {
      startTimeMs: row.signalBarOpenSec * 1000,
      endTimeMs: nowMs,
      limit: 20,
    });
    if (!dayPack || dayPack.timeSec.length === 0) continue;

    const { timeSec: dayT, close: dayC } = dayPack;
    const iDayFirst = dayT.findIndex((t) => t + DAY_SEC >= ac);
    if (iDayFirst < 0) continue;

    let iDayLast = iDayFirst;
    for (let i = iDayFirst; i < dayT.length; i++) {
      if (dayT[i]! + DAY_SEC <= windowEndSec) iDayLast = i;
    }
    if (iDayLast < iDayFirst) continue;

    let mfe: ReturnType<typeof computeMfeFromPack> = null;

    if (tf === "1h") {
      const hPack = await fetchBinanceUsdmKlinesRange(row.symbol, "1h", {
        startTimeMs: row.signalBarOpenSec * 1000,
        endTimeMs: nowMs,
        limit: 200,
      });
      if (hPack && hPack.timeSec.length > 0) {
        const { timeSec: hT, high: hH, low: hL } = hPack;
        const iHFirst = hT.findIndex((t) => t + HOUR_SEC >= ac);
        if (iHFirst >= 0) {
          let iHLast = iHFirst;
          for (let i = iHFirst; i < hT.length; i++) {
            if (hT[i]! + HOUR_SEC <= windowEndSec) iHLast = i;
          }
          if (iHLast >= iHFirst) {
            mfe = computeMfeFromPack(hT, hH, hL, HOUR_SEC, iHFirst, iHLast, ac, entry);
          }
        }
      }
    }

    if (!mfe) {
      mfe = computeMfeFromPack(dayT, dayPack.high, dayPack.low, DAY_SEC, iDayFirst, iDayLast, ac, entry);
    }
    if (!mfe) continue;

    const h1d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, ac + DAY_SEC, entry);
    const h3d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, ac + 3 * DAY_SEC, entry);
    let h7d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, ac + followSec, entry);
    if (h7d == null && nowSec >= ac + followSec && iDayLast >= iDayFirst) {
      const p = dayC[iDayLast]!;
      h7d = { price: p, pct: pctVsEntryShort(entry, p) };
    }

    row.maxRoiPct = mfe.maxRoi;
    row.durationToMfeHours = mfe.durationHours;
    row.maxDrawdownPct = mfe.maxDd;
    if (h1d) {
      row.price1d = h1d.price;
      row.pct1d = h1d.pct;
    }
    if (h3d) {
      row.price3d = h3d.price;
      row.pct3d = h3d.pct;
    }
    if (h7d) {
      row.price7d = h7d.price;
      row.pct7d = h7d.pct;
    }

    const finalized = nowSec >= ac + followSec && row.pct7d != null;
    if (finalized) {
      const pct7 = row.pct7d ?? 0;
      if (pct7 >= outcomeWinMinPct()) row.outcome = "win";
      else if (pct7 <= outcomeLossMaxPct()) row.outcome = "loss";
      else row.outcome = "flat";
    }

    dirty += 1;
  }

  if (dirty > 0) await saveCandleReversalStatsState(state);
  return dirty;
}
