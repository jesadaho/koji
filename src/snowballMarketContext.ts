/**
 * บริบทตลาดตอนแจ้ง Snowball stats — BTC PSAR 4h + 1h + quote vol 24h ของคู่สัญญาณ
 */

import { fetchBinanceUsdmKlines, fetchBinanceUsdmQuoteVol24h, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";
import { computeParabolicSarLast } from "./indicatorMath";

const BTC_SYMBOL = "BTCUSDT";

export type BtcPsarSnapshot = {
  trend: "up" | "down";
  sar: number;
  close: number;
  priceVsSar: "above" | "below";
  flipped: boolean;
};

/** @deprecated ใช้ BtcPsarSnapshot */
export type BtcPsar4hSnapshot = BtcPsarSnapshot;

export type SnowballAlertMarketContext = {
  btcPsar4hTrend: "up" | "down" | null;
  btcPsar4hClose: number | null;
  btcPsar1hTrend: "up" | "down" | null;
  btcPsar1hClose: number | null;
  quoteVol24hUsdt: number | null;
};

function snowballBtcPsarBars(tf: "4h" | "1h"): number {
  const raw =
    tf === "4h"
      ? process.env.SNOWBALL_STATS_BTC_PSAR_4H_BARS?.trim()
      : process.env.SNOWBALL_STATS_BTC_PSAR_1H_BARS?.trim();
  const v = Number(raw);
  if (Number.isFinite(v) && v >= 20 && v <= 200) return Math.floor(v);
  return tf === "4h" ? 60 : 120;
}

let btcPsar4hCache: { atMs: number; snap: BtcPsarSnapshot | null } | null = null;
let btcPsar1hCache: { atMs: number; snap: BtcPsarSnapshot | null } | null = null;
const BTC_PSAR_CACHE_MS = 5 * 60 * 1000;

/** ล้าง cache BTC PSAR — เรียกต้นรอบสแกน Snowball */
export function resetSnowballBtcPsarCache(): void {
  btcPsar4hCache = null;
  btcPsar1hCache = null;
}

/** @deprecated ใช้ resetSnowballBtcPsarCache */
export function resetSnowballBtcPsar4hCache(): void {
  resetSnowballBtcPsarCache();
}

async function fetchBtcPsarSnapshot(tf: "4h" | "1h"): Promise<BtcPsarSnapshot | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const bars = snowballBtcPsarBars(tf);
  const pack = await fetchBinanceUsdmKlines(BTC_SYMBOL, tf, bars);
  if (!pack || pack.high.length < 5) return null;

  const n = pack.close.length;
  const iClosed = n - 2;
  if (iClosed < 0) return null;

  const psar = computeParabolicSarLast(pack.high, pack.low);
  const close = pack.close[iClosed]!;
  if (!psar || !Number.isFinite(close) || close <= 0) return null;

  return {
    trend: psar.trend,
    sar: psar.sar,
    close,
    priceVsSar: close > psar.sar ? "above" : "below",
    flipped: psar.flipped,
  };
}

export async function fetchBtcPsar4hSnapshot(): Promise<BtcPsarSnapshot | null> {
  const now = Date.now();
  if (btcPsar4hCache && now - btcPsar4hCache.atMs < BTC_PSAR_CACHE_MS) {
    return btcPsar4hCache.snap;
  }
  const snap = await fetchBtcPsarSnapshot("4h");
  btcPsar4hCache = { atMs: now, snap };
  return snap;
}

export async function fetchBtcPsar1hSnapshot(): Promise<BtcPsarSnapshot | null> {
  const now = Date.now();
  if (btcPsar1hCache && now - btcPsar1hCache.atMs < BTC_PSAR_CACHE_MS) {
    return btcPsar1hCache.snap;
  }
  const snap = await fetchBtcPsarSnapshot("1h");
  btcPsar1hCache = { atMs: now, snap };
  return snap;
}

/** BTC PSAR 4h + 1h + vol 24h ของสัญญาณ (Binance USDT-M) */
export async function fetchSnowballAlertMarketContext(binanceSymbol: string): Promise<SnowballAlertMarketContext> {
  const sym = binanceSymbol.trim().toUpperCase();
  const [btc4h, btc1h, quoteVol24hUsdt] = await Promise.all([
    fetchBtcPsar4hSnapshot(),
    fetchBtcPsar1hSnapshot(),
    fetchBinanceUsdmQuoteVol24h(sym),
  ]);
  return {
    btcPsar4hTrend: btc4h?.trend ?? null,
    btcPsar4hClose: btc4h?.close ?? null,
    btcPsar1hTrend: btc1h?.trend ?? null,
    btcPsar1hClose: btc1h?.close ?? null,
    quoteVol24hUsdt,
  };
}
