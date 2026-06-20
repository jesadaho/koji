import { emaLine } from "./indicatorMath";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  computeEmaSlopePctFromPackAt,
  STATS_EMA1H_SLOPE_LOOKBACK_BARS,
  STATS_EMA4H_SLOPE_LOOKBACK_BARS,
  statsEmaSlopeMinKlineBars,
} from "./statsEmaSlope";

export const STATS_EMA20_DIST_PERIOD = 20;

/** แถวที่คำนวณ EMA20 metrics ณ alertedAtMs แล้ว — v2 = รวม slope */
export const STATS_EMA20_DIST_VERSION = 2;

const BTC_USDT = "BTCUSDT";
const LIVE_ALERT_MAX_AGE_MS = 10 * 60_000;
const BTC_EMA20_4H_SLOPE_CACHE_MS = 5 * 60 * 1000;

function tfBarDurSec(tf: "1h" | "4h"): number {
  return tf === "1h" ? 3600 : 4 * 3600;
}

function statsEma20DistMinKlineBars(): number {
  return STATS_EMA20_DIST_PERIOD + 8;
}

function lastClosedBarIndexAt(pack: BinanceKlinePack, barDurSec: number, atSec: number): number {
  let iClosed = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    if (pack.timeSec[i]! + barDurSec <= atSec) iClosed = i;
  }
  return iClosed;
}

/** % ระยะปิดจาก EMA — บวก = เหนือเส้น · ลบ = ใต้เส้น */
export function priceVsEmaDistPct(close: number, ema: number): number | null {
  if (!Number.isFinite(close) || !Number.isFinite(ema) || ema <= 0) return null;
  return ((close - ema) / ema) * 100;
}

export function computePriceVsEma20FromPackAt(
  pack: BinanceKlinePack,
  tf: "1h" | "4h",
  atMs: number,
  period = STATS_EMA20_DIST_PERIOD,
): number | null {
  if (!pack.close.length || pack.close.length < period + 2) return null;
  const barDur = tfBarDurSec(tf);
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, barDur, atSec);
  if (iClosed < period - 1) return null;
  const emaArr = emaLine(pack.close, period);
  const ema = emaArr[iClosed];
  const close = pack.close[iClosed];
  if (typeof ema !== "number" || typeof close !== "number") return null;
  return priceVsEmaDistPct(close, ema);
}

async function fetchKlinePackThrough(
  symbol: string,
  tf: "1h" | "4h",
  atMs: number,
  lookbackBars: number,
): Promise<BinanceKlinePack | null> {
  const barDur = tfBarDurSec(tf);
  const minBars = Math.max(statsEma20DistMinKlineBars(), statsEmaSlopeMinKlineBars(lookbackBars));
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - minBars * barDur) * 1000;
  return fetchBinanceUsdmKlinesRange(symbol.trim().toUpperCase(), tf, {
    startTimeMs: startMs,
    endTimeMs: atMs,
    limit: Math.min(1500, minBars + 20),
  });
}

export type StatsEma20MetricsSnapshot = {
  ema20_1hSlopePct7d: number | null;
  priceVsEma20_1hPct: number | null;
  btcEma20_4hSlopePct7d: number | null;
};

async function fetchSymbolEma20_1hMetricsAtMs(
  symbol: string,
  atMs: number,
): Promise<{ ema20_1hSlopePct7d: number | null; priceVsEma20_1hPct: number | null }> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return { ema20_1hSlopePct7d: null, priceVsEma20_1hPct: null };
  }
  const sym = symbol.trim().toUpperCase();
  if (!sym) return { ema20_1hSlopePct7d: null, priceVsEma20_1hPct: null };

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const limit = statsEmaSlopeMinKlineBars(STATS_EMA1H_SLOPE_LOOKBACK_BARS);
    const pack = await fetchBinanceUsdmKlines(sym, "1h", limit);
    if (!pack) return { ema20_1hSlopePct7d: null, priceVsEma20_1hPct: null };
    const now = Date.now();
    return {
      ema20_1hSlopePct7d: computeEmaSlopePctFromPackAt(
        pack,
        "1h",
        STATS_EMA1H_SLOPE_LOOKBACK_BARS,
        now,
        STATS_EMA20_DIST_PERIOD,
      ),
      priceVsEma20_1hPct: computePriceVsEma20FromPackAt(pack, "1h", now),
    };
  }

  const pack = await fetchKlinePackThrough(sym, "1h", atMs, STATS_EMA1H_SLOPE_LOOKBACK_BARS);
  if (!pack) return { ema20_1hSlopePct7d: null, priceVsEma20_1hPct: null };
  return {
    ema20_1hSlopePct7d: computeEmaSlopePctFromPackAt(
      pack,
      "1h",
      STATS_EMA1H_SLOPE_LOOKBACK_BARS,
      atMs,
      STATS_EMA20_DIST_PERIOD,
    ),
    priceVsEma20_1hPct: computePriceVsEma20FromPackAt(pack, "1h", atMs),
  };
}

let btcEma20_4hSlopeCache: { atMs: number; slope: number | null } | null = null;

export function resetBtcEma20_4hDistCache(): void {
  btcEma20_4hSlopeCache = null;
}

async function fetchBtcEma20_4hSlopeAtMs(atMs: number): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  if (!Number.isFinite(atMs) || atMs <= 0) return null;

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const now = Date.now();
    if (btcEma20_4hSlopeCache && now - btcEma20_4hSlopeCache.atMs < BTC_EMA20_4H_SLOPE_CACHE_MS) {
      return btcEma20_4hSlopeCache.slope;
    }
    const limit = statsEmaSlopeMinKlineBars(STATS_EMA4H_SLOPE_LOOKBACK_BARS);
    const pack = await fetchBinanceUsdmKlines(BTC_USDT, "4h", limit);
    const slope = pack
      ? computeEmaSlopePctFromPackAt(
          pack,
          "4h",
          STATS_EMA4H_SLOPE_LOOKBACK_BARS,
          now,
          STATS_EMA20_DIST_PERIOD,
        )
      : null;
    btcEma20_4hSlopeCache = { atMs: now, slope };
    return slope;
  }

  const pack = await fetchKlinePackThrough(BTC_USDT, "4h", atMs, STATS_EMA4H_SLOPE_LOOKBACK_BARS);
  return pack
    ? computeEmaSlopePctFromPackAt(
        pack,
        "4h",
        STATS_EMA4H_SLOPE_LOOKBACK_BARS,
        atMs,
        STATS_EMA20_DIST_PERIOD,
      )
    : null;
}

/** Symbol EMA20 1h slope+dist + BTC EMA20 4h slope ณ alertedAtMs */
export async function fetchStatsEma20MetricsAtMs(
  symbol: string,
  atMs: number,
): Promise<StatsEma20MetricsSnapshot> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return { ema20_1hSlopePct7d: null, priceVsEma20_1hPct: null, btcEma20_4hSlopePct7d: null };
  }
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return { ema20_1hSlopePct7d: null, priceVsEma20_1hPct: null, btcEma20_4hSlopePct7d: null };
  }
  const [symbol1h, btcEma20_4hSlopePct7d] = await Promise.all([
    fetchSymbolEma20_1hMetricsAtMs(symbol, atMs),
    fetchBtcEma20_4hSlopeAtMs(atMs),
  ]);
  return {
    ema20_1hSlopePct7d: symbol1h.ema20_1hSlopePct7d,
    priceVsEma20_1hPct: symbol1h.priceVsEma20_1hPct,
    btcEma20_4hSlopePct7d,
  };
}

/** @deprecated alias */
export const fetchStatsEma20DistAtMs = fetchStatsEma20MetricsAtMs;

export type StatsRowWithEma20Dist = {
  symbol: string;
  alertedAtMs: number;
  ema20_1hSlopePct7d?: number | null;
  priceVsEma20_1hPct?: number | null;
  btcEma20_4hSlopePct7d?: number | null;
  ema20DistV?: number;
};

export function statsRowNeedsEma20DistBackfill(row: StatsRowWithEma20Dist): boolean {
  return row.ema20DistV !== STATS_EMA20_DIST_VERSION;
}

export async function backfillStatsRowsEma20Dist<T extends StatsRowWithEma20Dist>(
  rows: T[],
  opts?: { maxRows?: number },
): Promise<number> {
  const maxRows = opts?.maxRows;
  let updated = 0;
  for (const row of rows) {
    if (maxRows != null && updated >= maxRows) break;
    if (!statsRowNeedsEma20DistBackfill(row)) continue;
    if (!Number.isFinite(row.alertedAtMs) || row.alertedAtMs <= 0) continue;
    try {
      const metrics = await fetchStatsEma20MetricsAtMs(row.symbol, row.alertedAtMs);
      row.ema20_1hSlopePct7d = metrics.ema20_1hSlopePct7d;
      row.priceVsEma20_1hPct = metrics.priceVsEma20_1hPct;
      row.btcEma20_4hSlopePct7d = metrics.btcEma20_4hSlopePct7d;
      row.ema20DistV = STATS_EMA20_DIST_VERSION;
      updated += 1;
    } catch (e) {
      console.error("[statsEma20Dist] backfill", row.symbol, row.alertedAtMs, e);
    }
  }
  return updated;
}

export async function backfillAllStatsRowsEma20Dist<T extends StatsRowWithEma20Dist>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxPasses = opts?.maxPasses ?? 10;
  const maxRowsPerPass = opts?.maxRowsPerPass ?? 40;
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const n = await backfillStatsRowsEma20Dist(rows, { maxRows: maxRowsPerPass });
    total += n;
    if (n === 0) break;
  }
  return total;
}
