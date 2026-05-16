/**
 * RSI Wilder — ค่าแรกที่ index = period (0-based); ก่อนหน้านั้น NaN
 */
export function rsiWilder(closes: number[], period: number): number[] {
  const n = closes.length;
  const result: number[] = new Array(n).fill(Number.NaN);
  if (n <= period || period < 2) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  const calcRsi = (): number => {
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  };

  result[period] = calcRsi();

  for (let i = period + 1; i < n; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const g = change > 0 ? change : 0;
    const l = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    result[i] = calcRsi();
  }

  return result;
}

/** SMA — ทุกค่าในหน้าต่างต้องเป็น finite */
export function smaLine(values: number[], period: number): number[] {
  const n = values.length;
  const result: number[] = new Array(n).fill(Number.NaN);
  if (period < 1 || n < period) return result;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (!Number.isFinite(v)) {
        sum = Number.NaN;
        break;
      }
      sum += v!;
    }
    if (Number.isFinite(sum)) result[i] = sum / period;
  }
  return result;
}

/**
 * EMA — seed ด้วย SMA ที่ index period-1 แล้วใช้ multiplier k = 2/(period+1)
 */
export function emaLine(closes: number[], period: number): number[] {
  const n = closes.length;
  const result: number[] = new Array(n).fill(Number.NaN);
  if (n < period || period < 1) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i]!;
  }
  result[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    result[i] = (closes[i]! - result[i - 1]!) * k + result[i - 1]!;
  }
  return result;
}

/**
 * Stochastic RSI (แบบ TradingView): จาก RSI Wilder แล้วสเกลในหน้าต่าง stochPeriod เป็น 0–100
 * ค่า NaN ช่วง warmup จนกว่า RSI + หน้าต่าง stoch จะพร้อม
 */
export function stochRsiLine(closes: number[], rsiPeriod: number, stochPeriod: number): number[] {
  const n = closes.length;
  const out: number[] = new Array(n).fill(Number.NaN);
  if (stochPeriod < 1 || rsiPeriod < 2) return out;
  const rsi = rsiWilder(closes, rsiPeriod);
  for (let i = 0; i < n; i++) {
    const rNow = rsi[i];
    if (!Number.isFinite(rNow)) continue;
    const loIdx = Math.max(0, i - stochPeriod + 1);
    let lowest = Infinity;
    let highest = -Infinity;
    let windowOk = true;
    for (let j = loIdx; j <= i; j++) {
      const rv = rsi[j];
      if (!Number.isFinite(rv)) {
        windowOk = false;
        break;
      }
      lowest = Math.min(lowest, rv);
      highest = Math.max(highest, rv);
    }
    if (!windowOk) continue;
    if (highest === lowest) out[i] = 50;
    else out[i] = ((rNow - lowest) / (highest - lowest)) * 100;
  }
  return out;
}

export type ParabolicSarResult = {
  sar: number;
  trend: "up" | "down";
  flipped: boolean;
};

/**
 * Parabolic SAR (classic) — high/low เรียงเก่า→ใหม่ · step=0.02 max=0.2
 */
export function computeParabolicSarLast(
  high: number[],
  low: number[],
  step = 0.02,
  maxAf = 0.2
): ParabolicSarResult | null {
  const n = Math.min(high.length, low.length);
  if (n < 5) return null;
  const h = high.slice(-n);
  const l = low.slice(-n);
  const valid =
    h.every((x) => Number.isFinite(x) && x > 0) && l.every((x) => Number.isFinite(x) && x > 0);
  if (!valid) return null;

  let trend: "up" | "down" = h[1]! >= h[0]! ? "up" : "down";
  let ep = trend === "up" ? Math.max(h[0]!, h[1]!) : Math.min(l[0]!, l[1]!);
  let sar = trend === "up" ? Math.min(l[0]!, l[1]!) : Math.max(h[0]!, h[1]!);
  let af = step;

  let flipped = false;
  for (let i = 2; i < n; i++) {
    flipped = false;
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (trend === "up") {
      sar = Math.min(sar, l[i - 1]!, l[i - 2]!);
      if (l[i]! <= sar) {
        trend = "down";
        flipped = true;
        sar = ep;
        ep = l[i]!;
        af = step;
      } else if (h[i]! > ep) {
        ep = h[i]!;
        af = Math.min(maxAf, af + step);
      }
    } else {
      sar = Math.max(sar, h[i - 1]!, h[i - 2]!);
      if (h[i]! >= sar) {
        trend = "up";
        flipped = true;
        sar = ep;
        ep = h[i]!;
        af = step;
      } else if (l[i]! < ep) {
        ep = l[i]!;
        af = Math.min(maxAf, af + step);
      }
    }
  }

  return { sar, trend, flipped };
}
