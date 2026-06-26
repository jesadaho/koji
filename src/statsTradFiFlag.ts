import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import { buildBinanceUsdmSymbolMetaMap } from "./binanceIndicatorKline";

export const STATS_TRADFI_FLAG_VERSION = 1;

export async function backfillAllStatsRowsTradFiFlag(
  rows: CandleReversalStatsRow[],
): Promise<number> {
  const pending = rows.filter((r) => r.isTradFiV !== STATS_TRADFI_FLAG_VERSION);
  if (pending.length === 0) return 0;

  const metaMap = await buildBinanceUsdmSymbolMetaMap();
  let dirty = 0;
  for (const row of pending) {
    const sym = row.symbol.trim().toUpperCase();
    const meta = metaMap.get(sym);
    row.isTradFi = meta?.isTradFi === true;
    row.isTradFiV = STATS_TRADFI_FLAG_VERSION;
    dirty++;
  }
  return dirty;
}
