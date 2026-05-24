import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import type { SnowballLongBreakout1hConfirmEval } from "./snowballLongBreakoutConfirm";
import { resolveSnowballLong4hPipeline } from "./snowballLongGrade4hPipeline";
import type { TrendMomentumMetrics } from "./snowballTrendMomentumMetrics";
import type { SnowballTwoBarInlineEval } from "./snowballTwoBarInline";

/** เกรดสุทธิที่แจ้ง / บันทึกสถิติ (Single-Layer Matrix) */
export type SnowballLongBreakoutGrade = "a_plus" | "b_plus" | "c_plus" | "d_plus" | "f_plus";

export type SnowballLongStructureTier = "a_plus" | "b_plus" | "c_plus";

export type SnowballLongGradeBlockReason =
  | "structure_fail"
  | "breakout_1h_fail"
  | "momentum_and_confirm_fail"
  | "momentum_fail_d_plus_off"
  | "confirm_fail";

export type SnowballLongGradeResolution =
  | {
      kind: "grade";
      grade: SnowballLongBreakoutGrade;
      structureTier: SnowballLongStructureTier;
      confirm1hOk: boolean;
      momentumOk: boolean;
      confirm1hEval: SnowballLongBreakout1hConfirmEval | null;
      footnote?: string;
      /** เกรดสุทธิ B เพราะ vol ใกล้เกณฑ์ (ผ่าน near-miss แต่ไม่ถึง SMA×strict) */
      nearMissVolume?: boolean;
    }
  | {
      kind: "block";
      reason: SnowballLongGradeBlockReason;
      detail: string;
    };

export type ResolveSnowballLongFinalGradeInput = {
  snowTf: BinanceIndicatorTf;
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
  /** ผล two-bar inline (4h) — ใช้ pipeline 4h */
  twoBarEval?: SnowballTwoBarInlineEval | null;
  trendMomentum?: TrendMomentumMetrics | null;
  /** ผ่าน two-bar inline (pullback / vol / 1h min-low) แล้ว — ถือ 1H confirm ผ่าน */
  twoBarInlinePassed: boolean;
  /** Snowball TF ≠ 4h และเปิด Long Breakout 1H */
  longBreakout1h: boolean;
  breakout1hEval: SnowballLongBreakout1hConfirmEval | null;
  momentumRequired: boolean;
  momentumOk: boolean;
  gradeDPlusOnMomentumFail: boolean;
  gradeFOnMomentumAndConfirmFail: boolean;
  /** ผ่าน vol > SMA×strict (หรือ intrabar relax) */
  volumeStrictOk: boolean;
  /** strict ไม่ผ่าน แต่ vol > SMA×near — ติดแค่ Volume */
  volumeNearMissOnly: boolean;
  gradeDPlusNearMissVolumeEnabled: boolean;
};

const SEC_4H = 4 * 3600;
const SEC_1H = 3600;
const SEC_15M = 900;

export function snowballTfBarDurationSec(tf: BinanceIndicatorTf): number {
  if (tf === "4h") return SEC_4H;
  if (tf === "1h") return SEC_1H;
  return SEC_15M;
}

/** โครงสร้าง 4H จาก HH48 · HH200 · VAH (ชั้น A+/B/C เท่านั้น) */
export function classifyLongStructureTier(
  swing48: boolean,
  swing200: boolean,
  vahOk: boolean,
): SnowballLongStructureTier {
  if (swing48 && swing200 && vahOk) return "a_plus";
  if (!swing48 && vahOk) return "b_plus";
  return "c_plus";
}

/** @deprecated ใช้ classifyLongStructureTier — คง alias เพื่อ compat */
export function classifyLongBreakoutGrade(
  swing48: boolean,
  swing200: boolean,
  vahOk: boolean,
): SnowballLongBreakoutGrade {
  return classifyLongStructureTier(swing48, swing200, vahOk);
}

export function snowballLongStructurePassesMain(swing48: boolean, vahOk: boolean): boolean {
  return swing48 || vahOk;
}

/** Breakout Entry 1H confirm ผ่าน (body/vol/clean close บนแท่ง 1H) */
export function snowballLongBreakout1hEvalPasses(
  ev: SnowballLongBreakout1hConfirmEval | null | undefined,
): boolean {
  return ev?.ok === true && Number.isFinite(ev.close) && ev.close > 0;
}

function resolveConfirm1hOk(input: ResolveSnowballLongFinalGradeInput): {
  ok: boolean;
  eval: SnowballLongBreakout1hConfirmEval | null;
} {
  if (input.twoBarInlinePassed) {
    return { ok: true, eval: input.breakout1hEval };
  }
  const ev = input.breakout1hEval;
  return { ok: snowballLongBreakout1hEvalPasses(ev), eval: ev };
}

/** @deprecated Grade D (Long->Short) ถูกถอดแล้ว — ใช้แถวสถิติเก่าที่ breakout1hConfirmFail เท่านั้น */
export function snowballIsGradeDLongToShort(
  _grade: SnowballLongBreakoutGrade | undefined,
  breakout1hConfirmFail: boolean | undefined,
): boolean {
  return breakout1hConfirmFail === true;
}

/** Grade D+ (Long) */
export function snowballIsGradeDPlusLong(grade: SnowballLongBreakoutGrade | undefined): boolean {
  return grade === "d_plus";
}

export function snowballIsGradeF(grade: SnowballLongBreakoutGrade | undefined): boolean {
  return grade === "f_plus";
}

export function snowballLongGradeShortLabel(g: SnowballLongBreakoutGrade): string {
  if (g === "a_plus") return "A+";
  if (g === "b_plus") return "B";
  if (g === "c_plus") return "C";
  if (g === "f_plus") return "F";
  if (g === "d_plus") return "D+";
  return "—";
}

export function snowballLongGradeDisplayLabel(grade: SnowballLongBreakoutGrade): string {
  if (snowballIsGradeDPlusLong(grade)) return "Grade D+ (Long)";
  if (grade === "f_plus") return snowballLongGradeFLabel();
  if (grade === "a_plus") return "Grade A+ (Long)";
  if (grade === "b_plus") return "Grade B (Long)";
  if (grade === "c_plus") return "Grade C (Long)";
  return "Grade — (Long)";
}

export function snowballLongGradePlusLabel(_g: SnowballLongBreakoutGrade): string {
  return "Grade D+ (Long)";
}

export function snowballLongGradeFLabel(): string {
  return "Grade F (Long)";
}

/** @deprecated ใช้ snowballLongStructureTierShortLabel */
export function snowballStructureGradeShortLabel(g: SnowballLongBreakoutGrade): string {
  if (g === "a_plus" || g === "b_plus" || g === "c_plus") return snowballLongGradeShortLabel(g);
  return "—";
}

/**
 * Single-Layer Matrix — คืนเกรดสุทธิหรือ BLOCK ครั้งเดียว
 * Master 4h → resolveSnowballLong4hPipeline (โครงสร้าง → two-bar → momentum)
 */
export function resolveSnowballLongFinalGrade(
  input: ResolveSnowballLongFinalGradeInput,
): SnowballLongGradeResolution {
  if (input.snowTf === "4h") {
    const twoBar =
      input.twoBarEval ??
      ({
        ok: input.twoBarInlinePassed,
        pullbackOk: input.twoBarInlinePassed,
        volRatioOk: input.twoBarInlinePassed,
        minLow1hOk: input.twoBarInlinePassed,
        detail: input.twoBarInlinePassed ? "two-bar inline ผ่าน" : "two-bar inline ไม่ผ่าน",
      } satisfies SnowballTwoBarInlineEval);
    return resolveSnowballLong4hPipeline({
      swing48: input.swing48,
      swing200: input.swing200,
      vahOk: input.vahOk,
      twoBar,
      trendMomentum: input.trendMomentum ?? null,
      volumeStrictOk: input.volumeStrictOk,
    });
  }

  const structureOk = snowballLongStructurePassesMain(input.swing48, input.vahOk);
  if (!structureOk) {
    return { kind: "block", reason: "structure_fail", detail: "โครงสร้าง 4H ไม่ผ่าน (ไม่มี Swing HH48 / VAH)" };
  }

  const structureTier = classifyLongStructureTier(input.swing48, input.swing200, input.vahOk);
  const confirm = resolveConfirm1hOk(input);
  const confirmOk = confirm.ok;
  const momentumOk = !input.momentumRequired || input.momentumOk;

  const confirm1hEvalOk = snowballLongBreakout1hEvalPasses(confirm.eval);

  if (
    input.gradeDPlusNearMissVolumeEnabled &&
    input.volumeNearMissOnly &&
    confirmOk &&
    confirm1hEvalOk &&
    momentumOk
  ) {
    return {
      kind: "grade",
      grade: "b_plus",
      structureTier,
      confirm1hOk: true,
      momentumOk: true,
      confirm1hEval: confirm.eval,
      nearMissVolume: true,
    };
  }

  if (
    input.volumeNearMissOnly &&
    momentumOk &&
    !confirm1hEvalOk &&
    input.gradeFOnMomentumAndConfirmFail
  ) {
    return {
      kind: "grade",
      grade: "f_plus",
      structureTier,
      confirm1hOk: false,
      momentumOk: true,
      confirm1hEval: confirm.eval,
      nearMissVolume: true,
    };
  }

  if (momentumOk && confirmOk && input.volumeStrictOk) {
    return {
      kind: "grade",
      grade: structureTier,
      structureTier,
      confirm1hOk: true,
      momentumOk: true,
      confirm1hEval: confirm.eval,
    };
  }

  if (!momentumOk && confirmOk) {
    if (!input.gradeDPlusOnMomentumFail) {
      return {
        kind: "block",
        reason: "momentum_fail_d_plus_off",
        detail: "momentum ไม่ผ่าน · ปิด D+ (INDICATOR_PUBLIC_SNOWBALL_GRADE_B_MOMENTUM_FAIL_GRADE_D_ON_1H_CONFIRM=0)",
      };
    }
    return {
      kind: "grade",
      grade: "d_plus",
      structureTier,
      confirm1hOk: true,
      momentumOk: false,
      confirm1hEval: confirm.eval,
    };
  }

  if (
    input.snowTf !== "4h" &&
    input.longBreakout1h &&
    !confirmOk
  ) {
    return {
      kind: "block",
      reason: "breakout_1h_fail",
      detail: confirm.eval?.detail ?? "1H Breakout confirm ไม่ผ่าน",
    };
  }

  if (!momentumOk && !confirmOk && !input.twoBarInlinePassed && input.gradeFOnMomentumAndConfirmFail) {
    return {
      kind: "grade",
      grade: "f_plus",
      structureTier,
      confirm1hOk: false,
      momentumOk: false,
      confirm1hEval: confirm.eval,
    };
  }

  if (!momentumOk && !confirmOk) {
    return {
      kind: "block",
      reason: "momentum_and_confirm_fail",
      detail: confirm.eval?.detail ?? "momentum ไม่ผ่าน · 1H confirm ไม่ผ่าน",
    };
  }

  if (!confirmOk) {
    return {
      kind: "block",
      reason: "confirm_fail",
      detail: confirm.eval?.detail ?? "1H confirm ไม่ผ่าน",
    };
  }

  return { kind: "block", reason: "momentum_and_confirm_fail", detail: "ไม่ตรงเกณฑ์ matrix" };
}

function maxHighPriorWindow(
  high: number[],
  i: number,
  lookback: number,
  excludeRecentTrailing: number,
): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

function highVolumeNodeBarHigh(
  vol: number[],
  high: number[],
  low: number[],
  i: number,
  lookback: number,
): number | null {
  const start = Math.max(0, i - lookback);
  const end = i - 1;
  if (end < start) return null;
  let bestJ = start;
  let bestV = -Infinity;
  for (let j = start; j <= end; j++) {
    const v = vol[j]!;
    if (v > bestV && Number.isFinite(v)) {
      bestV = v;
      bestJ = j;
    }
  }
  const H = high[bestJ];
  return Number.isFinite(H!) ? H! : null;
}

function longSwingHighBreak(
  high: number[],
  close: number[],
  i: number,
  lookback: number,
  excludeRecent: number,
): boolean {
  const priorMaxHigh = maxHighPriorWindow(high, i, lookback, excludeRecent);
  if (!Number.isFinite(priorMaxHigh)) return false;
  const cl = close[i]!;
  return cl > priorMaxHigh;
}

function vahCrossOnBar(
  pack: BinanceKlinePack,
  i: number,
  vahLb: number,
  longVahOn: boolean,
): boolean {
  if (!longVahOn || i < 1) return false;
  const vahH = highVolumeNodeBarHigh(pack.volume, pack.high, pack.low, i, vahLb);
  if (vahH == null || !Number.isFinite(vahH)) return false;
  const cl = pack.close[i]!;
  const clPrev = pack.close[i - 1]!;
  return Number.isFinite(cl) && Number.isFinite(clPrev) && cl > vahH && clPrev <= vahH;
}

/** A/B/C จากโครงสร้างแท่งสัญญาณ (HH48 / HH200 / VAH บน TF เดียวกับ Snowball) */
export function classifyLongBreakoutGradeOnBar(
  pack: BinanceKlinePack,
  iBar: number,
  swingLb: number,
  swingEx: number,
  swingGradeLb: number,
  vahLb: number,
  longVahOn: boolean,
): SnowballLongStructureTier {
  const swing48 = longSwingHighBreak(pack.high, pack.close, iBar, swingLb, swingEx);
  const swing200 = longSwingHighBreak(pack.high, pack.close, iBar, swingGradeLb, swingEx);
  const vahOk = vahCrossOnBar(pack, iBar, vahLb, longVahOn);
  return classifyLongStructureTier(swing48, swing200, vahOk);
}

/** แท่งปิดล่าสุดที่ close time ≤ asOfSec */
export function latestClosedBarIndexAtOrBefore(
  pack: BinanceKlinePack,
  barDurSec: number,
  asOfSec: number,
): number {
  let best = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    const t = pack.timeSec[i]!;
    if (Number.isFinite(t) && t + barDurSec <= asOfSec) best = i;
  }
  return best;
}

export type SnowballTwoBarGradeResult = {
  grade: SnowballLongStructureTier;
  iSig: number;
  iConf: number;
};

export function gradeFromSnowballTwoClosedBars(
  pack: BinanceKlinePack,
  snowTf: BinanceIndicatorTf,
  asOfSec: number,
  swingLb: number,
  swingEx: number,
  swingGradeLb: number,
  vahLb: number,
  longVahOn: boolean,
): SnowballTwoBarGradeResult | null {
  const barDur = snowballTfBarDurationSec(snowTf);
  const iConf = latestClosedBarIndexAtOrBefore(pack, barDur, asOfSec);
  if (iConf < 1) return null;
  const iSig = iConf - 1;
  const minBars = Math.max(swingLb + swingEx + 2, swingGradeLb + swingEx + 2, vahLb + 2);
  if (iSig < minBars) return null;
  const grade = classifyLongBreakoutGradeOnBar(pack, iSig, swingLb, swingEx, swingGradeLb, vahLb, longVahOn);
  return { grade, iSig, iConf };
}
