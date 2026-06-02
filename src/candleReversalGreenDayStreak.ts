import type { CandleReversalSignalBarTf } from "@/lib/candleReversalStatsClient";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import {
  countGreenDaysBeforeSignalBar,
  fetchGreenDaysBeforeSignalBar,
} from "./greenDayStreak";

/** @deprecated use countGreenDaysBeforeSignalBar from greenDayStreak */
export function countGreenDaysBeforeReversalSignal(
  pack1d: BinanceKlinePack | null,
  signalBarOpenSec: number,
  signalBarTf: CandleReversalSignalBarTf,
): number | null {
  return countGreenDaysBeforeSignalBar(pack1d, signalBarOpenSec, signalBarTf);
}

export async function fetchGreenDaysBeforeReversalSignal(
  symbol: string,
  signalBarOpenSec: number,
  signalBarTf: CandleReversalSignalBarTf,
  opts?: { dayTzOffsetSec?: number },
): Promise<number | null> {
  return fetchGreenDaysBeforeSignalBar(symbol, signalBarOpenSec, signalBarTf, opts);
}
