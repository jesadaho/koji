import { computeParabolicSarLast } from "./indicatorMath";
import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";

export const STATS_PSAR_4H_VERSION = 1;

const LIVE_ALERT_MAX_AGE_MS = 10 * 60_000;
const PSAR_4H_BAR_SEC = 4 * 3600;

export type SymbolPsar4hSnapshot = {
  trend: "up" | "down";
  /** (close − SAR) / close × 100 */
  distPct: number;
  close: number;
};

function statsPsar4hBars(): number {
  const raw = process.env.STATS_PSAR_4H_BARS?.trim();
  const v = Number(raw);
  if (Number.isFinite(v) && v >= 20 && v <= 200) return Math.floor(v);
  return 60;
}

function lastClosedBarIndexAt(pack: BinanceKlinePack, atSec: number): number {
  let iClosed = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    if (pack.timeSec[i]! + PSAR_4H_BAR_SEC <= atSec) iClosed = i;
  }
  return iClosed;
}

export function computeSymbolPsar4hFromPackAt(
  pack: BinanceKlinePack,
  atMs: number,
): SymbolPsar4hSnapshot | null {
  const atSec = Math.floor(atMs / 1000);
  const iClosed = lastClosedBarIndexAt(pack, atSec);
  if (iClosed < 4) return null;
  const high = pack.high.slice(0, iClosed + 1);
  const low = pack.low.slice(0, iClosed + 1);
  const psar = computeParabolicSarLast(high, low);
  const close = pack.close[iClosed]!;
  if (!psar || !Number.isFinite(close) || close <= 0 || !Number.isFinite(psar.sar) || psar.sar <= 0) {
    return null;
  }
  return {
    trend: psar.trend,
    distPct: ((close - psar.sar) / close) * 100,
    close,
  };
}

async function fetchSymbolKlinePackThrough4h(
  symbol: string,
  atMs: number,
): Promise<BinanceKlinePack | null> {
  const bars = statsPsar4hBars();
  const atSec = Math.floor(atMs / 1000);
  const startMs = (atSec - bars * PSAR_4H_BAR_SEC) * 1000;
  return fetchBinanceUsdmKlinesRange(symbol.trim().toUpperCase(), "4h", {
    startTimeMs: startMs,
    endTimeMs: atMs,
    limit: Math.min(1500, bars + 20),
  });
}

/** PSAR 4h ของคู่สัญญาณ ณ alertedAtMs */
export async function fetchSymbolPsar4hAtMs(
  symbol: string,
  atMs: number,
): Promise<SymbolPsar4hSnapshot | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const sym = symbol.trim().toUpperCase();
  if (!sym || !Number.isFinite(atMs) || atMs <= 0) return null;

  const ageMs = Date.now() - atMs;
  if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
    const pack = await fetchBinanceUsdmKlines(sym, "4h", statsPsar4hBars());
    if (!pack) return null;
    return computeSymbolPsar4hFromPackAt(pack, atMs);
  }

  const pack = await fetchSymbolKlinePackThrough4h(sym, atMs);
  if (!pack) return null;
  return computeSymbolPsar4hFromPackAt(pack, atMs);
}

export type StatsRowWithPsar4h = {
  symbol: string;
  alertedAtMs: number;
  psar4hTrend?: "up" | "down" | null;
  psar4hDistPct?: number | null;
  psar4hV?: number;
};

export async function backfillAllStatsRowsPsar4h<T extends StatsRowWithPsar4h>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  if (!isBinanceIndicatorFapiEnabled()) return 0;
  const maxRows = Math.max(1, opts?.maxRowsPerPass ?? 25);
  const maxPasses = Math.max(1, opts?.maxPasses ?? 8);
  let dirty = 0;
  let passes = 0;

  while (passes < maxPasses) {
    passes += 1;
    let passDirty = 0;
    for (const row of rows) {
      if (passDirty >= maxRows) break;
      const v = row.psar4hV ?? 0;
      const needs =
        v !== STATS_PSAR_4H_VERSION ||
        row.psar4hTrend == null ||
        row.psar4hDistPct == null ||
        !Number.isFinite(row.psar4hDistPct);
      if (!needs) continue;

      try {
        const snap = await fetchSymbolPsar4hAtMs(row.symbol, row.alertedAtMs);
        if (!snap) continue;
        row.psar4hTrend = snap.trend;
        row.psar4hDistPct = snap.distPct;
        row.psar4hV = STATS_PSAR_4H_VERSION;
        passDirty += 1;
        dirty += 1;
      } catch {
        /* skip row */
      }
    }
    if (passDirty === 0) break;
  }

  return dirty;
}
