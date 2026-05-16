import { emaLine } from "./indicatorMath";
import type { BinanceKlinePack } from "./binanceIndicatorKline";

export type CandleReversalTf = "1d" | "1h";

export type CandleReversalModel = "inverted_doji" | "marubozu" | "longest_red_body";

export type CandleReversalSignal = {
  tf: CandleReversalTf;
  model: CandleReversalModel;
  barOpenSec: number;
  o: number;
  h: number;
  l: number;
  c: number;
  wickRatio: number;
  bodyRatio: number;
  retestPrice: number;
  slPrice: number;
  afterInvertedDoji: boolean;
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

export type CandleReversal1dDetectEnv = {
  hh200Lookback: number;
  hh200ExcludeRecent: number;
  highestTailLookback: number;
  wickMinRatio: number;
  bodyMaxRatio: number;
  marubozuBodyLookback: number;
  marubozuEngulfMinRatio: number;
  marubozuEmaPeriod: number;
  slBufferPct: number;
};

export type CandleReversal1hDetectEnv = {
  highestHighLookback: number;
  wickMinRatio: number;
  bodyMaxRatio: number;
  longestRedBodyLookback: number;
  longestRedBodyMinRatio: number;
  emaPeriod: number;
  slBufferPct: number;
};

export const DEFAULT_CANDLE_REVERSAL_1D_ENV: CandleReversal1dDetectEnv = {
  hh200Lookback: 200,
  hh200ExcludeRecent: 2,
  highestTailLookback: 30,
  wickMinRatio: 0.65,
  bodyMaxRatio: 0.15,
  marubozuBodyLookback: 48,
  marubozuEngulfMinRatio: 0.8,
  marubozuEmaPeriod: 20,
  slBufferPct: 0.001,
};

export const DEFAULT_CANDLE_REVERSAL_1H_ENV: CandleReversal1hDetectEnv = {
  highestHighLookback: 24,
  wickMinRatio: 0.65,
  bodyMaxRatio: 0.2,
  longestRedBodyLookback: 24,
  longestRedBodyMinRatio: 0.8,
  emaPeriod: 20,
  slBufferPct: 0.001,
};

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
): CandleReversalSignal {
  const { open: o, high: h, low: l, close: c, timeSec: t } = pack;
  return {
    tf,
    model,
    barOpenSec: t[i]!,
    o: o[i]!,
    h: h[i]!,
    l: l[i]!,
    c: c[i]!,
    wickRatio,
    bodyRatio,
    retestPrice,
    slPrice,
    afterInvertedDoji,
  };
}

export function evalInvertedDoji1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c } = pack;
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
    (Number.isFinite(hh200) && c[i]! > hh200) ||
    (Number.isFinite(priorTailMax) && h[i]! >= priorTailMax);
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

/** 1H inverted doji ที่ high สูงสุดในรอบ N แท่ง (ดีฟอลต์ 24h) */
export function evalInvertedDoji1h(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hDetectEnv,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c } = pack;
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
  return buildSignal("1h", "inverted_doji", pack, i, wickRatio, bodyRatio, retestPrice, slPrice, false);
}

export function evalMarubozu1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
  hadRecentInvertedDoji: boolean,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c } = pack;
  if (c[i]! >= o[i]!) return null;

  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(body) || body <= eps || !Number.isFinite(range) || range <= eps) return null;

  const lb = env.marubozuBodyLookback;
  const winStart = Math.max(0, i - lb + 1);
  const windowHighMax = maxHighInWindowInclusive(h, winStart, i);
  if (!Number.isFinite(windowHighMax) || h[i]! < windowHighMax - eps) return null;

  const maxRedBody = maxRedBodyInWindow(o, c, winStart, i);
  if (!Number.isFinite(maxRedBody) || body < maxRedBody - eps) return null;

  if (i < 1) return null;
  const prevGreen = c[i - 1]! > o[i - 1]!;
  if (!prevGreen) return null;
  const prevBody = c[i - 1]! - o[i - 1]!;
  const engulfDepth = o[i - 1]! - c[i]!;
  const engulfOk = c[i]! <= o[i - 1]! || (prevBody > eps && engulfDepth >= prevBody * env.marubozuEngulfMinRatio);
  if (!engulfOk) return null;

  const ema = emaLine(c, env.marubozuEmaPeriod);
  const eNow = ema[i];
  if (!Number.isFinite(eNow) || c[i]! >= (eNow as number)) return null;

  const retest50 = c[i]! + body * 0.5;
  const retest382 = c[i]! + body * 0.382;
  const retestPrice = (retest50 + retest382) / 2;
  const slPrice = h[i]! * (1 + env.slBufferPct);
  return buildSignal("1d", "marubozu", pack, i, 0, body / range, retestPrice, slPrice, hadRecentInvertedDoji);
}

/** 1H longest red body — เนื้อแดง ≥ ratio × max ในรอบ N แท่ง + ปิดใต้ EMA */
export function evalLongestRedBody1h(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hDetectEnv,
  hadRecentInvertedDoji: boolean,
): CandleReversalSignal | null {
  const { open: o, high: h, low: l, close: c } = pack;
  if (c[i]! >= o[i]!) return null;

  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(body) || body <= eps || !Number.isFinite(range) || range <= eps) return null;

  const start = Math.max(0, i - env.longestRedBodyLookback + 1);
  const maxRedBody = maxRedBodyInWindow(o, c, start, i);
  if (!Number.isFinite(maxRedBody) || maxRedBody <= eps) return null;
  if (body <= maxRedBody * env.longestRedBodyMinRatio) return null;

  const ema = emaLine(c, env.emaPeriod);
  const eNow = ema[i];
  if (!Number.isFinite(eNow) || c[i]! >= (eNow as number)) return null;

  const retest50 = c[i]! + body * 0.5;
  const retest382 = c[i]! + body * 0.382;
  const retestPrice = (retest50 + retest382) / 2;
  const slPrice = h[i]! * (1 + env.slBufferPct);
  return buildSignal("1h", "longest_red_body", pack, i, 0, body / range, retestPrice, slPrice, hadRecentInvertedDoji);
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
    if (i < env1h.highestHighLookback + 2) return null;
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
  return "แท่งแดงทุบ";
}

export function buildCandleReversalAlertMessage(symbol: string, sig: CandleReversalSignal): string {
  const base = symbol.replace(/USDT$/i, "");
  const tfLabel = sig.tf.toUpperCase();
  const wickPct = (sig.wickRatio * 100).toFixed(1);
  const bodyPct = (sig.bodyRatio * 100).toFixed(1);
  const modelTh = candleReversalModelLabelTh(sig.model);

  if (sig.model === "inverted_doji") {
    return [
      `🎯 [Reversal ${tfLabel}] ${base} — ${modelTh}`,
      `แท่งปิด: O ${fmtReversalPrice(sig.o)} · H ${fmtReversalPrice(sig.h)} · L ${fmtReversalPrice(sig.l)} · C ${fmtReversalPrice(sig.c)}`,
      `ไส้บน ${wickPct}% · เนื้อ ${bodyPct}% ของช่วงแท่ง`,
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
    `🔻 [Reversal ${tfLabel}] ${base} — ${modelTh}${ctx}`,
    `แท่งปิด: O ${fmtReversalPrice(sig.o)} · H ${fmtReversalPrice(sig.h)} · L ${fmtReversalPrice(sig.l)} · C ${fmtReversalPrice(sig.c)}`,
    sig.model === "longest_red_body"
      ? `เนื้อแดง ${bodyPct}% · ปิดใต้ EMA20`
      : `เนื้อแดง ${bodyPct}% · กลืนแท่งเขียวก่อนหน้า · ปิดใต้ EMA20`,
    "",
    ...plan,
    "",
    `⚠️ สัญญาณจากแท่ง ${tfLabel} ปิด — ไม่ใช่คำแนะนำลงทุน`,
  ].join("\n");
}

/** @deprecated */
export const buildCandleReversal1dAlertMessage = buildCandleReversalAlertMessage;
