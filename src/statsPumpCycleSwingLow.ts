import {
  computePumpCycleSwingLow,
  pumpCycleSwingLowFieldsFromResult,
  PUMP_CYCLE_1H_BAR_SEC,
  PUMP_CYCLE_1H_LOOKBACK_BARS,
  STATS_PUMP_CYCLE_SWING_LOW_VERSION,
  type PumpCycleSwingLowResult,
  type PumpCycleSwingLowSource,
} from "@/lib/pumpCycleSwingLow";
import {
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

const FETCH_BUFFER_BARS = 8;

export function computePumpCycleSwingLowFromPack(
  pack: BinanceKlinePack | null,
  signalAtSec: number,
  entryPrice: number,
): PumpCycleSwingLowResult {
  if (!pack?.timeSec?.length) {
    return computePumpCycleSwingLow({ timeSec: [], high: [], low: [] }, signalAtSec, entryPrice);
  }
  return computePumpCycleSwingLow(
    { timeSec: pack.timeSec, high: pack.high, low: pack.low },
    signalAtSec,
    entryPrice,
  );
}

export async function fetchPumpCycleSwingLowAt(
  symbol: string,
  signalAtSec: number,
  entryPrice: number,
): Promise<PumpCycleSwingLowResult> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return computePumpCycleSwingLowFromPack(null, signalAtSec, entryPrice);
  }
  const sym = symbol.trim().toUpperCase();
  if (!sym) {
    return computePumpCycleSwingLowFromPack(null, signalAtSec, entryPrice);
  }
  const minBars = PUMP_CYCLE_1H_LOOKBACK_BARS + FETCH_BUFFER_BARS;
  const startMs = (signalAtSec - minBars * PUMP_CYCLE_1H_BAR_SEC) * 1000;
  const endMs = signalAtSec * 1000;
  try {
    const pack = await fetchBinanceUsdmKlinesRange(sym, "1h", {
      startTimeMs: startMs,
      endTimeMs: endMs,
      limit: Math.min(1500, minBars + 20),
    });
    return computePumpCycleSwingLowFromPack(pack, signalAtSec, entryPrice);
  } catch (e) {
    console.error("[statsPumpCycleSwingLow] fetch", sym, e);
    return computePumpCycleSwingLowFromPack(null, signalAtSec, entryPrice);
  }
}

export async function resolvePumpCycleSwingLowFields(opts: {
  symbol: string;
  signalAtSec: number;
  entryPrice: number;
  pack1h?: BinanceKlinePack | null;
}): Promise<ReturnType<typeof pumpCycleSwingLowFieldsFromResult>> {
  if (opts.pack1h?.timeSec?.length) {
    return pumpCycleSwingLowFieldsFromResult(
      computePumpCycleSwingLowFromPack(opts.pack1h, opts.signalAtSec, opts.entryPrice),
    );
  }
  const result = await fetchPumpCycleSwingLowAt(opts.symbol, opts.signalAtSec, opts.entryPrice);
  return pumpCycleSwingLowFieldsFromResult(result);
}

type PumpCycleSwingLowRowSlice = {
  symbol: string;
  entryPrice: number;
  pumpCycleSwingLowV?: number;
  swingLowSource?: PumpCycleSwingLowSource | null;
  swingLowOpenSec?: number | null;
  swingLowPrice?: number | null;
  ageOfTrendHours?: number | null;
  trendGainPct?: number | null;
};

function rowNeedsPumpCycleSwingLowBackfill(row: PumpCycleSwingLowRowSlice): boolean {
  return (
    row.pumpCycleSwingLowV !== STATS_PUMP_CYCLE_SWING_LOW_VERSION || row.swingLowSource == null
  );
}

function applyPumpCycleFieldsToRow(
  row: PumpCycleSwingLowRowSlice,
  fields: ReturnType<typeof pumpCycleSwingLowFieldsFromResult>,
): void {
  row.swingLowOpenSec = fields.swingLowOpenSec;
  row.swingLowPrice = fields.swingLowPrice;
  row.ageOfTrendHours = fields.ageOfTrendHours;
  row.trendGainPct = fields.trendGainPct;
  row.swingLowSource = fields.swingLowSource;
  row.pumpCycleSwingLowV = fields.pumpCycleSwingLowV;
}

export async function backfillPumpCycleSwingLowForRows<T extends PumpCycleSwingLowRowSlice>(
  rows: T[],
  anchorCloseSec: (row: T) => number,
  opts?: { symbolFilter?: string },
): Promise<number> {
  const symFilter = opts?.symbolFilter?.trim().toUpperCase();
  const need = rows.filter((r) => {
    if (symFilter && r.symbol.trim().toUpperCase() !== symFilter) return false;
    return rowNeedsPumpCycleSwingLowBackfill(r);
  });
  if (need.length === 0) return 0;

  let updated = 0;
  for (const row of need) {
    const sym = row.symbol.trim().toUpperCase();
    const signalAtSec = anchorCloseSec(row);
    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(signalAtSec)) continue;

    try {
      const fields = await resolvePumpCycleSwingLowFields({
        symbol: sym,
        signalAtSec,
        entryPrice: entry,
      });
      applyPumpCycleFieldsToRow(row, fields);
      updated += 1;
    } catch (e) {
      console.error("[statsPumpCycleSwingLow] backfill", sym, e);
    }
  }
  return updated;
}
