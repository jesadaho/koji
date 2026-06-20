import { emaLine } from "./indicatorMath";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

export const STATS_EMA20_DIST_PERIOD = 20;

/** แถวที่คำนวณ price vs EMA20 ณ alertedAtMs แล้ว */
export const STATS_EMA20_DIST_VERSION = 1;

const BTC_USDT = "BTCUSDT";
const LIVE_ALERT_MAX_AGE_MS = 10 * 60_000;
const BTC_EMA20_4H_DIST_CACHE_MS = 5 * 60 * 1000;

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
): Promise<BinanceKlinePack | null> {
  const barDur = tfBarDurSec(tf);
  const minBars = statsEma20DistMinKlineBars();
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - minBars * barDur) * 1000;
  return fetchBinanceUsdmKlinesRange(symbol.trim().toUpperCase(), tf, {
    startTimeMs: startMs,
    endTimeMs: atMs,
    limit: Math.min(1500, minBars + 20),
  });
}

export type StatsEma20DistSnapshot = {
  priceVsEma20_1hPct: number | null;
  btcPriceVsEma20_4hPct: number | null;
};

async function fetchSymbolPriceVsEma20_1hAtMs(symbol: string, atMs: number): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const pack = await fetchBinanceUsdmKlines(sym, "1h", statsEma20DistMinKlineBars());
    if (!pack) return null;
    return computePriceVsEma20FromPackAt(pack, "1h", Date.now());
  }

  const pack = await fetchKlinePackThrough(sym, "1h", atMs);
  return pack ? computePriceVsEma20FromPackAt(pack, "1h", atMs) : null;
}

let btcEma20_4hDistCache: { atMs: number; pct: number | null } | null = null;

export function resetBtcEma20_4hDistCache(): void {
  btcEma20_4hDistCache = null;
}

async function fetchBtcPriceVsEma20_4hAtMs(atMs: number): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  if (!Number.isFinite(atMs) || atMs <= 0) return null;

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const now = Date.now();
    if (btcEma20_4hDistCache && now - btcEma20_4hDistCache.atMs < BTC_EMA20_4H_DIST_CACHE_MS) {
      return btcEma20_4hDistCache.pct;
    }
    const pack = await fetchBinanceUsdmKlines(BTC_USDT, "4h", statsEma20DistMinKlineBars());
    const pct = pack ? computePriceVsEma20FromPackAt(pack, "4h", now) : null;
    btcEma20_4hDistCache = { atMs: now, pct };
    return pct;
  }

  const pack = await fetchKlinePackThrough(BTC_USDT, "4h", atMs);
  return pack ? computePriceVsEma20FromPackAt(pack, "4h", atMs) : null;
}

/** Symbol EMA20 1h dist + BTC EMA20 4h dist ณ alertedAtMs */
export async function fetchStatsEma20DistAtMs(
  symbol: string,
  atMs: number,
): Promise<StatsEma20DistSnapshot> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return { priceVsEma20_1hPct: null, btcPriceVsEma20_4hPct: null };
  }
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return { priceVsEma20_1hPct: null, btcPriceVsEma20_4hPct: null };
  }
  const [priceVsEma20_1hPct, btcPriceVsEma20_4hPct] = await Promise.all([
    fetchSymbolPriceVsEma20_1hAtMs(symbol, atMs),
    fetchBtcPriceVsEma20_4hAtMs(atMs),
  ]);
  return { priceVsEma20_1hPct, btcPriceVsEma20_4hPct };
}

export type StatsRowWithEma20Dist = {
  symbol: string;
  alertedAtMs: number;
  priceVsEma20_1hPct?: number | null;
  btcPriceVsEma20_4hPct?: number | null;
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
      const dist = await fetchStatsEma20DistAtMs(row.symbol, row.alertedAtMs);
      row.priceVsEma20_1hPct = dist.priceVsEma20_1hPct;
      row.btcPriceVsEma20_4hPct = dist.btcPriceVsEma20_4hPct;
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
