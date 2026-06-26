import axios, { isAxiosError } from "axios";
import {
  STATS_OPEN_INTEREST_HIST_MAX_AGE_MS,
  STATS_OPEN_INTEREST_VERSION,
} from "@/lib/statsOpenInterest";
import { isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";

const FAPI = "https://fapi.binance.com";

export { STATS_OPEN_INTEREST_VERSION };

type OpenInterestHistRow = {
  symbol?: string;
  sumOpenInterest?: string;
  sumOpenInterestValue?: string;
  timestamp?: string;
};

export type StatsOpenInterestSnapshot = {
  contracts: number | null;
  valueUsdt: number | null;
  source: "hist" | "snapshot" | null;
};

function parsePositiveNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickClosestHistRow(rows: OpenInterestHistRow[], atMs: number): OpenInterestHistRow | null {
  let best: OpenInterestHistRow | null = null;
  let bestDelta = Infinity;
  for (const row of rows) {
    const ts = Number(row.timestamp);
    if (!Number.isFinite(ts)) continue;
    const delta = Math.abs(ts - atMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = row;
    }
  }
  return best;
}

function histRowToSnapshot(row: OpenInterestHistRow | null): StatsOpenInterestSnapshot | null {
  if (!row) return null;
  const contracts = parsePositiveNum(row.sumOpenInterest);
  const valueUsdt = parsePositiveNum(row.sumOpenInterestValue);
  if (contracts == null && valueUsdt == null) return null;
  return { contracts, valueUsdt, source: "hist" };
}

export async function fetchBinanceUsdmOpenInterestHistAtMs(
  symbol: string,
  atMs: number,
): Promise<StatsOpenInterestSnapshot | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym || !isBinanceIndicatorFapiEnabled()) return null;
  const windowMs = 4 * 3600 * 1000;
  try {
    const { data } = await axios.get<OpenInterestHistRow[]>(`${FAPI}/futures/data/openInterestHist`, {
      timeout: 20_000,
      params: {
        symbol: sym,
        period: "1h",
        startTime: Math.floor(atMs - windowMs),
        endTime: Math.floor(atMs + windowMs),
        limit: 12,
      },
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    return histRowToSnapshot(pickClosestHistRow(data, atMs));
  } catch (e) {
    if (!isAxiosError(e) || e.response?.status !== 451) {
      console.error("[statsOpenInterest] openInterestHist", sym, e instanceof Error ? e.message : e);
    }
    return null;
  }
}

export async function fetchBinanceUsdmOpenInterestNow(
  symbol: string,
): Promise<StatsOpenInterestSnapshot | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym || !isBinanceIndicatorFapiEnabled()) return null;
  try {
    const { data } = await axios.get<{ openInterest?: string; symbol?: string; time?: number }>(
      `${FAPI}/fapi/v1/openInterest`,
      { timeout: 15_000, params: { symbol: sym } },
    );
    const contracts = parsePositiveNum(data?.openInterest);
    if (contracts == null) return null;
    return { contracts, valueUsdt: null, source: "snapshot" };
  } catch (e) {
    if (!isAxiosError(e) || e.response?.status !== 451) {
      console.error("[statsOpenInterest] openInterest", sym, e instanceof Error ? e.message : e);
    }
    return null;
  }
}

/** OI ณ atMs — hist ภายใน 30 วัน · snapshot ล่าสุดถ้าแจ้งภายใน 2 ชม. */
export async function fetchStatsOpenInterestAtMs(
  symbol: string,
  atMs: number,
): Promise<StatsOpenInterestSnapshot | null> {
  const ageMs = Date.now() - atMs;
  if (ageMs > STATS_OPEN_INTEREST_HIST_MAX_AGE_MS) return null;

  const hist = await fetchBinanceUsdmOpenInterestHistAtMs(symbol, atMs);
  if (hist?.valueUsdt != null || hist?.contracts != null) return hist;

  if (ageMs <= 2 * 3600 * 1000) {
    const now = await fetchBinanceUsdmOpenInterestNow(symbol);
    if (now) return now;
  }

  return hist;
}

export type StatsRowWithOpenInterest = {
  symbol: string;
  alertedAtMs: number;
  openInterestUsdt?: number | null;
  openInterestContracts?: number | null;
  openInterestV?: number;
};

export async function backfillAllStatsRowsOpenInterest<T extends StatsRowWithOpenInterest>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxRows = Math.max(1, opts?.maxRowsPerPass ?? 20);
  const maxPasses = Math.max(1, opts?.maxPasses ?? 8);
  const symCache = new Map<string, StatsOpenInterestSnapshot | null>();
  let dirty = 0;
  let passes = 0;
  const now = Date.now();

  while (passes < maxPasses) {
    passes += 1;
    let passDirty = 0;
    for (const row of rows) {
      if (passDirty >= maxRows) break;
      if (row.openInterestV === STATS_OPEN_INTEREST_VERSION) continue;

      const sym = row.symbol.trim().toUpperCase();
      if (!sym) continue;
      const atMs = row.alertedAtMs;
      if (!Number.isFinite(atMs) || atMs <= 0) continue;

      if (now - atMs > STATS_OPEN_INTEREST_HIST_MAX_AGE_MS) {
        row.openInterestV = STATS_OPEN_INTEREST_VERSION;
        passDirty += 1;
        dirty += 1;
        continue;
      }

      try {
        let cached = symCache.get(`${sym}|${atMs}`);
        if (cached === undefined) {
          const snap = await fetchStatsOpenInterestAtMs(sym, atMs);
          cached = snap;
          symCache.set(`${sym}|${atMs}`, snap);
        }
        if (!cached) continue;

        if (cached.valueUsdt != null) row.openInterestUsdt = cached.valueUsdt;
        if (cached.contracts != null) row.openInterestContracts = cached.contracts;
        if (cached.valueUsdt != null || cached.contracts != null) {
          row.openInterestV = STATS_OPEN_INTEREST_VERSION;
          passDirty += 1;
          dirty += 1;
        }
      } catch {
        /* skip row */
      }
    }
    if (passDirty === 0) break;
  }

  return dirty;
}
