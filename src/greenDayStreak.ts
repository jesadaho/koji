import { fetchBinanceUsdmKlines, type BinanceKlinePack } from "./binanceIndicatorKline";

const ONE_DAY_SEC = 86400;

export type GreenDayStreakSignalTf = "1d" | "1h" | "15m" | "4h";

function isGreenClosedBar(open: number[], close: number[], i: number): boolean {
  const o = open[i]!;
  const c = close[i]!;
  return Number.isFinite(o) && Number.isFinite(c) && o > 0 && c > o;
}

/** นับแท่ง 1D เขียว (close > open) ติดกันย้อนจาก index สิ้นสุด */
function countGreenStreakEndingAt(open: number[], close: number[], endIdx: number): number {
  if (endIdx < 0) return 0;
  let streak = 0;
  for (let i = endIdx; i >= 0; i--) {
    if (!isGreenClosedBar(open, close, i)) break;
    streak++;
  }
  return streak;
}

/**
 * แท่ง Day1 เขียวติดกี่วันก่อนแท่งสัญญาณ (ไม่นับแท่งสัญญาณ / ไม่นับวันที่สัญญาณกำลังวิ่ง)
 * - 1d: นับย้อนจากแท่งก่อนแท่งสัญญาณ
 * - 15m/1h/4h: นับจากแท่ง Day ปิดแล้วก่อนวันปฏิทินของสัญญาณ
 */
export function countGreenDaysBeforeSignalBar(
  pack1d: BinanceKlinePack | null,
  signalBarOpenSec: number,
  signalBarTf: GreenDayStreakSignalTf,
): number | null {
  if (!pack1d?.timeSec?.length || !Number.isFinite(signalBarOpenSec)) return null;
  const { open, close, timeSec } = pack1d;
  if (open.length !== close.length || close.length !== timeSec.length) return null;

  if (signalBarTf === "1d") {
    const iSig = timeSec.indexOf(signalBarOpenSec);
    if (iSig < 0) return null;
    if (iSig === 0) return 0;
    return countGreenStreakEndingAt(open, close, iSig - 1);
  }

  const dayOpen = Math.floor(signalBarOpenSec / ONE_DAY_SEC) * ONE_DAY_SEC;
  let firstIdxOnSignalDay = timeSec.length;
  for (let i = 0; i < timeSec.length; i++) {
    if (timeSec[i]! >= dayOpen) {
      firstIdxOnSignalDay = i;
      break;
    }
  }
  if (firstIdxOnSignalDay === 0) return 0;
  if (firstIdxOnSignalDay >= timeSec.length) {
    return countGreenStreakEndingAt(open, close, timeSec.length - 1);
  }
  return countGreenStreakEndingAt(open, close, firstIdxOnSignalDay - 1);
}

export async function fetchGreenDaysBeforeSignalBar(
  symbol: string,
  signalBarOpenSec: number,
  signalBarTf: GreenDayStreakSignalTf,
): Promise<number | null> {
  try {
    const pack = await fetchBinanceUsdmKlines(symbol.trim().toUpperCase(), "1d", 90);
    return countGreenDaysBeforeSignalBar(pack, signalBarOpenSec, signalBarTf);
  } catch (e) {
    console.error("[greenDayStreak] fetch 1d", symbol, e);
    return null;
  }
}
