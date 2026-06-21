/**
 * บริบทตลาดตอนแจ้ง Snowball stats — BTC PSAR 4h + 1h + quote vol 24h ของคู่สัญญาณ
 */

import { fetchCoinGeckoMarketCapUsd } from "./coinGeckoMarketCap";
import { resolveMexcContractFromBinanceSymbolAsync } from "./mexcContractResolver";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
} from "./binanceIndicatorKline";
import { computeParabolicSarLast } from "./indicatorMath";
import { fetchContractTickerSingle } from "./mexcMarkets";
import { fetchSymbolAtrPct14d } from "./statsAtrPct14d";
import { fetchStatsQuoteVol24hUsdt } from "./statsQuoteVol24h";
import {
  fetchBtcEmaSlopesAtMs,
  fetchSymbolEmaSlopesAtMs,
  fetchSymbolEmaSlopePctTf,
  resetBtcEmaSlopesCache,
  STATS_EMA1D_SLOPE_LOOKBACK_BARS,
  STATS_EMA4H_SLOPE_LOOKBACK_BARS,
} from "./statsEmaSlope";
import { fetchStatsEma20MetricsAtMs, resetBtcEma20_4hDistCache } from "./statsEma20Dist";
import { fetchSymbolPsar4hAtMs } from "./statsPsar4h";

const BTC_SYMBOL = "BTCUSDT";

export type BtcPsarSnapshot = {
  trend: "up" | "down";
  sar: number;
  close: number;
  priceVsSar: "above" | "below";
  flipped: boolean;
};

/** @deprecated ใช้ BtcPsarSnapshot */
export type BtcPsar4hSnapshot = BtcPsarSnapshot;

export type SnowballAlertMarketContext = {
  btcPsar4hTrend: "up" | "down" | null;
  btcPsar4hClose: number | null;
  btcPsar1hTrend: "up" | "down" | null;
  btcPsar1hClose: number | null;
  quoteVol24hUsdt: number | null;
  /** Market cap USD (CoinGecko) ณ เวลาแจ้ง */
  marketCapUsd: number | null;
  /** Funding rate สัญญา MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม เช่น 0.0001 = 0.01%) */
  fundingRate: number | null;
  /** Wilder ATR(14) บน 1d ÷ close × 100 */
  atrPct14d: number | null;
  /** EMA(12) 1h ของคู่สัญญาณ — slope % ย้อนหลัง 7 วัน (168 แท่ง) */
  ema1hSlopePct7d: number | null;
  /** EMA(12) 4h ของคู่สัญญาณ — slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  ema4hSlopePct7d: number | null;
  /** EMA(12) 1d ของคู่สัญญาณ — slope % ย้อนหลัง 7 แท่ง */
  ema1dSlopePct7d: number | null;
  /** BTC — EMA(12) 4h slope % ย้อนหลัง 7 วัน */
  btcEma4hSlopePct7d: number | null;
  /** BTC — EMA(12) 1d slope % ย้อนหลัง 7 แท่ง */
  btcEma1dSlopePct7d: number | null;
  /** (close − EMA20) / EMA20 × 100 บน 1h ของคู่สัญญาณ */
  priceVsEma20_1hPct: number | null;
  /** EMA20 1h — slope % ย้อนหลัง 7 วัน (168 แท่ง) */
  ema20_1hSlopePct7d: number | null;
  /** (close − EMA20) / EMA20 × 100 บน 4h ของคู่สัญญาณ */
  priceVsEma20_4hPct: number | null;
  /** EMA20 4h — slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  ema20_4hSlopePct7d: number | null;
  /** BTC — EMA20 4h slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  btcEma20_4hSlopePct7d: number | null;
  /** PSAR 4h ของคู่สัญญาณ — ทิศ SAR */
  psar4hTrend: "up" | "down" | null;
  /** PSAR 4h — (close − SAR) / close × 100 */
  psar4hDistPct: number | null;
};

function snowballBtcPsarBars(tf: "4h" | "1h"): number {
  const raw =
    tf === "4h"
      ? process.env.SNOWBALL_STATS_BTC_PSAR_4H_BARS?.trim()
      : process.env.SNOWBALL_STATS_BTC_PSAR_1H_BARS?.trim();
  const v = Number(raw);
  if (Number.isFinite(v) && v >= 20 && v <= 200) return Math.floor(v);
  return tf === "4h" ? 60 : 120;
}

let btcPsar4hCache: { atMs: number; snap: BtcPsarSnapshot | null } | null = null;
let btcPsar1hCache: { atMs: number; snap: BtcPsarSnapshot | null } | null = null;
const mcapCache = new Map<string, { atMs: number; mcap: number | null }>();
const BTC_PSAR_CACHE_MS = 5 * 60 * 1000;
const MCAP_CACHE_MS = 15 * 60 * 1000;

function binanceUsdtPerpBase(binanceSymbol: string): string | null {
  const sym = binanceSymbol.trim().toUpperCase();
  if (!sym.endsWith("USDT") || sym.length < 5) return null;
  return sym.slice(0, -4);
}

async function fetchMarketCapUsdCached(base: string): Promise<number | null> {
  const key = base.trim().toUpperCase();
  if (!key) return null;
  const now = Date.now();
  const hit = mcapCache.get(key);
  if (hit && now - hit.atMs < MCAP_CACHE_MS) return hit.mcap;
  const mcap = await fetchCoinGeckoMarketCapUsd(key);
  mcapCache.set(key, { atMs: now, mcap });
  return mcap;
}

/** ล้าง cache BTC PSAR — เรียกต้นรอบสแกน Snowball */
export function resetSnowballBtcPsarCache(): void {
  btcPsar4hCache = null;
  btcPsar1hCache = null;
  mcapCache.clear();
  resetBtcEmaSlopesCache();
  resetBtcEma20_4hDistCache();
}

/** @deprecated ใช้ resetSnowballBtcPsarCache */
export function resetSnowballBtcPsar4hCache(): void {
  resetSnowballBtcPsarCache();
}

async function fetchBtcPsarSnapshot(tf: "4h" | "1h"): Promise<BtcPsarSnapshot | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const bars = snowballBtcPsarBars(tf);
  const pack = await fetchBinanceUsdmKlines(BTC_SYMBOL, tf, bars);
  if (!pack || pack.high.length < 5) return null;

  const n = pack.close.length;
  const iClosed = n - 2;
  if (iClosed < 0) return null;

  const psar = computeParabolicSarLast(pack.high, pack.low);
  const close = pack.close[iClosed]!;
  if (!psar || !Number.isFinite(close) || close <= 0) return null;

  return {
    trend: psar.trend,
    sar: psar.sar,
    close,
    priceVsSar: close > psar.sar ? "above" : "below",
    flipped: psar.flipped,
  };
}

export async function fetchBtcPsar4hSnapshot(): Promise<BtcPsarSnapshot | null> {
  const now = Date.now();
  if (btcPsar4hCache && now - btcPsar4hCache.atMs < BTC_PSAR_CACHE_MS) {
    return btcPsar4hCache.snap;
  }
  const snap = await fetchBtcPsarSnapshot("4h");
  btcPsar4hCache = { atMs: now, snap };
  return snap;
}

export async function fetchBtcPsar1hSnapshot(): Promise<BtcPsarSnapshot | null> {
  const now = Date.now();
  if (btcPsar1hCache && now - btcPsar1hCache.atMs < BTC_PSAR_CACHE_MS) {
    return btcPsar1hCache.snap;
  }
  const snap = await fetchBtcPsarSnapshot("1h");
  btcPsar1hCache = { atMs: now, snap };
  return snap;
}

async function fetchBtcPsarSnapshotAt(tf: "4h" | "1h", atMs: number): Promise<BtcPsarSnapshot | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const bars = snowballBtcPsarBars(tf);
  const barDurSec = tf === "4h" ? 4 * 3600 : 3600;
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - bars * barDurSec) * 1000;
  const pack = await fetchBinanceUsdmKlinesRange(BTC_SYMBOL, tf, {
    startTimeMs: startMs,
    endTimeMs: atMs,
    limit: Math.min(1500, bars + 20),
  });
  if (!pack || pack.high.length < 5) return null;

  let iClosed = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    if (pack.timeSec[i]! + barDurSec <= atSec) iClosed = i;
  }
  if (iClosed < 0) return null;

  const high = pack.high.slice(0, iClosed + 1);
  const low = pack.low.slice(0, iClosed + 1);
  const psar = computeParabolicSarLast(high, low);
  const close = pack.close[iClosed]!;
  if (!psar || !Number.isFinite(close) || close <= 0) return null;

  return {
    trend: psar.trend,
    sar: psar.sar,
    close,
    priceVsSar: close > psar.sar ? "above" : "below",
    flipped: psar.flipped,
  };
}

/** บริบทตลาด ณ เวลา atMs — ใช้ backtest / replay (BTC PSAR + EMA slope ย้อนหลัง) */
export async function fetchSnowballAlertMarketContextAt(
  binanceSymbol: string,
  atMs: number,
): Promise<SnowballAlertMarketContext> {
  const sym = binanceSymbol.trim().toUpperCase();
  const mexcContract = await resolveMexcContractFromBinanceSymbolAsync(sym);
  const base = binanceUsdtPerpBase(sym);
  const [btc4h, btc1h, symbolEma, marketCapUsd, mexcTicker, atrPct14d, btcEma, psar4h, ema20Dist] =
    await Promise.all([
      fetchBtcPsarSnapshotAt("4h", atMs),
      fetchBtcPsarSnapshotAt("1h", atMs),
      fetchSymbolEmaSlopesAtMs(sym, atMs),
      base ? fetchMarketCapUsdCached(base) : Promise.resolve(null),
      mexcContract ? fetchContractTickerSingle(mexcContract) : Promise.resolve(null),
      fetchSymbolAtrPct14d(sym),
      fetchBtcEmaSlopesAtMs(atMs),
      fetchSymbolPsar4hAtMs(sym, atMs),
      fetchStatsEma20MetricsAtMs(sym, atMs),
    ]);
  const quoteVol24hUsdt = await fetchStatsQuoteVol24hUsdt(sym, mexcTicker);
  const fr = mexcTicker?.fundingRate;
  const fundingRate = typeof fr === "number" && Number.isFinite(fr) ? fr : null;
  return {
    btcPsar4hTrend: btc4h?.trend ?? null,
    btcPsar4hClose: btc4h?.close ?? null,
    btcPsar1hTrend: btc1h?.trend ?? null,
    btcPsar1hClose: btc1h?.close ?? null,
    quoteVol24hUsdt,
    marketCapUsd,
    fundingRate,
    atrPct14d,
    ema1hSlopePct7d: symbolEma.ema1hSlopePct7d,
    ema4hSlopePct7d: symbolEma.ema4hSlopePct7d,
    ema1dSlopePct7d: symbolEma.ema1dSlopePct7d,
    btcEma4hSlopePct7d: btcEma.btcEma4hSlopePct7d,
    btcEma1dSlopePct7d: btcEma.btcEma1dSlopePct7d,
    priceVsEma20_1hPct: ema20Dist.priceVsEma20_1hPct,
    ema20_1hSlopePct7d: ema20Dist.ema20_1hSlopePct7d,
    priceVsEma20_4hPct: ema20Dist.priceVsEma20_4hPct,
    ema20_4hSlopePct7d: ema20Dist.ema20_4hSlopePct7d,
    btcEma20_4hSlopePct7d: ema20Dist.btcEma20_4hSlopePct7d,
    psar4hTrend: psar4h?.trend ?? null,
    psar4hDistPct: psar4h?.distPct ?? null,
  };
}

/** BTC PSAR 4h + 1h + vol 24h (Binance) + mcap (CoinGecko) + funding (MEXC) */
export async function fetchSnowballAlertMarketContext(
  binanceSymbol: string,
  atMs: number = Date.now(),
): Promise<SnowballAlertMarketContext> {
  return fetchSnowballAlertMarketContextAt(binanceSymbol, atMs);
}
