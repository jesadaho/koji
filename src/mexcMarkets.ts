import axios from "axios";
import { fetchContractFunding } from "./mexcContractMeta";

const MEXC_TICKER = "https://api.mexc.com/api/v1/contract/ticker";
const MEXC_DETAIL = "https://api.mexc.com/api/v1/contract/detail";

/** น้ำหนักส่วน volume spike */
const MOMENTUM_W_V = 1;
/** น้ำหนักส่วน price return (สเกลเดียวกับ return เป็นทศนิยม เช่น 0.02 = 2%) */
const MOMENTUM_W_P = 1;

/** ดึง kline แค่ candidate อันดับต้น ๆ ตาม amount24 เพื่อจำกัด request */
const KLINE_CANDIDATE_CAP = 120;
/** เรียก kline พร้อมกันต่อรอบ */
const KLINE_CONCURRENCY = 14;
/** แท่ง 15m ย้อนหลังขั้นต่ำสำหรับค่าเฉลี่ย volume */
const MIN_BASELINE_BARS = 32;

/** กรองเฉพาะสัญญาที่มูลค่าเทิร์นโอเวอร์ 24h (amount24) มากกว่านี้ (USDT) */
export const MIN_AMOUNT24_USDT = 5_000_000;

type MexcTickerRow = {
  symbol?: string;
  lastPrice?: number;
  riseFallRate?: number;
  volume24?: number;
  amount24?: number;
  fundingRate?: number;
};

type MexcTickerResponse = {
  success: boolean;
  code: number;
  data?: MexcTickerRow | MexcTickerRow[];
};

type RiskTier = {
  level?: number;
  maxVol?: number;
  maxLeverage?: number;
};

type MexcDetailRow = {
  symbol?: string;
  state?: number;
  riskLimitCustom?: RiskTier[];
  limitMaxVol?: number;
  maxVol?: number;
};

type MexcDetailResponse = {
  success: boolean;
  code: number;
  data?: MexcDetailRow | MexcDetailRow[];
};

type KlineArrays = {
  open: number[];
  close: number[];
  vol: number[];
};

type KlineApiResponse = {
  success: boolean;
  code: number;
  data?: {
    open?: number[];
    close?: number[];
    vol?: number[];
    time?: number[];
  };
};

function asArray<T>(data: T | T[] | undefined): T[] {
  if (data === undefined) return [];
  return Array.isArray(data) ? data : [data];
}

export type TopMarketRow = {
  symbol: string;
  lastPrice: number;
  change24hPercent: number;
  volume24: number;
  amount24Usdt: number;
  fundingRate: number;
  maxPositionContracts: number | null;
  /** ประมาณ notional USDT = maxPositionContracts × lastPrice (USDT-M linear) */
  maxPositionUsdt: number | null;
  /** S = (w_v·V_recent/V_avg)·(w_p·ΔP/P_start) แท่ง 15m ปิดล่าสุด */
  momentumScore: number;
  /** V_recent / V_avg */
  volumeSpikeRatio: number;
  /** % จาก open→close แท่ง 15m ปิดล่าสุด */
  return15mPercent: number;
  /** ชม. ต่อรอบ funding จาก REST funding_rate */
  fundingCycleHours: number | null;
  /** ms epoch เวลาตัด funding ถัดไป */
  nextFundingSettleMs: number | null;
};

function maxFromRiskTiers(detail: MexcDetailRow): number | null {
  const tiers = detail.riskLimitCustom;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const vals = tiers.map((t) => t.maxVol).filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
    if (vals.length > 0) return Math.max(...vals);
  }
  if (typeof detail.limitMaxVol === "number" && !Number.isNaN(detail.limitMaxVol)) {
    return detail.limitMaxVol;
  }
  if (typeof detail.maxVol === "number" && !Number.isNaN(detail.maxVol)) {
    return detail.maxVol;
  }
  return null;
}

async function fetchContractTickers(): Promise<MexcTickerRow[]> {
  const { data } = await axios.get<MexcTickerResponse>(MEXC_TICKER, { timeout: 45_000 });
  if (!data.success || data.data === undefined) return [];
  return asArray(data.data);
}

async function fetchContractDetails(): Promise<MexcDetailRow[]> {
  const { data } = await axios.get<MexcDetailResponse>(MEXC_DETAIL, { timeout: 60_000 });
  if (!data.success || data.data === undefined) return [];
  return asArray(data.data);
}

function parseKlineArrays(raw: KlineApiResponse["data"]): KlineArrays | null {
  if (!raw?.vol?.length || !raw.open?.length || !raw.close?.length) return null;
  const n = raw.vol.length;
  if (raw.open.length !== n || raw.close.length !== n) return null;
  return {
    vol: raw.vol.map((v) => Number(v)),
    open: raw.open.map((v) => Number(v)),
    close: raw.close.map((v) => Number(v)),
  };
}

/**
 * แท่ง index n-2 = แท่ง 15 นาทีที่ปิดล่าสุด (กันท้ายที่อาจยังไม่ปิด)
 * V_avg = เฉลี่ย vol แท่งก่อนหน้า สูงสุด 96 แท่ง (~24 ชม.)
 */
function computeMomentum15m(k: KlineArrays): { score: number; volRatio: number; returnPct: number } | null {
  const { vol, open, close } = k;
  const n = vol.length;
  if (n < 4) return null;
  const i = n - 2;
  const windowStart = Math.max(0, i - 96);
  const baseline = vol.slice(windowStart, i);
  if (baseline.length < MIN_BASELINE_BARS) return null;

  let sum = 0;
  for (const v of baseline) {
    if (typeof v === "number" && !Number.isNaN(v)) sum += v;
  }
  const V_avg = sum / baseline.length;
  if (V_avg <= 0) return null;

  const V_recent = vol[i];
  if (typeof V_recent !== "number" || Number.isNaN(V_recent) || V_recent < 0) return null;

  const o = open[i];
  const c = close[i];
  if (typeof o !== "number" || o <= 0 || typeof c !== "number" || Number.isNaN(o) || Number.isNaN(c)) return null;

  const ret = (c - o) / o;
  const volRatio = V_recent / V_avg;
  const score = MOMENTUM_W_V * volRatio * (MOMENTUM_W_P * ret);

  return { score, volRatio, returnPct: ret * 100 };
}

async function fetchContractKline15m(symbol: string): Promise<KlineArrays | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 26 * 3600;
  const url = `https://api.mexc.com/api/v1/contract/kline/${encodeURIComponent(symbol)}`;
  try {
    const { data } = await axios.get<KlineApiResponse>(url, {
      timeout: 12_000,
      params: { interval: "Min15", start, end },
    });
    if (!data.success || !data.data) return null;
    return parseKlineArrays(data.data);
  } catch {
    return null;
  }
}

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const part = await Promise.all(chunk.map(fn));
    out.push(...part);
  }
  return out;
}

function fundingRateNum(t: MexcTickerRow): number {
  const fr = t.fundingRate;
  return typeof fr === "number" && !Number.isNaN(fr) ? fr : 0;
}

function toTopMarketRow(
  t: MexcTickerRow,
  detailBySymbol: Map<string, MexcDetailRow>,
  mom: { score: number; volRatio: number; returnPct: number }
): TopMarketRow {
  const sym = t.symbol!.trim();
  const detail = detailBySymbol.get(sym);
  const r = t.riseFallRate;
  const changePct = typeof r === "number" && !Number.isNaN(r) ? r * 100 : 0;
  const funding = fundingRateNum(t);
  const maxContracts = detail ? maxFromRiskTiers(detail) : null;
  const maxUsdt = maxContracts != null && maxContracts > 0 ? maxContracts * t.lastPrice! : null;

  return {
    symbol: sym,
    lastPrice: t.lastPrice!,
    change24hPercent: changePct,
    volume24: typeof t.volume24 === "number" && !Number.isNaN(t.volume24) ? t.volume24 : 0,
    amount24Usdt: t.amount24!,
    fundingRate: funding,
    maxPositionContracts: maxContracts,
    maxPositionUsdt: maxUsdt,
    momentumScore: mom.score,
    volumeSpikeRatio: mom.volRatio,
    return15mPercent: mom.returnPct,
    fundingCycleHours: null,
    nextFundingSettleMs: null,
  };
}

const EMPTY_MOM = { score: 0, volRatio: 1, returnPct: 0 };

const FUNDING_META_CONCURRENCY = 12;

async function enrichFundingMeta(rows: TopMarketRow[]): Promise<TopMarketRow[]> {
  if (rows.length === 0) return rows;
  const parts = await mapPoolConcurrent(rows, FUNDING_META_CONCURRENCY, async (row) => {
    const f = await fetchContractFunding(row.symbol);
    if (!f) {
      return { ...row, fundingCycleHours: null, nextFundingSettleMs: null };
    }
    const cc = f.collectCycle > 0 ? f.collectCycle : null;
    const ns = f.nextSettleTime > 0 ? f.nextSettleTime : null;
    return { ...row, fundingCycleHours: cc, nextFundingSettleMs: ns };
  });
  return parts;
}

export type MarketsSortMode = "momentum" | "funding";

export function parseMarketsSort(raw: string | string[] | undefined): MarketsSortMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "funding" ? "funding" : "momentum";
}

export type GetTopUsdtMarketsOptions = {
  sort: MarketsSortMode;
  limit?: number;
};

/**
 * USDT perpetual Top N — เรียงตาม momentum (จาก kline + candidate ตาม amount24) หรือ |funding| มากสุดก่อน
 */
export async function getTopUsdtMarkets(options: GetTopUsdtMarketsOptions): Promise<TopMarketRow[]> {
  const limit = options.limit ?? 50;
  const [tickers, details] = await Promise.all([fetchContractTickers(), fetchContractDetails()]);

  const detailBySymbol = new Map<string, MexcDetailRow>();
  for (const d of details) {
    if (d.symbol) detailBySymbol.set(d.symbol, d);
  }

  const usdtPerp = tickers.filter((t) => {
    const sym = t.symbol?.trim();
    if (!sym || !sym.endsWith("_USDT")) return false;
    const amt = t.amount24;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= MIN_AMOUNT24_USDT) return false;
    const price = t.lastPrice;
    if (typeof price !== "number" || Number.isNaN(price) || price <= 0) return false;
    const d = detailBySymbol.get(sym);
    if (d && typeof d.state === "number" && d.state !== 0) return false;
    return true;
  });

  if (options.sort === "funding") {
    const sorted = [...usdtPerp].sort((a, b) => {
      const diff = Math.abs(fundingRateNum(b)) - Math.abs(fundingRateNum(a));
      if (diff !== 0) return diff;
      return (b.amount24 ?? 0) - (a.amount24 ?? 0);
    });
    const picked = sorted.slice(0, limit);
    const scored = await mapPoolConcurrent(picked, KLINE_CONCURRENCY, async (t) => {
      const sym = t.symbol!.trim();
      const kline = await fetchContractKline15m(sym);
      const mom = kline ? computeMomentum15m(kline) : null;
      return mom;
    });
    const built = picked.map((t, i) => {
      const mom = scored[i];
      const fill = mom ? { score: mom.score, volRatio: mom.volRatio, returnPct: mom.returnPct } : EMPTY_MOM;
      return toTopMarketRow(t, detailBySymbol, fill);
    });
    return enrichFundingMeta(built);
  }

  const ranked = [...usdtPerp].sort((a, b) => (b.amount24 ?? 0) - (a.amount24 ?? 0));
  const candidates = ranked.slice(0, KLINE_CANDIDATE_CAP);

  const scored = await mapPoolConcurrent(candidates, KLINE_CONCURRENCY, async (t) => {
    const sym = t.symbol!.trim();
    const kline = await fetchContractKline15m(sym);
    const mom = kline ? computeMomentum15m(kline) : null;
    return { t, mom };
  });

  type Row = TopMarketRow & { _sort: number };
  const rows: Row[] = [];

  for (const { t, mom } of scored) {
    if (!mom) continue;
    rows.push({
      ...toTopMarketRow(t, detailBySymbol, mom),
      _sort: mom.score,
    });
  }

  rows.sort((a, b) => b._sort - a._sort);
  const top = rows.slice(0, limit).map(({ _sort, ...rest }) => rest);
  return enrichFundingMeta(top);
}

/** ใช้ getTopUsdtMarkets({ sort: "momentum", limit }) แทนได้ */
export async function getTopUsdtMarketsByMomentum(limit = 50): Promise<TopMarketRow[]> {
  return getTopUsdtMarkets({ sort: "momentum", limit });
}
