/** ATR + Max Upper Wick สำหรับบันทึก Snowball stats (ไม่มี Node / I/O). */

export function snowballVolatilityLookbackBars(): number {
  const v = Number(process.env.SNOWBALL_STATS_VOLATILITY_LOOKBACK?.trim());
  if (Number.isFinite(v) && v >= 14 && v <= 400) return Math.floor(v);
  return 100;
}

function trueRange(high: number[], low: number[], close: number[], i: number): number | null {
  const h = high[i];
  const l = low[i];
  if (!Number.isFinite(h) || !Number.isFinite(l)) return null;
  if (i < 1) return h - l;
  const prevC = close[i - 1];
  if (!Number.isFinite(prevC)) return h - l;
  return Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
}

/** Wilder ATR(period) ที่แท่ง i (ต้องมีอย่างน้อย period แท่งก่อนหน้า + แท่ง i) */
export function atrWilderAt(
  high: number[],
  low: number[],
  close: number[],
  i: number,
  period: number
): number | null {
  if (period < 2 || i < period) return null;
  let sum = 0;
  for (let j = 1; j <= period; j++) {
    const tr = trueRange(high, low, close, j);
    if (tr == null || !Number.isFinite(tr)) return null;
    sum += tr;
  }
  let atr = sum / period;
  for (let j = period + 1; j <= i; j++) {
    const tr = trueRange(high, low, close, j);
    if (tr == null || !Number.isFinite(tr)) return null;
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

function upperWickAt(high: number[], open: number[], close: number[], i: number): number | null {
  const h = high[i];
  const o = open[i];
  const c = close[i];
  if (!Number.isFinite(h) || !Number.isFinite(o) || !Number.isFinite(c)) return null;
  return Math.max(0, h - Math.max(o, c));
}

/**
 * Max upper wick ใน `lookback` แท่งก่อนแท่งสัญญาณ (ไม่รวม iEval) — เพดานไส้บนในอดีต
 */
export function maxUpperWickPrior(
  high: number[],
  open: number[],
  close: number[],
  iEval: number,
  lookback: number
): number | null {
  const end = iEval - 1;
  if (end < 0 || lookback < 1) return null;
  const start = Math.max(0, end - lookback + 1);
  let max = -Infinity;
  let n = 0;
  for (let j = start; j <= end; j++) {
    const w = upperWickAt(high, open, close, j);
    if (w == null || !Number.isFinite(w)) continue;
    n += 1;
    max = Math.max(max, w);
  }
  return n > 0 && Number.isFinite(max) ? max : null;
}

/** (High−Low) / Close × 100 — % ความกว้างแท่ง (สำหรับ leverage / 2 แท่งล่าสุด) */
function barRangePct(high: number[], low: number[], close: number[], i: number): number | null {
  const h = high[i];
  const l = low[i];
  const c = close[i];
  if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || c <= 0) return null;
  const span = h - l;
  if (!Number.isFinite(span) || span < 0) return null;
  return (span / c) * 100;
}

export type SnowballVolatilitySnapshot = {
  atr100: number | null;
  maxUpperWick100: number | null;
  /** (High−Low) แท่งสัญญาณ ÷ ATR(100) — ~1 = ปกติ · ≥3 = วิ่งแรงผิดปกติ */
  rangeScore: number | null;
  /** UpperWick แท่งสัญญาณ ÷ MaxWick(100) — ~1 = ไส้เทียบเพดานประวัติ */
  wickScore: number | null;
  /** % กว้างแท่งก่อนสัญญาณ (H−L)/Close */
  barRangePctPrev: number | null;
  /** % กว้างแท่งสัญญาณ */
  barRangePctSignal: number | null;
  /** รวม % 2 แท่งล่าสุด (ก่อน + สัญญาณ) */
  barRangePct2Sum: number | null;
};

export function snowballVolatilitySnapshotAt(
  high: number[],
  low: number[],
  close: number[],
  open: number[],
  iEval: number,
  lookback = snowballVolatilityLookbackBars()
): SnowballVolatilitySnapshot {
  const atr100 = atrWilderAt(high, low, close, iEval, lookback);
  const maxUpperWick100 = maxUpperWickPrior(high, open, close, iEval, lookback);

  const h = high[iEval];
  const l = low[iEval];
  let rangeScore: number | null = null;
  if (
    atr100 != null &&
    atr100 > 0 &&
    Number.isFinite(h) &&
    Number.isFinite(l)
  ) {
    const barRange = h - l;
    if (Number.isFinite(barRange) && barRange >= 0) rangeScore = barRange / atr100;
  }

  const upperWickNow = upperWickAt(high, open, close, iEval);
  let wickScore: number | null = null;
  if (upperWickNow != null && Number.isFinite(upperWickNow) && upperWickNow >= 0) {
    if (maxUpperWick100 != null && maxUpperWick100 > 0) {
      wickScore = upperWickNow / maxUpperWick100;
    } else if (maxUpperWick100 === 0 && upperWickNow === 0) {
      wickScore = 0;
    }
  }

  const barRangePctSignal = barRangePct(high, low, close, iEval);
  const barRangePctPrev = iEval >= 1 ? barRangePct(high, low, close, iEval - 1) : null;
  let barRangePct2Sum: number | null = null;
  if (barRangePctPrev != null && barRangePctSignal != null) {
    barRangePct2Sum = barRangePctPrev + barRangePctSignal;
  }

  return {
    atr100,
    maxUpperWick100,
    rangeScore,
    wickScore,
    barRangePctPrev,
    barRangePctSignal,
    barRangePct2Sum,
  };
}
