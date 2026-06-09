/**
 * Snowball trend grade — S / A / B / C / F จาก EMA slope (+ เขียวสำหรับ LONG)
 */

import type { SnowballAutoTradeAlertSide } from "./tradingViewCloseSettingsStore";

export type SnowballTrendGrade = "s" | "a" | "b" | "c" | "f";

/** @deprecated alias — ใช้ SnowballTrendGrade */
export type SnowballLongBreakoutGrade = SnowballTrendGrade;

export type SnowballTrendGradeDisplay = "S" | "A" | "B" | "C" | "F";

export type SnowballTrendActionPlan = "full" | "standard" | "light" | "monitor";

export const SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE = 50;
export const SNOWBALL_TREND_GRADE_A_EMA4H_MIN = 15;
export const SNOWBALL_TREND_GRADE_A_EMA4H_MAX = 50;
export const SNOWBALL_TREND_GRADE_B_EMA4H_MIN = 10;
export const SNOWBALL_TREND_GRADE_B_EMA4H_MAX = 15;
export const SNOWBALL_TREND_GRADE_B_BTC_EMA4H_MAX_EXCLUSIVE = -10;
export const SNOWBALL_TREND_GRADE_F_EMA4H_MIN_EXCLUSIVE = -10;
export const SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE = -2.5;
export const SNOWBALL_TREND_GRADE_S_GREEN_MAX = 1;
export const SNOWBALL_TREND_GRADE_A_GREEN_MAX = 3;

export type ClassifySnowballTrendGradeInput = {
  alertSide?: SnowballAutoTradeAlertSide | "long" | "bear" | null;
  ema4hSlopePct7d?: number | null;
  ema1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  greenDaysBeforeSignal?: number | null;
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

function matchesGradeS(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  if (input.ema4hSlopePct7d <= SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE) return false;
  if (isLongSide(input.alertSide) && !greenDaysAtMost(SNOWBALL_TREND_GRADE_S_GREEN_MAX, input.greenDaysBeforeSignal)) {
    return false;
  }
  return true;
}

function matchesGradeA(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  const pct = input.ema4hSlopePct7d;
  if (pct < SNOWBALL_TREND_GRADE_A_EMA4H_MIN || pct > SNOWBALL_TREND_GRADE_A_EMA4H_MAX) return false;
  if (isLongSide(input.alertSide) && !greenDaysAtMost(SNOWBALL_TREND_GRADE_A_GREEN_MAX, input.greenDaysBeforeSignal)) {
    return false;
  }
  return true;
}

function matchesGradeBSlope(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  const pct = input.ema4hSlopePct7d;
  return pct >= SNOWBALL_TREND_GRADE_B_EMA4H_MIN && pct <= SNOWBALL_TREND_GRADE_B_EMA4H_MAX;
}

function matchesGradeBBtc(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.btcEma4hSlopePct7d)) return false;
  return input.btcEma4hSlopePct7d < SNOWBALL_TREND_GRADE_B_BTC_EMA4H_MAX_EXCLUSIVE;
}

function matchesGradeB(input: ClassifySnowballTrendGradeInput): boolean {
  return matchesGradeBSlope(input) || matchesGradeBBtc(input);
}

function matchesGradeF(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d) || !finitePct(input.ema1dSlopePct7d)) return false;
  const ema4h = input.ema4hSlopePct7d;
  const ema1d = input.ema1dSlopePct7d;
  return (
    ema4h > SNOWBALL_TREND_GRADE_F_EMA4H_MIN_EXCLUSIVE &&
    ema4h < SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE &&
    ema1d < 0
  );
}

export const SNOWBALL_TREND_GRADE_F_CRITERIA = `EMA4h > ${SNOWBALL_TREND_GRADE_F_EMA4H_MIN_EXCLUSIVE}% และ < ${SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE}% (ลำดับแรก) · EMA1d < 0%`;

/** ตรงเกรด F — ใช้ Quality Short Signal / matrix filter / fade SHORT */
export function snowballEma4hSlopeMatchesTrendGradeF(
  ema4hSlopePct7d?: number | null,
  ema1dSlopePct7d?: number | null,
): boolean {
  return matchesGradeF({ ema4hSlopePct7d, ema1dSlopePct7d });
}

/** ตัดเกรด F → S → A → B → C */
export function classifySnowballTrendGrade(input: ClassifySnowballTrendGradeInput): SnowballTrendGrade {
  if (matchesGradeF(input)) return "f";
  if (matchesGradeS(input)) return "s";
  if (matchesGradeA(input)) return "a";
  if (matchesGradeB(input)) return "b";
  return "c";
}

export function snowballTrendGradeToDisplay(grade: SnowballTrendGrade): SnowballTrendGradeDisplay {
  if (grade === "s") return "S";
  if (grade === "a") return "A";
  if (grade === "b") return "B";
  if (grade === "f") return "F";
  return "C";
}

export type SnowballTrendGradeFilter = "all" | SnowballTrendGradeDisplay;

/** เกณฑ์ Trend Grade ต่อชั้น — ใช้ใน stats filter / tooltip */
export function snowballTrendGradeFilterCriteria(grade: SnowballTrendGradeDisplay): string {
  if (grade === "F") {
    return SNOWBALL_TREND_GRADE_F_CRITERIA;
  }
  if (grade === "S") {
    return `EMA4h > ${SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE}% · LONG เขียว ≤ ${SNOWBALL_TREND_GRADE_S_GREEN_MAX} วัน`;
  }
  if (grade === "A") {
    return `EMA4h ${SNOWBALL_TREND_GRADE_A_EMA4H_MIN}–${SNOWBALL_TREND_GRADE_A_EMA4H_MAX}% · LONG เขียว ≤ ${SNOWBALL_TREND_GRADE_A_GREEN_MAX} วัน`;
  }
  if (grade === "B") {
    return `EMA4h ${SNOWBALL_TREND_GRADE_B_EMA4H_MIN}–${SNOWBALL_TREND_GRADE_B_EMA4H_MAX}% หรือ BTC EMA4h < ${SNOWBALL_TREND_GRADE_B_BTC_EMA4H_MAX_EXCLUSIVE}%`;
  }
  return "นอกเหนือเกณฑ์ F / S / A / B";
}

export function snowballTrendGradeFilterTitle(filter: SnowballTrendGradeFilter): string {
  if (filter === "all") return "ทุก grade";
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

/** Grade F ไม่บล็อก pending dedupe */
export function snowballTrendGradeSkipsFeedDedupe(grade: SnowballTrendGrade | undefined): boolean {
  return grade === "f";
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
  const ema1d = fmtSlopePct(input.ema1dSlopePct7d);
  const btc4h = fmtSlopePct(input.btcEma4hSlopePct7d);
  const green =
    input.greenDaysBeforeSignal != null && Number.isFinite(input.greenDaysBeforeSignal)
      ? String(Math.floor(input.greenDaysBeforeSignal))
      : "—";
  const plan = snowballTrendActionPlanLabel(snowballTrendGradeActionPlan(input.grade));
  const greenPart = isLongSide(input.alertSide) ? ` · เขียว ${green}` : "";
  return `📎 Grade ${g}: EMA4h ${ema4h}${greenPart} · EMA1d ${ema1d} · BTC∠4h ${btc4h} · ${plan}`;
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
  if (k === "S" || k === "A" || k === "B" || k === "C" || k === "F") return k;
  if (k.startsWith("A")) return "A";
  if (k.startsWith("B")) return "B";
  if (k.startsWith("C")) return "C";
  if (k === "D" || k === "D+") return "C";
  if (k.startsWith("F")) return "F";
  return null;
}
