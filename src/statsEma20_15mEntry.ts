import { REVERSAL_LIMIT_EXPIRE_MS } from "@/lib/reversalAutoTradeEntry";
import { computeEmaLast } from "./emaUtils";
import { emaLine } from "./indicatorMath";
import {
  fetchBinanceUsdmKlinesPaginated,
  fetchBinanceUsdmLastPrice,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  STATS_EMA20_DIST_PERIOD,
  priceVsEmaDistPct,
} from "./statsEma20Dist";

/** 7 วันบน 15m = 672 แท่ง */
export const STATS_EMA15M_SLOPE_LOOKBACK_BARS = 672;

export const STATS_EMA20_15M_ENTRY_VERSION = 1;

/** EMA20@15m slope + dist ณ checkpoint 8 ชม. หลังปิดแท่งสัญญาณ (1H follow-up) */
export const STATS_EMA20_15M_AT8H_VERSION = 1;

/** EMA20@15m slope + dist ณ checkpoint 12 ชม. หลังปิดแท่งสัญญาณ (1H follow-up) */
export const STATS_EMA20_15M_AT12H_VERSION = 1;

const BAR_DUR_15M_SEC = 15 * 60;
const LIVE_ALERT_MAX_AGE_MS = 10 * 60_000;

function lastClosedBarIndexAt(pack: BinanceKlinePack, barDurSec: number, atSec: number): number {
  let iClosed = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    if (pack.timeSec[i]! + barDurSec <= atSec) iClosed = i;
  }
  return iClosed;
}

function statsEma15mSlopeMinKlineBars(lookbackBars: number): number {
  return STATS_EMA20_DIST_PERIOD + lookbackBars + 8;
}

function computeEma20_15mSlopePctFromPackAt(
  pack: BinanceKlinePack,
  lookbackBars: number,
  atMs: number,
  period = STATS_EMA20_DIST_PERIOD,
): number | null {
  if (!pack.close.length || pack.close.length < period) return null;
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, BAR_DUR_15M_SEC, atSec);
  const lb = Math.floor(lookbackBars);
  if (iClosed < 0 || lb < 1) return null;
  const closes = pack.close.slice(0, iClosed + 1);
  if (closes.length < period + lb + 1) return null;
  const iEnd = closes.length - 1;
  const iAgo = iEnd - lb;
  const emaToday = computeEmaLast(closes.slice(0, iEnd + 1), period);
  const emaAgo = computeEmaLast(closes.slice(0, iAgo + 1), period);
  if (emaToday == null || emaAgo == null || emaAgo <= 0) return null;
  return ((emaToday - emaAgo) / emaAgo) * 100;
}

function computeEntryEma20_15mFromPackAt(
  pack: BinanceKlinePack,
  atMs: number,
  period = STATS_EMA20_DIST_PERIOD,
): number | null {
  if (!pack.close.length || pack.close.length < period + 2) return null;
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, BAR_DUR_15M_SEC, atSec);
  if (iClosed < period - 1) return null;
  const emaArr = emaLine(pack.close, period);
  const ema = emaArr[iClosed];
  if (!Number.isFinite(ema) || ema <= 0) return null;
  return ema;
}

function closeAtLastClosedBar(pack: BinanceKlinePack, atMs: number): number | null {
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, BAR_DUR_15M_SEC, atSec);
  if (iClosed < 0) return null;
  const c = pack.close[iClosed];
  return Number.isFinite(c) && c > 0 ? c : null;
}

async function fetchMarkAtAlert(
  symbol: string,
  alertedAtMs: number,
  slopePack: BinanceKlinePack | null,
): Promise<number | null> {
  const ageMs = Date.now() - alertedAtMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const mark = await fetchBinanceUsdmLastPrice(symbol);
    if (mark != null) return mark;
  }
  if (slopePack) {
    return closeAtLastClosedBar(slopePack, alertedAtMs);
  }
  return null;
}

export type StatsEma20_15mEntrySnapshot = {
  ema20_15mSlopePct7d: number | null;
  priceVsEma20_15mPct: number | null;
  entryEma20_15m: number | null;
  entryEma20_15mTouchedWithin8h: boolean | null;
  entryEma20_15mTouchedAtMs: number | null;
};

function detectEma20_15mTouch(
  entryEma: number,
  mark: number,
  alertedAtMs: number,
  nowMs: number,
  touchPack: BinanceKlinePack,
): { touched: boolean | null; touchedAtMs: number | null } {
  if (mark > entryEma) {
    return { touched: true, touchedAtMs: alertedAtMs };
  }

  const windowEndMs = alertedAtMs + REVERSAL_LIMIT_EXPIRE_MS;
  const scanEndMs = Math.min(nowMs, windowEndMs);
  const alertSec = Math.floor(alertedAtMs / 1000);
  const scanEndSec = Math.floor(scanEndMs / 1000);

  for (let i = 0; i < touchPack.timeSec.length; i++) {
    const barOpen = touchPack.timeSec[i]!;
    const barClose = barOpen + BAR_DUR_15M_SEC;
    if (barClose <= alertSec) continue;
    if (barOpen > scanEndSec) break;
    const hi = touchPack.high[i]!;
    if (Number.isFinite(hi) && hi >= entryEma) {
      return { touched: true, touchedAtMs: Math.max(alertedAtMs, barOpen * 1000) };
    }
  }

  if (nowMs >= windowEndMs) {
    return { touched: false, touchedAtMs: null };
  }
  return { touched: null, touchedAtMs: null };
}

async function fetchSlopePack(symbol: string, atMs: number): Promise<BinanceKlinePack | null> {
  const minBars = statsEma15mSlopeMinKlineBars(STATS_EMA15M_SLOPE_LOOKBACK_BARS);
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - minBars * BAR_DUR_15M_SEC) * 1000;
  return fetchBinanceUsdmKlinesPaginated(symbol.trim().toUpperCase(), "15m", startMs, atMs);
}

async function fetchTouchPack(
  symbol: string,
  alertedAtMs: number,
  nowMs: number,
): Promise<BinanceKlinePack | null> {
  const windowEndMs = alertedAtMs + REVERSAL_LIMIT_EXPIRE_MS;
  const endMs = Math.max(alertedAtMs, Math.min(nowMs, windowEndMs) + BAR_DUR_15M_SEC * 1000);
  return fetchBinanceUsdmKlinesPaginated(
    symbol.trim().toUpperCase(),
    "15m",
    alertedAtMs,
    endMs,
  );
}

const emptySnapshot = (): StatsEma20_15mEntrySnapshot => ({
  ema20_15mSlopePct7d: null,
  priceVsEma20_15mPct: null,
  entryEma20_15m: null,
  entryEma20_15mTouchedWithin8h: null,
  entryEma20_15mTouchedAtMs: null,
});

export type Ema20_15mMetricsAtMs = {
  ema20_15mSlopePct7d: number | null;
  priceVsEma20_15mPct: number | null;
  entryEma20_15m: number | null;
};

/** EMA20@15m slope + close diff ณ atMs (ไม่สแกน touch) */
export async function fetchEma20_15mMetricsAtMs(
  symbol: string,
  atMs: number,
): Promise<Ema20_15mMetricsAtMs> {
  const empty: Ema20_15mMetricsAtMs = {
    ema20_15mSlopePct7d: null,
    priceVsEma20_15mPct: null,
    entryEma20_15m: null,
  };
  if (!isBinanceIndicatorFapiEnabled()) return empty;
  if (!Number.isFinite(atMs) || atMs <= 0) return empty;

  const sym = symbol.trim().toUpperCase();
  if (!sym) return empty;

  const slopePack = await fetchSlopePack(sym, atMs);
  if (!slopePack) return empty;

  const entryEma20_15m = computeEntryEma20_15mFromPackAt(slopePack, atMs);
  const ema20_15mSlopePct7d = computeEma20_15mSlopePctFromPackAt(
    slopePack,
    STATS_EMA15M_SLOPE_LOOKBACK_BARS,
    atMs,
  );
  const close = closeAtLastClosedBar(slopePack, atMs);
  const priceVsEma20_15mPct =
    close != null && entryEma20_15m != null ? priceVsEmaDistPct(close, entryEma20_15m) : null;

  return { ema20_15mSlopePct7d, priceVsEma20_15mPct, entryEma20_15m };
}

/** EMA20@15m slope + mark diff + touch ภายใน 8 ชม. ณ alertedAtMs */
export async function fetchStatsEma20_15mEntryAtMs(
  symbol: string,
  alertedAtMs: number,
  nowMs: number = Date.now(),
): Promise<StatsEma20_15mEntrySnapshot> {
  if (!isBinanceIndicatorFapiEnabled()) return emptySnapshot();
  if (!Number.isFinite(alertedAtMs) || alertedAtMs <= 0) return emptySnapshot();

  const sym = symbol.trim().toUpperCase();
  if (!sym) return emptySnapshot();

  const [slopePack, touchPack] = await Promise.all([
    fetchSlopePack(sym, alertedAtMs),
    fetchTouchPack(sym, alertedAtMs, nowMs),
  ]);

  if (!slopePack) return emptySnapshot();

  const entryEma20_15m = computeEntryEma20_15mFromPackAt(slopePack, alertedAtMs);
  const ema20_15mSlopePct7d = computeEma20_15mSlopePctFromPackAt(
    slopePack,
    STATS_EMA15M_SLOPE_LOOKBACK_BARS,
    alertedAtMs,
  );

  const mark = await fetchMarkAtAlert(sym, alertedAtMs, slopePack);
  const priceVsEma20_15mPct =
    mark != null && entryEma20_15m != null ? priceVsEmaDistPct(mark, entryEma20_15m) : null;

  if (entryEma20_15m == null || mark == null || !touchPack) {
    return {
      ema20_15mSlopePct7d,
      priceVsEma20_15mPct,
      entryEma20_15m,
      entryEma20_15mTouchedWithin8h: null,
      entryEma20_15mTouchedAtMs: null,
    };
  }

  const touch = detectEma20_15mTouch(entryEma20_15m, mark, alertedAtMs, nowMs, touchPack);
  return {
    ema20_15mSlopePct7d,
    priceVsEma20_15mPct,
    entryEma20_15m,
    entryEma20_15mTouchedWithin8h: touch.touched,
    entryEma20_15mTouchedAtMs: touch.touchedAtMs,
  };
}

export type StatsRowWithEma20_15mEntry = {
  symbol: string;
  signalBarTf?: string;
  tradeSide?: string;
  alertedAtMs: number;
  ema20_15mSlopePct7d?: number | null;
  priceVsEma20_15mPct?: number | null;
  entryEma20_15m?: number | null;
  entryEma20_15mTouchedWithin8h?: boolean | null;
  entryEma20_15mTouchedAtMs?: number | null;
  entryEma20_15mV?: number;
};

function is1hShortRow(row: StatsRowWithEma20_15mEntry): boolean {
  return row.signalBarTf === "1h" && row.tradeSide === "short";
}

function finite(v: number | null | undefined): boolean {
  return v != null && Number.isFinite(v);
}

export function statsEma20_15mEntryMetricsComplete(row: StatsRowWithEma20_15mEntry): boolean {
  return (
    finite(row.ema20_15mSlopePct7d) &&
    finite(row.priceVsEma20_15mPct) &&
    finite(row.entryEma20_15m)
  );
}

export function statsRowNeedsEma20_15mEntryBackfill(row: StatsRowWithEma20_15mEntry): boolean {
  if (!is1hShortRow(row)) return false;
  if (row.entryEma20_15mV !== STATS_EMA20_15M_ENTRY_VERSION) return true;
  if (!finite(row.ema20_15mSlopePct7d) || !finite(row.priceVsEma20_15mPct) || !finite(row.entryEma20_15m)) {
    return true;
  }
  const windowEndMs = row.alertedAtMs + REVERSAL_LIMIT_EXPIRE_MS;
  if (row.entryEma20_15mTouchedWithin8h === null && Date.now() >= windowEndMs) return true;
  if (
    row.entryEma20_15mTouchedWithin8h === null &&
    Date.now() < windowEndMs &&
    finite(row.entryEma20_15m)
  ) {
    return true;
  }
  return false;
}

export function mergeStatsEma20_15mEntryIntoRow<T extends StatsRowWithEma20_15mEntry>(
  row: T,
  snap: StatsEma20_15mEntrySnapshot,
): void {
  if (finite(snap.ema20_15mSlopePct7d)) row.ema20_15mSlopePct7d = snap.ema20_15mSlopePct7d;
  if (finite(snap.priceVsEma20_15mPct)) row.priceVsEma20_15mPct = snap.priceVsEma20_15mPct;
  if (finite(snap.entryEma20_15m)) row.entryEma20_15m = snap.entryEma20_15m;
  if (snap.entryEma20_15mTouchedWithin8h !== undefined) {
    row.entryEma20_15mTouchedWithin8h = snap.entryEma20_15mTouchedWithin8h;
  }
  if (snap.entryEma20_15mTouchedAtMs != null && Number.isFinite(snap.entryEma20_15mTouchedAtMs)) {
    row.entryEma20_15mTouchedAtMs = snap.entryEma20_15mTouchedAtMs;
  } else if (snap.entryEma20_15mTouchedWithin8h === false) {
    delete row.entryEma20_15mTouchedAtMs;
  }
  if (statsEma20_15mEntryMetricsComplete(row)) {
    row.entryEma20_15mV = STATS_EMA20_15M_ENTRY_VERSION;
  }
}

export async function backfillStatsRowsEma20_15mEntry<T extends StatsRowWithEma20_15mEntry>(
  rows: T[],
  opts?: { maxRows?: number; nowMs?: number },
): Promise<number> {
  const maxRows = opts?.maxRows;
  const nowMs = opts?.nowMs ?? Date.now();
  let updated = 0;
  const candidates = rows
    .filter(
      (row) =>
        statsRowNeedsEma20_15mEntryBackfill(row) &&
        Number.isFinite(row.alertedAtMs) &&
        row.alertedAtMs > 0,
    )
    .sort((a, b) => b.alertedAtMs - a.alertedAtMs);

  for (const row of candidates) {
    if (maxRows != null && updated >= maxRows) break;
    try {
      const snap = await fetchStatsEma20_15mEntryAtMs(row.symbol, row.alertedAtMs, nowMs);
      mergeStatsEma20_15mEntryIntoRow(row, snap);
      updated += 1;
    } catch (e) {
      console.error("[statsEma20_15mEntry] backfill", row.symbol, row.alertedAtMs, e);
    }
  }
  return updated;
}

export async function backfillAllStatsRowsEma20_15mEntry<T extends StatsRowWithEma20_15mEntry>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number; nowMs?: number },
): Promise<number> {
  const maxPasses = opts?.maxPasses ?? 15;
  const maxRowsPerPass = opts?.maxRowsPerPass ?? 30;
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const n = await backfillStatsRowsEma20_15mEntry(rows, {
      maxRows: maxRowsPerPass,
      nowMs: opts?.nowMs,
    });
    total += n;
    if (n === 0) break;
  }
  return total;
}
