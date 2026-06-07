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

const BTC_USDT = "BTCUSDT";
const BTC_EMA_SLOPES_CACHE_MS = 5 * 60 * 1000;

let btcEmaSlopesCache: {
  atMs: number;
  ema4h: number | null;
  ema1d: number | null;
} | null = null;

export function resetBtcEmaSlopesCache(): void {
  btcEmaSlopesCache = null;
}

export type BtcEmaSlopesPct7d = {
  btcEma4hSlopePct7d: number | null;
  btcEma1dSlopePct7d: number | null;
};

/** BTC EMA(12) slope 7d บน 4h / 1d — cache สั้น ใช้ร่วมทุกแถวในรอบสแกน */
export async function fetchBtcEmaSlopesPct7d(): Promise<BtcEmaSlopesPct7d> {
  const now = Date.now();
  if (btcEmaSlopesCache && now - btcEmaSlopesCache.atMs < BTC_EMA_SLOPES_CACHE_MS) {
    return {
      btcEma4hSlopePct7d: btcEmaSlopesCache.ema4h,
      btcEma1dSlopePct7d: btcEmaSlopesCache.ema1d,
    };
  }
  const [ema4h, ema1d] = await Promise.all([
    fetchSymbolEmaSlopePctTf(BTC_USDT, "4h", STATS_EMA4H_SLOPE_LOOKBACK_BARS),
    fetchSymbolEmaSlopePctTf(BTC_USDT, "1d", STATS_EMA1D_SLOPE_LOOKBACK_BARS),
  ]);
  btcEmaSlopesCache = { atMs: now, ema4h, ema1d };
  return { btcEma4hSlopePct7d: ema4h, btcEma1dSlopePct7d: ema1d };
}

export async function backfillStatsRowsBtcEmaSlopes<
  T extends { btcEma4hSlopePct7d?: number | null; btcEma1dSlopePct7d?: number | null },
>(rows: T[]): Promise<number> {
  const needs = rows.some(
    (r) => r.btcEma4hSlopePct7d == null || !Number.isFinite(r.btcEma4hSlopePct7d) ||
      r.btcEma1dSlopePct7d == null || !Number.isFinite(r.btcEma1dSlopePct7d),
  );
  if (!needs) return 0;
  const btc = await fetchBtcEmaSlopesPct7d();
  let updated = 0;
  for (const row of rows) {
    let touched = false;
    if (
      (row.btcEma4hSlopePct7d == null || !Number.isFinite(row.btcEma4hSlopePct7d)) &&
      btc.btcEma4hSlopePct7d != null &&
      Number.isFinite(btc.btcEma4hSlopePct7d)
    ) {
      row.btcEma4hSlopePct7d = btc.btcEma4hSlopePct7d;
      touched = true;
    }
    if (
      (row.btcEma1dSlopePct7d == null || !Number.isFinite(row.btcEma1dSlopePct7d)) &&
      btc.btcEma1dSlopePct7d != null &&
      Number.isFinite(btc.btcEma1dSlopePct7d)
    ) {
      row.btcEma1dSlopePct7d = btc.btcEma1dSlopePct7d;
      touched = true;
    }
    if (touched) updated += 1;
  }
  return updated;
}
