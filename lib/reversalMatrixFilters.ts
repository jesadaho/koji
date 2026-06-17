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
export const REVERSAL_QUALITY_SIGNAL_CRITERIA = "Trend Gain 20–50% · หรือ Velocity > 2%/h";

/** Trend Gain % — inclusive */
export const REVERSAL_QUALITY_SIGNAL_TREND_GAIN_MIN_PCT = 20;
export const REVERSAL_QUALITY_SIGNAL_TREND_GAIN_MAX_PCT = 50;
/** Trend Velocity (%/h) — exclusive */
export const REVERSAL_QUALITY_SIGNAL_TREND_VELOCITY_MIN_EXCLUSIVE = 2;

/** ข้อความเกณฑ์ Quality Signal — Reversal Long 1H → fade SHORT */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA =
  "((BTC∠1d > −8% (fade SHORT) OR BTC∠4h > −13%) OR ATR%14D < 8) and BTC∠4h < 3% and ATR%14D < 40";

/** Long 1H stats — BTC EMA(12) 1d slope ต้องสูงกว่า (exclusive) */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA1D_MIN_PCT = -8;
/** Long 1H stats — BTC EMA(12) 4h slope ต้องสูงกว่า (exclusive) */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA4H_MIN_PCT = -13;
/** Long 1H stats — BTC EMA(12) 4h slope ต้องต่ำกว่า (exclusive) */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA4H_MAX_PCT = 3;
/** Long 1H stats — ATR(14) 1d ÷ close ต้องต่ำกว่า (exclusive) — ทางเลือกใน OR */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_ATR_MAX_PCT = 8;
/** Long 1H stats — ATR(14) 1d ÷ close ต้องต่ำกว่า (exclusive) — gate บังคับทุก path */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_ATR_CEILING_PCT = 40;

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

function emaSlopeAbove(minExclusive: number, slopePct?: number | null): boolean {
  const pct = slopePct;
  return pct != null && Number.isFinite(pct) && pct > minExclusive;
}

function atrPct14dBelow(maxExclusive: number, atrPct14d?: number | null): boolean {
  const v = atrPct14d;
  return v != null && Number.isFinite(v) && v > 0 && v < maxExclusive;
}

function trendGainInBand(trendGainPct?: number | null): boolean {
  const pct = trendGainPct;
  return (
    pct != null &&
    Number.isFinite(pct) &&
    pct >= REVERSAL_QUALITY_SIGNAL_TREND_GAIN_MIN_PCT &&
    pct <= REVERSAL_QUALITY_SIGNAL_TREND_GAIN_MAX_PCT
  );
}

function trendVelocityAboveMin(
  trendGainPct?: number | null,
  ageOfTrendHours?: number | null,
): boolean {
  const v = computePumpCycleTrendVelocity(trendGainPct, ageOfTrendHours);
  return v != null && v > REVERSAL_QUALITY_SIGNAL_TREND_VELOCITY_MIN_EXCLUSIVE;
}

/** BTC∠1d > −8% OR BTC∠4h > −13% */
function reversalMatchesQualitySignalLong1hBtcBranch(input: {
  btcEma1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
}): boolean {
  return (
    emaSlopeAbove(
      REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA1D_MIN_PCT,
      input.btcEma1dSlopePct7d,
    ) ||
    emaSlopeAbove(
      REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA4H_MIN_PCT,
      input.btcEma4hSlopePct7d,
    )
  );
}

/** ✨ Quality Signal — สถิติ Reversal · Long 1H */
export function reversalMatchesQualitySignalLong1h(input: {
  btcEma1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  atrPct14d?: number | null;
}): boolean {
  if (
    !ema4hSlopeBelow(
      REVERSAL_QUALITY_SIGNAL_LONG_1H_BTC_EMA4H_MAX_PCT,
      input.btcEma4hSlopePct7d,
    )
  ) {
    return false;
  }
  if (!atrPct14dBelow(REVERSAL_QUALITY_SIGNAL_LONG_1H_ATR_CEILING_PCT, input.atrPct14d)) {
    return false;
  }
  if (atrPct14dBelow(REVERSAL_QUALITY_SIGNAL_LONG_1H_ATR_MAX_PCT, input.atrPct14d)) {
    return true;
  }
  return reversalMatchesQualitySignalLong1hBtcBranch(input);
}

/** ✨ Quality Signal — Reversal Short (และ 1D) */
export function reversalMatchesQualitySignal(input: {
  trendGainPct?: number | null;
  ageOfTrendHours?: number | null;
}): boolean {
  return (
    trendGainInBand(input.trendGainPct) ||
    trendVelocityAboveMin(input.trendGainPct, input.ageOfTrendHours)
  );
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
  btcEma1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  atrPct14d?: number | null;
}): boolean {
  if (reversalUsesLong1hQualitySignal(input.signalBarTf, input.tradeSide)) {
    return reversalMatchesQualitySignalLong1h({
      btcEma1dSlopePct7d: input.btcEma1dSlopePct7d,
      btcEma4hSlopePct7d: input.btcEma4hSlopePct7d,
      atrPct14d: input.atrPct14d,
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
    btcEma1dSlopePct7d: row.btcEma1dSlopePct7d,
    btcEma4hSlopePct7d: row.btcEma4hSlopePct7d,
    atrPct14d: row.atrPct14d,
  });
}

export function reversalStatsRowMatchesMatrixFilter(
  row: CandleReversalStatsRow,
  filter: ReversalMatrixFilter,
): boolean {
  if (filter === "all") return true;
  return reversalRowMatchesQualitySignalMatrix(row);
}
