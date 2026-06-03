/**
 * บริบทตลาดตอนบันทึก Reversal stats — quote vol 24h (Binance) + market cap (CoinGecko)
 */

import { fetchCoinGeckoMarketCapUsd } from "./coinGeckoMarketCap";
import { fetchBinanceUsdmQuoteVol24h, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";
import { fetchSymbolAtrPct14d } from "./statsAtrPct14d";
import {
  fetchSymbolEmaSlopePctTf,
  STATS_EMA1D_SLOPE_LOOKBACK_BARS,
  STATS_EMA4H_SLOPE_LOOKBACK_BARS,
} from "./statsEmaSlope";

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
  /** EMA(12) 4h — slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  ema4hSlopePct7d: number | null;
  /** EMA(12) 1d — slope % ย้อนหลัง 7 แท่ง */
  ema1dSlopePct7d: number | null;
  /** Wilder ATR(14) บน 1d ÷ close × 100 */
  atrPct14d: number | null;
};

/** Vol 24h + Mcap + EMA slope 4h/1d ณ เวลาแจ้ง */
export async function fetchReversalAlertMarketSnapshot(
  binanceSymbol: string,
): Promise<ReversalAlertMarketSnapshot> {
  const sym = binanceSymbol.trim().toUpperCase();
  const base = binanceUsdtPerpBase(sym);
  const [quoteVol24hUsdt, marketCapUsd, ema4hSlopePct7d, ema1dSlopePct7d, atrPct14d] = await Promise.all([
    isBinanceIndicatorFapiEnabled() ? fetchBinanceUsdmQuoteVol24h(sym) : Promise.resolve(null),
    base ? fetchMarketCapUsdCached(base) : Promise.resolve(null),
    fetchSymbolEmaSlopePctTf(sym, "4h", STATS_EMA4H_SLOPE_LOOKBACK_BARS),
    fetchSymbolEmaSlopePctTf(sym, "1d", STATS_EMA1D_SLOPE_LOOKBACK_BARS),
    fetchSymbolAtrPct14d(sym),
  ]);
  return { quoteVol24hUsdt, marketCapUsd, ema4hSlopePct7d, ema1dSlopePct7d, atrPct14d };
}
