/**
 * บริบทตลาดตอนบันทึก Reversal stats — quote vol 24h (Binance) + market cap (CoinGecko)
 */

import { fetchCoinGeckoMarketCapUsd } from "./coinGeckoMarketCap";
import { computeEmaLast } from "./emaUtils";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmQuoteVol24h,
  isBinanceIndicatorFapiEnabled,
} from "./binanceIndicatorKline";
import { fetchSymbolAtrPct14d } from "./statsAtrPct14d";

/** EMA6/12 + ราคาปิดแท่งล่าสุด — uptrend / downtrend (สอดคล้อง position checklist) */
export type ReversalEmaTrend = "up" | "down";

const EMA_FAST_PERIOD = 6;
const EMA_SLOW_PERIOD = 12;
const EMA_TREND_KLINE_BARS = 48;

const mcapCache = new Map<string, { atMs: number; mcap: number | null }>();
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

export type ReversalAlertMarketSnapshot = {
  quoteVol24hUsdt: number | null;
  marketCapUsd: number | null;
  ema4hTrend: ReversalEmaTrend | null;
  ema1dTrend: ReversalEmaTrend | null;
  /** Wilder ATR(14) บน 1d ÷ close × 100 */
  atrPct14d: number | null;
};

/** ปิดแท่งล่าสุด vs EMA6/12 — up = ราคา>EMA12 และ EMA6>EMA12 · down = ราคา<EMA12 และ EMA6<EMA12 */
export function resolveReversalEma612Trend(
  close: number,
  ema6: number | null,
  ema12: number | null,
): ReversalEmaTrend | null {
  if (
    ema6 == null ||
    ema12 == null ||
    !Number.isFinite(close) ||
    close <= 0 ||
    !Number.isFinite(ema6) ||
    !Number.isFinite(ema12)
  ) {
    return null;
  }
  if (close > ema12 && ema6 > ema12) return "up";
  if (close < ema12 && ema6 < ema12) return "down";
  return null;
}

async function fetchSymbolEmaTrendTf(
  symbol: string,
  tf: "4h" | "1d",
): Promise<ReversalEmaTrend | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const pack = await fetchBinanceUsdmKlines(symbol, tf, EMA_TREND_KLINE_BARS);
  if (!pack || pack.close.length < EMA_SLOW_PERIOD + 2) return null;
  const iClosed = pack.close.length - 2;
  const closes = pack.close.slice(0, iClosed + 1);
  const close = closes[closes.length - 1]!;
  const ema6 = computeEmaLast(closes, EMA_FAST_PERIOD);
  const ema12 = computeEmaLast(closes, EMA_SLOW_PERIOD);
  return resolveReversalEma612Trend(close, ema6, ema12);
}

/** Vol 24h + Mcap + EMA 4h/1d trend ณ เวลาแจ้ง */
export async function fetchReversalAlertMarketSnapshot(
  binanceSymbol: string,
): Promise<ReversalAlertMarketSnapshot> {
  const sym = binanceSymbol.trim().toUpperCase();
  const base = binanceUsdtPerpBase(sym);
  const [quoteVol24hUsdt, marketCapUsd, ema4hTrend, ema1dTrend, atrPct14d] = await Promise.all([
    isBinanceIndicatorFapiEnabled() ? fetchBinanceUsdmQuoteVol24h(sym) : Promise.resolve(null),
    base ? fetchMarketCapUsdCached(base) : Promise.resolve(null),
    fetchSymbolEmaTrendTf(sym, "4h"),
    fetchSymbolEmaTrendTf(sym, "1d"),
    fetchSymbolAtrPct14d(sym),
  ]);
  return { quoteVol24hUsdt, marketCapUsd, ema4hTrend, ema1dTrend, atrPct14d };
}
