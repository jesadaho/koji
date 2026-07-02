import type { CandleReversalSignalBarTf } from "@/lib/candleReversalStatsClient";
import {
  fetchBinanceUsdmKlinesPaginated,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  candleReversalSignalVolVsSmaAt,
  candleReversalVolSmaPeriod,
  candleReversalVolSmaPeriod24,
} from "./candleReversalSignalVolVsSma";

/** แถวที่ signalVolVsSma24 ถูก backfill แล้ว */
export const STATS_SIGNAL_VOL_VS_SMA24_VERSION = 1;

const HOUR_SEC = 3600;
const DAY_SEC = 24 * HOUR_SEC;

export type StatsRowWithSignalVolVsSma = {
  symbol: string;
  signalBarTf?: CandleReversalSignalBarTf;
  signalBarOpenSec: number;
  alertedAtMs?: number;
  signalVolVsSma?: number | null;
  signalVolVsSma24?: number | null;
  signalVolVsSma24V?: number;
};

function signalBarTf(row: StatsRowWithSignalVolVsSma): CandleReversalSignalBarTf {
  return row.signalBarTf === "1h" ? "1h" : "1d";
}

function signalBarDurationSecByTf(tf: CandleReversalSignalBarTf): number {
  return tf === "1h" ? HOUR_SEC : DAY_SEC;
}

function finiteVolRatio(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

export function reversalStatsRowNeedsSignalVolVsSma24Backfill(row: StatsRowWithSignalVolVsSma): boolean {
  if (!finiteVolRatio(row.signalVolVsSma24)) return true;
  return (row.signalVolVsSma24V ?? 0) < STATS_SIGNAL_VOL_VS_SMA24_VERSION;
}

function reversalStatsRowNeedsSignalVolVsSma48Backfill(row: StatsRowWithSignalVolVsSma): boolean {
  return !finiteVolRatio(row.signalVolVsSma);
}

function findSignalBarIndexInPack(pack: BinanceKlinePack, signalBarOpenSec: number): number {
  return pack.timeSec.findIndex((t) => t === signalBarOpenSec);
}

async function fetchSignalVolPack(
  row: StatsRowWithSignalVolVsSma,
  tf: CandleReversalSignalBarTf,
  barDur: number,
  maxPeriod: number,
): Promise<BinanceKlinePack | null> {
  if (!isBinanceIndicatorFapiEnabled()) return null;
  const windowStartSec = row.signalBarOpenSec - (maxPeriod + 4) * barDur;
  const windowEndSec = row.signalBarOpenSec + barDur;
  try {
    return await fetchBinanceUsdmKlinesPaginated(
      row.symbol,
      tf,
      windowStartSec * 1000,
      windowEndSec * 1000,
    );
  } catch (e) {
    console.error("[statsSignalVolVsSmaBackfill] fetch klines", row.symbol, tf, e);
    return null;
  }
}

export async function backfillAllStatsRowsSignalVolVsSma<T extends StatsRowWithSignalVolVsSma>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  if (!isBinanceIndicatorFapiEnabled()) return 0;

  const period = candleReversalVolSmaPeriod();
  const period24 = candleReversalVolSmaPeriod24();
  const maxRows = Math.max(1, opts?.maxRowsPerPass ?? 35);
  const maxPasses = Math.max(1, opts?.maxPasses ?? 12);

  const ordered = [...rows].sort((a, b) => {
    const aPri = reversalStatsRowNeedsSignalVolVsSma24Backfill(a) ? 0 : 1;
    const bPri = reversalStatsRowNeedsSignalVolVsSma24Backfill(b) ? 0 : 1;
    if (aPri !== bPri) return aPri - bPri;
    return (b.alertedAtMs ?? 0) - (a.alertedAtMs ?? 0);
  });

  const packCache = new Map<string, BinanceKlinePack | null>();
  let dirty = 0;
  let passes = 0;

  while (passes < maxPasses) {
    passes += 1;
    let passDirty = 0;

    for (const row of ordered) {
      if (passDirty >= maxRows) break;

      const need48 = reversalStatsRowNeedsSignalVolVsSma48Backfill(row);
      const need24 = reversalStatsRowNeedsSignalVolVsSma24Backfill(row);
      if (!need48 && !need24) continue;
      if (!Number.isFinite(row.signalBarOpenSec) || row.signalBarOpenSec <= 0) continue;

      const tf = signalBarTf(row);
      const barDur = signalBarDurationSecByTf(tf);
      const maxPeriod = Math.max(period, period24);
      const cacheKey = `${row.symbol.trim().toUpperCase()}|${tf}|${row.signalBarOpenSec}`;
      let pack = packCache.get(cacheKey);
      if (pack === undefined) {
        pack = await fetchSignalVolPack(row, tf, barDur, maxPeriod);
        packCache.set(cacheKey, pack);
      }
      if (!pack || pack.timeSec.length === 0) continue;

      const iSig = findSignalBarIndexInPack(pack, row.signalBarOpenSec);
      if (iSig < 0) continue;

      let rowTouched = false;
      if (need48) {
        const ratio = candleReversalSignalVolVsSmaAt(pack, iSig, period);
        if (finiteVolRatio(ratio)) {
          row.signalVolVsSma = ratio;
          rowTouched = true;
        }
      }
      if (need24) {
        const ratio24 = candleReversalSignalVolVsSmaAt(pack, iSig, period24);
        if (finiteVolRatio(ratio24)) {
          row.signalVolVsSma24 = ratio24;
          row.signalVolVsSma24V = STATS_SIGNAL_VOL_VS_SMA24_VERSION;
          rowTouched = true;
        }
      }
      if (rowTouched) {
        passDirty += 1;
        dirty += 1;
      }
    }

    if (passDirty === 0) break;
  }

  return dirty;
}
