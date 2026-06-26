import type {
  CandleReversalSignalBarTf,
  CandleReversalTradeSide,
} from "@/lib/candleReversalStatsClient";
import {
  REVERSAL_NEUTRAL_MATRIX_CRITERIA,
  reversalRowMatchesNeutralMatrix,
} from "@/lib/reversalMatrixFilters";

export type ReversalStatsPlayMode = "play" | "observe";

/** เหตุผลที่แถวเป็น observe */
export type ReversalObserveReason = "r_bar_range" | "neutral_matrix" | "lower_wick_long";

/** R% สัญญาณ — ต่ำกว่านี้ = Observe (1H Short) */
export const REVERSAL_SHORT_1H_OBSERVE_BAR_RANGE_PCT_MAX = 3;

export function reversalShort1hIsObserveSignal(input: {
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
}): boolean {
  if ((input.signalBarTf ?? "1d") !== "1h") return false;
  if ((input.tradeSide ?? "short") !== "short") return false;
  const r = input.barRangePctSignal;
  return r != null && Number.isFinite(r) && r >= 0 && r < REVERSAL_SHORT_1H_OBSERVE_BAR_RANGE_PCT_MAX;
}

/** Short ที่ไส้ล่างยาวกว่าไส้บน → observe ฝั่ง Long (hammer / rejection ล่าง) */
export function reversalShortLowerWickDominantIsObserveSignal(input: {
  tradeSide?: CandleReversalTradeSide | null;
  wickRatio?: number | null;
  lowerWickRatio?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
}): boolean {
  if ((input.tradeSide ?? "short") !== "short") return false;
  if (
    input.wickRatio != null &&
    input.lowerWickRatio != null &&
    Number.isFinite(input.wickRatio) &&
    Number.isFinite(input.lowerWickRatio)
  ) {
    return input.lowerWickRatio > input.wickRatio;
  }
  const upper = input.wickRatioPct;
  const lower = input.lowerWickRatioPct;
  if (upper == null || lower == null || !Number.isFinite(upper) || !Number.isFinite(lower)) {
    return false;
  }
  return lower > upper;
}

/** Neutral matrix — เก็บ stats observe ก่อนเล่น */
export function reversalNeutralMatrixIsObserveSignal(
  row: Parameters<typeof reversalRowMatchesNeutralMatrix>[0],
): boolean {
  return reversalRowMatchesNeutralMatrix(row);
}

export function reversalIsObserveSignal(input: {
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  wickRatio?: number | null;
  lowerWickRatio?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
}): boolean {
  if (
    reversalShortLowerWickDominantIsObserveSignal({
      tradeSide: input.tradeSide,
      wickRatio: input.wickRatio,
      lowerWickRatio: input.lowerWickRatio,
      wickRatioPct: input.wickRatioPct,
      lowerWickRatioPct: input.lowerWickRatioPct,
    })
  ) {
    return true;
  }
  if (
    reversalShort1hIsObserveSignal({
      signalBarTf: input.signalBarTf,
      tradeSide: input.tradeSide,
      barRangePctSignal: input.barRangePctSignal,
    })
  ) {
    return true;
  }
  return reversalNeutralMatrixIsObserveSignal({
    trendGainPct: input.trendGainPct,
    ema20_4hSlopePct7d: input.ema20_4hSlopePct7d,
    ema4hSlopePct7d: input.ema4hSlopePct7d,
  });
}

export function reversalResolveObserveReason(input: {
  observeReason?: ReversalObserveReason | null;
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  wickRatio?: number | null;
  lowerWickRatio?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
}): ReversalObserveReason | undefined {
  if (input.observeReason) return input.observeReason;
  if (
    reversalShortLowerWickDominantIsObserveSignal({
      tradeSide: input.tradeSide,
      wickRatio: input.wickRatio,
      lowerWickRatio: input.lowerWickRatio,
      wickRatioPct: input.wickRatioPct,
      lowerWickRatioPct: input.lowerWickRatioPct,
    })
  ) {
    return "lower_wick_long";
  }
  if (
    reversalShort1hIsObserveSignal({
      signalBarTf: input.signalBarTf,
      tradeSide: input.tradeSide,
      barRangePctSignal: input.barRangePctSignal,
    })
  ) {
    return "r_bar_range";
  }
  if (
    reversalNeutralMatrixIsObserveSignal({
      trendGainPct: input.trendGainPct,
      ema20_4hSlopePct7d: input.ema20_4hSlopePct7d,
      ema4hSlopePct7d: input.ema4hSlopePct7d,
    })
  ) {
    return "neutral_matrix";
  }
  return undefined;
}

export function reversalStatsObserveBadgeTitle(row: {
  observeReason?: ReversalObserveReason | null;
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
}): string {
  const reason = reversalResolveObserveReason(row);
  if (reason === "lower_wick_long") {
    return "Observe Long — ไส้ล่าง > ไส้บน (hammer) เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram";
  }
  if (reason === "neutral_matrix") {
    return `Neutral: ${REVERSAL_NEUTRAL_MATRIX_CRITERIA} — เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram`;
  }
  if (reason === "r_bar_range") {
    return `R% < ${REVERSAL_SHORT_1H_OBSERVE_BAR_RANGE_PCT_MAX}% (1H Short) — เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram`;
  }
  return "เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram";
}

export function reversalStatsRowIsObserve(row: {
  statsPlayMode?: ReversalStatsPlayMode | null;
}): boolean {
  return row.statsPlayMode === "observe";
}

export function reversalStatsPlayModeLabel(row: {
  statsPlayMode?: ReversalStatsPlayMode | null;
  observeReason?: ReversalObserveReason | null;
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
}): string {
  if (!reversalStatsRowIsObserve(row)) return "play";
  const reason = reversalResolveObserveReason(row);
  if (reason === "lower_wick_long") return "observe:long_wick";
  if (reason === "neutral_matrix") return "observe:neutral";
  if (reason === "r_bar_range") return "observe:r_low";
  return "observe";
}

/** pending ที่บล็อก play ใหม่ — observe pending ไม่นับ */
export function reversalStatsRowBlocksPlayPending(row: {
  outcome?: string | null;
  statsPlayMode?: ReversalStatsPlayMode | null;
}): boolean {
  return row.outcome === "pending" && !reversalStatsRowIsObserve(row);
}

export function excludeObserveStatsRows<
  T extends { statsPlayMode?: ReversalStatsPlayMode | null },
>(rows: readonly T[]): T[] {
  return rows.filter((r) => !reversalStatsRowIsObserve(r));
}

export type ReversalObserveFilter = "all" | "observe" | "play";

export const REVERSAL_OBSERVE_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalObserveFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "observe", label: "👁 Observe" },
  { value: "play", label: "Play" },
];

export function reversalObserveFilterLabel(filter: ReversalObserveFilter): string {
  return REVERSAL_OBSERVE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalObserveFilterTitle(filter: ReversalObserveFilter): string {
  if (filter === "all") return "ทั้งหมด — รวม Play และ Observe";
  if (filter === "observe") {
    return "Observe — เก็บสถิติอย่างเดียว (R% < 3 · Neutral · ไส้ล่าง>บน→Long) · ไม่เล่น · ไม่ส่ง Telegram";
  }
  return "Play — แถวที่เล่นจริง (ไม่รวม Observe)";
}

export function reversalStatsRowMatchesObserveFilter(
  row: { statsPlayMode?: ReversalStatsPlayMode | null },
  filter: ReversalObserveFilter,
): boolean {
  if (filter === "all") return true;
  const isObserve = reversalStatsRowIsObserve(row);
  return filter === "observe" ? isObserve : !isObserve;
}
