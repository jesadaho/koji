/**
 * Snowball trend grade — ลำดับ: A · B · F (fallback)
 * A: EMA4h > 10% · Funding > −0.10% · R% ก่อน 10–20%
 * B: EMA4h > 10% · Funding > −0.10%
 * F: fallback
 * 4h LONG: + (HH200+VAH) และ ⚠️ (Max DD>7%) เป็น modifier ใน composite
 */

import type { SnowballAutoTradeAlertSide } from "./tradingViewCloseSettingsStore";
import {
  SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C,
  snowballVolSmaMeetsGradeCMin,
} from "./snowballLongGrade4hPipeline";

export type SnowballTrendGrade = "s" | "a" | "b" | "c" | "f";

/** @deprecated alias — ใช้ SnowballTrendGrade */
export type SnowballLongBreakoutGrade = SnowballTrendGrade;

export type SnowballTrendGradeDisplay =
  | "S+"
  | "S"
  | "A+"
  | "A"
  | "B+"
  | "B"
  | "C+"
  | "C"
  | "F";

export function isSnowballTrendGradeDisplay(v: string | undefined | null): v is SnowballTrendGradeDisplay {
  return (
    v === "S+" ||
    v === "S" ||
    v === "A+" ||
    v === "A" ||
    v === "B+" ||
    v === "B" ||
    v === "C+" ||
    v === "C" ||
    v === "F"
  );
}

export type SnowballTrendActionPlan = "full" | "standard" | "light" | "monitor";

/** A/B — EMA(12) 4h slope 7d > ค่านี้ (%) */
export const SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE = 10;
/** A/B — Funding rate ทศนิยม > ค่านี้ (−0.001 = −0.10%) */
export const SNOWBALL_TREND_GRADE_FUNDING_MIN_DECIMAL = -0.001;
/** A — R% แท่งก่อนสัญญาณ (%) */
export const SNOWBALL_TREND_GRADE_A_R_PREV_MIN = 10;
export const SNOWBALL_TREND_GRADE_A_R_PREV_MAX = 20;

/** @deprecated ใช้ SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE */
export const SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE = 50;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_A_EMA4H_MIN = SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_A_EMA4H_MAX = 50;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_A_EMA4H_MIN_EXCLUSIVE = SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_B_EMA4H_MIN = SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_B_EMA4H_MAX = 15;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_B_BTC_EMA4H_MAX_EXCLUSIVE = -10;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_S_GREEN_MAX = 1;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_A_GREEN_MAX = 3;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_B_GREEN_MIN_EXCLUSIVE = SNOWBALL_TREND_GRADE_A_GREEN_MAX;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_C_GREEN_MIN_EXCLUSIVE = SNOWBALL_TREND_GRADE_B_GREEN_MIN_EXCLUSIVE;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_B_EMA4H_MIN_EXCLUSIVE = SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE = 0;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_F_BTC_EMA1D_MAX_EXCLUSIVE = -9;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_MIN_EXCLUSIVE = 80;

export type SnowballTrendPsar4hTrend = "up" | "down";

export type ClassifySnowballTrendGradeInput = {
  alertSide?: SnowballAutoTradeAlertSide | "long" | "bear" | null;
  ema1hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  ema1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  btcEma1dSlopePct7d?: number | null;
  greenDaysBeforeSignal?: number | null;
  /** Funding rate MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม ×100 = %) */
  fundingRate?: number | null;
  /** R% แท่งก่อนสัญญาณ */
  barRangePctPrev?: number | null;
  /** Vol แท่งสัญญาณ ÷ SMA — legacy composite gate */
  signalVolVsSma?: number | null;
  psar4hTrend?: SnowballTrendPsar4hTrend | null;
  signalBarTf?: "15m" | "1h" | "4h" | null;
};

function isLongSide(alertSide: ClassifySnowballTrendGradeInput["alertSide"]): boolean {
  return (alertSide ?? "long") !== "bear";
}

function finitePct(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

function fundingRateGtNeg010(fundingRate?: number | null): boolean {
  const fr = fundingRate;
  if (fr == null || !Number.isFinite(fr)) return false;
  return fr > SNOWBALL_TREND_GRADE_FUNDING_MIN_DECIMAL;
}

function barRangePrevInR1020Range(barRangePctPrev?: number | null): boolean {
  const raw = barRangePctPrev;
  return (
    raw != null &&
    Number.isFinite(raw) &&
    raw >= SNOWBALL_TREND_GRADE_A_R_PREV_MIN &&
    raw <= SNOWBALL_TREND_GRADE_A_R_PREV_MAX
  );
}

function meetsGradeABase(input: ClassifySnowballTrendGradeInput): boolean {
  const pct = input.ema4hSlopePct7d;
  return finitePct(pct) && pct > SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE && fundingRateGtNeg010(input.fundingRate);
}

function matchesGradeA(input: ClassifySnowballTrendGradeInput): boolean {
  return meetsGradeABase(input) && barRangePrevInR1020Range(input.barRangePctPrev);
}

function matchesGradeB(input: ClassifySnowballTrendGradeInput): boolean {
  const pct = input.ema4hSlopePct7d;
  return (
    finitePct(pct) &&
    pct < SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE &&
    barRangePrevInR1020Range(input.barRangePctPrev)
  );
}

export const SNOWBALL_TREND_GRADE_A_CRITERIA = `EMA4h > ${SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE}% · Funding > −0.10% · R% ก่อน ${SNOWBALL_TREND_GRADE_A_R_PREV_MIN}–${SNOWBALL_TREND_GRADE_A_R_PREV_MAX}%`;

export const SNOWBALL_TREND_GRADE_B_CRITERIA = `EMA4h < ${SNOWBALL_TREND_GRADE_AB_EMA4H_MIN_EXCLUSIVE}% · R% ก่อน ${SNOWBALL_TREND_GRADE_A_R_PREV_MIN}–${SNOWBALL_TREND_GRADE_A_R_PREV_MAX}%`;

export const SNOWBALL_TREND_GRADE_F_CRITERIA = "fallback";

/** @deprecated */
export const SNOWBALL_TREND_GRADE_SAB_VOL_PSAR_NOTE = `Vol×SMA > ${SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C}× · SAR 4h ↑`;

/** @deprecated */
export const SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_CRITERIA = `EMA1h > ${SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_MIN_EXCLUSIVE}%`;

/** @deprecated */
export const SNOWBALL_TREND_GRADE_C_FALLBACK_CRITERIA = "fallback (นอกเหนือ A / B)";

function snowballTrendGradeSabGatesApply(input: ClassifySnowballTrendGradeInput): boolean {
  return isLongSide(input.alertSide) && input.signalBarTf === "4h";
}

/** @deprecated — เกรดใหม่ไม่ใช้ Vol/SAR gate */
export function snowballTrendGradeMeetsSabVolAndPsar(input: ClassifySnowballTrendGradeInput): boolean {
  if (!snowballTrendGradeSabGatesApply(input)) return true;
  const volKnown = finitePct(input.signalVolVsSma);
  const psarKnown = input.psar4hTrend === "up" || input.psar4hTrend === "down";
  if (volKnown && !snowballVolSmaMeetsGradeCMin(input.signalVolVsSma)) return false;
  if (psarKnown && input.psar4hTrend !== "up") return false;
  return true;
}

/** สรุปเกณฑ์เกรดทั้งหมด — footer Mini App / tooltip */
export function snowballTrendGradeCriteriaLegend(): string {
  return [
    `A: ${SNOWBALL_TREND_GRADE_A_CRITERIA}`,
    `B: ${SNOWBALL_TREND_GRADE_B_CRITERIA}`,
    `F: ${SNOWBALL_TREND_GRADE_F_CRITERIA}`,
  ].join(" · ");
}

/** @deprecated — เกรดใหม่ไม่ใช้ EMA1h cap */
export function snowballEma1hSlopeForcesGradeC(ema1hSlopePct7d?: number | null): boolean {
  return (
    finitePct(ema1hSlopePct7d) && ema1hSlopePct7d > SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_MIN_EXCLUSIVE
  );
}

/** @deprecated */
export function applySnowballEma1hOverextendedCap(
  grade: SnowballTrendGrade,
  ema1hSlopePct7d?: number | null,
): SnowballTrendGrade {
  return grade;
}

/** ตรงเกรด F (fallback) — ใช้ Quality Short Signal / matrix filter / fade SHORT */
export function snowballEma4hSlopeMatchesTrendGradeF(
  ema4hSlopePct7d?: number | null,
  ema1dSlopePct7d?: number | null,
  btcEma1dSlopePct7d?: number | null,
  extra?: Pick<ClassifySnowballTrendGradeInput, "fundingRate" | "barRangePctPrev" | "alertSide" | "signalBarTf">,
): boolean {
  return (
    classifySnowballTrendGrade({
      ema4hSlopePct7d,
      ema1dSlopePct7d,
      btcEma1dSlopePct7d,
      fundingRate: extra?.fundingRate,
      barRangePctPrev: extra?.barRangePctPrev,
      alertSide: extra?.alertSide,
      signalBarTf: extra?.signalBarTf,
    }) === "f"
  );
}

/** ลำดับ: A · B · F (fallback) */
export function classifySnowballTrendGrade(input: ClassifySnowballTrendGradeInput): SnowballTrendGrade {
  if (matchesGradeA(input)) return "a";
  if (matchesGradeB(input)) return "b";
  return "f";
}

/** เพิ่ม + เมื่อ HH200+VAH (composite modifier) */
export function snowballTrendGradeWithPlus(
  baseTier: SnowballTrendGrade,
  plus: boolean,
): SnowballTrendGradeDisplay {
  const letter = snowballTrendGradeToDisplay(baseTier);
  if (plus) return `${letter}+` as SnowballTrendGradeDisplay;
  return letter;
}

export function snowballTrendGradeToDisplay(grade: SnowballTrendGrade): SnowballTrendGradeDisplay {
  if (grade === "s") return "S";
  if (grade === "a") return "A";
  if (grade === "b") return "B";
  if (grade === "f") return "F";
  return "C";
}

export type SnowballTrendGradeFilter =
  | "all"
  | SnowballTrendGradeDisplay
  | "SAB"
  | "SABplus";

/** เกณฑ์ Trend Grade ต่อชั้น — ใช้ใน stats filter / tooltip */
export function snowballTrendGradeFilterCriteria(grade: SnowballTrendGradeDisplay): string {
  const base = grade.endsWith("+") ? grade.slice(0, -1) : grade;
  const plusNote = grade.endsWith("+") ? " · HH200+VAH" : "";
  if (base === "F") return `${SNOWBALL_TREND_GRADE_F_CRITERIA}${plusNote}`;
  if (base === "A") return `${SNOWBALL_TREND_GRADE_A_CRITERIA}${plusNote}`;
  if (base === "B") return `${SNOWBALL_TREND_GRADE_B_CRITERIA}${plusNote}`;
  if (base === "S" || base === "C") return `legacy · ไม่ใช้ในเกรดใหม่${plusNote}`;
  return `นอกเหนือเกณฑ์ A / B / F`;
}

export function snowballTrendGradeFilterTitle(filter: SnowballTrendGradeFilter): string {
  if (filter === "all") return "ทุก grade";
  if (filter === "SAB") return "Grade S / A / B (รวม +)";
  if (filter === "SABplus") return "Grade S+ / A+ / B+ / C+ เท่านั้น";
  return `Grade ${filter}: ${snowballTrendGradeFilterCriteria(filter)}`;
}

export function snowballTrendGradeShortLabel(grade: SnowballTrendGrade | undefined): string {
  if (!grade) return "—";
  return snowballTrendGradeToDisplay(grade);
}

export function snowballTrendGradeDisplayLabel(
  grade: SnowballTrendGrade | undefined,
  side: "long" | "short" = "long",
): string {
  if (!grade) return "Grade —";
  const sideTag = side === "short" ? "Short" : "Long";
  return `Grade ${snowballTrendGradeToDisplay(grade)} (${sideTag})`;
}

export function snowballIsTrendGradeF(grade: SnowballTrendGrade | undefined): boolean {
  return grade === "f";
}

/** ทุกเกรดใช้ dedupe เดียวกัน — กันยิงซ้ำแท่ง/เหรียญเดิม */
export function snowballTrendGradeSkipsFeedDedupe(_grade: SnowballTrendGrade | undefined): boolean {
  return false;
}

export function snowballTrendGradeActionPlan(grade: SnowballTrendGrade): SnowballTrendActionPlan {
  if (grade === "a") return "standard";
  if (grade === "b") return "light";
  return "monitor";
}

export function snowballTrendActionPlanMarginScale(plan: SnowballTrendActionPlan): number {
  if (plan === "full") return 1.0;
  if (plan === "standard") return 1.0;
  if (plan === "light") return 0.5;
  return 0;
}

export function snowballTrendActionPlanAutoOpenEnabled(plan: SnowballTrendActionPlan): boolean {
  if (plan === "monitor") {
    const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_MONITOR_AUTO_OPEN?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }
  if (plan === "light") {
    const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_LIGHT_AUTO_OPEN?.trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
    return true;
  }
  return true;
}

export function snowballTrendActionPlanLabel(plan: SnowballTrendActionPlan): string {
  if (plan === "full") return "Full (1.0×)";
  if (plan === "standard") return "Standard (1.0×)";
  if (plan === "light") return "Light (0.5×)";
  return "Monitor (no auto-open)";
}

export type SnowballTrendGradeFootnoteInput = ClassifySnowballTrendGradeInput & {
  grade: SnowballTrendGrade;
};

function fmtSlopePct(v: number | null | undefined): string {
  if (!finitePct(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtFunding(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(4)}%`;
}

function fmtBarRangePrev(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

/** ข้อความ footnote สำหรับ alert / stats */
export function snowballTrendGradeFootnote(input: SnowballTrendGradeFootnoteInput): string {
  const g = snowballTrendGradeToDisplay(input.grade);
  const ema4h = fmtSlopePct(input.ema4hSlopePct7d);
  const funding = fmtFunding(input.fundingRate);
  const rPrev = fmtBarRangePrev(input.barRangePctPrev);
  const plan = snowballTrendActionPlanLabel(snowballTrendGradeActionPlan(input.grade));
  return `📎 Grade ${g}: EMA4h ${ema4h} · Funding ${funding} · R% ก่อน ${rPrev} · ${plan}`;
}

/** Legacy enum → trend grade สำหรับแถวสถิติเก่า */
export type LegacySnowballQualityTier = "a_plus" | "b_plus" | "c_plus" | "d_plus" | "f_plus";

export function isLegacySnowballQualityTier(t: string | undefined): t is LegacySnowballQualityTier {
  return t === "a_plus" || t === "b_plus" || t === "c_plus" || t === "d_plus" || t === "f_plus";
}

export function isSnowballTrendGrade(t: string | undefined): t is SnowballTrendGrade {
  return t === "s" || t === "a" || t === "b" || t === "c" || t === "f";
}

/** แปลง legacy tier เป็นป้าย display (ไม่ recompute slope) */
export function legacySnowballQualityTierToDisplay(tier: LegacySnowballQualityTier): SnowballTrendGradeDisplay {
  if (tier === "a_plus") return "A";
  if (tier === "b_plus") return "B";
  if (tier === "c_plus") return "C";
  if (tier === "d_plus") return "C";
  return "F";
}

/** normalize qualityTier จาก DB — รองรับ legacy + trend grade */
export function normalizeSnowballQualityTier(
  tier: string | undefined,
  row?: ClassifySnowballTrendGradeInput,
): SnowballTrendGrade | undefined {
  if (isSnowballTrendGrade(tier)) return tier;
  if (isLegacySnowballQualityTier(tier)) {
    if (tier === "f_plus") return "f";
    if (tier === "a_plus") return "a";
    if (tier === "b_plus") return "b";
    if (tier === "c_plus" || tier === "d_plus") return "c";
  }
  if (row) return classifySnowballTrendGrade(row);
  return undefined;
}

/** migrate auto-trade grade key เก่า → ใหม่ */
export function migrateSnowballAutoTradeGradeKey(key: string): SnowballTrendGradeDisplay | null {
  const k = key.trim();
  if (k === "S+" || k === "A+" || k === "B+" || k === "C+") return k as SnowballTrendGradeDisplay;
  if (k === "S" || k === "A" || k === "B" || k === "C" || k === "F") return k;
  if (k.startsWith("A")) return "A";
  if (k.startsWith("B")) return "B";
  if (k.startsWith("C")) return "C";
  if (k === "D" || k === "D+") return "C";
  if (k.startsWith("F")) return "F";
  return null;
}
