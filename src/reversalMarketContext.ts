/**
 * บริบทตลาดตอนบันทึก Reversal stats — quote vol 24h (Binance) + market cap (CoinGecko)
 */

import { fetchCoinGeckoMarketCapUsd } from "./coinGeckoMarketCap";
import { fetchSymbolAtrPct14d } from "./statsAtrPct14d";
import { fetchStatsQuoteVol24hUsdt } from "./statsQuoteVol24h";
import { fetchStatsEma20MetricsAtMs } from "./statsEma20Dist";
import { fetchBtcEmaSlopesAtMs, fetchSymbolEmaSlopesAtMs } from "./statsEmaSlope";
import { fetchSymbolPsar4hAtMs } from "./statsPsar4h";

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
  /** EMA(12) 1h — slope % ย้อนหลัง 7 วัน (168 แท่ง) */
  ema1hSlopePct7d: number | null;
  /** EMA(12) 4h — slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  ema4hSlopePct7d: number | null;
  /** EMA(12) 1d — slope % ย้อนหลัง 7 แท่ง */
  ema1dSlopePct7d: number | null;
  /** BTC — EMA(12) 4h slope % ย้อนหลัง 7 วัน */
  btcEma4hSlopePct7d: number | null;
  /** BTC — EMA(12) 1d slope % ย้อนหลัง 7 แท่ง */
  btcEma1dSlopePct7d: number | null;
  /** (close − EMA20) / EMA20 × 100 บน 1h ของคู่สัญญาณ */
  priceVsEma20_1hPct: number | null;
  /** EMA20 1h — slope % ย้อนหลัง 7 วัน (168 แท่ง) */
  ema20_1hSlopePct7d: number | null;
  /** BTC — EMA20 4h slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  btcEma20_4hSlopePct7d: number | null;
  /** Wilder ATR(14) บน 1d ÷ close × 100 */
  atrPct14d: number | null;
  /** PSAR 4h — ทิศ SAR (up/down) */
  psar4hTrend: "up" | "down" | null;
  /** PSAR 4h — (close − SAR) / close × 100 */
  psar4hDistPct: number | null;
};

/** Vol 24h + Mcap + EMA slope 4h/1d ณ เวลาแจ้ง */
export async function fetchReversalAlertMarketSnapshot(
  binanceSymbol: string,
  atMs: number = Date.now(),
): Promise<ReversalAlertMarketSnapshot> {
  const sym = binanceSymbol.trim().toUpperCase();
  const base = binanceUsdtPerpBase(sym);
  const [quoteVol24hUsdt, marketCapUsd, symbolEma, atrPct14d, btcEma, psar4h, ema20Dist] = await Promise.all([
    fetchStatsQuoteVol24hUsdt(sym),
    base ? fetchMarketCapUsdCached(base) : Promise.resolve(null),
    fetchSymbolEmaSlopesAtMs(sym, atMs),
    fetchSymbolAtrPct14d(sym),
    fetchBtcEmaSlopesAtMs(atMs),
    fetchSymbolPsar4hAtMs(sym, atMs),
    fetchStatsEma20MetricsAtMs(sym, atMs),
  ]);
  return {
    quoteVol24hUsdt,
    marketCapUsd,
    ema1hSlopePct7d: symbolEma.ema1hSlopePct7d,
    ema4hSlopePct7d: symbolEma.ema4hSlopePct7d,
    ema1dSlopePct7d: symbolEma.ema1dSlopePct7d,
    btcEma4hSlopePct7d: btcEma.btcEma4hSlopePct7d,
    btcEma1dSlopePct7d: btcEma.btcEma1dSlopePct7d,
    priceVsEma20_1hPct: ema20Dist.priceVsEma20_1hPct,
    ema20_1hSlopePct7d: ema20Dist.ema20_1hSlopePct7d,
    btcEma20_4hSlopePct7d: ema20Dist.btcEma20_4hSlopePct7d,
    atrPct14d,
    psar4hTrend: psar4h?.trend ?? null,
    psar4hDistPct: psar4h?.distPct ?? null,
  };
}
