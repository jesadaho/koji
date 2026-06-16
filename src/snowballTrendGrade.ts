/**
 * Snowball trend grade — S / A / B / C / F จาก EMA slope + เขียว (LONG)
 * 4h LONG S/A/B: Vol×SMA > 2× · SAR 4h ↑
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

export const SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE = 50;
/** @deprecated ใช้ SNOWBALL_TREND_GRADE_A_EMA4H_MIN_EXCLUSIVE */
export const SNOWBALL_TREND_GRADE_A_EMA4H_MIN = 15;
/** @deprecated ไม่มีเพดานบนเกรด A อีกต่อไป */
export const SNOWBALL_TREND_GRADE_A_EMA4H_MAX = 50;
export const SNOWBALL_TREND_GRADE_A_EMA4H_MIN_EXCLUSIVE = 15;
/** @deprecated เกณฑ์เก่า B 10–15% */
export const SNOWBALL_TREND_GRADE_B_EMA4H_MIN = 10;
/** @deprecated เกณฑ์เก่า B 10–15% */
export const SNOWBALL_TREND_GRADE_B_EMA4H_MAX = 15;
/** @deprecated ไม่ใช้ BTC weak path แล้ว */
export const SNOWBALL_TREND_GRADE_B_BTC_EMA4H_MAX_EXCLUSIVE = -10;
export const SNOWBALL_TREND_GRADE_S_GREEN_MAX = 1;
export const SNOWBALL_TREND_GRADE_A_GREEN_MAX = 3;
/** @deprecated เกรด B ไม่ใช้เขียว>3 อีกต่อไป */
export const SNOWBALL_TREND_GRADE_B_GREEN_MIN_EXCLUSIVE = SNOWBALL_TREND_GRADE_A_GREEN_MAX;
/** @deprecated */
export const SNOWBALL_TREND_GRADE_C_GREEN_MIN_EXCLUSIVE = SNOWBALL_TREND_GRADE_B_GREEN_MIN_EXCLUSIVE;
/** B — EMA4h > 0% */
export const SNOWBALL_TREND_GRADE_B_EMA4H_MIN_EXCLUSIVE = 0;
/** F — EMA4h < 0% (ใช้เป็น upper bound exclusive) */
export const SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE = 0;
/** F — BTC EMA1d slope 7d < -9% */
export const SNOWBALL_TREND_GRADE_F_BTC_EMA1D_MAX_EXCLUSIVE = -9;
/** EMA1h slope 7d > 80% → cap เป็น C ทุกเกรด */
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
  /** Vol แท่งสัญญาณ ÷ SMA — 4h Long S/A/B ต้อง > 2× */
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

function greenDaysAtMost(maxDays: number, greenDaysBeforeSignal?: number | null): boolean {
  const n = greenDaysBeforeSignal;
  return n != null && Number.isFinite(n) && n >= 0 && Math.floor(n) <= maxDays;
}

function snowballTrendGradeSabGatesApply(input: ClassifySnowballTrendGradeInput): boolean {
  return isLongSide(input.alertSide) && input.signalBarTf === "4h";
}

/** 4h Long S/A/B — Vol×SMA > 2× และ SAR 4h ↑ */
export function snowballTrendGradeMeetsSabVolAndPsar(input: ClassifySnowballTrendGradeInput): boolean {
  if (!snowballTrendGradeSabGatesApply(input)) return true;
  if (!snowballVolSmaMeetsGradeCMin(input.signalVolVsSma)) return false;
  return input.psar4hTrend === "up";
}

function matchesGradeB(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  if (input.ema4hSlopePct7d <= SNOWBALL_TREND_GRADE_B_EMA4H_MIN_EXCLUSIVE) return false;
  if (!snowballTrendGradeMeetsSabVolAndPsar(input)) return false;
  return true;
}

function matchesGradeS(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  if (input.ema4hSlopePct7d <= SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE) return false;
  if (isLongSide(input.alertSide) && !greenDaysAtMost(SNOWBALL_TREND_GRADE_S_GREEN_MAX, input.greenDaysBeforeSignal)) {
    return false;
  }
  if (!snowballTrendGradeMeetsSabVolAndPsar(input)) return false;
  return true;
}

function matchesGradeA(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  if (input.ema4hSlopePct7d <= SNOWBALL_TREND_GRADE_A_EMA4H_MIN_EXCLUSIVE) return false;
  if (isLongSide(input.alertSide) && !greenDaysAtMost(SNOWBALL_TREND_GRADE_A_GREEN_MAX, input.greenDaysBeforeSignal)) {
    return false;
  }
  if (!snowballTrendGradeMeetsSabVolAndPsar(input)) return false;
  return true;
}

function matchesGradeF(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d) || !finitePct(input.ema1dSlopePct7d)) return false;
  if (!finitePct(input.btcEma1dSlopePct7d)) return false;
  return (
    input.ema4hSlopePct7d < SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE &&
    input.ema1dSlopePct7d < 0 &&
    input.btcEma1dSlopePct7d < SNOWBALL_TREND_GRADE_F_BTC_EMA1D_MAX_EXCLUSIVE
  );
}

export const SNOWBALL_TREND_GRADE_SAB_VOL_PSAR_NOTE = `Vol×SMA > ${SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C}× · SAR 4h ↑`;

export const SNOWBALL_TREND_GRADE_F_CRITERIA = `EMA4h < 0% · EMA1d < 0% · BTC EMA1d < ${SNOWBALL_TREND_GRADE_F_BTC_EMA1D_MAX_EXCLUSIVE}%`;

export const SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_CRITERIA = `EMA1h > ${SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_MIN_EXCLUSIVE}% → C`;

/** EMA1h slope สูงเกิน — cap เกรดเป็น C (รวม F/S/A/B) */
export function snowballEma1hSlopeForcesGradeC(ema1hSlopePct7d?: number | null): boolean {
  return finitePct(ema1hSlopePct7d) && ema1hSlopePct7d > SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_MIN_EXCLUSIVE;
}

export function applySnowballEma1hOverextendedCap(
  grade: SnowballTrendGrade,
  ema1hSlopePct7d?: number | null,
): SnowballTrendGrade {
  if (!snowballEma1hSlopeForcesGradeC(ema1hSlopePct7d)) return grade;
  return "c";
}

/** ตรงเกรด F — ใช้ Quality Short Signal / matrix filter / fade SHORT */
export function snowballEma4hSlopeMatchesTrendGradeF(
  ema4hSlopePct7d?: number | null,
  ema1dSlopePct7d?: number | null,
  btcEma1dSlopePct7d?: number | null,
): boolean {
  return matchesGradeF({ ema4hSlopePct7d, ema1dSlopePct7d, btcEma1dSlopePct7d });
}

/** ตัดเกรด F → S → A → B → C (fallback) · EMA1h > 80% → C */
export function classifySnowballTrendGrade(input: ClassifySnowballTrendGradeInput): SnowballTrendGrade {
  let grade: SnowballTrendGrade;
  if (matchesGradeF(input)) grade = "f";
  else if (matchesGradeS(input)) grade = "s";
  else if (matchesGradeA(input)) grade = "a";
  else if (matchesGradeB(input)) grade = "b";
  else grade = "c";
  return applySnowballEma1hOverextendedCap(grade, input.ema1hSlopePct7d);
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
  const sabNote = ` · 4h Long: ${SNOWBALL_TREND_GRADE_SAB_VOL_PSAR_NOTE}`;
  const ema1hCapNote = ` · ${SNOWBALL_TREND_GRADE_EMA1H_OVEREXTENDED_CRITERIA}`;
  if (base === "F") return `${SNOWBALL_TREND_GRADE_F_CRITERIA}${ema1hCapNote}${plusNote}`;
  if (base === "S") {
    return `EMA4h > ${SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE}% · Long เขียว ≤ ${SNOWBALL_TREND_GRADE_S_GREEN_MAX}${sabNote}${ema1hCapNote}${plusNote}`;
  }
  if (base === "A") {
    return `EMA4h > ${SNOWBALL_TREND_GRADE_A_EMA4H_MIN_EXCLUSIVE}% (ไม่เกิน S) · Long เขียว ≤ ${SNOWBALL_TREND_GRADE_A_GREEN_MAX}${sabNote}${ema1hCapNote}${plusNote}`;
  }
  if (base === "B") {
    return `EMA4h > ${SNOWBALL_TREND_GRADE_B_EMA4H_MIN_EXCLUSIVE}%${sabNote}${ema1hCapNote}${plusNote}`;
  }
  if (base === "C") return `fallback (นอกเหนือ F / S / A / B)${ema1hCapNote}${plusNote}`;
  return `นอกเหนือเกณฑ์ F / S / A / B / C`;
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
  if (grade === "s") return "full";
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

/** ข้อความ footnote สำหรับ alert / stats */
export function snowballTrendGradeFootnote(input: SnowballTrendGradeFootnoteInput): string {
  const g = snowballTrendGradeToDisplay(input.grade);
  const ema4h = fmtSlopePct(input.ema4hSlopePct7d);
  const ema1h = fmtSlopePct(input.ema1hSlopePct7d);
  const ema1d = fmtSlopePct(input.ema1dSlopePct7d);
  const btc4h = fmtSlopePct(input.btcEma4hSlopePct7d);
  const btc1d = fmtSlopePct(input.btcEma1dSlopePct7d);
  const green =
    input.greenDaysBeforeSignal != null && Number.isFinite(input.greenDaysBeforeSignal)
      ? String(Math.floor(input.greenDaysBeforeSignal))
      : "—";
  const plan = snowballTrendActionPlanLabel(snowballTrendGradeActionPlan(input.grade));
  const greenPart = isLongSide(input.alertSide) ? ` · เขียว ${green}` : "";
  const psarPart =
    input.psar4hTrend === "up" ? " · SAR4h ↑" : input.psar4hTrend === "down" ? " · SAR4h ↓" : "";
  const ema1hCapPart = snowballEma1hSlopeForcesGradeC(input.ema1hSlopePct7d) ? " · EMA1h overextended→C" : "";
  return `📎 Grade ${g}: EMA1h ${ema1h} · EMA4h ${ema4h}${greenPart} · EMA1d ${ema1d} · BTC∠4h ${btc4h} · BTC∠1d ${btc1d}${psarPart}${ema1hCapPart} · ${plan}`;
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
