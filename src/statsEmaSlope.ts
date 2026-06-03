import { computeEmaLast } from "./emaUtils";
import { emaSlopePctFromValues } from "@/lib/statsEmaSlope";
import {
  fetchBinanceUsdmKlines,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

/** EMA ช้า — สอดคล้อง EMA12 ในเกณฑ์ trend เดิม */
export const STATS_EMA_SLOPE_PERIOD = 12;

/** 7 แท่งปิดบน 1d */
export const STATS_EMA1D_SLOPE_LOOKBACK_BARS = 7;

/** 7 วันบน 4h = 42 แท่ง */
export const STATS_EMA4H_SLOPE_LOOKBACK_BARS = 42;

/** แท่งปิดล่าสุด + lookback + EMA warm-up */
export function statsEmaSlopeMinKlineBars(lookbackBars: number): number {
  return STATS_EMA_SLOPE_PERIOD + lookbackBars + 8;
}

export function computeEmaSlopePctFromCloses(
  closes: number[],
  emaPeriod: number,
  lookbackBars: number,
): number | null {
  const lb = Math.floor(lookbackBars);
  if (lb < 1 || closes.length < emaPeriod + lb + 1) return null;
  const iEnd = closes.length - 1;
  const iAgo = iEnd - lb;
  const emaToday = computeEmaLast(closes.slice(0, iEnd + 1), emaPeriod);
  const emaAgo = computeEmaLast(closes.slice(0, iAgo + 1), emaPeriod);
  if (emaToday == null || emaAgo == null) return null;
  return emaSlopePctFromValues(emaToday, emaAgo);
}

/** ใช้แท่งปิดล่าสุด (index length−2) เหมือน snapshot อื่น ๆ */
export function computeEmaSlopePctFromPack(
  pack: BinanceKlinePack,
  lookbackBars: number,
  emaPeriod: number = STATS_EMA_SLOPE_PERIOD,
): number | null {
  if (pack.close.length < 2) return null;
  const iClosed = pack.close.length - 2;
  const closes = pack.close.slice(0, iClosed + 1);
  return computeEmaSlopePctFromCloses(closes, emaPeriod, lookbackBars);
}

export async function fetchSymbolEmaSlopePctTf(
  symbol: string,
  tf: "4h" | "1d",
  lookbackBars: number,
): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const sym = symbol.trim().toUpperCase();
  const limit = statsEmaSlopeMinKlineBars(lookbackBars);
  const pack = await fetchBinanceUsdmKlines(sym, tf, limit);
  if (!pack) return null;
  return computeEmaSlopePctFromPack(pack, lookbackBars);
}
