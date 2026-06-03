import type { BinanceKlinePack } from "./binanceIndicatorKline";
import {
  lenPercentilePctFromRank,
  statsRangeRankInWindow,
} from "@/lib/statsLenPercentile";
import { snowballVolatilityLookbackBars } from "./snowballVolatilityMetrics";

export type StatsLenPercentileSnapshot = {
  rangeRankInLookback: number;
  lookbackBars: number;
  lenPercentilePct: number;
};

export function computeLenPercentileSnapshot(
  high: number[],
  low: number[],
  i: number,
  lookbackBars: number,
): StatsLenPercentileSnapshot | null {
  const lb = Math.floor(lookbackBars);
  if (!(Number.isFinite(lb) && lb >= 2)) return null;
  if (i < 0 || i >= high.length || i >= low.length) return null;
  const start = Math.max(0, i - lb + 1);
  const rank = statsRangeRankInWindow(high, low, start, i, i);
  const lenPercentilePct = lenPercentilePctFromRank(rank, lb);
  if (lenPercentilePct == null || !Number.isFinite(lenPercentilePct)) return null;
  return { rangeRankInLookback: rank, lookbackBars: lb, lenPercentilePct };
}

export function computeLenPercentileFromPack(
  pack: BinanceKlinePack,
  i: number,
  lookbackBars: number,
): StatsLenPercentileSnapshot | null {
  return computeLenPercentileSnapshot(pack.high, pack.low, i, lookbackBars);
}

/** Snowball — ใช้ lookback เดียวกับ volatility snapshot (default 100 แท่ง 15m) */
export function snowballSignalLenPercentileLookbackBars(): number {
  return snowballVolatilityLookbackBars();
}

export function computeSnowballSignalLenPercentile(
  pack: BinanceKlinePack,
  iEval: number,
): StatsLenPercentileSnapshot | null {
  return computeLenPercentileFromPack(pack, iEval, snowballSignalLenPercentileLookbackBars());
}
