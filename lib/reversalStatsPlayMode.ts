import type {
  CandleReversalSignalBarTf,
  CandleReversalTradeSide,
} from "@/lib/candleReversalStatsClient";

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
