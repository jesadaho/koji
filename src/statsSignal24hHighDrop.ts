import { candleReversalStatsAnchorCloseSec } from "@/lib/candleReversalStatsClient";
import type { CandleReversalSignalBarTf, CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import {
  fetchBinanceUsdmKlinesRange,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

export const STATS_SIGNAL_24H_HIGH_DROP_VERSION = 1;

const HOUR_SEC = 3600;
const WINDOW_24H_SEC = 24 * HOUR_SEC;

/** (high24h − signalLow) / high24h × 100 */
export function dropFrom24hHighToSignalLowPct(high24h: number, signalLow: number): number | null {
  if (!(high24h > 0) || !(signalLow > 0) || signalLow > high24h * 1.000001) return null;
  return ((high24h - signalLow) / high24h) * 100;
}

/** สูงสุดของ high บนแท่ง 1h ในช่วง 24 ชม. ก่อนปิดแท่งสัญญาณ (รวมแท่งที่ปิดที่ anchor) */
export function maxHighIn24hWindow1h(pack1h: BinanceKlinePack, anchorCloseSec: number): number | null {
  const windowStartSec = anchorCloseSec - WINDOW_24H_SEC;
  let maxH = -Infinity;
  for (let i = 0; i < pack1h.timeSec.length; i++) {
    const barCloseSec = pack1h.timeSec[i]! + HOUR_SEC;
    if (barCloseSec <= windowStartSec) continue;
    if (barCloseSec > anchorCloseSec) break;
    const h = pack1h.high[i]!;
    if (Number.isFinite(h) && h > maxH) maxH = h;
  }
  return Number.isFinite(maxH) && maxH > 0 ? maxH : null;
}

export function computeSignal24hHighDropFromPack1h(input: {
  pack1h: BinanceKlinePack;
  signalBarOpenSec: number;
  signalBarTf: CandleReversalSignalBarTf;
  signalBarLow: number;
}): number | null {
  const anchorCloseSec = candleReversalStatsAnchorCloseSec({
    signalBarOpenSec: input.signalBarOpenSec,
    signalBarTf: input.signalBarTf,
  });
  const high24h = maxHighIn24hWindow1h(input.pack1h, anchorCloseSec);
  if (high24h == null) return null;
  return dropFrom24hHighToSignalLowPct(high24h, input.signalBarLow);
}

export type Signal24hHighDropSnapshot = {
  dropFrom24hHighToSignalLowPct: number | null;
};

export async function fetchSignal24hHighDropAtSignal(
  symbol: string,
  signalBarOpenSec: number,
  signalBarTf: CandleReversalSignalBarTf,
  signalBarLow: number,
): Promise<Signal24hHighDropSnapshot> {
  if (!(signalBarLow > 0) || !(signalBarOpenSec > 0)) {
    return { dropFrom24hHighToSignalLowPct: null };
  }
  const anchorCloseSec = candleReversalStatsAnchorCloseSec({ signalBarOpenSec, signalBarTf });
  try {
    const pack = await fetchBinanceUsdmKlinesRange(symbol, "1h", {
      startTimeMs: (anchorCloseSec - (WINDOW_24H_SEC + 2 * HOUR_SEC)) * 1000,
      endTimeMs: anchorCloseSec * 1000,
      limit: 32,
    });
    if (!pack || pack.timeSec.length === 0) {
      return { dropFrom24hHighToSignalLowPct: null };
    }
    return {
      dropFrom24hHighToSignalLowPct: computeSignal24hHighDropFromPack1h({
        pack1h: pack,
        signalBarOpenSec,
        signalBarTf,
        signalBarLow,
      }),
    };
  } catch {
    return { dropFrom24hHighToSignalLowPct: null };
  }
}

export function mergeSignal24hHighDropIntoRow(
  row: CandleReversalStatsRow,
  snap: Signal24hHighDropSnapshot,
): void {
  const v = snap.dropFrom24hHighToSignalLowPct;
  if (v != null && Number.isFinite(v) && v >= 0) {
    row.dropFrom24hHighToSignalLowPct = v;
    row.signal24hHighDropV = STATS_SIGNAL_24H_HIGH_DROP_VERSION;
  }
}
