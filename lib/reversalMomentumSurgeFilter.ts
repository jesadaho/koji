import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";

export const REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT = 1.4;
export const REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT = 12;
export const REVERSAL_MOMENTUM_SURGE_EMA20_4H_DIST_MIN_PCT = 12;
export const REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN = 1.5;

export const REVERSAL_MOMENTUM_SURGE_CRITERIA =
  `EMA20Δ15m > ${REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT}% · EMA20∠15m > ${REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT}% · EMA20Δ4h > ${REVERSAL_MOMENTUM_SURGE_EMA20_4H_DIST_MIN_PCT}% · Velocity > ${REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN}%/h`;

export type ReversalMomentumSurgeRowSlice = Pick<
  CandleReversalStatsRow,
  | "priceVsEma20_15mPct"
  | "ema20_15mSlopePct7d"
  | "priceVsEma20_4hPct"
  | "trendGainPct"
  | "ageOfTrendHours"
>;

function finiteGt(v: number | null | undefined, min: number): boolean {
  return v != null && Number.isFinite(v) && v > min;
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

export function reversalMomentumSurgeVelocityPass(row: ReversalMomentumSurgeRowSlice): boolean {
  const vel = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  return finiteGt(vel, REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN);
}

export function reversalStatsRowMatchesMomentumSurge(row: ReversalMomentumSurgeRowSlice): boolean {
  return (
    reversalMomentumSurgeEma20_15mDistPass(row) &&
    reversalMomentumSurgeEma20_15mSlopePass(row) &&
    reversalMomentumSurgeEma20_4hDistPass(row) &&
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
    `Velocity ${velTxt} ${mark(reversalMomentumSurgeVelocityPass(row))} (>${REVERSAL_MOMENTUM_SURGE_VELOCITY_MIN})`,
  ].join(" · ");
}

export type ReversalMomentumSurgeFilter = "all" | "surge";

export const REVERSAL_MOMENTUM_SURGE_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalMomentumSurgeFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "surge", label: "Momentum Surge" },
];

export function reversalMomentumSurgeFilterLabel(filter: ReversalMomentumSurgeFilter): string {
  return REVERSAL_MOMENTUM_SURGE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalMomentumSurgeFilterTitle(filter: ReversalMomentumSurgeFilter): string {
  if (filter === "all") {
    return `Momentum Surge — ${REVERSAL_MOMENTUM_SURGE_CRITERIA}`;
  }
  return `Momentum Surge — ${REVERSAL_MOMENTUM_SURGE_CRITERIA} (AND)`;
}

export function reversalStatsRowMatchesMomentumSurgeFilter(
  row: ReversalMomentumSurgeRowSlice,
  filter: ReversalMomentumSurgeFilter,
): boolean {
  if (filter === "all") return true;
  return reversalStatsRowMatchesMomentumSurge(row);
}
