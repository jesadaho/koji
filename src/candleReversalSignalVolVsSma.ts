import "server-only";

import type { BinanceKlinePack } from "./binanceIndicatorKline";

/** SMA(volume) จนถึง idx (รวม idx) — align กับ Snowball confirm */
function volumeSmaAtPackIndex(pack: BinanceKlinePack, idx: number, period: number): number {
  const { volume } = pack;
  const p = Math.max(1, Math.floor(period));
  const start = Math.max(0, idx - (p - 1));
  let sum = 0;
  let n = 0;
  for (let i = start; i <= idx; i++) {
    const v = volume[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : NaN;
}

/** รอบ SMA(volume) สำหรับ Vol×SMA ในสถิติ Reversal (ดีฟอลต์ 48 แท่ง — สอดคล้อง Snowball 1H confirm) */
export function candleReversalVolSmaPeriod(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_VOL_SMA_PERIOD?.trim());
  if (Number.isFinite(v) && v >= 3 && v <= 200) return Math.floor(v);
  return 48;
}

/** Vol แท่งสัญญาณ ÷ SMA(volume) ณ แท่งปิด — คืน null ถ้าคำนวณไม่ได้ */
export function candleReversalSignalVolVsSmaAt(
  pack: BinanceKlinePack,
  idx: number,
  period?: number,
): number | null {
  const barVol = pack.volume[idx];
  if (!Number.isFinite(barVol) || barVol! <= 0) return null;
  const sma = volumeSmaAtPackIndex(pack, idx, period ?? candleReversalVolSmaPeriod());
  if (!Number.isFinite(sma) || sma <= 0) return null;
  return barVol! / sma;
}
