import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import {
  REVERSAL_INSTANT_PUMP_MATRIX_ATR14D_MIN_EXCLUSIVE,
  REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MAX_PCT,
  REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MIN_PCT,
  REVERSAL_INSTANT_PUMP_MATRIX_OI_CHG24H_MIN_PCT,
  REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MAX_PCT,
  REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MIN_PCT,
  REVERSAL_INSTANT_PUMP_MATRIX_VOL_VS_SMA_MIN_EXCLUSIVE,
} from "@/lib/reversalMatrixFilters";

export const REVERSAL_RISK_SCORE_MAX = 5;

export const REVERSAL_RISK_SCORE_CRITERIA_SUMMARY =
  `OI Δ24h ≥${REVERSAL_INSTANT_PUMP_MATRIX_OI_CHG24H_MIN_PCT}% · Trend Gain ${REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MIN_PCT}–${REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MAX_PCT}% · EMA20Δ4h ${REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MIN_PCT}–${REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MAX_PCT}% · Vol×SMA >${REVERSAL_INSTANT_PUMP_MATRIX_VOL_VS_SMA_MIN_EXCLUSIVE} · ATR%14D >${REVERSAL_INSTANT_PUMP_MATRIX_ATR14D_MIN_EXCLUSIVE}%`;

export type ReversalRiskScoreRowSlice = Pick<
  CandleReversalStatsRow,
  | "openInterestChg24hPct"
  | "trendGainPct"
  | "priceVsEma20_4hPct"
  | "signalVolVsSma"
  | "atrPct14d"
>;

function finiteGt(v: number | null | undefined, min: number): boolean {
  return v != null && Number.isFinite(v) && v > min;
}

function finiteRangeInclusive(
  v: number | null | undefined,
  min: number,
  max: number,
): boolean {
  return v != null && Number.isFinite(v) && v >= min && v <= max;
}

export function reversalRiskOiChg24hPass(row: ReversalRiskScoreRowSlice): boolean {
  const oi = row.openInterestChg24hPct;
  return oi != null && Number.isFinite(oi) && oi >= REVERSAL_INSTANT_PUMP_MATRIX_OI_CHG24H_MIN_PCT;
}

export function reversalRiskTrendGainPass(row: ReversalRiskScoreRowSlice): boolean {
  return finiteRangeInclusive(
    row.trendGainPct,
    REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MIN_PCT,
    REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MAX_PCT,
  );
}

export function reversalRiskEma20_4hDistPass(row: ReversalRiskScoreRowSlice): boolean {
  return finiteRangeInclusive(
    row.priceVsEma20_4hPct,
    REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MIN_PCT,
    REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MAX_PCT,
  );
}

export function reversalRiskVolVsSmaPass(row: ReversalRiskScoreRowSlice): boolean {
  return finiteGt(row.signalVolVsSma, REVERSAL_INSTANT_PUMP_MATRIX_VOL_VS_SMA_MIN_EXCLUSIVE);
}

export function reversalRiskAtr14dPass(row: ReversalRiskScoreRowSlice): boolean {
  return finiteGt(row.atrPct14d, REVERSAL_INSTANT_PUMP_MATRIX_ATR14D_MIN_EXCLUSIVE);
}

export function reversalRiskScore(row: ReversalRiskScoreRowSlice): number {
  let score = 0;
  if (reversalRiskOiChg24hPass(row)) score += 1;
  if (reversalRiskTrendGainPass(row)) score += 1;
  if (reversalRiskEma20_4hDistPass(row)) score += 1;
  if (reversalRiskVolVsSmaPass(row)) score += 1;
  if (reversalRiskAtr14dPass(row)) score += 1;
  return score;
}

export function reversalRiskScoreLabel(row: ReversalRiskScoreRowSlice): string {
  return `${reversalRiskScore(row)}/${REVERSAL_RISK_SCORE_MAX}`;
}

export function reversalRiskScoreTitle(row: ReversalRiskScoreRowSlice): string {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  return [
    `Risk ${reversalRiskScoreLabel(row)}`,
    `OI Δ24h ${row.openInterestChg24hPct?.toFixed(1) ?? "—"}% ${mark(reversalRiskOiChg24hPass(row))} (≥${REVERSAL_INSTANT_PUMP_MATRIX_OI_CHG24H_MIN_PCT})`,
    `Trend Gain ${row.trendGainPct?.toFixed(1) ?? "—"}% ${mark(reversalRiskTrendGainPass(row))} (${REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MIN_PCT}–${REVERSAL_INSTANT_PUMP_MATRIX_TREND_GAIN_MAX_PCT})`,
    `EMA20Δ4h ${row.priceVsEma20_4hPct?.toFixed(1) ?? "—"}% ${mark(reversalRiskEma20_4hDistPass(row))} (${REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MIN_PCT}–${REVERSAL_INSTANT_PUMP_MATRIX_EMA20_4H_DIST_MAX_PCT})`,
    `Vol×SMA ${row.signalVolVsSma?.toFixed(2) ?? "—"} ${mark(reversalRiskVolVsSmaPass(row))} (>${REVERSAL_INSTANT_PUMP_MATRIX_VOL_VS_SMA_MIN_EXCLUSIVE})`,
    `ATR%14D ${row.atrPct14d?.toFixed(1) ?? "—"}% ${mark(reversalRiskAtr14dPass(row))} (>${REVERSAL_INSTANT_PUMP_MATRIX_ATR14D_MIN_EXCLUSIVE})`,
  ].join(" · ");
}
