/**
 * Snowball composite grade — Momentum + S1 (HH200/VAH) + S3 (Max DD 15m)
 * ใช้กับ 4h LONG เมื่อมี snapshot โครงสร้าง/DD
 */

import type { SnowballLongStructureTier } from "./snowballLongBreakoutGrade";
import { snowballTrendMomentumMaxDrawbackPct } from "./snowballTrendMomentumMetrics";
import {
  classifySnowballTrendGrade,
  snowballTrendActionPlanLabel,
  snowballTrendGradeActionPlan,
  snowballTrendGradeToDisplay,
  SNOWBALL_TREND_GRADE_A_EMA4H_MIN_EXCLUSIVE,
  SNOWBALL_TREND_GRADE_A_GREEN_MAX,
  SNOWBALL_TREND_GRADE_B_BTC_EMA4H_MAX_EXCLUSIVE,
  SNOWBALL_TREND_GRADE_B_EMA4H_MAX,
  SNOWBALL_TREND_GRADE_B_EMA4H_MIN,
  SNOWBALL_TREND_GRADE_C_GREEN_MIN_EXCLUSIVE,
  SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE,
  SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE,
  SNOWBALL_TREND_GRADE_S_GREEN_MAX,
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

function greenDaysExceeds(maxDays: number, greenDaysBeforeSignal?: number | null): boolean {
  const n = greenDaysBeforeSignal;
  return n != null && Number.isFinite(n) && n >= 0 && Math.floor(n) > maxDays;
}

function matchesMomentumS(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  if (input.ema4hSlopePct7d <= SNOWBALL_TREND_GRADE_S_EMA4H_MIN_EXCLUSIVE) return false;
  if (
    isLongSide(input.alertSide) &&
    !greenDaysAtMost(SNOWBALL_TREND_GRADE_S_GREEN_MAX, input.greenDaysBeforeSignal)
  ) {
    return false;
  }
  return true;
}

function matchesMomentumA(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  if (input.ema4hSlopePct7d <= SNOWBALL_TREND_GRADE_A_EMA4H_MIN_EXCLUSIVE) return false;
  if (
    isLongSide(input.alertSide) &&
    !greenDaysAtMost(SNOWBALL_TREND_GRADE_A_GREEN_MAX, input.greenDaysBeforeSignal)
  ) {
    return false;
  }
  return true;
}

function matchesMomentumBSlope(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d)) return false;
  const pct = input.ema4hSlopePct7d;
  return pct >= SNOWBALL_TREND_GRADE_B_EMA4H_MIN && pct <= SNOWBALL_TREND_GRADE_B_EMA4H_MAX;
}

function matchesMomentumBBtc(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.btcEma4hSlopePct7d)) return false;
  return input.btcEma4hSlopePct7d < SNOWBALL_TREND_GRADE_B_BTC_EMA4H_MAX_EXCLUSIVE;
}

function matchesMomentumB(input: ClassifySnowballTrendGradeInput): boolean {
  return matchesMomentumBSlope(input) || matchesMomentumBBtc(input);
}

function matchesMomentumF(input: ClassifySnowballTrendGradeInput): boolean {
  if (!finitePct(input.ema4hSlopePct7d) || !finitePct(input.ema1dSlopePct7d)) return false;
  return (
    input.ema4hSlopePct7d < SNOWBALL_TREND_GRADE_F_EMA4H_MAX_EXCLUSIVE &&
    input.ema1dSlopePct7d < 0
  );
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

/** S3 — Dangerous demote */
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
  if (display === "F") return "f";
  return "c";
}

export function snowballAutoTradeGradeKeyFromDisplay(
  display: SnowballTrendGradeDisplay | string | null | undefined,
): "S" | "A" | "B" | "C" | "F" | null {
  if (!display) return null;
  const d = display.trim();
  if (d === "S+" || d === "S") return "S";
  if (d === "A+" || d === "A") return "A";
  if (d === "B+" || d === "B") return "B";
  if (d === "C") return "C";
  if (d === "F" || d.startsWith("F")) return "F";
  return null;
}

function result(
  baseTier: SnowballTrendGrade,
  display: SnowballTrendGradeDisplay,
  dangerous: boolean,
): SnowballCompositeGradeResult {
  return { baseTier, display, dangerous, composite: true };
}

/** Classify composite grade for 4h LONG */
export function classifySnowballCompositeGrade(
  input: SnowballCompositeGradeInput,
): SnowballCompositeGradeResult {
  const momentum = input as ClassifySnowballTrendGradeInput;

  if (snowballS3MaxDdDangerous(input.signalMaxDdPct)) {
    return result("f", "F", true);
  }

  if (matchesMomentumF(momentum)) {
    return result("f", "F", false);
  }

  const hh200AndVah = snowballS1Hh200AndVahOk(input);
  const hh200OrVah = snowballS1Hh200OrVahOk(input);
  const hh200 = snowballS1Hh200Ok(input) === true;
  const greenOver3 =
    isLongSide(input.alertSide) &&
    greenDaysExceeds(SNOWBALL_TREND_GRADE_C_GREEN_MIN_EXCLUSIVE, input.greenDaysBeforeSignal);

  if (matchesMomentumS(momentum)) {
    return result("s", hh200AndVah ? "S+" : "S", false);
  }

  if (matchesMomentumA(momentum)) {
    return result("a", hh200AndVah ? "A+" : "A", false);
  }

  if (greenOver3) {
    if (hh200) return result("b", "B+", false);
    if (hh200OrVah) return result("b", "B", false);
    return result("c", "C", false);
  }

  if (matchesMomentumB(momentum) && hh200OrVah) {
    return result("b", "B", false);
  }

  return result("c", "C", false);
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
  ema4hSlopePct7d?: number | null;
  ema1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  greenDaysBeforeSignal?: number | null;
  swing200Ok?: boolean | null;
  vahOk?: boolean | null;
  structureTier?: SnowballLongStructureTier | null;
  signalMaxDdPct?: number | null;
}): string {
  const { result: r } = input;
  const ema4h = fmtSlopePct(input.ema4hSlopePct7d);
  const ema1d = fmtSlopePct(input.ema1dSlopePct7d);
  const btc4h = fmtSlopePct(input.btcEma4hSlopePct7d);
  const green =
    input.greenDaysBeforeSignal != null && Number.isFinite(input.greenDaysBeforeSignal)
      ? String(Math.floor(input.greenDaysBeforeSignal))
      : "—";
  const plan = snowballTrendActionPlanLabel(snowballTrendGradeActionPlan(r.baseTier));
  const greenPart = isLongSide(input.alertSide) ? ` · เขียว ${green}` : "";
  const dangerousPart = r.dangerous ? " · Dangerous (Max DD > 7%)" : "";
  const s1Part = r.composite
    ? ` · S1 HH200 ${snowballS1Hh200Ok(input) === true ? "✓" : "—"} · VAH ${snowballS1VahOk(input) ? "✓" : "—"}`
    : "";
  const dd =
    input.signalMaxDdPct != null && Number.isFinite(input.signalMaxDdPct)
      ? `${input.signalMaxDdPct.toFixed(2)}%`
      : "—";
  const s3Part = r.composite ? ` · S3 Max DD ${dd}` : "";
  return `📎 Grade ${r.display}${dangerousPart}: EMA4h ${ema4h}${greenPart} · EMA1d ${ema1d} · BTC∠4h ${btc4h}${s1Part}${s3Part} · ${plan}`;
}

export function snowballCompositeGradeDisplayLabel(
  display: SnowballTrendGradeDisplay,
  dangerous: boolean,
  side: "long" | "short" = "long",
): string {
  const sideTag = side === "short" ? "Short" : "Long";
  const d = dangerous && display === "F" ? `${display} Dangerous` : display;
  return `Grade ${d} (${sideTag})`;
}
