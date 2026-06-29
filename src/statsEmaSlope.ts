import { computeEmaLast } from "./emaUtils";
import { emaSlopePctFromValues } from "@/lib/statsEmaSlope";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

/** EMA ช้า — สอดคล้อง EMA12 ในเกณฑ์ trend เดิม */
export const STATS_EMA_SLOPE_PERIOD = 12;

/** 7 แท่งปิดบน 1d */
export const STATS_EMA1D_SLOPE_LOOKBACK_BARS = 7;

/** 7 วันบน 4h = 42 แท่ง */
export const STATS_EMA4H_SLOPE_LOOKBACK_BARS = 42;

/** 7 วันบน 1h = 168 แท่ง */
export const STATS_EMA1H_SLOPE_LOOKBACK_BARS = 168;

/** แถวที่คำนวณ EMA12∠1h ณ checkpoint 12 ชม. หลังสัญญาณแล้ว */
export const STATS_EMA12_1H_AT12H_VERSION = 1;

/** แถวที่คำนวณ BTC EMA slope ณ alertedAtMs แล้ว (ไม่ใช่ backfill ค่าเดียวทั้งตาราง) */
export const STATS_BTC_EMA_SLOPES_VERSION = 2;

/** แถวที่คำนวณ symbol EMA1h/4h/1d slope ณ alertedAtMs แล้ว */
export const STATS_SYMBOL_EMA_SLOPES_VERSION = 2;

const BTC_USDT = "BTCUSDT";
const BTC_EMA_SLOPES_CACHE_MS = 5 * 60 * 1000;
const LIVE_ALERT_MAX_AGE_MS = 10 * 60_000;

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

function tfBarDurSec(tf: "1h" | "4h" | "1d"): number {
  if (tf === "1h") return 3600;
  return tf === "4h" ? 4 * 3600 : 24 * 3600;
}

function lastClosedBarIndexAt(pack: BinanceKlinePack, barDurSec: number, atSec: number): number {
  let iClosed = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    if (pack.timeSec[i]! + barDurSec <= atSec) iClosed = i;
  }
  return iClosed;
}

/** EMA slope ณ เวลา atMs — ใช้แท่งปิดล่าสุดที่ปิดแล้วก่อน atMs */
export function computeEmaSlopePctFromPackAt(
  pack: BinanceKlinePack,
  tf: "1h" | "4h" | "1d",
  lookbackBars: number,
  atMs: number,
  emaPeriod: number = STATS_EMA_SLOPE_PERIOD,
): number | null {
  const barDur = tfBarDurSec(tf);
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, barDur, atSec);
  if (iClosed < 0) return null;
  const closes = pack.close.slice(0, iClosed + 1);
  return computeEmaSlopePctFromCloses(closes, emaPeriod, lookbackBars);
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
  tf: "1h" | "4h" | "1d",
  lookbackBars: number,
): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const sym = symbol.trim().toUpperCase();
  const limit = statsEmaSlopeMinKlineBars(lookbackBars);
  const pack = await fetchBinanceUsdmKlines(sym, tf, limit);
  if (!pack) return null;
  return computeEmaSlopePctFromPack(pack, lookbackBars);
}

async function fetchKlinePackThrough(
  symbol: string,
  tf: "1h" | "4h" | "1d",
  atMs: number,
  lookbackBars: number,
): Promise<BinanceKlinePack | null> {
  const barDur = tfBarDurSec(tf);
  const minBars = statsEmaSlopeMinKlineBars(lookbackBars);
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - minBars * barDur) * 1000;
  return fetchBinanceUsdmKlinesRange(symbol.trim().toUpperCase(), tf, {
    startTimeMs: startMs,
    endTimeMs: atMs,
    limit: Math.min(1500, minBars + 20),
  });
}

async function fetchBtcKlinePackThrough(
  tf: "4h" | "1d",
  atMs: number,
  lookbackBars: number,
): Promise<BinanceKlinePack | null> {
  return fetchKlinePackThrough(BTC_USDT, tf, atMs, lookbackBars);
}

export type SymbolEmaSlopesPct7d = {
  ema1hSlopePct7d: number | null;
  ema4hSlopePct7d: number | null;
  ema1dSlopePct7d: number | null;
};

/** Symbol EMA(12) slope 1h/4h/1d ณ alertedAtMs */
export async function fetchSymbolEmaSlopesAtMs(
  symbol: string,
  atMs: number,
): Promise<SymbolEmaSlopesPct7d> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return { ema1hSlopePct7d: null, ema4hSlopePct7d: null, ema1dSlopePct7d: null };
  }
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return { ema1hSlopePct7d: null, ema4hSlopePct7d: null, ema1dSlopePct7d: null };
  }

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const [ema1h, ema4h, ema1d] = await Promise.all([
      fetchSymbolEmaSlopePctTf(symbol, "1h", STATS_EMA1H_SLOPE_LOOKBACK_BARS),
      fetchSymbolEmaSlopePctTf(symbol, "4h", STATS_EMA4H_SLOPE_LOOKBACK_BARS),
      fetchSymbolEmaSlopePctTf(symbol, "1d", STATS_EMA1D_SLOPE_LOOKBACK_BARS),
    ]);
    return { ema1hSlopePct7d: ema1h, ema4hSlopePct7d: ema4h, ema1dSlopePct7d: ema1d };
  }

  const [pack1h, pack4h, pack1d] = await Promise.all([
    fetchKlinePackThrough(symbol, "1h", atMs, STATS_EMA1H_SLOPE_LOOKBACK_BARS),
    fetchKlinePackThrough(symbol, "4h", atMs, STATS_EMA4H_SLOPE_LOOKBACK_BARS),
    fetchKlinePackThrough(symbol, "1d", atMs, STATS_EMA1D_SLOPE_LOOKBACK_BARS),
  ]);
  return {
    ema1hSlopePct7d: pack1h
      ? computeEmaSlopePctFromPackAt(pack1h, "1h", STATS_EMA1H_SLOPE_LOOKBACK_BARS, atMs)
      : null,
    ema4hSlopePct7d: pack4h
      ? computeEmaSlopePctFromPackAt(pack4h, "4h", STATS_EMA4H_SLOPE_LOOKBACK_BARS, atMs)
      : null,
    ema1dSlopePct7d: pack1d
      ? computeEmaSlopePctFromPackAt(pack1d, "1d", STATS_EMA1D_SLOPE_LOOKBACK_BARS, atMs)
      : null,
  };
}

/** EMA(12) 1h slope 7d ณ atMs — ใช้เก็บ checkpoint หลังสัญญาณ (เช่น @12h) */
export async function fetchSymbolEma12_1hSlopePct7dAtMs(
  symbol: string,
  atMs: number,
): Promise<number | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  if (!Number.isFinite(atMs) || atMs <= 0) return null;
  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    return fetchSymbolEmaSlopePctTf(symbol, "1h", STATS_EMA1H_SLOPE_LOOKBACK_BARS);
  }
  const pack = await fetchKlinePackThrough(symbol, "1h", atMs, STATS_EMA1H_SLOPE_LOOKBACK_BARS);
  if (!pack) return null;
  return computeEmaSlopePctFromPackAt(pack, "1h", STATS_EMA1H_SLOPE_LOOKBACK_BARS, atMs);
}

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

/** BTC EMA(12) slope ล่าสุด — cache สั้น ใช้ร่วมทุกแถวในรอบสแกนสด */
export async function fetchBtcEmaSlopesPct7d(): Promise<BtcEmaSlopesPct7d> {
  return fetchBtcEmaSlopesAtMs(Date.now());
}

/** BTC EMA slope ณ alertedAtMs — ย้อนหลังจาก Binance klines */
export async function fetchBtcEmaSlopesAtMs(atMs: number): Promise<BtcEmaSlopesPct7d> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return { btcEma4hSlopePct7d: null, btcEma1dSlopePct7d: null };
  }
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return { btcEma4hSlopePct7d: null, btcEma1dSlopePct7d: null };
  }

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
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

  const [pack4h, pack1d] = await Promise.all([
    fetchBtcKlinePackThrough("4h", atMs, STATS_EMA4H_SLOPE_LOOKBACK_BARS),
    fetchBtcKlinePackThrough("1d", atMs, STATS_EMA1D_SLOPE_LOOKBACK_BARS),
  ]);
  return {
    btcEma4hSlopePct7d: pack4h
      ? computeEmaSlopePctFromPackAt(pack4h, "4h", STATS_EMA4H_SLOPE_LOOKBACK_BARS, atMs)
      : null,
    btcEma1dSlopePct7d: pack1d
      ? computeEmaSlopePctFromPackAt(pack1d, "1d", STATS_EMA1D_SLOPE_LOOKBACK_BARS, atMs)
      : null,
  };
}

export type StatsRowWithBtcEmaSlopes = {
  alertedAtMs: number;
  btcEma4hSlopePct7d?: number | null;
  btcEma1dSlopePct7d?: number | null;
  btcEmaSlopesV?: number;
};

/** แถว v1 — backfill ด้วยค่า BTC ปัจจุบันครั้งเดียว (ผิด) · v2 — คำนวณ ณ alertedAtMs */
export function statsRowNeedsBtcEmaSlopesBackfill(row: StatsRowWithBtcEmaSlopes): boolean {
  return row.btcEmaSlopesV !== STATS_BTC_EMA_SLOPES_VERSION;
}

export async function backfillStatsRowsBtcEmaSlopes<T extends StatsRowWithBtcEmaSlopes>(
  rows: T[],
  opts?: { maxRows?: number },
): Promise<number> {
  const maxRows = opts?.maxRows;
  let updated = 0;
  for (const row of rows) {
    if (maxRows != null && updated >= maxRows) break;
    if (!statsRowNeedsBtcEmaSlopesBackfill(row)) continue;
    try {
      const btc = await fetchBtcEmaSlopesAtMs(row.alertedAtMs);
      row.btcEma4hSlopePct7d = btc.btcEma4hSlopePct7d;
      row.btcEma1dSlopePct7d = btc.btcEma1dSlopePct7d;
      row.btcEmaSlopesV = STATS_BTC_EMA_SLOPES_VERSION;
      updated += 1;
    } catch (e) {
      console.error("[statsEmaSlope] btc ema backfill", row.alertedAtMs, e);
    }
  }
  return updated;
}

export async function backfillAllStatsRowsBtcEmaSlopes<T extends StatsRowWithBtcEmaSlopes>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxPasses = opts?.maxPasses ?? 10;
  const maxRowsPerPass = opts?.maxRowsPerPass ?? 40;
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const n = await backfillStatsRowsBtcEmaSlopes(rows, { maxRows: maxRowsPerPass });
    total += n;
    if (n === 0) break;
  }
  return total;
}

export type StatsRowWithSymbolEmaSlopes = {
  symbol: string;
  alertedAtMs: number;
  ema1hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  ema1dSlopePct7d?: number | null;
  symbolEmaSlopesV?: number;
};

export function statsRowNeedsSymbolEmaSlopesBackfill(row: StatsRowWithSymbolEmaSlopes): boolean {
  return row.symbolEmaSlopesV !== STATS_SYMBOL_EMA_SLOPES_VERSION;
}

export async function backfillStatsRowsSymbolEmaSlopes<T extends StatsRowWithSymbolEmaSlopes>(
  rows: T[],
  opts?: { maxRows?: number },
): Promise<number> {
  const maxRows = opts?.maxRows;
  let updated = 0;
  for (const row of rows) {
    if (maxRows != null && updated >= maxRows) break;
    if (!statsRowNeedsSymbolEmaSlopesBackfill(row)) continue;
    if (!Number.isFinite(row.alertedAtMs) || row.alertedAtMs <= 0) continue;
    try {
      const slopes = await fetchSymbolEmaSlopesAtMs(row.symbol, row.alertedAtMs);
      row.ema1hSlopePct7d = slopes.ema1hSlopePct7d;
      row.ema4hSlopePct7d = slopes.ema4hSlopePct7d;
      row.ema1dSlopePct7d = slopes.ema1dSlopePct7d;
      row.symbolEmaSlopesV = STATS_SYMBOL_EMA_SLOPES_VERSION;
      updated += 1;
    } catch (e) {
      console.error("[statsEmaSlope] symbol ema backfill", row.symbol, row.alertedAtMs, e);
    }
  }
  return updated;
}

export async function backfillAllStatsRowsSymbolEmaSlopes<T extends StatsRowWithSymbolEmaSlopes>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxPasses = opts?.maxPasses ?? 10;
  const maxRowsPerPass = opts?.maxRowsPerPass ?? 40;
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const n = await backfillStatsRowsSymbolEmaSlopes(rows, { maxRows: maxRowsPerPass });
    total += n;
    if (n === 0) break;
  }
  return total;
}
