/**
 * บริบทตลาดตอนแจ้ง Snowball stats — BTC PSAR 4h + quote vol 24h ของคู่สัญญาณ
 */

import { fetchBinanceUsdmKlines, fetchBinanceUsdmQuoteVol24h, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";
import { computeParabolicSarLast } from "./indicatorMath";

const BTC_SYMBOL = "BTCUSDT";

export type BtcPsar4hSnapshot = {
  trend: "up" | "down";
  sar: number;
  close4h: number;
  /** ราคาปิดแท่ง 4h ล่าสุดที่ปิดแล้ว เทียบ SAR */
  priceVsSar: "above" | "below";
  flipped: boolean;
};

export type SnowballAlertMarketContext = {
  btcPsar4hTrend: "up" | "down" | null;
  btcPsar4hClose: number | null;
  quoteVol24hUsdt: number | null;
};

function snowballBtcPsar4hBars(): number {
  const v = Number(process.env.SNOWBALL_STATS_BTC_PSAR_4H_BARS?.trim());
  if (Number.isFinite(v) && v >= 20 && v <= 200) return Math.floor(v);
  return 60;
}

let btcPsarCache: { atMs: number; snap: BtcPsar4hSnapshot | null } | null = null;
const BTC_PSAR_CACHE_MS = 5 * 60 * 1000;

/** ล้าง cache BTC — เรียกต้นรอบสแกน Snowball */
export function resetSnowballBtcPsar4hCache(): void {
  btcPsarCache = null;
}

export async function fetchBtcPsar4hSnapshot(): Promise<BtcPsar4hSnapshot | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const now = Date.now();
  if (btcPsarCache && now - btcPsarCache.atMs < BTC_PSAR_CACHE_MS) {
    return btcPsarCache.snap;
  }

  const bars = snowballBtcPsar4hBars();
  const pack = await fetchBinanceUsdmKlines(BTC_SYMBOL, "4h", bars);
  let snap: BtcPsar4hSnapshot | null = null;
  if (pack && pack.high.length >= 5) {
    const n = pack.close.length;
    const iClosed = n - 2;
    if (iClosed >= 0) {
      const psar = computeParabolicSarLast(pack.high, pack.low);
      const close4h = pack.close[iClosed]!;
      if (psar && Number.isFinite(close4h) && close4h > 0) {
        snap = {
          trend: psar.trend,
          sar: psar.sar,
          close4h,
          priceVsSar: close4h > psar.sar ? "above" : "below",
          flipped: psar.flipped,
        };
      }
    }
  }

  btcPsarCache = { atMs: now, snap };
  return snap;
}

/** BTC PSAR 4h + vol 24h ของสัญญาณ (Binance USDT-M) */
export async function fetchSnowballAlertMarketContext(binanceSymbol: string): Promise<SnowballAlertMarketContext> {
  const sym = binanceSymbol.trim().toUpperCase();
  const [btc, quoteVol24hUsdt] = await Promise.all([
    fetchBtcPsar4hSnapshot(),
    fetchBinanceUsdmQuoteVol24h(sym),
  ]);
  return {
    btcPsar4hTrend: btc?.trend ?? null,
    btcPsar4hClose: btc?.close4h ?? null,
    quoteVol24hUsdt,
  };
}
