import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";

export const REVERSAL_MOMENTUM_VELOCITY_MIN = 2.0;
export const REVERSAL_MOMENTUM_EMA20_4H_SLOPE_MIN = 15;
export const REVERSAL_MOMENTUM_EMA20_4H_DIST_MIN = 20;
export const REVERSAL_MOMENTUM_VOL_VS_SMA_MIN = 4;
export const REVERSAL_MOMENTUM_OI_CHG24H_MIN = 20;

export const REVERSAL_MOMENTUM_SCORE_MAX = 5;

export const REVERSAL_MOMENTUM_SCORE_CRITERIA_SUMMARY =
  `Velocity > ${REVERSAL_MOMENTUM_VELOCITY_MIN}%/h · EMA20∠4h > ${REVERSAL_MOMENTUM_EMA20_4H_SLOPE_MIN} · EMA20Δ4h > ${REVERSAL_MOMENTUM_EMA20_4H_DIST_MIN} · Vol×SMA > ${REVERSAL_MOMENTUM_VOL_VS_SMA_MIN} · OI Δ24h > ${REVERSAL_MOMENTUM_OI_CHG24H_MIN}`;

export type ReversalMomentumScoreRowSlice = Pick<
  CandleReversalStatsRow,
  | "trendGainPct"
  | "ageOfTrendHours"
  | "ema20_4hSlopePct7d"
  | "priceVsEma20_4hPct"
  | "signalVolVsSma"
  | "openInterestChg24hPct"
>;

function finiteGt(v: number | null | undefined, min: number): boolean {
  return v != null && Number.isFinite(v) && v > min;
}

export function reversalMomentumVelocityPass(row: ReversalMomentumScoreRowSlice): boolean {
  const vel = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  return finiteGt(vel, REVERSAL_MOMENTUM_VELOCITY_MIN);
}

export function reversalMomentumEma20_4hSlopePass(row: ReversalMomentumScoreRowSlice): boolean {
  return finiteGt(row.ema20_4hSlopePct7d, REVERSAL_MOMENTUM_EMA20_4H_SLOPE_MIN);
}

export function reversalMomentumEma20_4hDistPass(row: ReversalMomentumScoreRowSlice): boolean {
  return finiteGt(row.priceVsEma20_4hPct, REVERSAL_MOMENTUM_EMA20_4H_DIST_MIN);
}

export function reversalMomentumVolVsSmaPass(row: ReversalMomentumScoreRowSlice): boolean {
  return finiteGt(row.signalVolVsSma, REVERSAL_MOMENTUM_VOL_VS_SMA_MIN);
}

export function reversalMomentumOiChg24hPass(row: ReversalMomentumScoreRowSlice): boolean {
  return finiteGt(row.openInterestChg24hPct, REVERSAL_MOMENTUM_OI_CHG24H_MIN);
}

export function reversalMomentumScore(row: ReversalMomentumScoreRowSlice): number {
  let score = 0;
  if (reversalMomentumVelocityPass(row)) score += 1;
  if (reversalMomentumEma20_4hSlopePass(row)) score += 1;
  if (reversalMomentumEma20_4hDistPass(row)) score += 1;
  if (reversalMomentumVolVsSmaPass(row)) score += 1;
  if (reversalMomentumOiChg24hPass(row)) score += 1;
  return score;
}

export function reversalMomentumScoreLabel(row: ReversalMomentumScoreRowSlice): string {
  return `${reversalMomentumScore(row)}/${REVERSAL_MOMENTUM_SCORE_MAX}`;
}

export function reversalMomentumScoreTitle(row: ReversalMomentumScoreRowSlice): string {
  const vel = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  const velTxt = vel != null && Number.isFinite(vel) ? `${vel.toFixed(2)}%/h` : "—";
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  return [
    `Momentum ${reversalMomentumScoreLabel(row)}`,
    `Velocity ${velTxt} ${mark(reversalMomentumVelocityPass(row))} (>${REVERSAL_MOMENTUM_VELOCITY_MIN})`,
    `EMA20∠4h ${row.ema20_4hSlopePct7d?.toFixed(1) ?? "—"}% ${mark(reversalMomentumEma20_4hSlopePass(row))} (>${REVERSAL_MOMENTUM_EMA20_4H_SLOPE_MIN})`,
    `EMA20Δ4h ${row.priceVsEma20_4hPct?.toFixed(1) ?? "—"}% ${mark(reversalMomentumEma20_4hDistPass(row))} (>${REVERSAL_MOMENTUM_EMA20_4H_DIST_MIN})`,
    `Vol×SMA ${row.signalVolVsSma?.toFixed(2) ?? "—"} ${mark(reversalMomentumVolVsSmaPass(row))} (>${REVERSAL_MOMENTUM_VOL_VS_SMA_MIN})`,
    `OI Δ24h ${row.openInterestChg24hPct?.toFixed(1) ?? "—"}% ${mark(reversalMomentumOiChg24hPass(row))} (>${REVERSAL_MOMENTUM_OI_CHG24H_MIN})`,
  ].join(" · ");
}

export type ReversalMomentumScoreFilter = "all" | "ge1" | "ge2" | "ge3" | "ge4" | "ge5";

const MOMENTUM_MIN: Record<Exclude<ReversalMomentumScoreFilter, "all">, number> = {
  ge1: 1,
  ge2: 2,
  ge3: 3,
  ge4: 4,
  ge5: 5,
};

export const REVERSAL_MOMENTUM_SCORE_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalMomentumScoreFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "ge1", label: "≥ 1" },
  { value: "ge2", label: "≥ 2" },
  { value: "ge3", label: "≥ 3" },
  { value: "ge4", label: "≥ 4" },
  { value: "ge5", label: "= 5" },
];

export function reversalMomentumScoreFilterLabel(filter: ReversalMomentumScoreFilter): string {
  return REVERSAL_MOMENTUM_SCORE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalMomentumScoreFilterTitle(filter: ReversalMomentumScoreFilter): string {
  if (filter === "all") {
    return `Momentum Score 0–${REVERSAL_MOMENTUM_SCORE_MAX} — ${REVERSAL_MOMENTUM_SCORE_CRITERIA_SUMMARY}`;
  }
  return `Momentum Score ${reversalMomentumScoreFilterLabel(filter)} — ${REVERSAL_MOMENTUM_SCORE_CRITERIA_SUMMARY}`;
}

export function reversalRowMatchesMomentumScoreFilter(
  row: ReversalMomentumScoreRowSlice,
  filter: ReversalMomentumScoreFilter,
): boolean {
  if (filter === "all") return true;
  const min = MOMENTUM_MIN[filter];
  return reversalMomentumScore(row) >= min;
}
