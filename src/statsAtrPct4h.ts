import { atrWilderAt } from "./snowballVolatilityMetrics";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

export const STATS_ATR_PCT_4H_PERIOD = 14;
export const STATS_ATR_PCT_4H_VERSION = 1;

const ATR_4H_BAR_SEC = 4 * 3600;
const LIVE_ALERT_MAX_AGE_MS = 10 * 60_000;

function statsAtrPct4hKlineBars(): number {
  return STATS_ATR_PCT_4H_PERIOD + 18;
}

function lastClosedBarIndexAt(pack: BinanceKlinePack, atSec: number): number {
  let iClosed = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    if (pack.timeSec[i]! + ATR_4H_BAR_SEC <= atSec) iClosed = i;
  }
  return iClosed;
}

/** Wilder ATR(14) บน 4h ณ atMs ÷ close × 100 */
export function computeAtrPct4hFromPackAt(
  pack: BinanceKlinePack,
  atMs: number,
  period = STATS_ATR_PCT_4H_PERIOD,
): number | null {
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, atSec);
  if (iClosed < period) return null;
  const atr = atrWilderAt(pack.high, pack.low, pack.close, iClosed, period);
  const c = pack.close[iClosed]!;
  if (atr == null || !Number.isFinite(atr) || !Number.isFinite(c) || c <= 0 || atr < 0) {
    return null;
  }
  return (atr / c) * 100;
}

async function fetchSymbolKlinePackThrough4h(
  symbol: string,
  atMs: number,
): Promise<BinanceKlinePack | null> {
  const bars = statsAtrPct4hKlineBars();
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - bars * ATR_4H_BAR_SEC) * 1000;
  return fetchBinanceUsdmKlinesRange(symbol.trim().toUpperCase(), "4h", {
    startTimeMs: startMs,
    endTimeMs: atMs,
    limit: Math.min(1500, bars + 20),
  });
}

/** ATR% 4H ของคู่สัญญาณ ณ alertedAtMs */
export async function fetchSymbolAtrPct4hAtMs(
  symbol: string,
  atMs: number,
): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const sym = symbol.trim().toUpperCase();
  if (!sym || !Number.isFinite(atMs) || atMs <= 0) return null;

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const pack = await fetchBinanceUsdmKlines(sym, "4h", statsAtrPct4hKlineBars());
    if (!pack) return null;
    return computeAtrPct4hFromPackAt(pack, atMs);
  }

  const pack = await fetchSymbolKlinePackThrough4h(sym, atMs);
  if (!pack) return null;
  return computeAtrPct4hFromPackAt(pack, atMs);
}

export type StatsRowWithAtrPct4h = {
  symbol: string;
  alertedAtMs: number;
  atrPct4h?: number | null;
  atrPct4hV?: number;
};

export async function backfillAllStatsRowsAtrPct4h<T extends StatsRowWithAtrPct4h>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  if (!isBinanceIndicatorFapiEnabled()) return 0;
  const maxRows = Math.max(1, opts?.maxRowsPerPass ?? 25);
  const maxPasses = Math.max(1, opts?.maxPasses ?? 8);
  let dirty = 0;
  let passes = 0;

  while (passes < maxPasses) {
    passes += 1;
    let passDirty = 0;
    for (const row of rows) {
      if (passDirty >= maxRows) break;
      const v = row.atrPct4hV ?? 0;
      const needs =
        v !== STATS_ATR_PCT_4H_VERSION ||
        row.atrPct4h == null ||
        !Number.isFinite(row.atrPct4h) ||
        row.atrPct4h <= 0;
      if (!needs) continue;
      try {
        const atrPct4h = await fetchSymbolAtrPct4hAtMs(row.symbol, row.alertedAtMs);
        if (atrPct4h == null || !Number.isFinite(atrPct4h) || atrPct4h <= 0) continue;
        row.atrPct4h = atrPct4h;
        row.atrPct4hV = STATS_ATR_PCT_4H_VERSION;
        passDirty += 1;
        dirty += 1;
      } catch (e) {
        console.error("[statsAtrPct4h] backfill", row.symbol, e);
      }
    }
    if (passDirty === 0) break;
  }

  return dirty;
}
