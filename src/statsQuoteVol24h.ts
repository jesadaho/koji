import { resolveMexcContractFromBinanceSymbol } from "./coinMap";
import { fetchBinanceUsdmQuoteVol24h, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";
import { fetchContractTickerMetrics, type MexcTickerRow } from "./mexcMarkets";

/** แถวที่ quoteVol24hUsdt ถูกดึงต่อ symbol แล้ว (v1) */
export const STATS_QUOTE_VOL_24H_VERSION = 1;

export function quoteVol24hFromMexcTicker(ticker: MexcTickerRow | null | undefined): number | null {
  const amt = ticker?.amount24;
  return typeof amt === "number" && Number.isFinite(amt) && amt > 0 ? amt : null;
}

/** Vol 24h USDT — Binance perp quoteVolume ก่อน · fallback MEXC amount24 */
export async function fetchStatsQuoteVol24hUsdt(
  binanceSymbol: string,
  mexcTicker?: MexcTickerRow | null,
): Promise<number | null> {
  const sym = binanceSymbol.trim().toUpperCase();
  if (!sym) return null;

  if (isBinanceIndicatorFapiEnabled()) {
    const bin = await fetchBinanceUsdmQuoteVol24h(sym);
    if (bin != null) return bin;
  }

  const fromTicker = quoteVol24hFromMexcTicker(mexcTicker);
  if (fromTicker != null) return fromTicker;

  const mexc = resolveMexcContractFromBinanceSymbol(sym);
  if (mexc) {
    const metrics = await fetchContractTickerMetrics(mexc);
    if (metrics && metrics.amount24Usdt > 0) return metrics.amount24Usdt;
  }

  return null;
}

export type StatsRowWithQuoteVol24h = {
  symbol: string;
  quoteVol24hUsdt?: number | null;
  quoteVol24hV?: number;
};

export async function backfillAllStatsRowsQuoteVol24h<T extends StatsRowWithQuoteVol24h>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxRows = Math.max(1, opts?.maxRowsPerPass ?? 25);
  const maxPasses = Math.max(1, opts?.maxPasses ?? 8);
  const symCache = new Map<string, number | null>();
  let dirty = 0;
  let passes = 0;

  while (passes < maxPasses) {
    passes += 1;
    let passDirty = 0;
    for (const row of rows) {
      if (passDirty >= maxRows) break;
      const v = row.quoteVol24hV ?? 0;
      const needs = v !== STATS_QUOTE_VOL_24H_VERSION || row.quoteVol24hUsdt == null;
      if (!needs) continue;

      const sym = row.symbol.trim().toUpperCase();
      if (!sym) continue;

      try {
        let vol = symCache.get(sym);
        if (vol === undefined) {
          vol = await fetchStatsQuoteVol24hUsdt(sym);
          symCache.set(sym, vol);
        }
        if (vol == null) continue;
        row.quoteVol24hUsdt = vol;
        row.quoteVol24hV = STATS_QUOTE_VOL_24H_VERSION;
        passDirty += 1;
        dirty += 1;
      } catch {
        /* skip row */
      }
    }
    if (passDirty === 0) break;
  }

  return dirty;
}
