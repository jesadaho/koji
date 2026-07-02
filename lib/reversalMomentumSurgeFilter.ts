import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";

export const REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT = 1.4;
export const REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT = 12;
export const REVERSAL_MOMENTUM_SURGE_EMA20_4H_DIST_MIN_PCT = 12;
export const REVERSAL_MOMENTUM_SURGE_EMA20_1H_DIST_MAX_PCT = 15;
export const REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN = 1.5;

export const REVERSAL_MOMENTUM_SURGE_CRITERIA =
  `EMA20Δ15m > ${REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT}% · EMA20∠15m > ${REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT}% · EMA20Δ4h > ${REVERSAL_MOMENTUM_SURGE_EMA20_4H_DIST_MIN_PCT}% · EMA20Δ1h < ${REVERSAL_MOMENTUM_SURGE_EMA20_1H_DIST_MAX_PCT}% · Velocity > ${REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN}%/h`;

export type ReversalMomentumSurgeRowSlice = Pick<
  CandleReversalStatsRow,
  | "priceVsEma20_15mPct"
  | "ema20_15mSlopePct7d"
  | "priceVsEma20_4hPct"
  | "priceVsEma20_1hPct"
  | "trendGainPct"
  | "ageOfTrendHours"
>;

function finiteGt(v: number | null | undefined, min: number): boolean {
  return v != null && Number.isFinite(v) && v > min;
}

function finiteLt(v: number | null | undefined, max: number): boolean {
  return v != null && Number.isFinite(v) && v < max;
}

export function reversalMomentumSurgeEma20_15mDistPass(
  row: ReversalMomentumSurgeRowSlice,
): boolean {
  return finiteGt(row.priceVsEma20_15mPct, REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT);
}

export function reversalMomentumSurgeEma20_15mSlopePass(
  row: ReversalMomentumSurgeRowSlice,
): boolean {
  return finiteGt(row.ema20_15mSlopePct7d, REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT);
}

export function reversalMomentumSurgeEma20_4hDistPass(
  row: ReversalMomentumSurgeRowSlice,
): boolean {
  return finiteGt(row.priceVsEma20_4hPct, REVERSAL_MOMENTUM_SURGE_EMA20_4H_DIST_MIN_PCT);
}

export function reversalMomentumSurgeEma20_1hDistPass(
  row: ReversalMomentumSurgeRowSlice,
): boolean {
  return finiteLt(row.priceVsEma20_1hPct, REVERSAL_MOMENTUM_SURGE_EMA20_1H_DIST_MAX_PCT);
}

export function reversalMomentumSurgeVelocityPass(row: ReversalMomentumSurgeRowSlice): boolean {
  const vel = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  return finiteGt(vel, REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN);
}

export function reversalStatsRowMatchesMomentumSurge(row: ReversalMomentumSurgeRowSlice): boolean {
  return (
    reversalMomentumSurgeEma20_15mDistPass(row) &&
    reversalMomentumSurgeEma20_15mSlopePass(row) &&
    reversalMomentumSurgeEma20_4hDistPass(row) &&
    reversalMomentumSurgeEma20_1hDistPass(row) &&
    reversalMomentumSurgeVelocityPass(row)
  );
}

export function reversalMomentumSurgeTitle(row: ReversalMomentumSurgeRowSlice): string {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  const vel = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  const velTxt = vel != null && Number.isFinite(vel) ? `${vel.toFixed(2)}%/h` : "—";
  return [
    reversalStatsRowMatchesMomentumSurge(row) ? "Momentum Surge" : "ไม่ใช่ Momentum Surge",
    `EMA20Δ15m ${row.priceVsEma20_15mPct?.toFixed(1) ?? "—"}% ${mark(reversalMomentumSurgeEma20_15mDistPass(row))} (>${REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT})`,
    `EMA20∠15m ${row.ema20_15mSlopePct7d?.toFixed(1) ?? "—"}% ${mark(reversalMomentumSurgeEma20_15mSlopePass(row))} (>${REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT})`,
    `EMA20Δ4h ${row.priceVsEma20_4hPct?.toFixed(1) ?? "—"}% ${mark(reversalMomentumSurgeEma20_4hDistPass(row))} (>${REVERSAL_MOMENTUM_SURGE_EMA20_4H_DIST_MIN_PCT})`,
    `EMA20Δ1h ${row.priceVsEma20_1hPct?.toFixed(1) ?? "—"}% ${mark(reversalMomentumSurgeEma20_1hDistPass(row))} (<${REVERSAL_MOMENTUM_SURGE_EMA20_1H_DIST_MAX_PCT})`,
    `Velocity ${velTxt} ${mark(reversalMomentumSurgeVelocityPass(row))} (>${REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN})`,
  ].join(" · ");
}
