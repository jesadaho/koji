import type {
  CandleReversalSignalBarTf,
  CandleReversalTradeSide,
} from "@/lib/candleReversalStatsClient";
import {
  REVERSAL_NEUTRAL_MATRIX_CRITERIA,
  REVERSAL_WEAK_TREND_MATRIX_CRITERIA,
  reversalRowMatchesNeutralMatrix,
  reversalWeakTrendPass,
  type ReversalLongCandidateRowSlice,
} from "@/lib/reversalMatrixFilters";

export type ReversalStatsPlayMode = "play" | "observe";

/** เหตุผลที่แถวเป็น observe */
export type ReversalObserveReason =
  | "r_bar_range"
  | "neutral_matrix"
  | "lower_wick_long"
  | "atr14d_high";

/** ATR%14D สูงกว่านี้ = Observe เฉพาะสัญญาณ Short */
export const REVERSAL_OBSERVE_ATR14D_PCT_MIN = 25;

export const REVERSAL_OBSERVE_ATR14D_CRITERIA = `ATR%14D > ${REVERSAL_OBSERVE_ATR14D_PCT_MIN}% (Short)`;

/** R% สัญญาณ — ต่ำกว่านี้ = Observe (1H Short) */
export const REVERSAL_SHORT_1H_OBSERVE_BAR_RANGE_PCT_MAX = 3;

export const REVERSAL_OBSERVE_R_BAR_RANGE_CRITERIA = `R% สัญญาณ < ${REVERSAL_SHORT_1H_OBSERVE_BAR_RANGE_PCT_MAX}% (1H Short) · ไม่ใช่ Weak Trend (${REVERSAL_WEAK_TREND_MATRIX_CRITERIA})`;

/** ไส้ล่างต้องสูงกว่านี้ (%) — ใช้ร่วมกับ ไส้ล่าง > ไส้บน สำหรับ Observe */
export const REVERSAL_OBSERVE_LOWER_WICK_MIN_PCT = 45;

export const REVERSAL_OBSERVE_LOWER_WICK_LONG_CRITERIA =
  "ไส้ล่าง > ไส้บน · ไส้ล่าง > 45% (Short → Observe Long / hammer)";

/** คั่นระหว่างชุดเกณฑ์ Observe ระดับบน — ผ่านอย่างใดอย่างหนึ่ง (OR) */
export const REVERSAL_OBSERVE_CRITERIA_OR_JOIN = " หรือ ";

/** OR ระหว่างเกณฑ์ Observe — ผ่านอย่างใดอย่างหนึ่ง */
export const REVERSAL_OBSERVE_OR_CRITERIA_SUMMARY = [
  REVERSAL_OBSERVE_R_BAR_RANGE_CRITERIA,
  `Neutral: ${REVERSAL_NEUTRAL_MATRIX_CRITERIA}`,
  REVERSAL_OBSERVE_LOWER_WICK_LONG_CRITERIA,
  REVERSAL_OBSERVE_ATR14D_CRITERIA,
].join(REVERSAL_OBSERVE_CRITERIA_OR_JOIN);

/** สรุปเกณฑ์ Observe ทั้งหมด */
export const REVERSAL_OBSERVE_CRITERIA_SUMMARY = REVERSAL_OBSERVE_OR_CRITERIA_SUMMARY;

export type ReversalObserveEvaluateInput = {
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
  ema20_1hSlopePct7d?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  wickRatio?: number | null;
  lowerWickRatio?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
  atrPct14d?: number | null;
} & ReversalLongCandidateRowSlice;

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

export function reversalShort1hRBarRangeObserveIsObserveSignal(input: {
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  barRangePctSignal?: number | null;
  ema20_1hSlopePct7d?: number | null;
}): boolean {
  if (
    !reversalShort1hIsObserveSignal({
      signalBarTf: input.signalBarTf,
      tradeSide: input.tradeSide,
      barRangePctSignal: input.barRangePctSignal,
    })
  ) {
    return false;
  }
  return !reversalWeakTrendPass({
    barRangePctSignal: input.barRangePctSignal,
    ema20_1hSlopePct7d: input.ema20_1hSlopePct7d,
  });
}

/** Short ที่ไส้ล่างยาวกว่าไส้บน และไส้ล่าง > 45% (hammer / rejection ล่าง) */
export function reversalShortLowerWickPct(input: {
  lowerWickRatio?: number | null;
  lowerWickRatioPct?: number | null;
}): number | null {
  if (input.lowerWickRatio != null && Number.isFinite(input.lowerWickRatio)) {
    return input.lowerWickRatio * 100;
  }
  if (input.lowerWickRatioPct != null && Number.isFinite(input.lowerWickRatioPct)) {
    return input.lowerWickRatioPct;
  }
  return null;
}

export function reversalShortLowerWickDominantPass(input: {
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

export function reversalShortLowerWickDominantIsObserveSignal(input: {
  tradeSide?: CandleReversalTradeSide | null;
  wickRatio?: number | null;
  lowerWickRatio?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
}): boolean {
  if ((input.tradeSide ?? "short") !== "short") return false;
  const lowerPct = reversalShortLowerWickPct(input);
  if (lowerPct == null || lowerPct <= REVERSAL_OBSERVE_LOWER_WICK_MIN_PCT) return false;
  return reversalShortLowerWickDominantPass(input);
}

export type ReversalLowerWickDominantFilter = "all" | "lower_gt_upper";

export const REVERSAL_LOWER_WICK_DOMINANT_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalLowerWickDominantFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "lower_gt_upper", label: "ไส้ล่าง>บน" },
];

export function reversalLowerWickDominantFilterLabel(
  filter: ReversalLowerWickDominantFilter,
): string {
  return REVERSAL_LOWER_WICK_DOMINANT_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalLowerWickDominantFilterTitle(
  filter: ReversalLowerWickDominantFilter,
): string {
  if (filter === "all") return "ทั้งหมด — ไม่กรองไส้";
  return "ไส้ล่าง > ไส้บน (Short · คอลัมน์ไส้ล่าง vs ไส้บน)";
}

export function reversalStatsRowMatchesLowerWickDominantFilter(
  row: {
    tradeSide?: CandleReversalTradeSide | null;
    wickRatioPct?: number | null;
    lowerWickRatioPct?: number | null;
  },
  filter: ReversalLowerWickDominantFilter,
): boolean {
  if (filter === "all") return true;
  return reversalShortLowerWickDominantPass({
    tradeSide: row.tradeSide,
    wickRatioPct: row.wickRatioPct,
    lowerWickRatioPct: row.lowerWickRatioPct,
  });
}

/** Neutral matrix — เก็บ stats observe ก่อนเล่น */
export function reversalNeutralMatrixIsObserveSignal(
  row: Parameters<typeof reversalRowMatchesNeutralMatrix>[0],
): boolean {
  return reversalRowMatchesNeutralMatrix(row);
}

/** Short + ATR%14D สูง — volatility สูงเกินเล่น (ไม่ต้องทิศแนะนำ Long) */
export function reversalShortAtr14dHighIsObserveSignal(input: {
  tradeSide?: CandleReversalTradeSide | null;
  atrPct14d?: number | null;
}): boolean {
  if ((input.tradeSide ?? "short") !== "short") return false;
  const atr = input.atrPct14d;
  return atr != null && Number.isFinite(atr) && atr > REVERSAL_OBSERVE_ATR14D_PCT_MIN;
}

function reversalObserveOrCriterionPass(input: ReversalObserveEvaluateInput): boolean {
  if (reversalShortAtr14dHighIsObserveSignal(input)) return true;
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
    reversalShort1hRBarRangeObserveIsObserveSignal({
      signalBarTf: input.signalBarTf,
      tradeSide: input.tradeSide,
      barRangePctSignal: input.barRangePctSignal,
      ema20_1hSlopePct7d: input.ema20_1hSlopePct7d,
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

export function reversalIsObserveSignal(input: ReversalObserveEvaluateInput): boolean {
  return reversalObserveOrCriterionPass(input);
}

export function reversalResolveObserveReason(input: {
  observeReason?: ReversalObserveReason | null;
} & ReversalObserveEvaluateInput): ReversalObserveReason | undefined {
  if (input.observeReason) return input.observeReason;
  if (reversalShortAtr14dHighIsObserveSignal(input)) return "atr14d_high";
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
    reversalShort1hRBarRangeObserveIsObserveSignal({
      signalBarTf: input.signalBarTf,
      tradeSide: input.tradeSide,
      barRangePctSignal: input.barRangePctSignal,
      ema20_1hSlopePct7d: input.ema20_1hSlopePct7d,
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
  ema20_1hSlopePct7d?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
  atrPct14d?: number | null;
}): string {
  const reason = reversalResolveObserveReason(row);
  if (reason === "lower_wick_long") {
    return `Observe — ${REVERSAL_OBSERVE_LOWER_WICK_LONG_CRITERIA} · เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram`;
  }
  if (reason === "neutral_matrix") {
    return `Observe — Neutral: ${REVERSAL_NEUTRAL_MATRIX_CRITERIA} — เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram`;
  }
  if (reason === "r_bar_range") {
    return `Observe — ${REVERSAL_OBSERVE_R_BAR_RANGE_CRITERIA} — เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram`;
  }
  if (reason === "atr14d_high") {
    return `Observe — ${REVERSAL_OBSERVE_ATR14D_CRITERIA} — เก็บสถิติอย่างเดียว ไม่เล่น · ไม่ส่ง Telegram`;
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
  ema20_1hSlopePct7d?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
  atrPct14d?: number | null;
}): string {
  if (!reversalStatsRowIsObserve(row)) return "play";
  const reason = reversalResolveObserveReason(row);
  if (reason === "lower_wick_long") return "observe:long_wick";
  if (reason === "neutral_matrix") return "observe:neutral";
  if (reason === "r_bar_range") return "observe:r_low";
  if (reason === "atr14d_high") return "observe:atr14d";
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
    return `Observe — แถวที่เก็บเป็น observe เท่านั้น (ไม่เล่น · ไม่ส่ง Telegram)`;
  }
  return "Play — แถวที่ส่ง Telegram / เล่นจริง (ไม่รวม Observe)";
}

/** คำอธิบายเกณฑ์ Observe แบบเต็ม — แสดงใต้ตัวกรอง */
export function reversalObserveFilterDetail(filter: ReversalObserveFilter): string | null {
  if (filter === "all") return null;
  if (filter === "observe") {
    return [
      "เกณฑ์ตอนแจ้ง (ผ่านอย่างใดอย่างหนึ่ง):",
      REVERSAL_OBSERVE_OR_CRITERIA_SUMMARY,
      "≠ ตัวกรอง R%<3% ด้านบน — ตัวกรอง R% รวมแถว Play ทุก TF/ทิศ",
      "แถวเก่าก่อนมี Observe ที่ R%<3% ยังเป็น Play",
    ].join(" · ");
  }
  return "รวมแถวที่ส่ง Telegram / เล่นจริง · แถวเก่า R%<3% ที่ยังไม่ถูก mark observe";
}

export function reversalStatsRowMatchesObserveFilter(
  row: { statsPlayMode?: ReversalStatsPlayMode | null },
  filter: ReversalObserveFilter,
): boolean {
  if (filter === "all") return true;
  const isObserve = reversalStatsRowIsObserve(row);
  return filter === "observe" ? isObserve : !isObserve;
}
