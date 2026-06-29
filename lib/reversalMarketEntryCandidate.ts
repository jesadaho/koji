import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

export const REVERSAL_MARKET_ENTRY_EMA20_15M_DIFF_MIN_PCT = 6.5;
export const REVERSAL_MARKET_ENTRY_VOL_VS_SMA_MIN = 4;
export const REVERSAL_MARKET_ENTRY_LOWER_WICK_MAX_PCT = 15;

export const REVERSAL_MARKET_ENTRY_CANDIDATE_CRITERIA =
  `EMA20Δ15m > ${REVERSAL_MARKET_ENTRY_EMA20_15M_DIFF_MIN_PCT}% · Vol×SMA > ${REVERSAL_MARKET_ENTRY_VOL_VS_SMA_MIN} · Lower Wick < ${REVERSAL_MARKET_ENTRY_LOWER_WICK_MAX_PCT}% · ทิศ Short`;

export type ReversalMarketEntryCandidateRowSlice = Pick<
  CandleReversalStatsRow,
  "priceVsEma20_15mPct" | "signalVolVsSma" | "lowerWickRatioPct"
>;

function finiteGt(v: number | null | undefined, min: number): boolean {
  return v != null && Number.isFinite(v) && v > min;
}

function finiteLt(v: number | null | undefined, max: number): boolean {
  return v != null && Number.isFinite(v) && v < max;
}

export function reversalMarketEntryEma20_15mDiffPass(
  row: ReversalMarketEntryCandidateRowSlice,
): boolean {
  return finiteGt(row.priceVsEma20_15mPct, REVERSAL_MARKET_ENTRY_EMA20_15M_DIFF_MIN_PCT);
}

export function reversalMarketEntryVolVsSmaPass(
  row: ReversalMarketEntryCandidateRowSlice,
): boolean {
  return finiteGt(row.signalVolVsSma, REVERSAL_MARKET_ENTRY_VOL_VS_SMA_MIN);
}

export function reversalMarketEntryLowerWickPass(
  row: ReversalMarketEntryCandidateRowSlice,
): boolean {
  return finiteLt(row.lowerWickRatioPct, REVERSAL_MARKET_ENTRY_LOWER_WICK_MAX_PCT);
}

export function reversalRowIsMarketEntryCandidate(row: ReversalMarketEntryCandidateRowSlice): boolean {
  return (
    reversalMarketEntryEma20_15mDiffPass(row) &&
    reversalMarketEntryVolVsSmaPass(row) &&
    reversalMarketEntryLowerWickPass(row)
  );
}

export function reversalMarketEntryCandidateTitle(row: ReversalMarketEntryCandidateRowSlice): string {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  return [
    reversalRowIsMarketEntryCandidate(row) ? "Market Entry Candidate" : "ไม่ใช่ Market Entry Candidate",
    `EMA20Δ15m ${row.priceVsEma20_15mPct?.toFixed(1) ?? "—"}% ${mark(reversalMarketEntryEma20_15mDiffPass(row))} (>${REVERSAL_MARKET_ENTRY_EMA20_15M_DIFF_MIN_PCT})`,
    `Vol×SMA ${row.signalVolVsSma?.toFixed(2) ?? "—"} ${mark(reversalMarketEntryVolVsSmaPass(row))} (>${REVERSAL_MARKET_ENTRY_VOL_VS_SMA_MIN})`,
    `Lower Wick ${row.lowerWickRatioPct?.toFixed(1) ?? "—"}% ${mark(reversalMarketEntryLowerWickPass(row))} (<${REVERSAL_MARKET_ENTRY_LOWER_WICK_MAX_PCT})`,
  ].join(" · ");
}
