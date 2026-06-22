import type {
  CandleReversalSignalBarTf,
  CandleReversalTradeSide,
} from "@/lib/candleReversalStatsClient";
import {
  REVERSAL_NEUTRAL_MATRIX_CRITERIA,
  reversalRowMatchesNeutralMatrix,
} from "@/lib/reversalMatrixFilters";

export type ReversalStatsPlayMode = "play" | "observe";

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
}): boolean {
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

export function reversalStatsObserveBadgeTitle(row: {
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
}): string {
  if (reversalNeutralMatrixIsObserveSignal(row)) {
    return `Neutral: ${REVERSAL_NEUTRAL_MATRIX_CRITERIA} — เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram`;
  }
  if (
    reversalShort1hIsObserveSignal({
      signalBarTf: row.signalBarTf,
      tradeSide: row.tradeSide,
      barRangePctSignal: row.barRangePctSignal,
    })
  ) {
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
}): ReversalStatsPlayMode {
  return reversalStatsRowIsObserve(row) ? "observe" : "play";
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
    return "Observe — เก็บสถิติอย่างเดียว (R% < 3 · Neutral matrix) · ไม่เล่น · ไม่ส่ง Telegram";
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
