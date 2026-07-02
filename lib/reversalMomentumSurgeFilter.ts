import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

export const REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT = 1.2;
export const REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT = 12;

export const REVERSAL_MOMENTUM_SURGE_CRITERIA =
  `EMA20Δ15m > ${REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT}% · EMA20∠15m > ${REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT}%`;

export type ReversalMomentumSurgeRowSlice = Pick<
  CandleReversalStatsRow,
  "priceVsEma20_15mPct" | "ema20_15mSlopePct7d"
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

export function reversalStatsRowMatchesMomentumSurge(row: ReversalMomentumSurgeRowSlice): boolean {
  return reversalMomentumSurgeEma20_15mDistPass(row) && reversalMomentumSurgeEma20_15mSlopePass(row);
}

export function reversalMomentumSurgeTitle(row: ReversalMomentumSurgeRowSlice): string {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  return [
    reversalStatsRowMatchesMomentumSurge(row) ? "Momentum Surge" : "ไม่ใช่ Momentum Surge",
    `EMA20Δ15m ${row.priceVsEma20_15mPct?.toFixed(1) ?? "—"}% ${mark(reversalMomentumSurgeEma20_15mDistPass(row))} (>${REVERSAL_MOMENTUM_SURGE_EMA20_15M_DIST_MIN_PCT})`,
    `EMA20∠15m ${row.ema20_15mSlopePct7d?.toFixed(1) ?? "—"}% ${mark(reversalMomentumSurgeEma20_15mSlopePass(row))} (>${REVERSAL_MOMENTUM_SURGE_EMA20_15M_SLOPE_MIN_PCT})`,
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
