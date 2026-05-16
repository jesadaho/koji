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

const KLINE_GRAN_SEC = 24 * 3600;
const FOLLOWUP_DAYS = 7;

function signalBarDurationSec(): number {
  return KLINE_GRAN_SEC;
}

function anchorCloseSec(row: CandleReversalStatsRow): number {
  return row.signalBarOpenSec + signalBarDurationSec();
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
  iFirst: number,
  iLast: number,
  nowSec: number,
  horizonEndSec: number,
  entry: number,
): { price: number; pct: number } | null {
  const limitSec = Math.min(horizonEndSec, nowSec);
  let best = -1;
  for (let i = iFirst; i <= iLast; i++) {
    const barClose = timeSec[i]! + KLINE_GRAN_SEC;
    if (barClose <= limitSec) best = i;
  }
  if (best < 0) return null;
  const price = close[best]!;
  return { price, pct: pctVsEntryShort(entry, price) };
}

export async function runCandleReversalStatsFollowUpTick(nowMs: number): Promise<number> {
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isCandleReversalStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return 0;

  const state = await loadCandleReversalStatsState();
  let dirty = 0;

  for (const row of state.rows) {
    if (row.outcome !== "pending") continue;

    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const ac = anchorCloseSec(row);
    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec < ac) continue;

    const followSec = FOLLOWUP_DAYS * KLINE_GRAN_SEC;
    const windowEndSec = Math.min(nowSec, ac + followSec);

    const pack = await fetchBinanceUsdmKlinesRange(row.symbol, "1d", {
      startTimeMs: row.signalBarOpenSec * 1000,
      endTimeMs: nowMs,
      limit: 20,
    });
    if (!pack || pack.timeSec.length === 0) continue;

    const { timeSec, high, low, close } = pack;
    const iFirst = timeSec.findIndex((t) => t + KLINE_GRAN_SEC >= ac);
    if (iFirst < 0) continue;

    let iLast = iFirst;
    for (let i = iFirst; i < timeSec.length; i++) {
      if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndSec) iLast = i;
    }
    if (iLast < iFirst) continue;

    let maxRoi = -Infinity;
    let mfeIdx = iFirst;
    for (let i = iFirst; i <= iLast; i++) {
      const roi = ((entry - low[i]!) / entry) * 100;
      if (roi > maxRoi) {
        maxRoi = roi;
        mfeIdx = i;
      }
    }
    if (!Number.isFinite(maxRoi)) continue;

    let maxHigh = -Infinity;
    for (let i = iFirst; i <= mfeIdx; i++) {
      maxHigh = Math.max(maxHigh, high[i]!);
    }
    let maxDd = ((maxHigh - entry) / entry) * 100;
    if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;

    const durationHours = (timeSec[mfeIdx]! + KLINE_GRAN_SEC - ac) / 3600;

    const h1d = pickHorizonClose(timeSec, close, iFirst, iLast, nowSec, ac + KLINE_GRAN_SEC, entry);
    const h3d = pickHorizonClose(timeSec, close, iFirst, iLast, nowSec, ac + 3 * KLINE_GRAN_SEC, entry);
    let h7d = pickHorizonClose(timeSec, close, iFirst, iLast, nowSec, ac + followSec, entry);
    if (h7d == null && nowSec >= ac + followSec && iLast >= iFirst) {
      const p = close[iLast]!;
      h7d = { price: p, pct: pctVsEntryShort(entry, p) };
    }

    row.maxRoiPct = maxRoi;
    row.durationToMfeHours = durationHours;
    row.maxDrawdownPct = maxDd;
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
