/**
 * Matrix presets สำหรับกรองสถิติ Reversal
 */

import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

export type ReversalMatrixFilter = "all" | "qualitySignal";

export const REVERSAL_MATRIX_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalMatrixFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "qualitySignal", label: "✨ Quality Signal" },
];

export function reversalMatrixFilterLabel(filter: ReversalMatrixFilter): string {
  return REVERSAL_MATRIX_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalMatrixFilterTitle(filter: ReversalMatrixFilter): string {
  if (filter === "qualitySignal") {
    return "Quality Signal: เขียว ≥ 1 วัน · Wick ≤ 80% · เนื้อแท่ง > 59%";
  }
  return "Matrix preset — กรองชุดเงื่อนไขสำเร็จรูป";
}

function greenDaysBeforeSignalAtLeast(
  row: Pick<CandleReversalStatsRow, "greenDaysBeforeSignal">,
  minDays: number,
): boolean {
  const g = row.greenDaysBeforeSignal;
  return g != null && Number.isFinite(g) && Math.floor(g) >= minDays;
}

/** ไส้บน ÷ ช่วงแท่ง (%) — ≤ 80% = ratio ≤ 0.8 */
function wickRatioPctAtMost(row: Pick<CandleReversalStatsRow, "wickRatioPct">, maxPct: number): boolean {
  const w = row.wickRatioPct;
  return w != null && Number.isFinite(w) && w <= maxPct;
}

function bodyPctAbove(row: Pick<CandleReversalStatsRow, "bodyPct">, minPct: number): boolean {
  const b = row.bodyPct;
  return b != null && Number.isFinite(b) && b > minPct;
}

/** ✨ Quality Signal */
export function reversalRowMatchesQualitySignalMatrix(row: CandleReversalStatsRow): boolean {
  if (!greenDaysBeforeSignalAtLeast(row, 1)) return false;
  if (!wickRatioPctAtMost(row, 80)) return false;
  if (!bodyPctAbove(row, 59)) return false;
  return true;
}

export function reversalStatsRowMatchesMatrixFilter(
  row: CandleReversalStatsRow,
  filter: ReversalMatrixFilter,
): boolean {
  if (filter === "all") return true;
  return reversalRowMatchesQualitySignalMatrix(row);
}
