import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import type { SnowballLongBreakout1hConfirmEval } from "./snowballLongBreakoutConfirm";

export type SnowballLongBreakoutGrade = "a_plus" | "b_plus" | "c_plus" | "d_plus";

/** ป้ายเกรด Long สำหรับหัวข้อ Telegram — รูปแบบ Grade X+ (Long) */
export function snowballLongGradePlusLabel(g: SnowballLongBreakoutGrade): string {
  if (g === "a_plus") return "Grade A+ (Long)";
  if (g === "b_plus") return "Grade B+ (Long)";
  if (g === "c_plus") return "Grade C+ (Long)";
  return "Grade D+ (Long)";
}

const SEC_4H = 4 * 3600;
const SEC_1H = 3600;
const SEC_15M = 900;

export function snowballTfBarDurationSec(tf: BinanceIndicatorTf): number {
  if (tf === "4h") return SEC_4H;
  if (tf === "1h") return SEC_1H;
  return SEC_15M;
}

export function classifyLongBreakoutGrade(
  swing48: boolean,
  swing200: boolean,
  vahOk: boolean,
): SnowballLongBreakoutGrade {
  if (!swing48 && vahOk) return "b_plus";
  if (swing48 && swing200 && vahOk) return "a_plus";
  return "c_plus";
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
): SnowballLongBreakoutGrade {
  const swing48 = longSwingHighBreak(pack.high, pack.close, iBar, swingLb, swingEx);
  const swing200 = longSwingHighBreak(pack.high, pack.close, iBar, swingGradeLb, swingEx);
  const vahOk = vahCrossOnBar(pack, iBar, vahLb, longVahOn);
  return classifyLongBreakoutGrade(swing48, swing200, vahOk);
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
  grade: SnowballLongBreakoutGrade;
  /** แท่งสัญญาณ (แท่งก่อน) */
  iSig: number;
  /** แท่ง confirm (แท่งล่าสุดใน 2 แท่ง) */
  iConf: number;
};

/**
 * Original logic เมื่อ Master TF = 4h (หรือ two-bar inline): อ่าน 2 แท่งปิดล่าสุดบน TF นั้น
 * แล้วตัดเกรด A/B/C จากแท่งสัญญาณ (แท่งแรกในคู่)
 */
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

export type ResolveSnowballLongBreakoutGradeInput = {
  /** โหมด Breakout 1H (เฉพาะเมื่อ Snowball TF ≠ 4h) */
  longBreakout1h: boolean;
  breakout1hFailedGradeD: boolean;
  breakout1hEval: SnowballLongBreakout1hConfirmEval | null;
  pack1h: BinanceKlinePack | null;
  fallbackGrade: SnowballLongBreakoutGrade;
  swingLb: number;
  swingEx: number;
  swingGradeLb: number;
  vahLb: number;
  longVahOn: boolean;
};

/** ตัดเกรดเมื่อเปิด Long Breakout 1H (ไม่ใช้กับ Master TF = 4h) */
export function resolveSnowballLongBreakoutGrade(input: ResolveSnowballLongBreakoutGradeInput): SnowballLongBreakoutGrade {
  if (!input.longBreakout1h) return input.fallbackGrade;

  if (input.breakout1hFailedGradeD) return "d_plus";

  const pack = input.pack1h;
  const ev = input.breakout1hEval;
  if (!pack || !ev || !Number.isFinite(ev.i1h)) return "d_plus";

  return classifyLongBreakoutGradeOnBar(
    pack,
    ev.i1h,
    input.swingLb,
    input.swingEx,
    input.swingGradeLb,
    input.vahLb,
    input.longVahOn,
  );
}
