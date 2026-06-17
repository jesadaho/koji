/** Pump-cycle swing low — client-safe pure logic (1H lookback). */

import { statsFmtBkk, statsFmtPrice } from "@/lib/statsCsv";

export type PumpCycleSwingLowSource =
  | "STRICT_20"
  | "FALLBACK_10"
  | "LOWEST_7D"
  | "LOWEST_72H"
  | "NOT_FOUND";

export type PumpCycleSwingLowResult = {
  swingLowOpenSec: number | null;
  swingLowPrice: number | null;
  ageOfTrendHours: number | null;
  trendGainPct: number | null;
  swingLowSource: PumpCycleSwingLowSource;
};

export const PUMP_CYCLE_1H_BAR_SEC = 3600;
export const PUMP_CYCLE_1H_LOOKBACK_BARS = 168;
export const PUMP_CYCLE_PRIOR_LOW_HOURS = 24;
export const PUMP_CYCLE_BOUNCE_STRICT = 0.2;
export const PUMP_CYCLE_BOUNCE_FALLBACK = 0.1;
export const PUMP_CYCLE_72H_BARS = 72;
export const STATS_PUMP_CYCLE_SWING_LOW_VERSION = 1;

export const PUMP_CYCLE_NOT_FOUND: PumpCycleSwingLowResult = {
  swingLowOpenSec: null,
  swingLowPrice: null,
  ageOfTrendHours: null,
  trendGainPct: null,
  swingLowSource: "NOT_FOUND",
};

/** Minimal kline slice for compute (no Node deps). */
export type PumpCycleKlineSlice = {
  timeSec: number[];
  high: number[];
  low: number[];
};

function lastClosed1hIndexAt(timeSec: number[], signalAtSec: number): number {
  let iClosed = -1;
  for (let i = 0; i < timeSec.length; i++) {
    if (timeSec[i]! + PUMP_CYCLE_1H_BAR_SEC <= signalAtSec) iClosed = i;
  }
  return iClosed;
}

function windowStartIndex(timeSec: number[], signalAtSec: number): number {
  const minSec = signalAtSec - PUMP_CYCLE_1H_LOOKBACK_BARS * PUMP_CYCLE_1H_BAR_SEC;
  for (let i = 0; i < timeSec.length; i++) {
    if (timeSec[i]! >= minSec) return i;
  }
  return 0;
}

function isPrior24hLowest(low: number[], j: number, windowStart: number): boolean {
  const start = Math.max(windowStart, j - PUMP_CYCLE_PRIOR_LOW_HOURS);
  if (j <= start) return false;
  const lj = low[j]!;
  if (!Number.isFinite(lj) || lj <= 0) return false;
  for (let k = start; k < j; k++) {
    if (low[k]! < lj) return false;
  }
  return true;
}

function noLowerLowAfter(low: number[], j: number, iSignal: number): boolean {
  const lj = low[j]!;
  for (let k = j + 1; k <= iSignal; k++) {
    if (low[k]! < lj) return false;
  }
  return true;
}

function maxHighAfter(high: number[], j: number, iSignal: number): number {
  let m = -Infinity;
  for (let k = j + 1; k <= iSignal; k++) {
    m = Math.max(m, high[k]!);
  }
  return m;
}

function bounceOk(high: number[], low: number[], j: number, iSignal: number, bouncePct: number): boolean {
  const lj = low[j]!;
  if (!Number.isFinite(lj) || lj <= 0) return false;
  const maxH = maxHighAfter(high, j, iSignal);
  return Number.isFinite(maxH) && maxH >= lj * (1 + bouncePct);
}

function findStrictSwingLowIndex(
  low: number[],
  high: number[],
  iSignal: number,
  windowStart: number,
  bouncePct: number,
): number {
  for (let j = iSignal - 1; j >= windowStart; j--) {
    if (!isPrior24hLowest(low, j, windowStart)) continue;
    if (!noLowerLowAfter(low, j, iSignal)) continue;
    if (!bounceOk(high, low, j, iSignal, bouncePct)) continue;
    return j;
  }
  return -1;
}

/** Lowest low in last `bars` before iSignal (inclusive of iSignal); tie → latest index. */
function findLowestLowIndex(low: number[], iSignal: number, bars: number): number {
  const start = Math.max(0, iSignal - bars + 1);
  let bestJ = -1;
  let bestLow = Infinity;
  for (let j = start; j <= iSignal; j++) {
    const lj = low[j]!;
    if (!Number.isFinite(lj) || lj <= 0) continue;
    if (lj < bestLow || (lj === bestLow && j > bestJ)) {
      bestLow = lj;
      bestJ = j;
    }
  }
  return bestJ;
}

function buildResult(
  pack: PumpCycleKlineSlice,
  j: number,
  signalAtSec: number,
  entryPrice: number,
  source: PumpCycleSwingLowSource,
): PumpCycleSwingLowResult {
  const swingLowOpenSec = pack.timeSec[j]!;
  const swingLowPrice = pack.low[j]!;
  if (!Number.isFinite(swingLowOpenSec) || !Number.isFinite(swingLowPrice) || swingLowPrice <= 0) {
    return PUMP_CYCLE_NOT_FOUND;
  }
  const ageOfTrendHours = (signalAtSec - swingLowOpenSec) / PUMP_CYCLE_1H_BAR_SEC;
  const trendGainPct =
    Number.isFinite(entryPrice) && entryPrice > 0
      ? ((entryPrice - swingLowPrice) / swingLowPrice) * 100
      : null;
  return {
    swingLowOpenSec,
    swingLowPrice,
    ageOfTrendHours: Number.isFinite(ageOfTrendHours) && ageOfTrendHours >= 0 ? ageOfTrendHours : null,
    trendGainPct: trendGainPct != null && Number.isFinite(trendGainPct) ? trendGainPct : null,
    swingLowSource: source,
  };
}

export function computePumpCycleSwingLow(
  pack: PumpCycleKlineSlice,
  signalAtSec: number,
  entryPrice: number,
): PumpCycleSwingLowResult {
  const { timeSec, high, low } = pack;
  if (timeSec.length < 2 || timeSec.length !== low.length || low.length !== high.length) {
    return PUMP_CYCLE_NOT_FOUND;
  }

  const iSignal = lastClosed1hIndexAt(timeSec, signalAtSec);
  if (iSignal < 0) return PUMP_CYCLE_NOT_FOUND;

  const windowStart = windowStartIndex(timeSec, signalAtSec);

  const j20 = findStrictSwingLowIndex(low, high, iSignal, windowStart, PUMP_CYCLE_BOUNCE_STRICT);
  if (j20 >= 0) return buildResult(pack, j20, signalAtSec, entryPrice, "STRICT_20");

  const j10 = findStrictSwingLowIndex(low, high, iSignal, windowStart, PUMP_CYCLE_BOUNCE_FALLBACK);
  if (j10 >= 0) return buildResult(pack, j10, signalAtSec, entryPrice, "FALLBACK_10");

  const j7d = findLowestLowIndex(low, iSignal, PUMP_CYCLE_1H_LOOKBACK_BARS);
  if (j7d >= 0) return buildResult(pack, j7d, signalAtSec, entryPrice, "LOWEST_7D");

  const j72 = findLowestLowIndex(low, iSignal, PUMP_CYCLE_72H_BARS);
  if (j72 >= 0) return buildResult(pack, j72, signalAtSec, entryPrice, "LOWEST_72H");

  return PUMP_CYCLE_NOT_FOUND;
}

export function pumpCycleSwingLowSourceLabel(source: PumpCycleSwingLowSource | null | undefined): string {
  if (source == null || source === "NOT_FOUND") return "—";
  return source;
}

export function pumpCycleAgeHoursLabel(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  return hours.toFixed(1);
}

export function pumpCycleTrendGainPctLabel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function pumpCycleSwingLowTimeIso(openSec: number | null | undefined): string | null {
  if (openSec == null || !Number.isFinite(openSec)) return null;
  return new Date(openSec * 1000).toISOString();
}

export function pumpCycleSwingLowSourceCsvCell(source: PumpCycleSwingLowSource | null | undefined): string {
  if (source == null) return "";
  return source;
}

export function pumpCycleSwingLowTimeCsvCell(openSec: number | null | undefined): string {
  const iso = pumpCycleSwingLowTimeIso(openSec);
  return iso ? statsFmtBkk(iso) : "";
}

export function pumpCycleSwingLowPriceCsvCell(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return "";
  return statsFmtPrice(price);
}

export function pumpCycleAgeHoursCsvCell(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "";
  return hours.toFixed(1);
}

export function pumpCycleTrendGainCsvCell(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  return pct.toFixed(2);
}

export function pumpCycleSwingLowFieldsFromResult(
  result: PumpCycleSwingLowResult,
): {
  swingLowOpenSec: number | null;
  swingLowPrice: number | null;
  ageOfTrendHours: number | null;
  trendGainPct: number | null;
  swingLowSource: PumpCycleSwingLowSource;
  pumpCycleSwingLowV: number;
} {
  return {
    swingLowOpenSec: result.swingLowOpenSec,
    swingLowPrice: result.swingLowPrice,
    ageOfTrendHours: result.ageOfTrendHours,
    trendGainPct: result.trendGainPct,
    swingLowSource: result.swingLowSource,
    pumpCycleSwingLowV: STATS_PUMP_CYCLE_SWING_LOW_VERSION,
  };
}
