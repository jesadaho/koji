/**
 * บริบทตลาดตอนบันทึก Reversal stats — quote vol 24h (Binance) + market cap (CoinGecko)
 */

import { fetchCoinGeckoMarketCapUsd } from "./coinGeckoMarketCap";
import { fetchBinanceUsdmQuoteVol24h, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";

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
};

/** Vol 24h USDT (Binance perp) + Mcap USD (CoinGecko) ณ เวลาแจ้ง */
export async function fetchReversalAlertMarketSnapshot(
  binanceSymbol: string,
): Promise<ReversalAlertMarketSnapshot> {
  const sym = binanceSymbol.trim().toUpperCase();
  const base = binanceUsdtPerpBase(sym);
  const [quoteVol24hUsdt, marketCapUsd] = await Promise.all([
    isBinanceIndicatorFapiEnabled() ? fetchBinanceUsdmQuoteVol24h(sym) : Promise.resolve(null),
    base ? fetchMarketCapUsdCached(base) : Promise.resolve(null),
  ]);
  return { quoteVol24hUsdt, marketCapUsd };
}
