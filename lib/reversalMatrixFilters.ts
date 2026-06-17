/**
 * Matrix presets สำหรับกรองสถิติ Reversal
 */

import type {
  CandleReversalSignalBarTf,
  CandleReversalStatsRow,
  CandleReversalTradeSide,
} from "@/lib/candleReversalStatsClient";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";

export type ReversalMatrixFilter = "all" | "qualitySignal";

/** โปรไฟล์ Quality Signal ในตารางสถิติ (แต่ละ section) */
export type ReversalQualitySignalProfile = "short" | "long1h";

/** ข้อความเกณฑ์ Quality Signal (stats + auto-open) — Reversal Short */
export const REVERSAL_QUALITY_SIGNAL_CRITERIA = "Velocity > 1.4%/h";

/** Trend Velocity (%/h) — exclusive */
export const REVERSAL_QUALITY_SIGNAL_TREND_VELOCITY_MIN_EXCLUSIVE = 1.4;

/** ข้อความเกณฑ์ Quality Signal — Reversal Long 1H → fade SHORT */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA =
  "Trend Gain < 20% · Velocity < 2%/h · BTC EMA4H slope < 0%";

/** Trend Gain % — exclusive */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MAX_EXCLUSIVE = 20;
/** Trend Velocity (%/h) — exclusive */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_VELOCITY_MAX_EXCLUSIVE = 2;
/** BTC EMA(12) 4h slope 7d % — exclusive */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA4H_MAX_EXCLUSIVE = 0;

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

export function reversalQualitySignalCriteria(profile: ReversalQualitySignalProfile = "short"): string {
  return profile === "long1h"
    ? REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA
    : REVERSAL_QUALITY_SIGNAL_CRITERIA;
}

export function reversalMatrixFilterTitle(
  filter: ReversalMatrixFilter,
  profile: ReversalQualitySignalProfile = "short",
): string {
  if (filter === "qualitySignal") {
    return `Quality Signal: ${reversalQualitySignalCriteria(profile)}`;
  }
  return "Matrix preset — กรองชุดเงื่อนไขสำเร็จรูป";
}

function ema4hSlopeBelow(maxExclusive: number, ema4hSlopePct7d?: number | null): boolean {
  const pct = ema4hSlopePct7d;
  return pct != null && Number.isFinite(pct) && pct < maxExclusive;
}

function trendVelocityAboveMin(
  trendGainPct?: number | null,
  ageOfTrendHours?: number | null,
): boolean {
  const v = computePumpCycleTrendVelocity(trendGainPct, ageOfTrendHours);
  return v != null && v > REVERSAL_QUALITY_SIGNAL_TREND_VELOCITY_MIN_EXCLUSIVE;
}

/** ✨ Quality Signal — สถิติ Reversal · Long 1H */
export function reversalMatchesQualitySignalLong1h(input: {
  btcEma4hSlopePct7d?: number | null;
  trendGainPct?: number | null;
  ageOfTrendHours?: number | null;
}): boolean {
  const gain = input.trendGainPct;
  const vel = computePumpCycleTrendVelocity(input.trendGainPct, input.ageOfTrendHours);
  return (
    gain != null &&
    Number.isFinite(gain) &&
    gain < REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MAX_EXCLUSIVE &&
    vel != null &&
    vel < REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_VELOCITY_MAX_EXCLUSIVE &&
    ema4hSlopeBelow(REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA4H_MAX_EXCLUSIVE, input.btcEma4hSlopePct7d)
  );
}

/** ✨ Quality Signal — Reversal Short (และ 1D) */
export function reversalMatchesQualitySignal(input: {
  trendGainPct?: number | null;
  ageOfTrendHours?: number | null;
}): boolean {
  return trendVelocityAboveMin(input.trendGainPct, input.ageOfTrendHours);
}

export function reversalUsesLong1hQualitySignal(
  signalBarTf?: CandleReversalSignalBarTf | null,
  tradeSide?: CandleReversalTradeSide | null,
): boolean {
  return (signalBarTf ?? "1d") === "1h" && tradeSide === "long";
}

/** ✨ Quality Signal — stats / auto-open / alert header */
export function reversalMatchesQualitySignalForAlert(input: {
  signalBarTf?: CandleReversalSignalBarTf | null;
  tradeSide?: CandleReversalTradeSide | null;
  trendGainPct?: number | null;
  ageOfTrendHours?: number | null;
  btcEma4hSlopePct7d?: number | null;
}): boolean {
  if (reversalUsesLong1hQualitySignal(input.signalBarTf, input.tradeSide)) {
    return reversalMatchesQualitySignalLong1h({
      btcEma4hSlopePct7d: input.btcEma4hSlopePct7d,
      trendGainPct: input.trendGainPct,
      ageOfTrendHours: input.ageOfTrendHours,
    });
  }
  return reversalMatchesQualitySignal({
    trendGainPct: input.trendGainPct,
    ageOfTrendHours: input.ageOfTrendHours,
  });
}

/** ✨ Quality Signal (แถวสถิติ) */
export function reversalRowMatchesQualitySignalMatrix(row: CandleReversalStatsRow): boolean {
  return reversalMatchesQualitySignalForAlert({
    signalBarTf: row.signalBarTf,
    tradeSide: row.tradeSide,
    trendGainPct: row.trendGainPct,
    ageOfTrendHours: row.ageOfTrendHours,
    btcEma4hSlopePct7d: row.btcEma4hSlopePct7d,
  });
}

export function reversalStatsRowMatchesMatrixFilter(
  row: CandleReversalStatsRow,
  filter: ReversalMatrixFilter,
): boolean {
  if (filter === "all") return true;
  return reversalRowMatchesQualitySignalMatrix(row);
}
