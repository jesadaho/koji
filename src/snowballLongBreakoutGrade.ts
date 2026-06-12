import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import type { SnowballLongBreakout1hConfirmEval } from "./snowballLongBreakoutConfirm";
import type { TrendMomentumMetrics } from "./snowballTrendMomentumMetrics";
import type { SnowballTwoBarInlineEval } from "./snowballTwoBarInline";
import {
  classifySnowballGradeWithFallback,
  snowballCompositeGradeFootnote,
  snowballCompositeSignalBarTf,
  type SnowballCompositeGradeResult,
} from "./snowballCompositeGrade";
import {
  snowballIsTrendGradeF,
  snowballTrendGradeActionPlan,
  snowballTrendGradeDisplayLabel,
  snowballTrendGradeShortLabel,
  snowballTrendGradeSkipsFeedDedupe,
  type ClassifySnowballTrendGradeInput,
  type SnowballLongBreakoutGrade,
  type SnowballTrendActionPlan,
  type SnowballTrendGrade,
  type SnowballTrendGradeDisplay,
} from "./snowballTrendGrade";

export type {
  ClassifySnowballTrendGradeInput,
  LegacySnowballQualityTier,
  SnowballLongBreakoutGrade,
  SnowballTrendActionPlan,
  SnowballTrendGrade,
  SnowballTrendGradeDisplay,
} from "./snowballTrendGrade";

export {
  classifySnowballTrendGrade,
  isLegacySnowballQualityTier,
  isSnowballTrendGrade,
  legacySnowballQualityTierToDisplay,
  migrateSnowballAutoTradeGradeKey,
  normalizeSnowballQualityTier,
  snowballIsTrendGradeF,
  snowballTrendActionPlanLabel,
  snowballTrendGradeActionPlan,
  snowballTrendGradeDisplayLabel,
  snowballTrendGradeFootnote,
  snowballTrendGradeShortLabel,
  snowballTrendGradeSkipsFeedDedupe,
  snowballTrendGradeToDisplay,
} from "./snowballTrendGrade";

export type SnowballLongStructureTier = "a_plus" | "b_plus" | "c_plus";

export function isSnowballLongStructureTier(t: string | undefined): t is SnowballLongStructureTier {
  return t === "a_plus" || t === "b_plus" || t === "c_plus";
}

/** @deprecated — ไม่ block alert อีกต่อไป */
export type SnowballLongGradeBlockReason =
  | "structure_fail"
  | "two_bar_inline_fail"
  | "breakout_1h_fail"
  | "momentum_and_confirm_fail"
  | "momentum_fail_d_plus_off"
  | "confirm_fail";

export type SnowballLongGradeResolution = {
  kind: "grade";
  grade: SnowballLongBreakoutGrade;
  displayGrade: SnowballTrendGradeDisplay;
  gradeDangerous: boolean;
  compositeGrade: boolean;
  structureTier: SnowballLongStructureTier;
  confirm1hOk: boolean;
  momentumOk: boolean;
  confirm1hEval: SnowballLongBreakout1hConfirmEval | null;
  footnote?: string;
  actionPlan?: SnowballTrendActionPlan;
};

export type ResolveSnowballLongFinalGradeInput = {
  snowTf: BinanceIndicatorTf;
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
  twoBarEval?: SnowballTwoBarInlineEval | null;
  trendMomentum?: TrendMomentumMetrics | null;
  signalVolVsSma?: number | null;
  twoBarInlinePassed: boolean;
  longBreakout1h: boolean;
  breakout1hEval: SnowballLongBreakout1hConfirmEval | null;
  momentumRequired: boolean;
  momentumOk: boolean;
  gradeDPlusOnMomentumFail: boolean;
  gradeFOnMomentumAndConfirmFail: boolean;
  volumeStrictOk: boolean;
  volumeNearMissOnly: boolean;
  gradeDPlusNearMissVolumeEnabled: boolean;
  /** market context สำหรับ trend grade */
  trendGradeInput: ClassifySnowballTrendGradeInput;
};

const SEC_4H = 4 * 3600;
const SEC_1H = 3600;
const SEC_15M = 900;

export function snowballTfBarDurationSec(tf: BinanceIndicatorTf): number {
  if (tf === "4h") return SEC_4H;
  if (tf === "1h") return SEC_1H;
  return SEC_15M;
}

export function classifyLongStructureTier(
  swing48: boolean,
  swing200: boolean,
  vahOk: boolean,
): SnowballLongStructureTier {
  if (swing48 && swing200 && vahOk) return "a_plus";
  if (!swing48 && vahOk) return "b_plus";
  return "c_plus";
}

/** @deprecated */
export function classifyLongBreakoutGrade(
  swing48: boolean,
  swing200: boolean,
  vahOk: boolean,
): SnowballLongBreakoutGrade {
  return classifyLongStructureTier(swing48, swing200, vahOk) === "a_plus"
    ? "a"
    : classifyLongStructureTier(swing48, swing200, vahOk) === "b_plus"
      ? "b"
      : "c";
}

export function snowballLongStructureTierShortLabel(tier: SnowballLongStructureTier): string {
  if (tier === "a_plus") return "A";
  if (tier === "b_plus") return "B";
  return "C";
}

export function snowballLongStructurePassesMain(swing48: boolean, vahOk: boolean): boolean {
  return swing48 || vahOk;
}

/** ceiling Stage 1 สำหรับ debug — A/B/C จากโครงสร้าง (ไม่ใช่ trend grade) */
export function classifySnowballStructureCeiling(input: {
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
}): "A" | "B" | "C" {
  const { swing48, swing200, vahOk } = input;
  if (swing48 && swing200 && vahOk) return "A";
  if ((swing48 && vahOk) || (swing200 && vahOk) || (swing48 && swing200)) return "B";
  return "C";
}

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

/** @deprecated */
export function snowballIsGradeDLongToShort(
  _grade: SnowballLongBreakoutGrade | undefined,
  breakout1hConfirmFail: boolean | undefined,
): boolean {
  return breakout1hConfirmFail === true;
}

/** @deprecated — ไม่มี D+ ใน trend grade */
export function snowballIsGradeDPlusLong(_grade: SnowballLongBreakoutGrade | undefined): boolean {
  return false;
}

export function snowballIsGradeF(grade: SnowballLongBreakoutGrade | undefined): boolean {
  return snowballIsTrendGradeF(grade);
}

export function snowballLongGradeSkipsFeedDedupe(
  grade: SnowballLongBreakoutGrade | undefined,
): boolean {
  return snowballTrendGradeSkipsFeedDedupe(grade);
}

export function snowballStatsRowSkipsFeedDedupe(_row: {
  qualityTier?: string;
  alertQualityTier?: string;
  momentumFailGradeF?: boolean;
}): boolean {
  return false;
}

export function snowballLongGradeShortLabel(g: SnowballLongBreakoutGrade): string {
  return snowballTrendGradeShortLabel(g);
}

export function snowballLongGradeDisplayLabel(grade: SnowballLongBreakoutGrade): string {
  return snowballTrendGradeDisplayLabel(grade, "long");
}

/** @deprecated */
export function snowballLongGradePlusLabel(_g: SnowballLongBreakoutGrade): string {
  return "Grade C (Long)";
}

export function snowballLongGradeFLabel(): string {
  return snowballTrendGradeDisplayLabel("f", "long");
}

/** @deprecated */
export function snowballStructureGradeShortLabel(g: SnowballLongBreakoutGrade): string {
  return snowballTrendGradeShortLabel(g);
}

/**
 * Trend grade จาก EMA slope — ไม่ block alert จาก structure/two-bar/momentum
 */
function resolveCompositeGradeResult(
  input: ResolveSnowballLongFinalGradeInput,
): SnowballCompositeGradeResult {
  const signalMaxDdPct =
    input.trendMomentum != null &&
    Number.isFinite(input.trendMomentum.maxDrawbackPercent) &&
    input.trendMomentum.maxDrawbackPercent >= 0
      ? input.trendMomentum.maxDrawbackPercent
      : null;

  return classifySnowballGradeWithFallback({
    ...input.trendGradeInput,
    signalBarTf: snowballCompositeSignalBarTf(input.snowTf),
    swing200Ok: input.swing200,
    vahOk: input.vahOk,
    structureTier: classifyLongStructureTier(input.swing48, input.swing200, input.vahOk),
    signalMaxDdPct,
  });
}

export function resolveSnowballLongFinalGrade(
  input: ResolveSnowballLongFinalGradeInput,
): SnowballLongGradeResolution {
  const structureTier = classifyLongStructureTier(input.swing48, input.swing200, input.vahOk);
  const confirm = resolveConfirm1hOk(input);
  const momentumOk = !input.momentumRequired || input.momentumOk;
  const composite = resolveCompositeGradeResult(input);
  const grade = composite.baseTier;
  return {
    kind: "grade",
    grade,
    displayGrade: composite.display,
    gradeDangerous: composite.dangerous,
    compositeGrade: composite.composite,
    structureTier,
    confirm1hOk: confirm.ok,
    momentumOk,
    confirm1hEval: confirm.eval,
    footnote: snowballCompositeGradeFootnote({
      ...input.trendGradeInput,
      result: composite,
      swing200Ok: input.swing200,
      vahOk: input.vahOk,
      structureTier,
      signalMaxDdPct:
        input.trendMomentum != null &&
        Number.isFinite(input.trendMomentum.maxDrawbackPercent)
          ? input.trendMomentum.maxDrawbackPercent
          : null,
    }),
    actionPlan: snowballTrendGradeActionPlan(grade),
  };
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
