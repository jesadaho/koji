/**
 * ค่า EMA ล่าสุดจากชุด close เรียงเก่า→ใหม่ (แท่งแรก = seed SMA)
 */
export function computeEmaLast(closes: number[], period: number): number | null {
  if (period < 1 || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i]!;
  ema /= period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}
