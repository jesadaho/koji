import type { CandleReversalSignalBarTf } from "@/lib/candleReversalStatsClient";
import { countGreenDaysBeforeSignalBar } from "./greenDayStreak";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  isCandleReversalStatsEnabled,
  loadCandleReversalStatsState,
  saveCandleReversalStatsState,
  type CandleReversalStatsRow,
} from "./candleReversalStatsStore";

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

async function followUpCandleReversal1hRow(
  row: CandleReversalStatsRow,
  nowMs: number,
  nowSec: number,
): Promise<boolean> {
  const entry = row.entryPrice;
  const ac = anchorCloseSec(row);
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

  let mfe: ReturnType<typeof computeMfeFromPack> = null;
  const hPack = await fetchBinanceUsdmKlinesRange(row.symbol, "1h", {
    startTimeMs: row.signalBarOpenSec * 1000,
    endTimeMs: nowMs,
    limit: 200,
  });
  if (hPack && hPack.timeSec.length > 0) {
    const { timeSec: hT, high: hH, low: hL } = hPack;
    const iHFirst = hT.findIndex((t) => t + HOUR_SEC >= ac);
    if (iHFirst >= 0) {
      const iHLast = indexRangeThrough(hT, HOUR_SEC, iHFirst, windowEndSec);
      if (iHLast >= iHFirst) {
        mfe = computeMfeFromPack(hT, hH, hL, HOUR_SEC, iHFirst, iHLast, ac, entry);
      }
    }
  }
  if (!mfe) {
    mfe = computeMfeFromPack(t15, h15, l15, KLINE_15M_SEC, i15First, i15Last, ac, entry);
  }
  if (!mfe) return false;

  const h4 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, ac + 4 * HOUR_SEC, entry);
  const h12 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, ac + 12 * HOUR_SEC, entry);
  const h24 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, ac + 24 * HOUR_SEC, entry);
  let h48 = pickHorizonClose(t15, c15, KLINE_15M_SEC, i15First, i15Last, nowSec, ac + 48 * HOUR_SEC, entry);
  if (h48 == null && nowSec >= ac + 48 * HOUR_SEC && i15Last >= i15First) {
    const p = c15[i15Last]!;
    h48 = { price: p, pct: pctVsEntryShort(entry, p) };
  }

  row.maxRoiPct = mfe.maxRoi;
  row.durationToMfeHours = mfe.durationHours;
  row.maxDrawdownPct = mfe.maxDd;
  if (h4) {
    row.price4h = h4.price;
    row.pct4h = h4.pct;
  }
  if (h12) {
    row.price12h = h12.price;
    row.pct12h = h12.pct;
  }
  if (h24) {
    row.price24h = h24.price;
    row.pct24h = h24.pct;
  }
  if (h48) {
    row.price48h = h48.price;
    row.pct48h = h48.pct;
  }

  // Reversal 1H: ปิดผลเร็วขึ้นที่ 24h (ใช้ pct24h)
  // pct48h ยังคำนวณเก็บไว้สำหรับ winrate horizon 48h ในตาราง
  const finalized = nowSec >= ac + 24 * HOUR_SEC && row.pct24h != null;
  if (finalized) {
    applyOutcomeFromPct(row, row.pct24h ?? 0);
  }

  return true;
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
    applyOutcomeFromPct(row, row.pct7d ?? 0);
  }

  return true;
}

async function backfillGreenDaysBeforeSignal(rows: CandleReversalStatsRow[]): Promise<number> {
  const need = rows.filter((r) => r.greenDaysBeforeSignal == null);
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
    const n = countGreenDaysBeforeSignalBar(pack, row.signalBarOpenSec, tf);
    if (n == null) continue;
    row.greenDaysBeforeSignal = n;
    updated += 1;
  }
  return updated;
}

export async function runCandleReversalStatsFollowUpTick(nowMs: number): Promise<number> {
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isCandleReversalStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return 0;

  const state = await loadCandleReversalStatsState();
  let dirty = 0;
  const nowSec = Math.floor(nowMs / 1000);

  dirty += await backfillGreenDaysBeforeSignal(state.rows);
  dirty += backfill1hOutcomeTo24h(state.rows);

  for (const row of state.rows) {
    if (row.outcome !== "pending") continue;

    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const ac = anchorCloseSec(row);
    if (nowSec < ac) continue;

    const ok =
      signalBarTf(row) === "1h"
        ? await followUpCandleReversal1hRow(row, nowMs, nowSec)
        : await followUpCandleReversal1dRow(row, nowMs, nowSec);
    if (ok) dirty += 1;
  }

  if (dirty > 0) await saveCandleReversalStatsState(state);
  return dirty;
}
