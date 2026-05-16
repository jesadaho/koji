import { emaLine } from "./indicatorMath";
import type { BinanceKlinePack } from "./binanceIndicatorKline";

export type CandleReversal1dModel = "inverted_doji" | "marubozu";

export type CandleReversal1dSignal = {
  model: CandleReversal1dModel;
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

function maxHighPriorWindow(high: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

function maxBodyPriorWindow(open: number[], close: number[], i: number, lookback: number): number {
  const start = Math.max(0, i - lookback);
  const end = i - 1;
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) {
    const body = Math.abs(close[j]! - open[j]!);
    if (body > m) m = body;
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

export const DEFAULT_CANDLE_REVERSAL_1D_ENV: CandleReversal1dDetectEnv = {
  hh200Lookback: 200,
  hh200ExcludeRecent: 2,
  highestTailLookback: 30,
  wickMinRatio: 0.65,
  bodyMaxRatio: 0.15,
  marubozuBodyLookback: 15,
  marubozuEngulfMinRatio: 0.8,
  marubozuEmaPeriod: 20,
  slBufferPct: 0.001,
};

export function evalInvertedDoji1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
): CandleReversal1dSignal | null {
  const { open: o, high: h, low: l, close: c, timeSec: t } = pack;
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

  return {
    model: "inverted_doji",
    barOpenSec: t[i]!,
    o: o[i]!,
    h: h[i]!,
    l: l[i]!,
    c: c[i]!,
    wickRatio,
    bodyRatio,
    retestPrice,
    slPrice,
    afterInvertedDoji: false,
  };
}

export function evalMarubozu1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
  hadRecentInvertedDoji: boolean,
): CandleReversal1dSignal | null {
  const { open: o, high: h, low: l, close: c, timeSec: t } = pack;
  if (c[i]! >= o[i]!) return null;

  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  if (!Number.isFinite(body) || body <= eps || !Number.isFinite(range) || range <= eps) return null;

  const maxPriorBody = maxBodyPriorWindow(o, c, i, env.marubozuBodyLookback);
  if (!Number.isFinite(maxPriorBody) || body <= maxPriorBody) return null;

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

  return {
    model: "marubozu",
    barOpenSec: t[i]!,
    o: o[i]!,
    h: h[i]!,
    l: l[i]!,
    c: c[i]!,
    wickRatio: 0,
    bodyRatio: body / range,
    retestPrice,
    slPrice,
    afterInvertedDoji: hadRecentInvertedDoji,
  };
}

export function evalCandleReversal1dClosedBar(
  pack: BinanceKlinePack,
  env: CandleReversal1dDetectEnv,
  opts?: { hadRecentInvertedDoji?: boolean },
): CandleReversal1dSignal | null {
  const n = pack.close.length;
  const i = n - 2;
  if (i < env.hh200Lookback + env.hh200ExcludeRecent + 3) return null;

  const marubozu = evalMarubozu1d(pack, i, env, Boolean(opts?.hadRecentInvertedDoji));
  if (marubozu) return marubozu;

  return evalInvertedDoji1d(pack, i, env);
}

export function fmtReversalPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function buildCandleReversal1dAlertMessage(symbol: string, sig: CandleReversal1dSignal): string {
  const base = symbol.replace(/USDT$/i, "");
  const wickPct = (sig.wickRatio * 100).toFixed(1);
  const bodyPct = (sig.bodyRatio * 100).toFixed(1);

  if (sig.model === "inverted_doji") {
    return [
      `🎯 [Reversal 1D] ${base} — โดจิกลับหัว / Shooting Star`,
      `แท่ง Day ปิด: O ${fmtReversalPrice(sig.o)} · H ${fmtReversalPrice(sig.h)} · L ${fmtReversalPrice(sig.l)} · C ${fmtReversalPrice(sig.c)}`,
      `ไส้บน ${wickPct}% · เนื้อ ${bodyPct}% ของช่วงแท่ง`,
      "",
      "📍 แผน Short (รอรีเทสต์):",
      `• Limit รีเทสต์ ~50% ไส้บน: ${fmtReversalPrice(sig.retestPrice)}`,
      `• SL เหนือปลายไส้: ${fmtReversalPrice(sig.slPrice)}`,
      "",
      "⚠️ สัญญาณจากแท่ง Day ปิด — ไม่ใช่คำแนะนำลงทุน",
    ].join("\n");
  }

  const ctx = sig.afterInvertedDoji ? " (หลังโดจิกลับหัว)" : "";
  return [
    `🔻 [Reversal 1D] ${base} — แท่งแดงทุบยาว / Engulfing${ctx}`,
    `แท่ง Day ปิด: O ${fmtReversalPrice(sig.o)} · H ${fmtReversalPrice(sig.h)} · L ${fmtReversalPrice(sig.l)} · C ${fmtReversalPrice(sig.c)}`,
    `เนื้อแดง ${bodyPct}% ของช่วงแท่ง · กลืนแท่งเขียวก่อนหน้า · ปิดใต้ EMA20`,
    "",
    "📍 แผน Short (รอรีเทสต์):",
    `• Limit รีเทสต์ ~38.2–50% เนื้อแดง: ${fmtReversalPrice(sig.retestPrice)}`,
    `• SL เหนือยอดแท่ง: ${fmtReversalPrice(sig.slPrice)}`,
    "",
    "⚠️ สัญญาณจากแท่ง Day ปิด — ไม่ใช่คำแนะนำลงทุน",
  ].join("\n");
}
