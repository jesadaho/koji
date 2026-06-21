import { computeEmaLast } from "./emaUtils";
import { emaLine } from "./indicatorMath";
import {
  fetchBinanceUsdmKlinesPaginated,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  STATS_EMA1H_SLOPE_LOOKBACK_BARS,
  STATS_EMA4H_SLOPE_LOOKBACK_BARS,
} from "./statsEmaSlope";

export const STATS_EMA20_DIST_PERIOD = 20;

/** แถวที่คำนวณ EMA20 metrics ณ alertedAtMs แล้ว — v6 = เพิ่ม symbol EMA20 4h */
export const STATS_EMA20_DIST_VERSION = 6;

const BTC_USDT = "BTCUSDT";

/** แท่งปิดล่าสุด + lookback + EMA20 warm-up */
export function statsEma20SlopeMinKlineBars(lookbackBars: number): number {
  return STATS_EMA20_DIST_PERIOD + lookbackBars + 8;
}

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

/** EMA20 slope % ณ atMs — slice ถึงแท่งปิดล่าสุด (สอดคล้อง EMA12 slope) */
export function computeEma20SlopePctFromPackAt(
  pack: BinanceKlinePack,
  tf: "1h" | "4h",
  lookbackBars: number,
  atMs: number,
  period = STATS_EMA20_DIST_PERIOD,
): number | null {
  if (!pack.close.length || pack.close.length < period) return null;
  const barDur = tfBarDurSec(tf);
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, barDur, atSec);
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
  if (!Number.isFinite(ema) || !Number.isFinite(close)) return null;
  return priceVsEmaDistPct(close, ema);
}

async function fetchKlinePackThrough(
  symbol: string,
  tf: "1h" | "4h",
  atMs: number,
  lookbackBars: number,
): Promise<BinanceKlinePack | null> {
  const barDur = tfBarDurSec(tf);
  const minBars = Math.max(statsEma20DistMinKlineBars(), statsEma20SlopeMinKlineBars(lookbackBars));
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - minBars * barDur) * 1000;
  return fetchBinanceUsdmKlinesPaginated(symbol.trim().toUpperCase(), tf, startMs, atMs);
}

export type StatsEma20MetricsSnapshot = {
  ema20_1hSlopePct7d: number | null;
  priceVsEma20_1hPct: number | null;
  ema20_4hSlopePct7d: number | null;
  priceVsEma20_4hPct: number | null;
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

  const pack = await fetchKlinePackThrough(sym, "1h", atMs, STATS_EMA1H_SLOPE_LOOKBACK_BARS);
  if (!pack) return { ema20_1hSlopePct7d: null, priceVsEma20_1hPct: null };
  return {
    ema20_1hSlopePct7d: computeEma20SlopePctFromPackAt(
      pack,
      "1h",
      STATS_EMA1H_SLOPE_LOOKBACK_BARS,
      atMs,
    ),
    priceVsEma20_1hPct: computePriceVsEma20FromPackAt(pack, "1h", atMs),
  };
}

async function fetchSymbolEma20_4hMetricsAtMs(
  symbol: string,
  atMs: number,
): Promise<{ ema20_4hSlopePct7d: number | null; priceVsEma20_4hPct: number | null }> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return { ema20_4hSlopePct7d: null, priceVsEma20_4hPct: null };
  }
  const sym = symbol.trim().toUpperCase();
  if (!sym) return { ema20_4hSlopePct7d: null, priceVsEma20_4hPct: null };

  const pack = await fetchKlinePackThrough(sym, "4h", atMs, STATS_EMA4H_SLOPE_LOOKBACK_BARS);
  if (!pack) return { ema20_4hSlopePct7d: null, priceVsEma20_4hPct: null };
  return {
    ema20_4hSlopePct7d: computeEma20SlopePctFromPackAt(
      pack,
      "4h",
      STATS_EMA4H_SLOPE_LOOKBACK_BARS,
      atMs,
    ),
    priceVsEma20_4hPct: computePriceVsEma20FromPackAt(pack, "4h", atMs),
  };
}

/** @deprecated — cache ถูกลบเมื่อเลิกใช้ live shortcut */
export function resetBtcEma20_4hDistCache(): void {}

async function fetchBtcEma20_4hSlopeAtMs(atMs: number): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  if (!Number.isFinite(atMs) || atMs <= 0) return null;

  const pack = await fetchKlinePackThrough(BTC_USDT, "4h", atMs, STATS_EMA4H_SLOPE_LOOKBACK_BARS);
  return pack
    ? computeEma20SlopePctFromPackAt(pack, "4h", STATS_EMA4H_SLOPE_LOOKBACK_BARS, atMs)
    : null;
}

/** Symbol EMA20 1h/4h slope+dist + BTC EMA20 4h slope ณ alertedAtMs */
export async function fetchStatsEma20MetricsAtMs(
  symbol: string,
  atMs: number,
): Promise<StatsEma20MetricsSnapshot> {
  const empty: StatsEma20MetricsSnapshot = {
    ema20_1hSlopePct7d: null,
    priceVsEma20_1hPct: null,
    ema20_4hSlopePct7d: null,
    priceVsEma20_4hPct: null,
    btcEma20_4hSlopePct7d: null,
  };
  if (!isBinanceIndicatorFapiEnabled()) return empty;
  if (!Number.isFinite(atMs) || atMs <= 0) return empty;
  const [symbol1h, symbol4h, btcEma20_4hSlopePct7d] = await Promise.all([
    fetchSymbolEma20_1hMetricsAtMs(symbol, atMs),
    fetchSymbolEma20_4hMetricsAtMs(symbol, atMs),
    fetchBtcEma20_4hSlopeAtMs(atMs),
  ]);
  return {
    ema20_1hSlopePct7d: symbol1h.ema20_1hSlopePct7d,
    priceVsEma20_1hPct: symbol1h.priceVsEma20_1hPct,
    ema20_4hSlopePct7d: symbol4h.ema20_4hSlopePct7d,
    priceVsEma20_4hPct: symbol4h.priceVsEma20_4hPct,
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
  ema20_4hSlopePct7d?: number | null;
  priceVsEma20_4hPct?: number | null;
  btcEma20_4hSlopePct7d?: number | null;
  ema20DistV?: number;
};

export function statsEma20MetricsComplete(row: StatsRowWithEma20Dist): boolean {
  const finite = (v: number | null | undefined) => v != null && Number.isFinite(v);
  return (
    finite(row.ema20_1hSlopePct7d) &&
    finite(row.ema20_4hSlopePct7d) &&
    finite(row.btcEma20_4hSlopePct7d)
  );
}

export function statsRowNeedsEma20DistBackfill(row: StatsRowWithEma20Dist): boolean {
  if (row.ema20DistV !== STATS_EMA20_DIST_VERSION) return true;
  const finite = (v: number | null | undefined) => v != null && Number.isFinite(v);
  if (finite(row.priceVsEma20_1hPct) && !finite(row.ema20_1hSlopePct7d)) return true;
  if (!finite(row.ema20_4hSlopePct7d)) return true;
  if (!finite(row.btcEma20_4hSlopePct7d)) return true;
  return false;
}

export async function backfillStatsRowsEma20Dist<T extends StatsRowWithEma20Dist>(
  rows: T[],
  opts?: { maxRows?: number },
): Promise<number> {
  const maxRows = opts?.maxRows;
  let updated = 0;
  const candidates = rows
    .filter(
      (row) =>
        statsRowNeedsEma20DistBackfill(row) &&
        Number.isFinite(row.alertedAtMs) &&
        row.alertedAtMs > 0,
    )
    .sort((a, b) => b.alertedAtMs - a.alertedAtMs);
  for (const row of candidates) {
    if (maxRows != null && updated >= maxRows) break;
    try {
      const metrics = await fetchStatsEma20MetricsAtMs(row.symbol, row.alertedAtMs);
      row.ema20_1hSlopePct7d = metrics.ema20_1hSlopePct7d;
      row.priceVsEma20_1hPct = metrics.priceVsEma20_1hPct;
      row.ema20_4hSlopePct7d = metrics.ema20_4hSlopePct7d;
      row.priceVsEma20_4hPct = metrics.priceVsEma20_4hPct;
      row.btcEma20_4hSlopePct7d = metrics.btcEma20_4hSlopePct7d;
      if (statsEma20MetricsComplete(row)) {
        row.ema20DistV = STATS_EMA20_DIST_VERSION;
      } else {
        delete row.ema20DistV;
      }
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
  const maxPasses = opts?.maxPasses ?? 20;
  const maxRowsPerPass = opts?.maxRowsPerPass ?? 60;
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const n = await backfillStatsRowsEma20Dist(rows, { maxRows: maxRowsPerPass });
    total += n;
    if (n === 0) break;
  }
  return total;
}
