/**
 * Snowball composite grade — base (EMA/เขียว) + modifiers: + (HH200+VAH) · ⚠️ (Max DD)
 * ใช้กับ 4h LONG เมื่อมี snapshot โครงสร้าง/DD
 */

/** suffix แสดง Max DD > limit — ต่อท้าย display grade */
export const SNOWBALL_GRADE_DANGEROUS_DISPLAY_SUFFIX = " ⚠️";

import type { SnowballLongStructureTier } from "./snowballLongBreakoutGrade";
import {
  SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C,
  snowballVolSmaMeetsGradeCMin,
} from "./snowballLongGrade4hPipeline";
import { snowballTrendMomentumMaxDrawbackPct } from "./snowballTrendMomentumMetrics";
import {
  classifySnowballTrendGrade,
  snowballTrendActionPlanLabel,
  snowballTrendGradeActionPlan,
  snowballTrendGradeToDisplay,
  snowballTrendGradeWithPlus,
  type ClassifySnowballTrendGradeInput,
  type SnowballTrendGrade,
  type SnowballTrendGradeDisplay,
} from "./snowballTrendGrade";

export type SnowballCompositeGradeResult = {
  baseTier: SnowballTrendGrade;
  display: SnowballTrendGradeDisplay;
  dangerous: boolean;
  composite: boolean;
};

export type SnowballCompositeSignalBarTf = "15m" | "1h" | "4h";

export type SnowballCompositeGradeInput = ClassifySnowballTrendGradeInput & {
  signalBarTf?: SnowballCompositeSignalBarTf | null;
  swing200Ok?: boolean | null;
  vahOk?: boolean | null;
  structureTier?: SnowballLongStructureTier | null;
  signalMaxDdPct?: number | null;
  /** Vol แท่งสัญญาณ ÷ SMA — 4h Long ต้อง ≥ 2× ถึงจะได้ S/A/B */
  signalVolVsSma?: number | null;
};

/** Vol×SMA ขั้นต่ำสำหรับเกรด S/A/B บน 4h Long */
export const SNOWBALL_COMPOSITE_SAB_VOL_VS_SMA_MIN = SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C;

export function snowballVolSmaMeetsSabGradeMin(
  signalVolVsSma: number | null | undefined,
): boolean {
  return snowballVolSmaMeetsGradeCMin(signalVolVsSma);
}

/** S/A/B ที่ Vol×SMA ไม่ถึง → cap เป็น C (F/C ไม่เปลี่ยน · ไม่ลงโทษเมื่อไม่มีข้อมูล vol) */
export function applySnowballVolSmaSabCap(
  baseTier: SnowballTrendGrade,
  signalVolVsSma: number | null | undefined,
): SnowballTrendGrade {
  if (baseTier !== "s" && baseTier !== "a" && baseTier !== "b") return baseTier;
  if (signalVolVsSma == null || !Number.isFinite(signalVolVsSma)) return baseTier;
  if (snowballVolSmaMeetsSabGradeMin(signalVolVsSma)) return baseTier;
  return "c";
}

/** S1 — HH200 ผ่าน (feed-time หรือ stats row) */
export function snowballS1Hh200Ok(input: {
  swing200Ok?: boolean | null;
  structureTier?: SnowballLongStructureTier | null;
}): boolean | null {
  if (typeof input.swing200Ok === "boolean") return input.swing200Ok;
  const tier = input.structureTier;
  if (tier === "a_plus") return true;
  if (tier === "c_plus") return false;
  return null;
}

/** S1 — VAH ผ่าน */
export function snowballS1VahOk(input: {
  vahOk?: boolean | null;
  structureTier?: SnowballLongStructureTier | null;
}): boolean {
  if (typeof input.vahOk === "boolean") return input.vahOk;
  const tier = input.structureTier;
  return tier === "a_plus" || tier === "b_plus";
}

export function snowballS1Hh200AndVahOk(input: {
  swing200Ok?: boolean | null;
  vahOk?: boolean | null;
  structureTier?: SnowballLongStructureTier | null;
}): boolean {
  return snowballS1Hh200Ok(input) === true && snowballS1VahOk(input);
}

export function snowballS1Hh200OrVahOk(input: {
  swing200Ok?: boolean | null;
  vahOk?: boolean | null;
  structureTier?: SnowballLongStructureTier | null;
}): boolean {
  return snowballS1Hh200Ok(input) === true || snowballS1VahOk(input);
}

/** S3 — Max DD 15m ผ่าน (≤ limit) */
export function snowballS3MaxDdOk(signalMaxDdPct: number | null | undefined): boolean | null {
  if (signalMaxDdPct == null || !Number.isFinite(signalMaxDdPct) || signalMaxDdPct < 0) {
    return null;
  }
  return signalMaxDdPct <= snowballTrendMomentumMaxDrawbackPct();
}

/** S3 — Max DD > limit → suffix ⚠️ */
export function snowballS3MaxDdDangerous(signalMaxDdPct: number | null | undefined): boolean {
  if (signalMaxDdPct == null || !Number.isFinite(signalMaxDdPct)) return false;
  return signalMaxDdPct > snowballTrendMomentumMaxDrawbackPct();
}

/** Normalize Binance TF → composite signal TF (1d etc. → null = momentum-only) */
export function snowballCompositeSignalBarTf(
  tf: string | null | undefined,
): SnowballCompositeSignalBarTf | null {
  if (tf === "15m" || tf === "1h" || tf === "4h") return tf;
  return null;
}

export function snowballCompositeGradeApplies(input: SnowballCompositeGradeInput): boolean {
  const side = input.alertSide ?? "long";
  if (side === "bear") return false;
  return input.signalBarTf === "4h";
}

export function displayGradeToBaseTier(display: SnowballTrendGradeDisplay): SnowballTrendGrade {
  if (display === "S+" || display === "S") return "s";
  if (display === "A+" || display === "A") return "a";
  if (display === "B+" || display === "B") return "b";
  if (display === "C+" || display === "C") return "c";
  if (display === "F") return "f";
  return "c";
}

export function snowballAutoTradeGradeKeyFromDisplay(
  display: SnowballTrendGradeDisplay | string | null | undefined,
): "S" | "A" | "B" | "C" | "F" | null {
  if (!display) return null;
  const d = snowballTrendGradeDisplayLabelBase(display.trim());
  if (d === "S+" || d === "S") return "S";
  if (d === "A+" || d === "A") return "A";
  if (d === "B+" || d === "B") return "B";
  if (d === "C+" || d === "C") return "C";
  if (d === "F") return "F";
  return null;
}

function result(
  baseTier: SnowballTrendGrade,
  display: SnowballTrendGradeDisplay,
  dangerous: boolean,
): SnowballCompositeGradeResult {
  return { baseTier, display, dangerous, composite: true };
}

/** Classify composite grade for 4h LONG — base tier + + / ⚠️ modifiers */
export function classifySnowballCompositeGrade(
  input: SnowballCompositeGradeInput,
): SnowballCompositeGradeResult {
  const baseTier = classifySnowballTrendGrade(input);
  const plus = snowballS1Hh200AndVahOk(input);
  const dangerous = snowballS3MaxDdDangerous(input.signalMaxDdPct);
  const display = snowballTrendGradeWithPlus(baseTier, plus);
  return result(baseTier, display, dangerous);
}

/** Fallback: momentum-only (non-4h / bear / missing composite context) */
export function classifySnowballGradeWithFallback(
  input: SnowballCompositeGradeInput,
): SnowballCompositeGradeResult {
  if (!snowballCompositeGradeApplies(input)) {
    const baseTier = classifySnowballTrendGrade(input);
    return {
      baseTier,
      display: snowballTrendGradeToDisplay(baseTier),
      dangerous: false,
      composite: false,
    };
  }
  return classifySnowballCompositeGrade(input);
}

function fmtSlopePct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function snowballCompositeGradeFootnote(input: {
  result: SnowballCompositeGradeResult;
  alertSide?: ClassifySnowballTrendGradeInput["alertSide"];
  ema1hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  ema1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  btcEma1dSlopePct7d?: number | null;
  psar4hTrend?: ClassifySnowballTrendGradeInput["psar4hTrend"];
  greenDaysBeforeSignal?: number | null;
  fundingRate?: number | null;
  barRangePctPrev?: number | null;
  swing200Ok?: boolean | null;
  vahOk?: boolean | null;
  structureTier?: SnowballLongStructureTier | null;
  signalMaxDdPct?: number | null;
}): string {
  const { result: r } = input;
  const ema4h = fmtSlopePct(input.ema4hSlopePct7d);
  const funding =
    input.fundingRate != null && Number.isFinite(input.fundingRate)
      ? `${(input.fundingRate * 100).toFixed(4)}%`
      : "—";
  const rPrev =
    input.barRangePctPrev != null && Number.isFinite(input.barRangePctPrev)
      ? `${input.barRangePctPrev.toFixed(2)}%`
      : "—";
  const plan = snowballTrendActionPlanLabel(snowballTrendGradeActionPlan(r.baseTier));
  const psarPart =
    input.psar4hTrend === "up" ? " · SAR4h ↑" : input.psar4hTrend === "down" ? " · SAR4h ↓" : "";
  const gradeLabel = snowballTrendGradeDisplayWithDangerous(r.display, r.dangerous);
  const plusPart = r.composite
    ? ` · + ${snowballS1Hh200AndVahOk(input) ? "✓" : "—"} (HH200+VAH)`
    : "";
  const dd =
    input.signalMaxDdPct != null && Number.isFinite(input.signalMaxDdPct)
      ? `${input.signalMaxDdPct.toFixed(2)}%`
      : "—";
  const ddPart = r.composite && r.dangerous ? ` · Max DD ${dd}` : "";
  return `📎 Grade ${gradeLabel}: EMA4h ${ema4h} · Funding ${funding} · R% ก่อน ${rPrev}${psarPart}${plusPart}${ddPart} · ${plan}`;
}

/** ตัด suffix ⚠️ / legacy (D) ก่อนเทียบ filter */
export function snowballTrendGradeDisplayLabelBase(label: string): string {
  return label
    .replace(SNOWBALL_GRADE_DANGEROUS_DISPLAY_SUFFIX, "")
    .replace(" (Dangerous)", "")
    .replace(" · Dangerous", "")
    .replace(" (D)", "")
    .trim();
}

/** ป้าย display + ⚠️ เมื่อ Max DD > 7% */
export function snowballTrendGradeDisplayWithDangerous(
  display: SnowballTrendGradeDisplay | string,
  dangerous?: boolean,
): string {
  if (dangerous) return `${display}${SNOWBALL_GRADE_DANGEROUS_DISPLAY_SUFFIX}`;
  return display;
}

export function snowballCompositeGradeDisplayLabel(
  display: SnowballTrendGradeDisplay,
  dangerous: boolean,
  side: "long" | "short" = "long",
): string {
  const sideTag = side === "short" ? "Short" : "Long";
  const d = snowballTrendGradeDisplayWithDangerous(display, dangerous);
  return `Grade ${d} (${sideTag})`;
}
