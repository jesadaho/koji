import { atrWilderAt } from "./snowballVolatilityMetrics";
import { fetchBinanceUsdmKlines, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";

/** ช่วง ATR บนกราฟรายวัน (14D = period 14 แท่ง 1d) */
export const STATS_ATR_PCT_14D_PERIOD = 14;

const STATS_ATR_PCT_14D_KLINE_BARS = 32;

/** ATR(14) แท่ง 1d ÷ close แท่งปิดล่าสุด × 100 */
export function computeAtrPct14dAtClosedBar(
  high: number[],
  low: number[],
  close: number[],
  iClosed?: number,
): number | null {
  const i = iClosed ?? close.length - 2;
  if (i < STATS_ATR_PCT_14D_PERIOD || i < 0) return null;
  const atr = atrWilderAt(high, low, close, i, STATS_ATR_PCT_14D_PERIOD);
  const c = close[i];
  if (atr == null || c == null || !Number.isFinite(atr) || !Number.isFinite(c) || c <= 0 || atr < 0) {
    return null;
  }
  return (atr / c) * 100;
}

/** ดึง ATR% 14D จาก Binance USDT-M perp 1d */
export async function fetchSymbolAtrPct14d(binanceSymbol: string): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const sym = binanceSymbol.trim().toUpperCase();
  const pack = await fetchBinanceUsdmKlines(sym, "1d", STATS_ATR_PCT_14D_KLINE_BARS);
  if (!pack || pack.close.length < STATS_ATR_PCT_14D_PERIOD + 2) return null;
  return computeAtrPct14dAtClosedBar(pack.high, pack.low, pack.close);
}
