import "server-only";

import axios, { isAxiosError } from "axios";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import { marketPulseUsesCoinMarketCap } from "./marketPulseFetch";
import { computeEma20SlopePctFromPackAt } from "./statsEma20Dist";
import { STATS_EMA4H_SLOPE_LOOKBACK_BARS } from "./statsEmaSlope";

const COINGECKO = "https://api.coingecko.com/api/v3";
const CMC_PRO_BASE = "https://pro-api.coinmarketcap.com";
const BAR_SEC = 4 * 3600;
const TIMEOUT_MS = 20_000;

/** แถวที่คำนวณ BTC.D EMA20 4h slope ณ alertedAtMs แล้ว */
export const STATS_BTC_DOM_EMA20_4H_VERSION = 1;

/** CoinGecko market_chart days=90 — แถวเก่ากว่านี้ mark skipped */
export const STATS_BTC_DOM_EMA20_HIST_MAX_AGE_MS = 88 * 24 * 60 * 60 * 1000;

type DomPoint = { tsMs: number; pct: number };

const domHourlyCache = new Map<string, DomPoint[] | null>();
const slopeCache = new Map<string, number | null>();

function cmcProApiKey(): string | undefined {
  const k = process.env.CMC_PRO_API_KEY?.trim();
  return k || undefined;
}

function cacheKeyAtMs(atMs: number): string {
  const barOpenSec = Math.floor(atMs / 1000 / BAR_SEC) * BAR_SEC;
  return String(barOpenSec);
}

function minHourlyPointsNeeded(): number {
  const min4hBars = 20 + STATS_EMA4H_SLOPE_LOOKBACK_BARS + 8;
  return min4hBars * 4 + 8;
}

function normalizeTsPoints(raw: [number, number][] | undefined): DomPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: DomPoint[] = [];
  for (const row of raw) {
    const tsMs = Number(row[0]);
    const v = Number(row[1]);
    if (!Number.isFinite(tsMs) || !Number.isFinite(v) || v <= 0) continue;
    out.push({ tsMs, pct: v });
  }
  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

function dominanceFromMcapSeries(btcCaps: DomPoint[], totalCaps: DomPoint[]): DomPoint[] {
  const totalByHour = new Map<number, number>();
  for (const p of totalCaps) {
    totalByHour.set(Math.floor(p.tsMs / 3_600_000), p.pct);
  }
  const out: DomPoint[] = [];
  for (const p of btcCaps) {
    const total = totalByHour.get(Math.floor(p.tsMs / 3_600_000));
    if (total == null || total <= 0) continue;
    const dom = (p.pct / total) * 100;
    if (!Number.isFinite(dom) || dom <= 0 || dom > 100) continue;
    out.push({ tsMs: p.tsMs, pct: dom });
  }
  return out;
}

async function fetchCmcBtcDominanceHourly(atMs: number): Promise<DomPoint[] | null> {
  const key = cmcProApiKey();
  if (!key || !marketPulseUsesCoinMarketCap()) return null;
  const count = Math.min(500, minHourlyPointsNeeded() + 48);
  try {
    const { data } = await axios.get<{
      data?: {
        quotes?: Array<{
          timestamp?: string;
          btc_dominance?: number;
        }>;
      };
    }>(`${CMC_PRO_BASE}/v1/global-metrics/quotes/historical`, {
      timeout: TIMEOUT_MS,
      headers: { "X-CMC_PRO_API_KEY": key },
      params: {
        time_end: new Date(atMs).toISOString(),
        count,
        interval: "hourly",
      },
    });
    const quotes = data?.data?.quotes;
    if (!Array.isArray(quotes) || quotes.length === 0) return null;
    const out: DomPoint[] = [];
    for (const q of quotes) {
      const tsMs = Date.parse(q.timestamp ?? "");
      const pct = q.btc_dominance;
      if (!Number.isFinite(tsMs) || typeof pct !== "number" || !Number.isFinite(pct) || pct <= 0) continue;
      out.push({ tsMs, pct });
    }
    out.sort((a, b) => a.tsMs - b.tsMs);
    return out.length > 0 ? out : null;
  } catch (e) {
    if (!isAxiosError(e) || e.response?.status !== 429) {
      console.error("[statsBtcDominanceEma] CMC hist", e instanceof Error ? e.message : e);
    }
    return null;
  }
}

async function fetchCoinGeckoDominanceHourly(): Promise<DomPoint[] | null> {
  const days = 90;
  try {
    const [btcRes, globalRes] = await Promise.all([
      axios.get<{ market_caps?: [number, number][] }>(`${COINGECKO}/coins/bitcoin/market_chart`, {
        timeout: TIMEOUT_MS,
        params: { vs_currency: "usd", days },
      }),
      axios.get<{ market_cap_chart?: { market_cap?: [number, number][] } }>(
        `${COINGECKO}/global/market_cap_chart`,
        {
          timeout: TIMEOUT_MS,
          params: { vs_currency: "usd", days },
        },
      ),
    ]);
    const btcCaps = normalizeTsPoints(btcRes.data?.market_caps).map((p) => ({
      tsMs: p.tsMs,
      pct: p.pct,
    }));
    const totalCaps = normalizeTsPoints(globalRes.data?.market_cap_chart?.market_cap).map((p) => ({
      tsMs: p.tsMs,
      pct: p.pct,
    }));
    const dom = dominanceFromMcapSeries(btcCaps, totalCaps);
    return dom.length > 0 ? dom : null;
  } catch (e) {
    if (!isAxiosError(e) || e.response?.status !== 429) {
      console.error("[statsBtcDominanceEma] CoinGecko", e instanceof Error ? e.message : e);
    }
    return null;
  }
}

async function loadBtcDominanceHourly(atMs: number): Promise<DomPoint[] | null> {
  const key = cacheKeyAtMs(atMs);
  if (domHourlyCache.has(key)) return domHourlyCache.get(key) ?? null;

  let hourly = await fetchCmcBtcDominanceHourly(atMs);
  if (!hourly) hourly = await fetchCoinGeckoDominanceHourly();

  domHourlyCache.set(key, hourly);
  return hourly;
}

function hourlyTo4hPack(hourly: DomPoint[], atMs: number): BinanceKlinePack | null {
  const atSec = Math.floor(atMs / 1000);
  const buckets = new Map<number, number>();
  for (const p of hourly) {
    const sec = Math.floor(p.tsMs / 1000);
    if (sec + 3600 > atSec) continue;
    const barOpen = Math.floor(sec / BAR_SEC) * BAR_SEC;
    buckets.set(barOpen, p.pct);
  }
  const timeSec = [...buckets.keys()].sort((a, b) => a - b);
  if (timeSec.length < 20 + STATS_EMA4H_SLOPE_LOOKBACK_BARS) return null;
  const close = timeSec.map((t) => buckets.get(t)!);
  return {
    timeSec,
    open: close,
    high: close,
    low: close,
    close,
    volume: close.map(() => 0),
  };
}

export async function fetchBtcDomEma20_4hSlopePct7dAtMs(atMs: number): Promise<number | null> {
  if (!Number.isFinite(atMs) || atMs <= 0) return null;
  const key = cacheKeyAtMs(atMs);
  if (slopeCache.has(key)) return slopeCache.get(key) ?? null;

  const hourly = await loadBtcDominanceHourly(atMs);
  if (!hourly) {
    slopeCache.set(key, null);
    return null;
  }
  const pack = hourlyTo4hPack(hourly, atMs);
  if (!pack) {
    slopeCache.set(key, null);
    return null;
  }
  const slope = computeEma20SlopePctFromPackAt(
    pack,
    "4h",
    STATS_EMA4H_SLOPE_LOOKBACK_BARS,
    atMs,
  );
  slopeCache.set(key, slope);
  return slope;
}

export type StatsRowWithBtcDomEma20_4h = {
  alertedAtMs: number;
  btcDomEma20_4hSlopePct7d?: number | null;
  btcDomEma20_4hV?: number;
};

export async function backfillAllStatsRowsBtcDomEma20_4h<T extends StatsRowWithBtcDomEma20_4h>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxRows = Math.max(1, opts?.maxRowsPerPass ?? 15);
  const maxPasses = Math.max(1, opts?.maxPasses ?? 6);
  const now = Date.now();
  let dirty = 0;
  let passes = 0;

  while (passes < maxPasses) {
    passes += 1;
    let passDirty = 0;
    for (const row of rows) {
      if (passDirty >= maxRows) break;
      if (row.btcDomEma20_4hV === STATS_BTC_DOM_EMA20_4H_VERSION) continue;
      const atMs = row.alertedAtMs;
      if (!Number.isFinite(atMs) || atMs <= 0) continue;

      if (now - atMs > STATS_BTC_DOM_EMA20_HIST_MAX_AGE_MS) {
        row.btcDomEma20_4hV = STATS_BTC_DOM_EMA20_4H_VERSION;
        passDirty += 1;
        dirty += 1;
        continue;
      }

      try {
        const slope = await fetchBtcDomEma20_4hSlopePct7dAtMs(atMs);
        if (slope == null) continue;
        row.btcDomEma20_4hSlopePct7d = slope;
        row.btcDomEma20_4hV = STATS_BTC_DOM_EMA20_4H_VERSION;
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
