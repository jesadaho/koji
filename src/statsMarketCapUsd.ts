import { fetchBinancePerpMarketCapUsd } from "./coinGeckoMarketCap";
import {
  STATS_MARKET_CAP_MANUAL_BACKFILL_LIMIT,
  STATS_MARKET_CAP_VERSION,
} from "@/lib/statsMarketCapUsd";

export { STATS_MARKET_CAP_VERSION, STATS_MARKET_CAP_MANUAL_BACKFILL_LIMIT };

export type StatsRowWithMarketCap = {
  symbol: string;
  marketCapUsd?: number | null;
  marketCapV?: number;
};

export async function backfillAllStatsRowsMarketCapUsd<T extends StatsRowWithMarketCap>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxRows = Math.max(1, opts?.maxRowsPerPass ?? STATS_MARKET_CAP_MANUAL_BACKFILL_LIMIT);
  const maxPasses = Math.max(1, opts?.maxPasses ?? 8);
  const symCache = new Map<string, number | null>();
  let dirty = 0;
  let passes = 0;

  while (passes < maxPasses) {
    passes += 1;
    let passDirty = 0;
    for (const row of rows) {
      if (passDirty >= maxRows) break;
      if (row.marketCapV === STATS_MARKET_CAP_VERSION) continue;

      const sym = row.symbol.trim().toUpperCase();
      if (!sym) continue;

      try {
        let mcap = symCache.get(sym);
        if (mcap === undefined) {
          mcap = await fetchBinancePerpMarketCapUsd(sym);
          symCache.set(sym, mcap);
        }
        if (mcap == null) continue;
        row.marketCapUsd = mcap;
        row.marketCapV = STATS_MARKET_CAP_VERSION;
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
