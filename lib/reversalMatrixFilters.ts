/**
 * Matrix presets สำหรับกรองสถิติ Reversal
 */

import type {
  CandleReversalSignalBarTf,
  CandleReversalStatsRow,
  CandleReversalTradeSide,
} from "@/lib/candleReversalStatsClient";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";

export type ReversalMatrixFilter = "all" | "qualitySignal" | "neutral" | "slowMover";

/** โปรไฟล์ Quality Signal ในตารางสถิติ (แต่ละ section) */
export type ReversalQualitySignalProfile = "short" | "long1h";

/** ข้อความเกณฑ์ Quality Signal (stats + auto-open) — Reversal Short */
export const REVERSAL_QUALITY_SIGNAL_CRITERIA = "ทิศ Short ทั้งหมด";

/** ข้อความเกณฑ์ Quality Signal — Reversal Long 1H → fade SHORT */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA =
  "Trend Gain 5–20% · Vol×SMA 2–5× · หรือ ศ (BKK)";

/** เกณฑ์ Long candidate ในตาราง Reversal Short 1H */
export const REVERSAL_LONG_CANDIDATE_CRITERIA =
  "Trend Gain 5–20% + Vol×SMA 2–5× หรือ EMA20Δ1h 15–30% หรือ EMA20∠1h 50–66% หรือ Trend Gain<16% + Vol×SMA 2–12× หรือ Velocity 0.2–0.3%/h หรือ (EMA20∠4h 40–300% and EMA20Δ4h>20%) หรือ (EMA20∠4h<-5% and EMA20Δ4h>30%)";

/** @deprecated — ใช้ REVERSAL_LONG_CANDIDATE_CRITERIA */
export const REVERSAL_LONG_1H_STATS_FILTER_CRITERIA = REVERSAL_LONG_CANDIDATE_CRITERIA;

/** Trend Velocity (%/h) — inclusive */
export const REVERSAL_LONG_CANDIDATE_TREND_VELOCITY_MIN = 0.2;
export const REVERSAL_LONG_CANDIDATE_TREND_VELOCITY_MAX = 0.3;

/** EMA20 1h slope 7d (คอลัมน์ EMA20∠1h) — inclusive */
export const REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_PCT = 50;
export const REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MAX_PCT = 66;

/** Trend Gain < 16% + Vol×SMA 2–12× — Long candidate ชุดที่ 4 */
export const REVERSAL_LONG_CANDIDATE_LOW_TREND_GAIN_MAX_EXCLUSIVE = 16;
export const REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MIN = 2;
export const REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MAX = 12;

/** @deprecated — ใช้ REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MIN */
export const REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MIN_EXCLUSIVE = 2;

/** @deprecated — ใช้ REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_PCT */
export const REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_EXCLUSIVE = 50;

/** @deprecated — ใช้ REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_PCT */
export const REVERSAL_LONG_CANDIDATE_EMA1H_SLOPE_MIN_EXCLUSIVE =
  REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_EXCLUSIVE;
/** @deprecated */
export const REVERSAL_LONG_1H_STATS_EMA1H_SLOPE_MIN_EXCLUSIVE =
  REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_EXCLUSIVE;

/** EMA20 dist % บน 1h (คอลัมน์ EMA20Δ1h) — inclusive */
export const REVERSAL_LONG_CANDIDATE_EMA20_DIST_MIN_PCT = 15;
export const REVERSAL_LONG_CANDIDATE_EMA20_DIST_MAX_PCT = 30;

/** EMA20 4h slope 7d (คอลัมน์ EMA20∠4h) — inclusive */
export const REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MIN_PCT = 40;
export const REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MAX_PCT = 300;

/** EMA20 dist % บน 4h (คอลัมน์ EMA20Δ4h) — exclusive min (>20%) ชุดที่ 6 */
export const REVERSAL_LONG_CANDIDATE_EMA20_4H_DIST_MIN_EXCLUSIVE = 20;

/** EMA20∠4h <-5% + EMA20Δ4h>30% — Long candidate ชุดที่ 7 */
export const REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MAX_EXCLUSIVE = -5;
export const REVERSAL_LONG_CANDIDATE_EMA20_4H_OVERSOLD_DIST_MIN_EXCLUSIVE = 30;

/** @deprecated — ใช้ REVERSAL_LONG_CANDIDATE_EMA20_DIST_* */
export const REVERSAL_LONG_1H_STATS_EMA20_DIST_MIN_PCT = REVERSAL_LONG_CANDIDATE_EMA20_DIST_MIN_PCT;
export const REVERSAL_LONG_1H_STATS_EMA20_DIST_MAX_PCT = REVERSAL_LONG_CANDIDATE_EMA20_DIST_MAX_PCT;

/** วัน BKK ที่ผ่าน Quality Signal Long 1H โดยไม่ต้องดู Trend Gain / Vol×SMA — 5=ศุกร์ */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_BKK_DOW_INDICES = [5] as const;

/** Trend Gain % — inclusive */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MIN_PCT = 5;
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MAX_PCT = 20;
/** Vol×SMA — inclusive */
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MIN = 2;
export const REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MAX = 5;

/** Matrix Neutral — Trend Gain 50–80% · EMA(12) 4h slope > 20% */
export const REVERSAL_NEUTRAL_MATRIX_TREND_GAIN_MIN_EXCLUSIVE = 50;
export const REVERSAL_NEUTRAL_MATRIX_TREND_GAIN_MAX_EXCLUSIVE = 80;
export const REVERSAL_NEUTRAL_MATRIX_EMA4H_MIN_EXCLUSIVE = 20;

export const REVERSAL_NEUTRAL_MATRIX_CRITERIA =
  "Trend Gain >50% & <80% · EMA4H >20%";

/** Matrix Slow mover — EMA(12) 4h slope >20% · Trend Velocity <0.5%/h */
export const REVERSAL_SLOW_MOVER_MATRIX_EMA4H_MIN_EXCLUSIVE = 20;
export const REVERSAL_SLOW_MOVER_MATRIX_VELOCITY_MAX_EXCLUSIVE = 0.5;

export const REVERSAL_SLOW_MOVER_MATRIX_CRITERIA =
  "EMA4H >20% · Velocity <0.5%/h";

export const REVERSAL_MATRIX_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalMatrixFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "qualitySignal", label: "✨ Quality Signal" },
  { value: "neutral", label: "Neutral" },
  { value: "slowMover", label: "Slow mover" },
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
  if (filter === "neutral") {
    return `Neutral: ${REVERSAL_NEUTRAL_MATRIX_CRITERIA}`;
  }
  if (filter === "slowMover") {
    return `Slow mover: ${REVERSAL_SLOW_MOVER_MATRIX_CRITERIA}`;
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

/** ✨ Quality Signal — Reversal Short (1H / 1D) */
export function reversalMatchesQualitySignal(input: {
  tradeSide?: CandleReversalTradeSide | null;
}): boolean {
  return (input.tradeSide ?? "short") === "short";
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
    tradeSide: input.tradeSide,
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

/** Matrix Neutral — Trend Gain >50% & <80% · EMA(12) 4h slope >20% */
export function reversalRowMatchesNeutralMatrix(
  row: Pick<CandleReversalStatsRow, "trendGainPct" | "ema4hSlopePct7d">,
): boolean {
  const gain = row.trendGainPct;
  const ema4h = row.ema4hSlopePct7d;
  return (
    gain != null &&
    Number.isFinite(gain) &&
    gain > REVERSAL_NEUTRAL_MATRIX_TREND_GAIN_MIN_EXCLUSIVE &&
    gain < REVERSAL_NEUTRAL_MATRIX_TREND_GAIN_MAX_EXCLUSIVE &&
    ema4h != null &&
    Number.isFinite(ema4h) &&
    ema4h > REVERSAL_NEUTRAL_MATRIX_EMA4H_MIN_EXCLUSIVE
  );
}

/** Matrix Slow mover — EMA(12) 4h slope >20% · Trend Velocity <0.5%/h */
export function reversalRowMatchesSlowMoverMatrix(
  row: Pick<CandleReversalStatsRow, "ema4hSlopePct7d" | "trendGainPct" | "ageOfTrendHours">,
): boolean {
  const ema4h = row.ema4hSlopePct7d;
  const velocity = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  return (
    ema4h != null &&
    Number.isFinite(ema4h) &&
    ema4h > REVERSAL_SLOW_MOVER_MATRIX_EMA4H_MIN_EXCLUSIVE &&
    velocity != null &&
    Number.isFinite(velocity) &&
    velocity < REVERSAL_SLOW_MOVER_MATRIX_VELOCITY_MAX_EXCLUSIVE
  );
}

export function reversalStatsRowMatchesMatrixFilter(
  row: CandleReversalStatsRow,
  filter: ReversalMatrixFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "neutral") return reversalRowMatchesNeutralMatrix(row);
  if (filter === "slowMover") return reversalRowMatchesSlowMoverMatrix(row);
  return reversalRowMatchesQualitySignalMatrix(row);
}

export type ReversalLongCandidateFilter = "all" | "longCandidate" | "notLongCandidate";

export const REVERSAL_LONG_CANDIDATE_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalLongCandidateFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "longCandidate", label: "Long candidate" },
  { value: "notLongCandidate", label: "ไม่ใช่ Long candidate" },
];

export function reversalLongCandidateFilterLabel(filter: ReversalLongCandidateFilter): string {
  return REVERSAL_LONG_CANDIDATE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalLongCandidateFilterTitle(filter: ReversalLongCandidateFilter): string {
  if (filter === "all") return "ไม่กรอง Long candidate";
  if (filter === "longCandidate") {
    return `Long candidate — ${REVERSAL_LONG_CANDIDATE_CRITERIA}`;
  }
  return `ไม่ใช่ Long candidate — ไม่ผ่าน ${REVERSAL_LONG_CANDIDATE_CRITERIA}`;
}

/** กรอง Long candidate — (Trend+Vol) หรือ EMA20Δ1h หรือ EMA20∠1h หรือ Trend<16%+Vol 2–12× หรือ Velocity 0.2–0.3 หรือ EMA20∠4h+Δ4h */
export type ReversalLongCandidateRowSlice = Pick<
  CandleReversalStatsRow,
  | "trendGainPct"
  | "signalVolVsSma"
  | "priceVsEma20_1hPct"
  | "ema20_1hSlopePct7d"
  | "priceVsEma20_4hPct"
  | "ema20_4hSlopePct7d"
  | "ageOfTrendHours"
>;

export function reversalLongCandidateTrendVolPass(
  row: Pick<CandleReversalStatsRow, "trendGainPct" | "signalVolVsSma">,
): boolean {
  return reversalLong1hMetricsPass(row);
}

export function reversalLongCandidateEma20DistPass(
  row: Pick<CandleReversalStatsRow, "priceVsEma20_1hPct">,
): boolean {
  const dist = row.priceVsEma20_1hPct;
  return (
    dist != null &&
    Number.isFinite(dist) &&
    dist >= REVERSAL_LONG_CANDIDATE_EMA20_DIST_MIN_PCT &&
    dist <= REVERSAL_LONG_CANDIDATE_EMA20_DIST_MAX_PCT
  );
}

export function reversalLongCandidateLowTrendHighVolPass(
  row: Pick<CandleReversalStatsRow, "trendGainPct" | "signalVolVsSma">,
): boolean {
  const gain = row.trendGainPct;
  const vol = row.signalVolVsSma;
  return (
    gain != null &&
    Number.isFinite(gain) &&
    gain < REVERSAL_LONG_CANDIDATE_LOW_TREND_GAIN_MAX_EXCLUSIVE &&
    vol != null &&
    Number.isFinite(vol) &&
    vol >= REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MIN &&
    vol <= REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MAX
  );
}

export function reversalLongCandidateEma20_1hSlopePass(
  row: Pick<CandleReversalStatsRow, "ema20_1hSlopePct7d">,
): boolean {
  const slope = row.ema20_1hSlopePct7d;
  return (
    slope != null &&
    Number.isFinite(slope) &&
    slope >= REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_PCT &&
    slope <= REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MAX_PCT
  );
}

export function reversalLongCandidateTrendVelocityPass(
  row: Pick<CandleReversalStatsRow, "trendGainPct" | "ageOfTrendHours">,
): boolean {
  const v = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  return (
    v != null &&
    Number.isFinite(v) &&
    v >= REVERSAL_LONG_CANDIDATE_TREND_VELOCITY_MIN &&
    v <= REVERSAL_LONG_CANDIDATE_TREND_VELOCITY_MAX
  );
}

export function reversalLongCandidateEma20_4hPass(
  row: Pick<CandleReversalStatsRow, "ema20_4hSlopePct7d" | "priceVsEma20_4hPct">,
): boolean {
  const slope = row.ema20_4hSlopePct7d;
  const dist = row.priceVsEma20_4hPct;
  return (
    slope != null &&
    Number.isFinite(slope) &&
    slope >= REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MIN_PCT &&
    slope <= REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MAX_PCT &&
    dist != null &&
    Number.isFinite(dist) &&
    dist > REVERSAL_LONG_CANDIDATE_EMA20_4H_DIST_MIN_EXCLUSIVE
  );
}

/** EMA20∠4h <-5% และ EMA20Δ4h>30% */
export function reversalLongCandidateEma20_4hOversoldPass(
  row: Pick<CandleReversalStatsRow, "ema20_4hSlopePct7d" | "priceVsEma20_4hPct">,
): boolean {
  const slope = row.ema20_4hSlopePct7d;
  const dist = row.priceVsEma20_4hPct;
  return (
    slope != null &&
    Number.isFinite(slope) &&
    slope < REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MAX_EXCLUSIVE &&
    dist != null &&
    Number.isFinite(dist) &&
    dist > REVERSAL_LONG_CANDIDATE_EMA20_4H_OVERSOLD_DIST_MIN_EXCLUSIVE
  );
}

export function reversalLong1hStatsFilterPass(row: ReversalLongCandidateRowSlice): boolean {
  return (
    reversalLongCandidateTrendVolPass(row) ||
    reversalLongCandidateEma20DistPass(row) ||
    reversalLongCandidateEma20_1hSlopePass(row) ||
    reversalLongCandidateLowTrendHighVolPass(row) ||
    reversalLongCandidateTrendVelocityPass(row) ||
    reversalLongCandidateEma20_4hPass(row) ||
    reversalLongCandidateEma20_4hOversoldPass(row)
  );
}

export function reversalLongCandidateDebugTitle(row: ReversalLongCandidateRowSlice): string {
  const gain = row.trendGainPct;
  const vol = row.signalVolVsSma;
  const dist = row.priceVsEma20_1hPct;
  const slope = row.ema20_1hSlopePct7d;
  const dist4h = row.priceVsEma20_4hPct;
  const slope4h = row.ema20_4hSlopePct7d;
  const gainLabel =
    gain != null && Number.isFinite(gain) ? `${gain.toFixed(1)}%` : "—";
  const volLabel = vol != null && Number.isFinite(vol) && vol > 0 ? `${vol.toFixed(2)}×` : "—";
  const distLabel = dist != null && Number.isFinite(dist) ? `${dist.toFixed(1)}%` : "—";
  const slopeLabel =
    slope != null && Number.isFinite(slope) ? `${slope.toFixed(1)}%` : "—";
  const dist4hLabel = dist4h != null && Number.isFinite(dist4h) ? `${dist4h.toFixed(1)}%` : "—";
  const slope4hLabel =
    slope4h != null && Number.isFinite(slope4h) ? `${slope4h.toFixed(1)}%` : "—";
  const trendVolOk = reversalLongCandidateTrendVolPass(row);
  const lowTrendHighVolOk = reversalLongCandidateLowTrendHighVolPass(row);
  const gainOk = trendGainInLong1hQualityRange(gain);
  const volOk = volVsSmaInLong1hQualityRange(vol);
  const gainLt16 =
    gain != null && Number.isFinite(gain) && gain < REVERSAL_LONG_CANDIDATE_LOW_TREND_GAIN_MAX_EXCLUSIVE;
  const volIn212 =
    vol != null &&
    Number.isFinite(vol) &&
    vol >= REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MIN &&
    vol <= REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MAX;
  const distOk = reversalLongCandidateEma20DistPass(row);
  const slopeRangeOk = reversalLongCandidateEma20_1hSlopePass(row);
  const vel = computePumpCycleTrendVelocity(gain, row.ageOfTrendHours);
  const velLabel = vel != null && Number.isFinite(vel) ? `${vel.toFixed(2)}%/h` : "—";
  const velOk = reversalLongCandidateTrendVelocityPass(row);
  const ema20_4hOk = reversalLongCandidateEma20_4hPass(row);
  const ema20_4hOversoldOk = reversalLongCandidateEma20_4hOversoldPass(row);
  return (
    `ต้อง Trend ${REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MIN_PCT}–${REVERSAL_QUALITY_SIGNAL_LONG_1H_TREND_GAIN_MAX_PCT}% + Vol×SMA ${REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MIN}–${REVERSAL_QUALITY_SIGNAL_LONG_1H_VOL_VS_SMA_MAX} หรือ EMA20Δ1h ${REVERSAL_LONG_CANDIDATE_EMA20_DIST_MIN_PCT}–${REVERSAL_LONG_CANDIDATE_EMA20_DIST_MAX_PCT}% หรือ EMA20∠1h ${REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MIN_PCT}–${REVERSAL_LONG_CANDIDATE_EMA20_1H_SLOPE_MAX_PCT}% หรือ Trend <${REVERSAL_LONG_CANDIDATE_LOW_TREND_GAIN_MAX_EXCLUSIVE}% + Vol×SMA ${REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MIN}–${REVERSAL_LONG_CANDIDATE_LOW_TREND_VOL_VS_SMA_MAX}× หรือ Velocity ${REVERSAL_LONG_CANDIDATE_TREND_VELOCITY_MIN}–${REVERSAL_LONG_CANDIDATE_TREND_VELOCITY_MAX}%/h หรือ EMA20∠4h ${REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MIN_PCT}–${REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MAX_PCT}% + EMA20Δ4h >${REVERSAL_LONG_CANDIDATE_EMA20_4H_DIST_MIN_EXCLUSIVE}% หรือ EMA20∠4h <${REVERSAL_LONG_CANDIDATE_EMA20_4H_SLOPE_MAX_EXCLUSIVE}% + EMA20Δ4h >${REVERSAL_LONG_CANDIDATE_EMA20_4H_OVERSOLD_DIST_MIN_EXCLUSIVE}% · ` +
    `Trend ${gainLabel}${gainOk ? " ✓" : ""}${gainLt16 ? " <16✓" : ""} · Vol ${volLabel}${volOk ? " ✓" : ""}${volIn212 ? " 2–12✓" : ""}${trendVolOk ? " (ชุด1✓)" : ""}${lowTrendHighVolOk ? " (ชุด4✓)" : ""} · Δ1h ${distLabel}${distOk ? " ✓" : ""} · ∠1h ${slopeLabel}${slopeRangeOk ? " (50–66✓)" : ""} · Vel ${velLabel}${velOk ? " (0.2–0.3✓)" : ""} · ∠4h ${slope4hLabel} + Δ4h ${dist4hLabel}${ema20_4hOk ? " (ชุด6✓)" : ""}${ema20_4hOversoldOk ? " (ชุด7✓)" : ""}`
  );
}

export function reversalRowIsLongCandidate(row: ReversalLongCandidateRowSlice): boolean {
  return reversalLong1hStatsFilterPass(row);
}

export function reversalSuggestedTradeSide(row: ReversalLongCandidateRowSlice): CandleReversalTradeSide {
  return reversalRowIsLongCandidate(row) ? "long" : "short";
}

export function reversalSuggestedTradeSideLabel(row: ReversalLongCandidateRowSlice): string {
  return reversalSuggestedTradeSide(row) === "long" ? "🟢 Long" : "🔴 Short";
}

export function reversalRowMatchesLongCandidateFilter(
  row: ReversalLongCandidateRowSlice,
  filter: ReversalLongCandidateFilter,
): boolean {
  if (filter === "all") return true;
  const isCandidate = reversalRowIsLongCandidate(row);
  return filter === "longCandidate" ? isCandidate : !isCandidate;
}

/** กรองตามคอลัมน์ทิศแนะนำ — ตาราง Reversal Short 1H */
export type ReversalSuggestedSideFilter = "all" | "long" | "short";

export const REVERSAL_SUGGESTED_SIDE_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalSuggestedSideFilter;
  label: string;
}> = [
  { value: "all", label: "ทุกทิศ" },
  { value: "long", label: "🟢 Long" },
  { value: "short", label: "🔴 Short" },
];

export function reversalSuggestedSideFilterLabel(filter: ReversalSuggestedSideFilter): string {
  return REVERSAL_SUGGESTED_SIDE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalSuggestedSideFilterTitle(filter: ReversalSuggestedSideFilter): string {
  if (filter === "all") return "ไม่กรองทิศแนะนำ";
  if (filter === "long") {
    return `ทิศแนะนำ Long — ${REVERSAL_LONG_CANDIDATE_CRITERIA}`;
  }
  return `ทิศแนะนำ Short — ไม่ผ่าน ${REVERSAL_LONG_CANDIDATE_CRITERIA}`;
}

export function reversalRowMatchesSuggestedSideFilter(
  row: ReversalLongCandidateRowSlice,
  filter: ReversalSuggestedSideFilter,
): boolean {
  if (filter === "all") return true;
  return reversalSuggestedTradeSide(row) === filter;
}

/** ทิศที่ผู้ใช้เลือกเล่น — ตาราง Reversal Short 1H */
export type ReversalStatsPlaySide = "short" | "long";

/** @deprecated — ใช้ ReversalStatsPlaySides */
export const REVERSAL_STATS_PLAY_SIDE_OPTIONS: ReadonlyArray<{
  value: ReversalStatsPlaySide;
  label: string;
}> = [
  { value: "short", label: "Short — ตามสัญญาณ" },
  { value: "long", label: "Long — ทิศแนะนำ 🟢" },
];

export type ReversalStatsPlaySides = {
  short: boolean;
  long: boolean;
};

export function reversalStatsPlaySidesFromSettings(row: {
  reversalStatsPlaySide?: ReversalStatsPlaySide | null;
  reversalStatsPlayShortEnabled?: boolean | null;
  reversalStatsPlayLongEnabled?: boolean | null;
}): ReversalStatsPlaySides {
  if (
    row.reversalStatsPlayShortEnabled !== undefined &&
    row.reversalStatsPlayShortEnabled !== null
  ) {
    const short = row.reversalStatsPlayShortEnabled !== false;
    const long = row.reversalStatsPlayLongEnabled === true;
    if (!short && !long) return { short: true, long: false };
    return { short, long };
  }
  if (row.reversalStatsPlayLongEnabled === true) {
    return {
      short: row.reversalStatsPlaySide !== "long",
      long: true,
    };
  }
  if (row.reversalStatsPlaySide === "long") return { short: false, long: true };
  return { short: true, long: false };
}

/**
 * ทิศที่ใช้ auto-open — แยกจาก stats table
 * เปิด reversalAutoTradeEnabled → อนุญาต SHORT เสมอ (ยกเว้นโหมด Long-only)
 */
export function reversalAutoTradePlaySidesFromSettings(row: {
  reversalAutoTradeEnabled?: boolean | null;
  reversalStatsPlaySide?: ReversalStatsPlaySide | null;
  reversalStatsPlayShortEnabled?: boolean | null;
  reversalStatsPlayLongEnabled?: boolean | null;
}): ReversalStatsPlaySides {
  const statsSides = reversalStatsPlaySidesFromSettings(row);
  const longOnly = statsSides.long && !statsSides.short;
  if (row.reversalAutoTradeEnabled === true && !longOnly) {
    return { short: true, long: statsSides.long };
  }
  return statsSides;
}

export function reversalStatsPlaySidesLabel(sides: ReversalStatsPlaySides): string {
  if (sides.short && sides.long) return "Short + Long";
  if (sides.long) return "Long — ทิศแนะนำ 🟢";
  return "Short — ตามสัญญาณ";
}

/** @deprecated — ใช้ reversalStatsPlaySidesLabel */
export function reversalStatsPlaySideLabel(side: ReversalStatsPlaySide): string {
  return REVERSAL_STATS_PLAY_SIDE_OPTIONS.find((o) => o.value === side)?.label ?? side;
}

/** @deprecated — ใช้ reversalStatsPlaySidesFromSettings */
export function normalizeReversalStatsPlaySide(value: unknown): ReversalStatsPlaySide {
  return value === "long" ? "long" : "short";
}

export function reversalStatsDefaultSuggestedSideFilter(
  sides: ReversalStatsPlaySides,
): ReversalSuggestedSideFilter {
  if (sides.long && !sides.short) return "long";
  return "all";
}

export function reversalStatsPlaySubtitle(sides: ReversalStatsPlaySides): string {
  const base = "follow-up 4h / 12h / 24h / 48h (ผลที่ 24h)";
  if (sides.long && !sides.short) return `Long (fade สัญญาณ Short) · ${base}`;
  if (sides.long && sides.short) return `Short + Long · ${base}`;
  return `Short · ${base}`;
}
