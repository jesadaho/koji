/**
 * Matrix presets สำหรับกรองสถิติ Reversal
 */

import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

export type ReversalMatrixFilter = "all" | "qualitySignal";

/** ข้อความเกณฑ์ Quality Signal (stats + auto-open) — Reversal Short */
export const REVERSAL_QUALITY_SIGNAL_CRITERIA =
  "(เขียว ≥ 1 วัน · Wick ≤ 0.20 · Range < 4.5) หรือ (EMA4H < 0% และ > −30%)";

export const REVERSAL_QUALITY_SIGNAL_MAX_WICK_RATIO = 0.2;
export const REVERSAL_QUALITY_SIGNAL_MAX_RANGE_SCORE = 4.5;
/** EMA(12) 4h slope 7d — ช่วงล่าง (exclusive) */
export const REVERSAL_QUALITY_SIGNAL_EMA4H_MIN_PCT = -30;
/** EMA(12) 4h slope 7d — ช่วงบน (exclusive) */
export const REVERSAL_QUALITY_SIGNAL_EMA4H_MAX_PCT = 0;

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
    return `Quality Signal: ${REVERSAL_QUALITY_SIGNAL_CRITERIA}`;
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

/** ไส้บน ÷ ช่วงแท่ง — ทศนิยม 0–1 (หรือ % 0–100 auto-detect) */
function wickRatioAtMost(
  input: {
    wickRatio?: number | null;
    wickRatioPct?: number | null;
  },
  maxRatio: number,
): boolean {
  let w = input.wickRatio;
  if (w == null && input.wickRatioPct != null && Number.isFinite(input.wickRatioPct)) {
    w = input.wickRatioPct <= 1 ? input.wickRatioPct : input.wickRatioPct / 100;
  }
  if (w == null || !Number.isFinite(w)) return false;
  const ratio = w <= 1 ? w : w / 100;
  return ratio <= maxRatio;
}

function rangeScoreBelow(maxExclusive: number, rangeScore?: number | null): boolean {
  const r = rangeScore;
  return r != null && Number.isFinite(r) && r < maxExclusive;
}

function reversalMatchesQualitySignalClassic(input: {
  greenDaysBeforeSignal?: number | null;
  wickRatio?: number | null;
  wickRatioPct?: number | null;
  rangeScore?: number | null;
}): boolean {
  if (!greenDaysBeforeSignalAtLeast({ greenDaysBeforeSignal: input.greenDaysBeforeSignal }, 1)) {
    return false;
  }
  if (!wickRatioAtMost(input, REVERSAL_QUALITY_SIGNAL_MAX_WICK_RATIO)) return false;
  if (!rangeScoreBelow(REVERSAL_QUALITY_SIGNAL_MAX_RANGE_SCORE, input.rangeScore)) return false;
  return true;
}

/** EMA(12) 4h slope 7d — อยู่ระหว่าง −30% ถึง 0% (ไม่รวมขอบ) */
function reversalMatchesQualitySignalEma4hBand(ema4hSlopePct7d?: number | null): boolean {
  const pct = ema4hSlopePct7d;
  if (pct == null || !Number.isFinite(pct)) return false;
  return (
    pct < REVERSAL_QUALITY_SIGNAL_EMA4H_MAX_PCT &&
    pct > REVERSAL_QUALITY_SIGNAL_EMA4H_MIN_PCT
  );
}

/** ✨ Quality Signal — ใช้ร่วม stats filter และ Reversal auto-open gate */
export function reversalMatchesQualitySignal(input: {
  greenDaysBeforeSignal?: number | null;
  /** ไส้บน / range — ทศนิยม 0–1 หรือ % 0–100 (auto-detect) */
  wickRatio?: number | null;
  wickRatioPct?: number | null;
  /** ช่วงแท่ง ÷ ATR100 (คอลัมน์ Range ในสถิติ) */
  rangeScore?: number | null;
  /** EMA(12) 4h slope 7 วัน % */
  ema4hSlopePct7d?: number | null;
}): boolean {
  return (
    reversalMatchesQualitySignalClassic(input) ||
    reversalMatchesQualitySignalEma4hBand(input.ema4hSlopePct7d)
  );
}

/** ✨ Quality Signal (แถวสถิติ) */
export function reversalRowMatchesQualitySignalMatrix(row: CandleReversalStatsRow): boolean {
  return reversalMatchesQualitySignal({
    greenDaysBeforeSignal: row.greenDaysBeforeSignal,
    wickRatioPct: row.wickRatioPct,
    rangeScore: row.rangeScore,
    ema4hSlopePct7d: row.ema4hSlopePct7d,
  });
}

export function reversalStatsRowMatchesMatrixFilter(
  row: CandleReversalStatsRow,
  filter: ReversalMatrixFilter,
): boolean {
  if (filter === "all") return true;
  return reversalRowMatchesQualitySignalMatrix(row);
}
