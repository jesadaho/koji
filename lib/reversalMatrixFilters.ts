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
export const REVERSAL_QUALITY_SIGNAL_CRITERIA =
  "Velocity > 1.4%/h · หรือ ศ/ส (BKK)";

/** Trend Velocity (%/h) — exclusive */
export const REVERSAL_QUALITY_SIGNAL_TREND_VELOCITY_MIN_EXCLUSIVE = 1.4;

/** วัน BKK ที่ผ่าน Quality Signal Short โดยไม่ต้องดู Velocity — 5=ศุกร์ · 6=เสาร์ */
export const REVERSAL_QUALITY_SIGNAL_SHORT_BKK_DOW_INDICES = [5, 6] as const;

/** ข้อความเกณฑ์ Quality Signal — Reversal Long 1H → fade SHORT */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA =
  "Trend Gain 5–20% · Vol×SMA 2–5× · หรือ ศ (BKK)";

/** เกณฑ์กรองสัญญาณ Long ในตาราง 1H รวม (stats) */
export const REVERSAL_LONG_1H_STATS_FILTER_CRITERIA = "EMA1H > 50% · EMA20 Diff 15–30%";

/** EMA20 1h slope 7d — exclusive lower bound */
export const REVERSAL_LONG_1H_STATS_EMA1H_SLOPE_MIN_EXCLUSIVE = 50;
/** EMA20 dist % บน 1h — inclusive */
export const REVERSAL_LONG_1H_STATS_EMA20_DIST_MIN_PCT = 15;
export const REVERSAL_LONG_1H_STATS_EMA20_DIST_MAX_PCT = 30;

/** วัน BKK ที่ผ่าน Quality Signal Long 1H โดยไม่ต้องดู Trend Gain / Vol×SMA — 5=ศุกร์ */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_BKK_DOW_INDICES = [5] as const;

/** Trend Gain % — inclusive */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MIN_PCT = 5;
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MAX_PCT = 20;
/** Vol×SMA — inclusive */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MIN = 2;
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MAX = 5;

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

function trendGainInLong1hQualityRange(trendGainPct?: number | null): boolean {
  const gain = trendGainPct;
  return (
    gain != null &&
    Number.isFinite(gain) &&
    gain >= REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MIN_PCT &&
    gain <= REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MAX_PCT
  );
}

function volVsSmaInLong1hQualityRange(signalVolVsSma?: number | null): boolean {
  const vol = signalVolVsSma;
  return (
    vol != null &&
    Number.isFinite(vol) &&
    vol >= REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MIN &&
    vol <= REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MAX
  );
}

/** BKK = UTC+7 — 0 = Sunday … 6 = Saturday */
function bkkDayOfWeekIndex(ms: number): number {
  if (!Number.isFinite(ms)) return -1;
  return new Date(ms + 7 * 3600 * 1000).getUTCDay();
}

export function reversalQualitySignalShortBkkDowPass(alertedAtMs?: number | null): boolean {
  const ms = alertedAtMs ?? Date.now();
  const dow = bkkDayOfWeekIndex(ms);
  return (REVERSAL_QUALITY_SIGNAL_SHORT_BKK_DOW_INDICES as readonly number[]).includes(dow);
}

export function reversalQualitySignalLong1hBkkDowPass(alertedAtMs?: number | null): boolean {
  const ms = alertedAtMs ?? Date.now();
  const dow = bkkDayOfWeekIndex(ms);
  return (REVERSAL_QUALITY_SIGNAL_LONG_1H_BKK_DOW_INDICES as readonly number[]).includes(dow);
}

function reversalLong1hMetricsPass(input: {
  trendGainPct?: number | null;
  signalVolVsSma?: number | null;
}): boolean {
  return (
    trendGainInLong1hQualityRange(input.trendGainPct) &&
    volVsSmaInLong1hQualityRange(input.signalVolVsSma)
  );
}

function reversalQualitySignalAlertedAtMs(input: {
  alertedAtMs?: number | null;
  signalBarOpenSec?: number | null;
  signalBarTf?: CandleReversalSignalBarTf | null;
}): number {
  if (input.alertedAtMs != null && Number.isFinite(input.alertedAtMs)) return input.alertedAtMs;
  const open = input.signalBarOpenSec;
  if (open != null && Number.isFinite(open) && open > 0) {
    const barSec = (input.signalBarTf ?? "1d") === "1h" ? 3600 : 86400;
    return (open + barSec) * 1000;
  }
  return Date.now();
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
  trendGainPct?: number | null;
  signalVolVsSma?: number | null;
  alertedAtMs?: number | null;
  signalBarOpenSec?: number | null;
  signalBarTf?: CandleReversalSignalBarTf | null;
}): boolean {
  const atMs = reversalQualitySignalAlertedAtMs(input);
  if (reversalQualitySignalLong1hBkkDowPass(atMs)) return true;
  return reversalLong1hMetricsPass(input);
}

/** ✨ Quality Signal — Reversal Short (และ 1D) */
export function reversalMatchesQualitySignal(input: {
  trendGainPct?: number | null;
  ageOfTrendHours?: number | null;
  alertedAtMs?: number | null;
  signalBarOpenSec?: number | null;
  signalBarTf?: CandleReversalSignalBarTf | null;
}): boolean {
  const atMs = reversalQualitySignalAlertedAtMs(input);
  if (reversalQualitySignalShortBkkDowPass(atMs)) return true;
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
  signalVolVsSma?: number | null;
  btcEma4hSlopePct7d?: number | null;
  alertedAtMs?: number | null;
  signalBarOpenSec?: number | null;
}): boolean {
  if (reversalUsesLong1hQualitySignal(input.signalBarTf, input.tradeSide)) {
    return reversalMatchesQualitySignalLong1h({
      trendGainPct: input.trendGainPct,
      signalVolVsSma: input.signalVolVsSma,
      alertedAtMs: input.alertedAtMs,
      signalBarOpenSec: input.signalBarOpenSec,
      signalBarTf: input.signalBarTf,
    });
  }
  return reversalMatchesQualitySignal({
    trendGainPct: input.trendGainPct,
    ageOfTrendHours: input.ageOfTrendHours,
    alertedAtMs: input.alertedAtMs,
    signalBarOpenSec: input.signalBarOpenSec,
    signalBarTf: input.signalBarTf,
  });
}

/** ✨ Quality Signal (แถวสถิติ) */
export function reversalRowMatchesQualitySignalMatrix(row: CandleReversalStatsRow): boolean {
  const alertedAtMs =
    row.alertedAtMs != null && Number.isFinite(row.alertedAtMs)
      ? row.alertedAtMs
      : Date.parse(row.alertedAtIso);
  return reversalMatchesQualitySignalForAlert({
    signalBarTf: row.signalBarTf,
    tradeSide: row.tradeSide,
    trendGainPct: row.trendGainPct,
    ageOfTrendHours: row.ageOfTrendHours,
    signalVolVsSma: row.signalVolVsSma,
    btcEma4hSlopePct7d: row.btcEma4hSlopePct7d,
    alertedAtMs: Number.isFinite(alertedAtMs) ? alertedAtMs : undefined,
    signalBarOpenSec: row.signalBarOpenSec,
  });
}

export function reversalStatsRowMatchesMatrixFilter(
  row: CandleReversalStatsRow,
  filter: ReversalMatrixFilter,
): boolean {
  if (filter === "all") return true;
  return reversalRowMatchesQualitySignalMatrix(row);
}

/** กรองสัญญาณ Long 1H ในตารางรวม — EMA1H > 50% · EMA20 Diff 15–30% */
export function reversalLong1hStatsFilterPass(
  row: Pick<CandleReversalStatsRow, "ema20_1hSlopePct7d" | "priceVsEma20_1hPct">,
): boolean {
  const slope = row.ema20_1hSlopePct7d;
  const dist = row.priceVsEma20_1hPct;
  return (
    slope != null &&
    Number.isFinite(slope) &&
    slope > REVERSAL_LONG_1H_STATS_EMA1H_SLOPE_MIN_EXCLUSIVE &&
    dist != null &&
    Number.isFinite(dist) &&
    dist >= REVERSAL_LONG_1H_STATS_EMA20_DIST_MIN_PCT &&
    dist <= REVERSAL_LONG_1H_STATS_EMA20_DIST_MAX_PCT
  );
}

/** ตาราง 1H รวม — Short ผ่านตามตัวกรองทั่วไป · Long ต้องผ่านเกณฑ์ EMA เพิ่ม */
export function reversalCombined1hRowPassesSideFilter(row: CandleReversalStatsRow): boolean {
  if ((row.tradeSide ?? "short") !== "long") return true;
  return reversalLong1hStatsFilterPass(row);
}
