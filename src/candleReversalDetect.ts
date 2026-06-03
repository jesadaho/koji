import { statsRangeRankInWindow } from "@/lib/statsLenPercentile";
import { lenPercentilePctFromRank } from "@/lib/statsLenPercentile";
import { reversalMatchesQualitySignal } from "@/lib/reversalMatrixFilters";
import { withQualitySignalAlertHeader } from "@/lib/qualitySignalAlertHeader";
import { emaLine } from "./indicatorMath";
import type { BinanceKlinePack } from "./binanceIndicatorKline";

export type CandleReversalAlertQualityContext = {
  greenDaysBeforeSignal?: number | null;
  rangeScore?: number | null;
};

export type CandleReversalTf = "1d" | "1h";

export type CandleReversalTradeSide = "short" | "long";

export type CandleReversalModel =
  | "inverted_doji"
  | "marubozu"
  | "longest_red_body"
  | "longest_green_body";

export type CandleReversalSignal = {
  tf: CandleReversalTf;
  model: CandleReversalModel;
  tradeSide: CandleReversalTradeSide;
  barOpenSec: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** ไส้หลักใน stats/Quality — Short: ไส้บน · Long: ไส้ล่าง */
  wickRatio: number;
  /** Short เท่านั้น — ไส้ล่าง ÷ ช่วงแท่ง (0–1) */
  lowerWickRatio?: number;
  bodyRatio: number;
  retestPrice: number;
  slPrice: number;
  afterInvertedDoji: boolean;
  /** อันดับ high ในรอบ lookbackBars (1 = สูงสุด) */
  highRankInLookback?: number;
  /** อันดับ low ในรอบ lookbackBars (1 = ต่ำสุด) */
  lowRankInLookback?: number;
  /** อันดับ “ความยาวแท่ง” (high-low) ในรอบ lookbackBars (1 = ยาวสุด) */
  rangeRankInLookback?: number;
  /** อันดับ volume ในรอบ lookbackBars (1 = สูงสุด) */
  volRankInLookback?: number;
  lookbackBars?: number;
};

/** @deprecated use CandleReversalSignal */
export type CandleReversal1dSignal = CandleReversalSignal;

function maxHighPriorWindow(high: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

function maxHighInWindowInclusive(high: number[], start: number, end: number): number {
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

function maxRedBodyInWindow(open: number[], close: number[], start: number, end: number): number {
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) {
    if (close[j]! < open[j]!) {
      const body = open[j]! - close[j]!;
      if (body > m) m = body;
    }
  }
  return m;
}

function maxGreenBodyInWindow(open: number[], close: number[], start: number, end: number): number {
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) {
    if (close[j]! > open[j]!) {
      const body = close[j]! - open[j]!;
      if (body > m) m = body;
    }
  }
  return m;
}

/** อันดับค่าใน окน [start,end] — 1 = สูงสุด (นับแท่งที่ค่าสูงกว่าแท่ง i เท่านั้น) */
function valueRankInWindow(values: number[], start: number, end: number, i: number): number {
  const vi = values[i]!;
  const eps = Math.max(1e-12, Math.abs(vi) * 1e-10);
  let strictlyHigher = 0;
  for (let j = start; j <= end; j++) {
    if (j !== i && values[j]! > vi + eps) strictlyHigher++;
  }
  return strictlyHigher + 1;
}

function highRankInWindow(high: number[], start: number, end: number, i: number): number {
  return valueRankInWindow(high, start, end, i);
}

/** อันดับ low ใน окน — 1 = ต่ำสุด */
function lowRankInWindow(low: number[], start: number, end: number, i: number): number {
  const vi = low[i]!;
  const eps = Math.max(1e-12, Math.abs(vi) * 1e-10);
  let strictlyLower = 0;
  for (let j = start; j <= end; j++) {
    if (j !== i && low[j]! < vi - eps) strictlyLower++;
  }
  return strictlyLower + 1;
}

function volumeRankInWindow(volume: number[], start: number, end: number, i: number): number {
  return valueRankInWindow(volume, start, end, i);
}

function rangeRankInWindow(high: number[], low: number[], start: number, end: number, i: number): number {
  return statsRangeRankInWindow(high, low, start, end, i);
}

/** % ระยะปิดจาก EMA — บวก = เหนือเส้น · ลบ = ใต้เส้น */
export function longestRedBody1hEmaDistancePct(close: number, ema: number): number | null {
  if (!Number.isFinite(close) || !Number.isFinite(ema) || ema <= 0) return null;
  return ((close - ema) / ema) * 100;
}

export function isLongestRedBody1hEmaZoneOk(
  close: number,
  ema: number,
  env: Pick<
    CandleReversal1hDetectEnv,
    "longestRedBodyEmaDistAboveMaxPct" | "longestRedBodyEmaDistBelowMaxPct"
  >,
): boolean {
  const dist = longestRedBody1hEmaDistancePct(close, ema);
  if (dist == null) return false;
  return dist >= -env.longestRedBodyEmaDistBelowMaxPct && dist <= env.longestRedBodyEmaDistAboveMaxPct;
}

/** % ระยะปิดจาก EMA — Long green (mirror แดงยาว) */
export function longestGreenBody1hEmaDistancePct(close: number, ema: number): number | null {
  return longestRedBody1hEmaDistancePct(close, ema);
}

export function isLongestGreenBody1hEmaZoneOk(
  close: number,
  ema: number,
  env: Pick<
    CandleReversal1hLongDetectEnv,
    "longestGreenBodyEmaDistAboveMaxPct" | "longestGreenBodyEmaDistBelowMaxPct"
  >,
): boolean {
  const dist = longestGreenBody1hEmaDistancePct(close, ema);
  if (dist == null) return false;
  return dist >= -env.longestGreenBodyEmaDistBelowMaxPct && dist <= env.longestGreenBodyEmaDistAboveMaxPct;
}

export type CandleReversal1dDetectEnv = {
  hh200Lookback: number;
  hh200ExcludeRecent: number;
  highestTailLookback: number;
  wickMinRatio: number;
  bodyMaxRatio: number;
  marubozuBodyLookback: number;
  marubozuEngulfMinRatio: number;
  /** volume แท่งสัญญาณต้องอยู่อันดับ 1..N ในรอบ marubozuBodyLookback */
  marubozuVolRankMax: number;
  marubozuEmaPeriod: number;
  slBufferPct: number;
};

export type CandleReversal1hDetectEnv = {
  highestHighLookback: number;
  wickMinRatio: number;
  bodyMaxRatio: number;
  longestRedBodyLookback: number;
  longestRedBodyMinRatio: number;
  /** high ของแท่งต้องอยู่อันดับ 1..N ในรอบ longestRedBodyLookback (ดีฟอลต์ 3) */
  longestRedBodyHighRankMax: number;
  emaPeriod: number;
  /** ยอมให้ปิดเหนือ EMA ไม่เกิน X% (ม้วนลงมาหาเส้น) */
  longestRedBodyEmaDistAboveMaxPct: number;
  /** ยอมให้ปิดใต้ EMA ไม่เกิน X% (เพิ่งเริ่มหลุด) */
  longestRedBodyEmaDistBelowMaxPct: number;
  slBufferPct: number;
};

export type CandleReversal1hLongDetectEnv = {
  longestGreenBodyLookback: number;
  longestGreenBodyMinRatio: number;
  /** low ของแท่งต้องอยู่อันดับ 1..N ในรอบ lookback (ดีฟอลต์ 1 = ต่ำสุด) */
  longestGreenBodyLowRankMax: number;
  emaPeriod: number;
  /** ยอมให้ปิดเหนือ EMA ไม่เกิน X% (เพิ่งขึ้นเหนือเส้น — mirror จากแดง below) */
  longestGreenBodyEmaDistAboveMaxPct: number;
  /** ยอมให้ปิดใต้ EMA ไม่เกิน X% (ม้วนขึ้นจากก้น) */
  longestGreenBodyEmaDistBelowMaxPct: number;
  slBufferPct: number;
};

export const DEFAULT_CANDLE_REVERSAL_1D_ENV: CandleReversal1dDetectEnv = {
  hh200Lookback: 200,
  hh200ExcludeRecent: 2,
  highestTailLookback: 30,
  wickMinRatio: 0.65,
  bodyMaxRatio: 0.15,
  marubozuBodyLookback: 48,
  marubozuEngulfMinRatio: 0.7,
  marubozuVolRankMax: 2,
  marubozuEmaPeriod: 20,
  slBufferPct: 0.001,
};

export const DEFAULT_CANDLE_REVERSAL_1H_ENV: CandleReversal1hDetectEnv = {
  highestHighLookback: 200,
  wickMinRatio: 0.65,
  bodyMaxRatio: 0.2,
  longestRedBodyLookback: 200,
  longestRedBodyMinRatio: 0.8,
  longestRedBodyHighRankMax: 3,
  emaPeriod: 20,
  longestRedBodyEmaDistAboveMaxPct: 13,
  longestRedBodyEmaDistBelowMaxPct: 3,
  slBufferPct: 0.001,
};

export const DEFAULT_CANDLE_REVERSAL_1H_LONG_ENV: CandleReversal1hLongDetectEnv = {
  longestGreenBodyLookback: 24,
  longestGreenBodyMinRatio: 0.8,
  longestGreenBodyLowRankMax: 1,
  emaPeriod: 20,
  longestGreenBodyEmaDistAboveMaxPct: 3,
  longestGreenBodyEmaDistBelowMaxPct: 13,
  slBufferPct: 0.001,
};

type CandleReversalSignalLookbackMeta = Pick<
  CandleReversalSignal,
  "highRankInLookback" | "lowRankInLookback" | "volRankInLookback" | "lookbackBars"
>;

/** ไส้บนต่อช่วงแท่ง (0–1) — ใช้แสดงไส้% ใน stats ทุกโมเดล */
export function candleUpperWickRatio(pack: BinanceKlinePack, i: number): number {
  const { open: o, high: h, low: l, close: c } = pack;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(range) || range <= eps) return 0;
  const upperWick = Math.max(0, h[i]! - Math.max(o[i]!, c[i]!));
  return upperWick / range;
}

function buildSignal(
  tf: CandleReversalTf,
  model: CandleReversalModel,
  pack: BinanceKlinePack,
  i: number,
  wickRatio: number,
  bodyRatio: number,
  retestPrice: number,
  slPrice: number,
  afterInvertedDoji: boolean,
  lookback?: CandleReversalSignalLookbackMeta,
  tradeSide: CandleReversalTradeSide = "short",
): CandleReversalSignal {
  const { open: o, high: h, low: l, close: c, timeSec: t } = pack;
  const lbRaw = lookback?.lookbackBars;
  const lb = lbRaw != null && Number.isFinite(lbRaw) && lbRaw >= 2 ? Math.floor(lbRaw) : null;
  const rangeRankInLookback =
    lb != null ? rangeRankInWindow(h, l, Math.max(0, i - lb + 1), i, i) : undefined;
  const lowerWickRatio =
    tradeSide === "short" ? candleLowerWickRatio(pack, i) : undefined;
  return {
    tf,
    model,
    tradeSide,
    barOpenSec: t[i]!,
    o: o[i]!,
    h: h[i]!,
    l: l[i]!,
    c: c[i]!,
    wickRatio,
    ...(lowerWickRatio != null ? { lowerWickRatio } : {}),
    bodyRatio,
    retestPrice,
    slPrice,
    afterInvertedDoji,
    ...(rangeRankInLookback != null ? { rangeRankInLookback } : {}),
    ...lookback,
  };
}

export function evalInvertedDoji1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c } = pack;
  /** Reversal ต้องเป็นแท่งแดงปิดจริง — ห้ามยิงจากเขียวที่มีแค่ไส้บนยาว */
  if (c[i]! >= o[i]!) return null;

  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(range) || range <= eps) return null;

  const body = Math.abs(c[i]! - o[i]!);
  const upperWick = h[i]! - Math.max(o[i]!, c[i]!);
  const wickRatio = upperWick / range;
  const bodyRatio = body / range;
  if (wickRatio < env.wickMinRatio || bodyRatio > env.bodyMaxRatio) return null;

  const hh200 = maxHighPriorWindow(h, i, env.hh200Lookback, env.hh200ExcludeRecent);
  const priorTailMax = maxHighPriorWindow(h, i, env.highestTailLookback, 0);
  const athContext =
    (Number.isFinite(hh200) && h[i]! > hh200 - eps) ||
    (Number.isFinite(priorTailMax) && h[i]! >= priorTailMax - eps);
  if (!athContext) return null;

  const allTimePriorMax = maxHighPriorWindow(h, i, Math.max(env.hh200Lookback, i), 0);
  const highestTail =
    (Number.isFinite(priorTailMax) && h[i]! >= priorTailMax) ||
    (Number.isFinite(allTimePriorMax) && h[i]! >= allTimePriorMax);
  if (!highestTail) return null;

  const retestPrice = h[i]! - upperWick * 0.5;
  const slPrice = h[i]! * (1 + env.slBufferPct);
  return buildSignal("1d", "inverted_doji", pack, i, wickRatio, bodyRatio, retestPrice, slPrice, false);
}

/** 1H inverted doji ที่ high สูงสุดในรอบ N แท่ง (ดีฟอลต์ 200) */
export function evalInvertedDoji1h(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hDetectEnv,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c } = pack;
  /** Reversal ต้องเป็นแท่งแดงปิดจริง — ห้ามยิงจากเขียวที่มีแค่ไส้บนยาว */
  if (c[i]! >= o[i]!) return null;

  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(range) || range <= eps) return null;

  const body = Math.abs(c[i]! - o[i]!);
  const upperWick = h[i]! - Math.max(o[i]!, c[i]!);
  const wickRatio = upperWick / range;
  const bodyRatio = body / range;
  if (wickRatio < env.wickMinRatio || bodyRatio > env.bodyMaxRatio) return null;

  const start = Math.max(0, i - env.highestHighLookback + 1);
  const windowMax = maxHighInWindowInclusive(h, start, i);
  if (!Number.isFinite(windowMax) || h[i]! < windowMax - eps) return null;

  const retestPrice = h[i]! - upperWick * 0.5;
  const slPrice = h[i]! * (1 + env.slBufferPct);
  return buildSignal("1h", "inverted_doji", pack, i, wickRatio, bodyRatio, retestPrice, slPrice, false, {
    highRankInLookback: 1,
    lookbackBars: env.highestHighLookback,
  });
}

export function evalMarubozu1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
  hadRecentInvertedDoji: boolean,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  if (c[i]! >= o[i]!) return null;

  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(body) || body <= eps || !Number.isFinite(range) || range <= eps) return null;

  const lb = env.marubozuBodyLookback;
  const winStart = Math.max(0, i - lb + 1);
  const windowHighMax = maxHighInWindowInclusive(h, winStart, i);
  if (!Number.isFinite(windowHighMax) || h[i]! < windowHighMax - eps) return null;

  const barVol = vol[i];
  if (!Number.isFinite(barVol) || barVol <= 0) return null;
  const volRank = volumeRankInWindow(vol, winStart, i, i);
  if (volRank > env.marubozuVolRankMax) return null;

  const maxRedBody = maxRedBodyInWindow(o, c, winStart, i);
  if (!Number.isFinite(maxRedBody) || body < maxRedBody - eps) return null;
  const isAbsoluteMonsterRed = body >= maxRedBody - eps;

  if (i < 1) return null;
  const prevGreen = c[i - 1]! > o[i - 1]!;
  if (!prevGreen) return null;
  const prevBody = c[i - 1]! - o[i - 1]!;
  const standardEngulf = prevBody > eps && body >= prevBody * env.marubozuEngulfMinRatio;
  if (!standardEngulf && !isAbsoluteMonsterRed) return null;

  const retest50 = c[i]! + body * 0.5;
  const retest382 = c[i]! + body * 0.382;
  const retestPrice = (retest50 + retest382) / 2;
  const slPrice = h[i]! * (1 + env.slBufferPct);
  const wickRatio = candleUpperWickRatio(pack, i);
  return buildSignal("1d", "marubozu", pack, i, wickRatio, body / range, retestPrice, slPrice, hadRecentInvertedDoji, {
    highRankInLookback: 1,
    volRankInLookback: volRank,
    lookbackBars: env.marubozuBodyLookback,
  });
}

/** 1H longest red body — เนื้อแดงยาว · high top-N · โซน EMA (ม้วนลง/เพิ่งหลุด) */
export function evalLongestRedBody1h(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hDetectEnv,
  hadRecentInvertedDoji: boolean,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  if (c[i]! >= o[i]!) return null;

  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(body) || body <= eps || !Number.isFinite(range) || range <= eps) return null;

  const start = Math.max(0, i - env.longestRedBodyLookback + 1);
  const maxRedBody = maxRedBodyInWindow(o, c, start, i);
  if (!Number.isFinite(maxRedBody) || maxRedBody <= eps) return null;
  if (body <= maxRedBody * env.longestRedBodyMinRatio) return null;

  const highRank = highRankInWindow(h, start, i, i);
  if (highRank > env.longestRedBodyHighRankMax) return null;

  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, start, i, i) : undefined;

  const ema = emaLine(c, env.emaPeriod);
  const eNow = ema[i];
  if (!Number.isFinite(eNow) || !isLongestRedBody1hEmaZoneOk(c[i]!, eNow as number, env)) return null;

  const retest50 = c[i]! + body * 0.5;
  const retest382 = c[i]! + body * 0.382;
  const retestPrice = (retest50 + retest382) / 2;
  const slPrice = h[i]! * (1 + env.slBufferPct);
  const wickRatio = candleUpperWickRatio(pack, i);
  return buildSignal("1h", "longest_red_body", pack, i, wickRatio, body / range, retestPrice, slPrice, hadRecentInvertedDoji, {
    highRankInLookback: highRank,
    volRankInLookback: volRank,
    lookbackBars: env.longestRedBodyLookback,
  });
}

/** Short reversal — ข้ามแจ้ง/stats/auto-open เมื่อไส้ล่าง > ไส้บน */
export function reversalShortSkipsLowerWickDominant(
  upperWickRatio: number,
  lowerWickRatio: number,
): boolean {
  if (!Number.isFinite(upperWickRatio) || !Number.isFinite(lowerWickRatio)) return false;
  return lowerWickRatio > upperWickRatio;
}

/** ไส้ล่างต่อช่วงแท่ง (0–1) */
export function candleLowerWickRatio(pack: BinanceKlinePack, i: number): number {
  const { open: o, high: h, low: l, close: c } = pack;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(range) || range <= eps) return 0;
  const lowerWick = Math.max(0, Math.min(o[i]!, c[i]!) - l[i]!);
  return lowerWick / range;
}

/** 1H longest green body — เนื้อเขียวยาว · low ต่ำสุดในรอบ · โซน EMA (ม้วนขึ้น/เพิ่งขึ้น) */
export function evalLongestGreenBody1h(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hLongDetectEnv,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  if (c[i]! <= o[i]!) return null;

  const body = c[i]! - o[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(body) || body <= eps || !Number.isFinite(range) || range <= eps) return null;

  const start = Math.max(0, i - env.longestGreenBodyLookback + 1);
  const maxGreenBody = maxGreenBodyInWindow(o, c, start, i);
  if (!Number.isFinite(maxGreenBody) || maxGreenBody <= eps) return null;
  if (body <= maxGreenBody * env.longestGreenBodyMinRatio) return null;

  const lowRank = lowRankInWindow(l, start, i, i);
  if (lowRank > env.longestGreenBodyLowRankMax) return null;

  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, start, i, i) : undefined;

  const ema = emaLine(c, env.emaPeriod);
  const eNow = ema[i];
  if (!Number.isFinite(eNow) || !isLongestGreenBody1hEmaZoneOk(c[i]!, eNow as number, env)) return null;

  const retest50 = o[i]! + body * 0.5;
  const retest382 = o[i]! + body * 0.382;
  const retestPrice = (retest50 + retest382) / 2;
  const slPrice = l[i]! * (1 - env.slBufferPct);
  const wickRatio = candleLowerWickRatio(pack, i);
  return buildSignal(
    "1h",
    "longest_green_body",
    pack,
    i,
    wickRatio,
    body / range,
    retestPrice,
    slPrice,
    false,
    {
      lowRankInLookback: lowRank,
      volRankInLookback: volRank,
      lookbackBars: env.longestGreenBodyLookback,
    },
    "long",
  );
}

/** index แท่งปิดล่าสุด (ไม่รวมแท่งกำลังก่อตัว) */
export function candleReversalLatestClosedBarIndex(pack: BinanceKlinePack): number {
  return pack.close.length - 2;
}

/** index จากจำนวนแท่งย้อนหลังจากแท่งปิดล่าสุด (0 = ปิดล่าสุด) */
export function candleReversalBarIndexBarsAgo(pack: BinanceKlinePack, barsAgo: number): number {
  const ago = Math.max(0, Math.floor(barsAgo));
  return candleReversalLatestClosedBarIndex(pack) - ago;
}

/** ประเมิน reversal ที่ index แท่งปิดที่กำหนด */
export function evalCandleReversalAtBarIndex(
  tf: CandleReversalTf,
  pack: BinanceKlinePack,
  barIndex: number,
  env1d: CandleReversal1dDetectEnv,
  env1h: CandleReversal1hDetectEnv,
  opts?: { hadRecentInvertedDoji?: boolean },
): CandleReversalSignal | null {
  const i = barIndex;
  const hadDoji = Boolean(opts?.hadRecentInvertedDoji);

  if (tf === "1h") {
    const min1hBars = Math.max(env1h.highestHighLookback, env1h.longestRedBodyLookback, env1h.emaPeriod) + 2;
    if (i < min1hBars) return null;
    const longest = evalLongestRedBody1h(pack, i, env1h, hadDoji);
    if (longest) return longest;
    return evalInvertedDoji1h(pack, i, env1h);
  }

  if (i < env1d.hh200Lookback + env1d.hh200ExcludeRecent + 3) return null;
  const marubozu = evalMarubozu1d(pack, i, env1d, hadDoji);
  if (marubozu) return marubozu;
  return evalInvertedDoji1d(pack, i, env1d);
}

export function evalCandleReversalClosedBar(
  tf: CandleReversalTf,
  pack: BinanceKlinePack,
  env1d: CandleReversal1dDetectEnv,
  env1h: CandleReversal1hDetectEnv,
  opts?: { hadRecentInvertedDoji?: boolean },
): CandleReversalSignal | null {
  const i = candleReversalLatestClosedBarIndex(pack);
  if (i < 0) return null;
  return evalCandleReversalAtBarIndex(tf, pack, i, env1d, env1h, opts);
}

/** @deprecated */
export function evalCandleReversal1dClosedBar(
  pack: BinanceKlinePack,
  env: CandleReversal1dDetectEnv,
  opts?: { hadRecentInvertedDoji?: boolean },
): CandleReversalSignal | null {
  return evalCandleReversalClosedBar("1d", pack, env, DEFAULT_CANDLE_REVERSAL_1H_ENV, opts);
}

function checkMark(ok: boolean): string {
  return ok ? "✓" : "—";
}

/** รายการเกณฑ์ longest_red_body 1H สำหรับ debug */
export function candleReversal1hLongestRedBodyCheckLines(
  pack: BinanceKlinePack,
  barIndex: number,
  env: CandleReversal1hDetectEnv = DEFAULT_CANDLE_REVERSAL_1H_ENV,
): string[] {
  const i = barIndex;
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  const lines: string[] = [];
  lines.push(
    `เกณฑ์ longest_red_body (lookback ${env.longestRedBodyLookback} แท่ง · min ${(env.longestRedBodyMinRatio * 100).toFixed(0)}% เนื้อแดง · high อันดับ≤${env.longestRedBodyHighRankMax} · EMA${env.emaPeriod} ${-env.longestRedBodyEmaDistBelowMaxPct}%..+${env.longestRedBodyEmaDistAboveMaxPct}%):`,
  );

  const red = c[i]! < o[i]!;
  lines.push(`  แท่งแดง C<O: ${checkMark(red)} (${fmtReversalPrice(c[i]!)} < ${fmtReversalPrice(o[i]!)})`);

  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const bodyOk = Number.isFinite(body) && body > eps && Number.isFinite(range) && range > eps;
  lines.push(`  มีเนื้อ/ช่วงแท่ง: ${checkMark(bodyOk)}`);

  const start = Math.max(0, i - env.longestRedBodyLookback + 1);
  const maxRedBody = maxRedBodyInWindow(o, c, start, i);
  const need = maxRedBody * env.longestRedBodyMinRatio;
  const longestOk = Number.isFinite(maxRedBody) && maxRedBody > eps && body > need;
  lines.push(
    `  เนื้อแดงยาวในรอบ: ${checkMark(longestOk)} (เนื้อ ${fmtReversalPrice(body)} > ${(env.longestRedBodyMinRatio * 100).toFixed(0)}%×max ${fmtReversalPrice(maxRedBody)} = ${fmtReversalPrice(need)})`,
  );

  const highRank = highRankInWindow(h, start, i, i);
  const highRankOk = highRank <= env.longestRedBodyHighRankMax;
  lines.push(
    `  high อันดับในรอบ: ${checkMark(highRankOk)} (อันดับ ${highRank} · H ${fmtReversalPrice(h[i]!)} · ต้อง≤${env.longestRedBodyHighRankMax})`,
  );

  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, start, i, i) : NaN;
  lines.push(
    `  vol อันดับในรอบ: ${Number.isFinite(volRank) ? "✓" : "—"} (อันดับ ${Number.isFinite(volRank) ? volRank : "—"} · vol ${Number.isFinite(barVol) ? barVol!.toFixed(0) : "—"} · รอบ ${env.longestRedBodyLookback} แท่ง)`,
  );

  const ema = emaLine(c, env.emaPeriod);
  const eNow = ema[i];
  const emaDist = Number.isFinite(eNow) ? longestRedBody1hEmaDistancePct(c[i]!, eNow as number) : null;
  const emaZoneOk =
    emaDist != null && isLongestRedBody1hEmaZoneOk(c[i]!, eNow as number, env);
  const emaRel =
    emaDist != null && emaDist > 0.01
      ? "เหนือ"
      : emaDist != null && emaDist < -0.01
        ? "ใต้"
        : "แนบ";
  lines.push(
    `  โซน EMA${env.emaPeriod}: ${checkMark(emaZoneOk)} (C ${fmtReversalPrice(c[i]!)} · EMA ${fmtReversalPrice(eNow as number)} · ${emaRel} ${emaDist != null ? `${emaDist >= 0 ? "+" : ""}${emaDist.toFixed(2)}%` : "—"} · ยอม ${-env.longestRedBodyEmaDistBelowMaxPct}%..+${env.longestRedBodyEmaDistAboveMaxPct}%)`,
  );

  return lines;
}

/** รายการเกณฑ์ longest_green_body 1H สำหรับ debug */
export function candleReversal1hLongestGreenBodyCheckLines(
  pack: BinanceKlinePack,
  barIndex: number,
  env: CandleReversal1hLongDetectEnv = DEFAULT_CANDLE_REVERSAL_1H_LONG_ENV,
): string[] {
  const i = barIndex;
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  const lines: string[] = [];
  lines.push(
    `เกณฑ์ longest_green_body (lookback ${env.longestGreenBodyLookback} แท่ง · min ${(env.longestGreenBodyMinRatio * 100).toFixed(0)}% เนื้อเขียว · low อันดับ≤${env.longestGreenBodyLowRankMax} · EMA${env.emaPeriod} ${-env.longestGreenBodyEmaDistBelowMaxPct}%..+${env.longestGreenBodyEmaDistAboveMaxPct}%):`,
  );

  const green = c[i]! > o[i]!;
  lines.push(`  แท่งเขียว C>O: ${checkMark(green)} (${fmtReversalPrice(c[i]!)} > ${fmtReversalPrice(o[i]!)})`);

  const body = c[i]! - o[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const bodyOk = Number.isFinite(body) && body > eps && Number.isFinite(range) && range > eps;
  lines.push(`  มีเนื้อ/ช่วงแท่ง: ${checkMark(bodyOk)}`);

  const start = Math.max(0, i - env.longestGreenBodyLookback + 1);
  const maxGreenBody = maxGreenBodyInWindow(o, c, start, i);
  const need = maxGreenBody * env.longestGreenBodyMinRatio;
  const longestOk = Number.isFinite(maxGreenBody) && maxGreenBody > eps && body > need;
  lines.push(
    `  เนื้อเขียวยาวในรอบ: ${checkMark(longestOk)} (เนื้อ ${fmtReversalPrice(body)} > ${(env.longestGreenBodyMinRatio * 100).toFixed(0)}%×max ${fmtReversalPrice(maxGreenBody)} = ${fmtReversalPrice(need)})`,
  );

  const lowRank = lowRankInWindow(l, start, i, i);
  const lowRankOk = lowRank <= env.longestGreenBodyLowRankMax;
  lines.push(
    `  low อันดับในรอบ: ${checkMark(lowRankOk)} (อันดับ ${lowRank} · L ${fmtReversalPrice(l[i]!)} · ต้อง≤${env.longestGreenBodyLowRankMax})`,
  );

  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, start, i, i) : NaN;
  lines.push(
    `  vol อันดับในรอบ: ${Number.isFinite(volRank) ? "✓" : "—"} (อันดับ ${Number.isFinite(volRank) ? volRank : "—"} · vol ${Number.isFinite(barVol) ? barVol!.toFixed(0) : "—"} · รอบ ${env.longestGreenBodyLookback} แท่ง)`,
  );

  const ema = emaLine(c, env.emaPeriod);
  const eNow = ema[i];
  const emaDist = Number.isFinite(eNow) ? longestGreenBody1hEmaDistancePct(c[i]!, eNow as number) : null;
  const emaZoneOk =
    emaDist != null && isLongestGreenBody1hEmaZoneOk(c[i]!, eNow as number, env);
  const emaRel =
    emaDist != null && emaDist > 0.01
      ? "เหนือ"
      : emaDist != null && emaDist < -0.01
        ? "ใต้"
        : "แนบ";
  lines.push(
    `  โซน EMA${env.emaPeriod}: ${checkMark(emaZoneOk)} (C ${fmtReversalPrice(c[i]!)} · EMA ${fmtReversalPrice(eNow as number)} · ${emaRel} ${emaDist != null ? `${emaDist >= 0 ? "+" : ""}${emaDist.toFixed(2)}%` : "—"} · ยอม ${-env.longestGreenBodyEmaDistBelowMaxPct}%..+${env.longestGreenBodyEmaDistAboveMaxPct}%)`,
  );

  return lines;
}

/** รายการเกณฑ์ inverted_doji 1H สำหรับ debug */
export function candleReversal1hInvertedDojiCheckLines(
  pack: BinanceKlinePack,
  barIndex: number,
  env: CandleReversal1hDetectEnv = DEFAULT_CANDLE_REVERSAL_1H_ENV,
): string[] {
  const i = barIndex;
  const { open: o, high: h, low: l, close: c } = pack;
  const lines: string[] = [];
  lines.push(
    `เกณฑ์ inverted_doji (แท่งแดง C<O · high สูงสุดใน ${env.highestHighLookback} แท่ง · ไส้≥${(env.wickMinRatio * 100).toFixed(0)}% · เนื้อ≤${(env.bodyMaxRatio * 100).toFixed(0)}%):`,
  );

  const red = c[i]! < o[i]!;
  lines.push(`  แท่งแดง C<O: ${checkMark(red)} (${fmtReversalPrice(c[i]!)} < ${fmtReversalPrice(o[i]!)})`);

  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const rangeOk = Number.isFinite(range) && range > eps;
  lines.push(`  ช่วงแท่ง: ${checkMark(rangeOk)}`);

  const body = Math.abs(c[i]! - o[i]!);
  const upperWick = h[i]! - Math.max(o[i]!, c[i]!);
  const wickRatio = upperWick / range;
  const bodyRatio = body / range;
  const wickOk = wickRatio >= env.wickMinRatio;
  const bodySmallOk = bodyRatio <= env.bodyMaxRatio;
  lines.push(
    `  ไส้บน≥${(env.wickMinRatio * 100).toFixed(0)}%: ${checkMark(wickOk)} (${(wickRatio * 100).toFixed(1)}%)`,
  );
  lines.push(
    `  เนื้อ≤${(env.bodyMaxRatio * 100).toFixed(0)}%: ${checkMark(bodySmallOk)} (${(bodyRatio * 100).toFixed(1)}%)`,
  );

  const start = Math.max(0, i - env.highestHighLookback + 1);
  const windowMax = maxHighInWindowInclusive(h, start, i);
  const highOk = Number.isFinite(windowMax) && h[i]! >= windowMax - eps;
  lines.push(
    `  high สูงสุดในรอบ: ${checkMark(highOk)} (H ${fmtReversalPrice(h[i]!)} vs max ${fmtReversalPrice(windowMax)})`,
  );

  return lines;
}

/** รายการเกณฑ์ inverted_doji 1D สำหรับ debug */
export function candleReversal1dInvertedDojiCheckLines(
  pack: BinanceKlinePack,
  barIndex: number,
  env: CandleReversal1dDetectEnv = DEFAULT_CANDLE_REVERSAL_1D_ENV,
): string[] {
  const i = barIndex;
  const { open: o, high: h, low: l, close: c } = pack;
  const lines: string[] = [];
  lines.push(
    `เกณฑ์ inverted_doji 1D (แท่งแดง C<O · ไส้≥${(env.wickMinRatio * 100).toFixed(0)}% · เนื้อ≤${(env.bodyMaxRatio * 100).toFixed(0)}% · HH${env.hh200Lookback}/tail${env.highestTailLookback}):`,
  );

  const red = c[i]! < o[i]!;
  lines.push(`  แท่งแดง C<O: ${checkMark(red)} (${fmtReversalPrice(c[i]!)} < ${fmtReversalPrice(o[i]!)})`);

  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const body = Math.abs(c[i]! - o[i]!);
  const upperWick = h[i]! - Math.max(o[i]!, c[i]!);
  const wickRatio = upperWick / range;
  const bodyRatio = body / range;
  lines.push(
    `  ไส้บน≥${(env.wickMinRatio * 100).toFixed(0)}%: ${checkMark(wickRatio >= env.wickMinRatio)} (${(wickRatio * 100).toFixed(1)}%)`,
  );
  lines.push(
    `  เนื้อ≤${(env.bodyMaxRatio * 100).toFixed(0)}%: ${checkMark(bodyRatio <= env.bodyMaxRatio)} (${(bodyRatio * 100).toFixed(1)}%)`,
  );

  const hh200 = maxHighPriorWindow(h, i, env.hh200Lookback, env.hh200ExcludeRecent);
  const priorTailMax = maxHighPriorWindow(h, i, env.highestTailLookback, 0);
  const athContext =
    (Number.isFinite(hh200) && h[i]! > hh200 - eps) ||
    (Number.isFinite(priorTailMax) && h[i]! >= priorTailMax - eps);
  lines.push(
    `  บริบท ATH/tail: ${checkMark(athContext)} (H>${fmtReversalPrice(hh200)} HH200 หรือ H≥tail ${fmtReversalPrice(priorTailMax)})`,
  );

  const allTimePriorMax = maxHighPriorWindow(h, i, Math.max(env.hh200Lookback, i), 0);
  const highestTail =
    (Number.isFinite(priorTailMax) && h[i]! >= priorTailMax) ||
    (Number.isFinite(allTimePriorMax) && h[i]! >= allTimePriorMax);
  lines.push(
    `  high ปลายไส้สูงสุด: ${checkMark(highestTail)} (H ${fmtReversalPrice(h[i]!)} vs tail ${fmtReversalPrice(priorTailMax)} / prior ${fmtReversalPrice(allTimePriorMax)})`,
  );

  return lines;
}

/** รายการเกณฑ์ marubozu 1D สำหรับ debug */
export function candleReversal1dMarubozuCheckLines(
  pack: BinanceKlinePack,
  barIndex: number,
  env: CandleReversal1dDetectEnv = DEFAULT_CANDLE_REVERSAL_1D_ENV,
): string[] {
  const i = barIndex;
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  const lines: string[] = [];
  const lb = env.marubozuBodyLookback;
  lines.push(
    `เกณฑ์ marubozu 1D (lookback ${lb} แท่ง · high+vol+เนื้อแดงสุดในรอบ · กลืน/monster · ไม่เช็ค EMA):`,
  );

  const red = c[i]! < o[i]!;
  lines.push(`  แท่งแดง C<O: ${checkMark(red)}`);

  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const winStart = Math.max(0, i - lb + 1);
  const windowHighMax = maxHighInWindowInclusive(h, winStart, i);
  const highOk = Number.isFinite(windowHighMax) && h[i]! >= windowHighMax - eps;
  lines.push(
    `  high สูงสุดใน ${lb} แท่ง: ${checkMark(highOk)} (H ${fmtReversalPrice(h[i]!)} vs max ${fmtReversalPrice(windowHighMax)})`,
  );

  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, winStart, i, i) : NaN;
  const volRankOk = Number.isFinite(volRank) && volRank <= env.marubozuVolRankMax;
  lines.push(
    `  volume อันดับในรอบ: ${checkMark(volRankOk)} (อันดับ ${Number.isFinite(volRank) ? volRank : "—"} · vol ${Number.isFinite(barVol) ? barVol!.toFixed(0) : "—"} · ต้อง≤${env.marubozuVolRankMax})`,
  );

  const maxRedBody = maxRedBodyInWindow(o, c, winStart, i);
  const bodyLongestOk = Number.isFinite(maxRedBody) && body >= maxRedBody - eps;
  lines.push(
    `  เนื้อแดงยาวสุดในรอบ: ${checkMark(bodyLongestOk)} (เนื้อ ${fmtReversalPrice(body)} vs max ${fmtReversalPrice(maxRedBody)})`,
  );

  const prevGreen = i >= 1 && c[i - 1]! > o[i - 1]!;
  const prevBody = i >= 1 ? c[i - 1]! - o[i - 1]! : 0;
  const standardEngulf = i >= 1 && prevBody > eps && body >= prevBody * env.marubozuEngulfMinRatio;
  const monsterBypass = bodyLongestOk;
  const engulfOk = prevGreen && (standardEngulf || monsterBypass);
  const engulfPct = prevBody > eps ? (body / prevBody) * 100 : null;
  lines.push(
    `  แท่งก่อนเขียว+กลืน: ${checkMark(engulfOk)}` +
      (engulfPct != null
        ? ` (กลืนมาตรฐาน ${engulfPct.toFixed(0)}%≥${(env.marubozuEngulfMinRatio * 100).toFixed(0)}%` +
          `${monsterBypass ? " · หรือเนื้อแดงยาวสุดในรอบ=monster bypass" : ""})`
        : ""),
  );

  return lines;
}

export function fmtReversalPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function candleReversalModelLabelTh(model: CandleReversalModel): string {
  if (model === "inverted_doji") return "โดจิกลับหัว";
  if (model === "longest_red_body") return "แท่งแดงทุบยาว";
  if (model === "longest_green_body") return "แท่งเขียวทุบยาว";
  return "แท่งแดงทุบ";
}

function formatLowLookbackLabelTh(rank: number, lb: number): string {
  if (rank <= 1) return `low ต่ำสุดในรอบ ${lb} แท่ง`;
  return `low อันดับ ${rank} ในรอบ ${lb} แท่ง`;
}

/** ข้อความบริบท low ในรอบ lookback สำหรับแจ้งเตือน Long */
export function candleReversalLowLookbackLabelTh(sig: CandleReversalSignal): string | null {
  const rank = sig.lowRankInLookback;
  const lb = sig.lookbackBars;
  if (rank == null || lb == null) return null;
  return formatLowLookbackLabelTh(rank, lb);
}

function candleReversalRankLookbackLabelTh(
  kind: "high" | "vol",
  rank: number,
  lb: number,
  model: CandleReversalModel,
): string {
  if (kind === "high" && model === "inverted_doji") return `high สูงสุดใน ${lb} แท่ง`;
  const prefix = kind === "high" ? "high" : "vol";
  if (rank <= 1) return `${prefix} สูงสุดในรอบ ${lb} แท่ง`;
  return `${prefix} อันดับ ${rank} ในรอบ ${lb} แท่ง`;
}

/** ข้อความบริบท high ในรอบ lookback สำหรับแจ้งเตือน */
export function candleReversalHighLookbackLabelTh(sig: CandleReversalSignal): string | null {
  const rank = sig.highRankInLookback;
  const lb = sig.lookbackBars;
  if (rank == null || lb == null) return null;
  return candleReversalRankLookbackLabelTh("high", rank, lb, sig.model);
}

/** ข้อความบริบท volume ในรอบ lookback สำหรับแจ้งเตือน */
export function candleReversalVolLookbackLabelTh(sig: CandleReversalSignal): string | null {
  const rank = sig.volRankInLookback;
  const lb = sig.lookbackBars;
  if (rank == null || lb == null) return null;
  return candleReversalRankLookbackLabelTh("vol", rank, lb, sig.model);
}

function candleReversalLookbackContextSuffix(sig: CandleReversalSignal): string {
  const parts = [
    sig.tradeSide === "long" ? candleReversalLowLookbackLabelTh(sig) : candleReversalHighLookbackLabelTh(sig),
    candleReversalVolLookbackLabelTh(sig),
  ].filter((s): s is string => Boolean(s));
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

export function buildCandleReversalAlertMessage(
  symbol: string,
  sig: CandleReversalSignal,
  qualityCtx?: CandleReversalAlertQualityContext,
): string {
  const base = symbol.replace(/USDT$/i, "");
  const tfLabel = sig.tf.toUpperCase();
  const wickPct = (sig.wickRatio * 100).toFixed(1);
  const bodyPct = (sig.bodyRatio * 100).toFixed(1);
  const modelTh = candleReversalModelLabelTh(sig.model);
  const sideTag = sig.tradeSide === "long" ? " Long" : "";
  const qualitySignal =
    qualityCtx != null &&
    reversalMatchesQualitySignal({
      greenDaysBeforeSignal: qualityCtx.greenDaysBeforeSignal,
      wickRatio: sig.wickRatio,
      rangeScore: qualityCtx.rangeScore,
    });

  if (sig.model === "longest_green_body") {
    return [
      withQualitySignalAlertHeader(
        `🟢 [Reversal ${tfLabel}${sideTag}] ${base} — ${modelTh}`,
        qualitySignal,
      ),
      `แท่งปิด: O ${fmtReversalPrice(sig.o)} · H ${fmtReversalPrice(sig.h)} · L ${fmtReversalPrice(sig.l)} · C ${fmtReversalPrice(sig.c)}`,
      `เนื้อเขียว ${bodyPct}% · ไส้ล่าง ${wickPct}%${candleReversalLookbackContextSuffix(sig)} · โซน EMA20 (ม้วนขึ้น/เพิ่งขึ้น)`,
      "",
      "📍 แผน Long (รอรีเทสต์):",
      "• แนวทาง Market ตามน้ำ หรือรีเทสต์เบา",
      `• รีเทสต์ ~38.2–50% เนื้อเขียว: ${fmtReversalPrice(sig.retestPrice)}`,
      `• SL ใต้ยอดแท่ง: ${fmtReversalPrice(sig.slPrice)}`,
      "",
      `⚠️ สัญญาณจากแท่ง ${tfLabel} ปิด — ไม่ใช่คำแนะนำลงทุน`,
    ].join("\n");
  }

  if (sig.model === "inverted_doji") {
    return [
      withQualitySignalAlertHeader(`🎯 [Reversal ${tfLabel}] ${base} — ${modelTh}`, qualitySignal),
      `แท่งปิด: O ${fmtReversalPrice(sig.o)} · H ${fmtReversalPrice(sig.h)} · L ${fmtReversalPrice(sig.l)} · C ${fmtReversalPrice(sig.c)}`,
      `แท่งแดง · ไส้บน ${wickPct}% · เนื้อ ${bodyPct}% ของช่วงแท่ง${candleReversalLookbackContextSuffix(sig)}`,
      "",
      "📍 แผน Short (รอรีเทสต์):",
      `• Limit รีเทสต์ ~50% ไส้บน: ${fmtReversalPrice(sig.retestPrice)}`,
      `• SL เหนือปลายไส้: ${fmtReversalPrice(sig.slPrice)}`,
      "",
      `⚠️ สัญญาณจากแท่ง ${tfLabel} ปิด — ไม่ใช่คำแนะนำลงทุน`,
    ].join("\n");
  }

  const ctx = sig.afterInvertedDoji ? " (หลังโดจิกลับหัว)" : "";
  const plan =
    sig.tf === "1h" && sig.model === "longest_red_body"
      ? [
          "📍 แผน Short (ม้วนเดียว / vol หนา):",
          "• แนวทาง Market ตามน้ำ หรือรีเทสต์เบา",
          `• รีเทสต์ ~38.2–50% เนื้อแดง: ${fmtReversalPrice(sig.retestPrice)}`,
          `• SL เหนือยอดแท่ง: ${fmtReversalPrice(sig.slPrice)}`,
        ]
      : [
          "📍 แผน Short (รอรีเทสต์):",
          `• Limit รีเทสต์ ~38.2–50% เนื้อแดง: ${fmtReversalPrice(sig.retestPrice)}`,
          `• SL เหนือยอดแท่ง: ${fmtReversalPrice(sig.slPrice)}`,
        ];

  return [
    withQualitySignalAlertHeader(`🔻 [Reversal ${tfLabel}] ${base} — ${modelTh}${ctx}`, qualitySignal),
    `แท่งปิด: O ${fmtReversalPrice(sig.o)} · H ${fmtReversalPrice(sig.h)} · L ${fmtReversalPrice(sig.l)} · C ${fmtReversalPrice(sig.c)}`,
    sig.model === "longest_red_body"
      ? `เนื้อแดง ${bodyPct}%${candleReversalLookbackContextSuffix(sig)} · โซน EMA20 (ม้วนลง/เพิ่งหลุด)`
      : `เนื้อแดง ${bodyPct}%${candleReversalLookbackContextSuffix(sig)} · high/vol/เนื้อยาวสุดในรอบ · กลืน/monster`,
    "",
    ...plan,
    "",
    `⚠️ สัญญาณจากแท่ง ${tfLabel} ปิด — ไม่ใช่คำแนะนำลงทุน`,
  ].join("\n");
}

/** @deprecated */
export const buildCandleReversal1dAlertMessage = buildCandleReversalAlertMessage;
