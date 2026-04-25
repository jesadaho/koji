import axios from "axios";
import { fetchContractFunding } from "./mexcContractMeta";

const MEXC_TICKER = "https://api.mexc.com/api/v1/contract/ticker";
const MEXC_DETAIL = "https://api.mexc.com/api/v1/contract/detail";
const MEXC_SPOT_TICKER_PRICE = "https://api.mexc.com/api/v3/ticker/price";
const MEXC_SPOT_TICKER_24HR = "https://api.mexc.com/api/v3/ticker/24hr";
const MEXC_SPOT_KLINES = "https://api.mexc.com/api/v3/klines";

/** แท่ง 1h สำหรับสถิติ basis ย้อนหลัง ~24 ชม. (spot + perp) */
const BASIS_24H_KLINE_LIMIT = 26;
const BASIS_24H_FETCH_CONCURRENCY = 5;

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

/** 24h ติดลบ — กรอง Top loser by vol (รวมขอบเขต -1% … -15%) */
export const TOP_LOSER_24H_PCT_MIN = -15;
export const TOP_LOSER_24H_PCT_MAX = -1;

/** Vol 24h ขั้นต่ำสำหรับ Top loser (amount24, USDT) — อ่อนกว่า MIN_AMOUNT24_USDT ของ markets หลัก */
export const TOP_LOSER_MIN_AMOUNT24_USDT = 2_000_000;

export type MexcTickerRow = {
  symbol?: string;
  lastPrice?: number;
  riseFallRate?: number;
  /** ค่า 24h ตาม zone (มัก zone ตรงกับ `riseFallRate` / UTC+8) */
  riseFallRates?: { zone?: string; r?: number; v?: number };
  /** อัตรา 24h หลายเขตเวลา — อินดีซ์ 0/1/2 ต่างกัน; เทียบกับคอลัมน์ 24h บน mexc.com ที่สลับ timezone */
  riseFallRatesOfTimezone?: number[];
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
  /** ชื่อโชว์จาก MEXC (มักมีภาษาจีน + คำว่า 永续 ฯลฯ) */
  displayName?: string;
  displayNameEn?: string;
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

/** จากแท่ง 1h ที่จับคู่เวลา — basis = (perp close − spot close) / spot close × 100 */
export type SpotFutBasis24hStats = {
  minBasisPct: number;
  maxBasisPct: number;
  /** แท่ง 1h สุดท้าย − แท่งแรกในช่วงที่ดึงได้ (~24–25 ชม.) */
  deltaBasisPct24h: number;
};

/** Spot vs USDT-M perpetual — เรียงตาม |basis| (ไม่เรียก kline / funding_rate แยก) */
export type SpotFutBasisRow = {
  symbol: string;
  /** เช่น BTCUSDT */
  spotSymbol: string;
  spotPrice: number;
  futPrice: number;
  /** (fut - spot) / spot × 100 — บวก = perp แพงกว่า spot */
  basisPct: number;
  absBasisPct: number;
  change24hPercent: number;
  volume24: number;
  amount24Usdt: number;
  fundingRate: number;
  maxPositionUsdt: number | null;
  /** เติมใน getTopUsdtMarketsBySpotFutBasis — จาก kline 1h */
  basis24h?: SpotFutBasis24hStats | null;
};

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

/** ดึง amount24 / volume24 / last ต่อสัญญา — ใช้ตอนเก็บสถิติ Spark (แยก Vol / mcap proxy) */
export async function fetchContractTickerMetrics(contractSymbol: string): Promise<{
  amount24Usdt: number;
  volume24: number;
  lastPrice: number;
} | null> {
  const sym = contractSymbol.trim();
  if (!sym) return null;
  try {
    const { data } = await axios.get<MexcTickerResponse>(MEXC_TICKER, {
      params: { symbol: sym },
      timeout: 15_000,
    });
    if (!data.success || data.data === undefined) return null;
    const rows = asArray(data.data);
    const t = rows.find((r) => r.symbol?.trim() === sym) ?? rows[0];
    if (!t) return null;
    const lp = t.lastPrice;
    const amt = t.amount24;
    if (typeof lp !== "number" || Number.isNaN(lp) || lp <= 0) return null;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt < 0) return null;
    const vol = t.volume24;
    return {
      lastPrice: lp,
      amount24Usdt: amt,
      volume24: typeof vol === "number" && !Number.isNaN(vol) ? vol : 0,
    };
  } catch {
    return null;
  }
}

type MexcSpotPriceRow = { symbol?: string; price?: string };

/** MEXC spot /api/v3/ticker/24hr — สนใจ quote volume (USDT) */
type MexcSpot24hrRow = {
  symbol?: string;
  quoteVolume?: string;
  volume?: string;
  lastPrice?: string;
};

/** แปลงสัญญา perp BTC_USDT → คู่ spot BTCUSDT */
export function perpSymbolToSpotSymbol(contractSymbol: string): string {
  return contractSymbol.trim().replace(/_/g, "");
}

/** ราคา last ทุกคู่ spot — GET ครั้งเดียว */
async function fetchSpotTickerPrices(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const { data } = await axios.get<MexcSpotPriceRow | MexcSpotPriceRow[]>(MEXC_SPOT_TICKER_PRICE, {
      timeout: 60_000,
    });
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    for (const r of rows) {
      const sym = r.symbol?.trim();
      if (!sym) continue;
      const p = Number(r.price);
      if (Number.isFinite(p) && p > 0) map.set(sym, p);
    }
  } catch {
    /* empty map */
  }
  return map;
}

async function fetchContractDetails(): Promise<MexcDetailRow[]> {
  const { data } = await axios.get<MexcDetailResponse>(MEXC_DETAIL, { timeout: 60_000 });
  if (!data.success || data.data === undefined) return [];
  return asArray(data.data);
}

export type ContractDisplayMeta = { displayName?: string; displayNameEn?: string };

/** symbol สัญญา (เช่น BIAN_REN_SHENG_USDT) → displayName / displayNameEn จาก GET contract/detail */
export async function fetchContractDisplayMetaBySymbol(): Promise<Map<string, ContractDisplayMeta>> {
  const rows = await fetchContractDetails();
  const map = new Map<string, ContractDisplayMeta>();
  for (const d of rows) {
    const sym = d.symbol?.trim();
    if (!sym) continue;
    const displayName = typeof d.displayName === "string" ? d.displayName.trim() || undefined : undefined;
    const displayNameEn = typeof d.displayNameEn === "string" ? d.displayNameEn.trim() || undefined : undefined;
    map.set(sym, { displayName, displayNameEn });
  }
  return map;
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

/** 15m kline สำหรับ EMA cross — close + เวลาเปิดแท่ง (สอดคล้อง indicator worker index n-2) */
export type ContractKline15mIndicatorPack = {
  close: number[];
  timeSec: number[];
};

function parseKlineIndicator15m(raw: KlineApiResponse["data"]): ContractKline15mIndicatorPack | null {
  if (!raw?.close?.length || !raw.time?.length) return null;
  const n = raw.close.length;
  if (raw.time.length !== n) return null;
  return {
    close: raw.close.map((c) => Number(c)),
    timeSec: raw.time.map((t) => Number(t)),
  };
}

/**
 * ดึง kline 15m (เก่า→ใหม่) พร้อม time สำหรับ EMA6/12 — แท่งท้ายอาจยังไม่ปิด (ใช้ index n-2 เป็นแท่งปิดล่าสุด)
 */
export async function fetchContractKline15mIndicatorPack(
  symbol: string
): Promise<ContractKline15mIndicatorPack | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 26 * 3600;
  const url = `https://api.mexc.com/api/v1/contract/kline/${encodeURIComponent(symbol.trim())}`;
  try {
    const { data } = await axios.get<KlineApiResponse>(url, {
      timeout: 12_000,
      params: { interval: "Min15", start, end },
    });
    if (!data.success || !data.data) return null;
    return parseKlineIndicator15m(data.data);
  } catch {
    return null;
  }
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

/**
 * ดึง close 15m (เก่า→ใหม่) สำหรับ EMA — ตัดแท่งสุดท้ายที่อาจยังไม่ปิด (สอดคล้อง index n-2 ใน momentum)
 */
export async function fetchPerp15mClosesForChecklist(contractSymbol: string): Promise<number[] | null> {
  const k = await fetchContractKline15m(contractSymbol.trim());
  if (!k?.close.length) return null;
  const raw = k.close.map((c) => Number(c)).filter((c) => Number.isFinite(c) && c > 0);
  if (raw.length < 14) return null;
  const n = raw.length;
  const closed = n >= 3 ? raw.slice(0, n - 1) : raw;
  return closed.length >= 14 ? closed : null;
}

/**
 * แปลง close[] จาก kline เป็นแท่งปิดสำหรับ EMA — ไม่ใช้ parseKlineArrays (ไม่บังคับ vol/open)
 */
function closedClosesForEmaFromKlineCloseArray(closeRaw: number[] | undefined): number[] | null {
  if (!closeRaw?.length) return null;
  const raw = closeRaw.map((c) => Number(c)).filter((c) => Number.isFinite(c) && c > 0);
  /** ตัดแท่งท้ายที่อาจยังไม่ปิด → ต้องมีอย่างน้อย 15 แท่งดิบเพื่อให้ได้ 14 แท่งปิด */
  if (raw.length < 15) return null;
  const n = raw.length;
  const closed = n >= 3 ? raw.slice(0, n - 1) : raw;
  return closed.length >= 14 ? closed : null;
}

/**
 * 1hr / 4hr / 1D สำหรับ checklist — ใช้ limit ก่อน แล้วค่อย fallback start/end
 * MEXC contract kline: 4h = `Hour4` (ไม่ใช่ Min240); รายวัน = `Day1`; limit สูงสุด 100
 */
async function fetchContractKlineClosesForEmaChecklist(
  contractSymbol: string,
  interval: "Min60" | "Hour4" | "Day1"
): Promise<number[] | null> {
  const sym = contractSymbol.trim();
  const url = `https://api.mexc.com/api/v1/contract/kline/${encodeURIComponent(sym)}`;
  const limit = 100;

  const withLimit = async (): Promise<number[] | null> => {
    try {
      const { data } = await axios.get<KlineApiResponse>(url, {
        timeout: 14_000,
        params: { interval, limit },
      });
      if (!data.success || !data.data?.close?.length) return null;
      return closedClosesForEmaFromKlineCloseArray(data.data.close);
    } catch {
      return null;
    }
  };

  const withRange = async (): Promise<number[] | null> => {
    const end = Math.floor(Date.now() / 1000);
    const lookbackSec =
      interval === "Min60"
        ? 80 * 3600
        : interval === "Hour4"
          ? 45 * 24 * 3600
          : 400 * 24 * 3600;
    const start = end - lookbackSec;
    try {
      const { data } = await axios.get<KlineApiResponse>(url, {
        timeout: 14_000,
        params: { interval, start, end },
      });
      if (!data.success || !data.data?.close?.length) return null;
      return closedClosesForEmaFromKlineCloseArray(data.data.close);
    } catch {
      return null;
    }
  };

  return (await withLimit()) ?? (await withRange());
}

/** close 1h (เก่า→ใหม่) สำหรับ EMA6/12 — ตัดแท่งท้ายที่อาจยังไม่ปิด */
export async function fetchPerp1hClosesForChecklist(contractSymbol: string): Promise<number[] | null> {
  return fetchContractKlineClosesForEmaChecklist(contractSymbol, "Min60");
}

/** close 4h — สำหรับ EMA12 */
export async function fetchPerp4hClosesForChecklist(contractSymbol: string): Promise<number[] | null> {
  return fetchContractKlineClosesForEmaChecklist(contractSymbol, "Hour4");
}

/** close รายวัน (Day1) — สำหรับ EMA6/12 ภาพ macro */
export async function fetchPerp1dClosesForChecklist(contractSymbol: string): Promise<number[] | null> {
  return fetchContractKlineClosesForEmaChecklist(contractSymbol, "Day1");
}

/** แท่ง index n-2 = แท่ง 15 นาทีที่ปิดล่าสุด — return เป็น % จาก open→close */
export type LastClosed15mBarResult = {
  returnPct: number;
  /** เวลาเปิดแท่ง (วินาที) ใช้กันซ้ำแจ้งเตือน */
  barOpenTimeSec: number;
};

export async function fetchLastClosed15mBarReturn(contractSymbol: string): Promise<LastClosed15mBarResult | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 26 * 3600;
  const url = `https://api.mexc.com/api/v1/contract/kline/${encodeURIComponent(contractSymbol.trim())}`;
  try {
    const { data } = await axios.get<KlineApiResponse>(url, {
      timeout: 12_000,
      params: { interval: "Min15", start, end },
    });
    if (!data.success || !data.data) return null;
    const raw = data.data;
    const opens = raw.open;
    if (!opens?.length || opens.length < 4) return null;
    const n = opens.length;
    const i = n - 2;
    const o = Number(opens[i]);
    const c = raw.close != null ? Number(raw.close[i]) : Number.NaN;
    if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(c)) return null;
    let barOpenTimeSec = 0;
    if (raw.time != null && raw.time.length === n) {
      const t = Number(raw.time[i]);
      if (Number.isFinite(t)) {
        barOpenTimeSec = t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
      }
    }
    if (barOpenTimeSec <= 0) {
      barOpenTimeSec = Math.floor(Date.now() / 1000 / 900) * 900;
    }
    return {
      returnPct: ((c - o) / o) * 100,
      barOpenTimeSec,
    };
  } catch {
    return null;
  }
}

const SPARK_5M_BASELINE_BARS = 48;

/** แท่ง 5m ล่าสุดที่ปิดแล้ว — return, ราคาปิด, Vol โดยประมาณ (USDT) และ % เทียบค่าเฉลี่ย Vol ของแท่งก่อนหน้า */
export type LastClosed5mSparkBarResult = {
  returnPct: number;
  barOpenTimeSec: number;
  lastClose: number;
  /** มูลค่าโดยประมาณของแท่ง 5m ล่าสุด (vol×close, USDT-M) */
  volUsdt5m: number;
  /** (V/V_avg − 1)×100 — ใช้โชว์ "สูงกว่าค่าเฉลี่ย X%" */
  volVsAvgPct: number | null;
};

export async function fetchLastClosed5mSparkBar(contractSymbol: string): Promise<LastClosed5mSparkBarResult | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 7 * 24 * 3600;
  const url = `https://api.mexc.com/api/v1/contract/kline/${encodeURIComponent(contractSymbol.trim())}`;
  try {
    const { data } = await axios.get<KlineApiResponse>(url, {
      timeout: 14_000,
      params: { interval: "Min5", start, end },
    });
    if (!data.success || !data.data) return null;
    const raw = data.data;
    const opens = raw.open;
    const vols = raw.vol;
    if (!opens?.length || !vols?.length || opens.length < 4 || vols.length !== opens.length) return null;
    const n = opens.length;
    const i = n - 2;
    const windowStart = Math.max(0, i - SPARK_5M_BASELINE_BARS);
    const baselineEnd = i;
    const o = Number(opens[i]);
    const c = raw.close != null ? Number(raw.close[i]) : Number.NaN;
    const v = Number(vols[i]);
    if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(c) || !Number.isFinite(v) || v < 0) return null;

    let barOpenTimeSec = 0;
    if (raw.time != null && raw.time.length === n) {
      const t = Number(raw.time[i]);
      if (Number.isFinite(t)) {
        barOpenTimeSec = t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
      }
    }
    if (barOpenTimeSec <= 0) {
      barOpenTimeSec = Math.floor(Date.now() / 1000 / 300) * 300;
    }

    const volUsdt5m = v * c;
    let volVsAvgPct: number | null = null;
    if (baselineEnd > windowStart) {
      let sum = 0;
      let count = 0;
      for (let j = windowStart; j < baselineEnd; j++) {
        const vj = Number(vols[j]);
        const cj = raw.close != null ? Number(raw.close[j]) : Number.NaN;
        if (!Number.isFinite(vj) || vj < 0 || !Number.isFinite(cj) || cj <= 0) continue;
        sum += vj * cj;
        count += 1;
      }
      if (count >= 8) {
        const vAvg = sum / count;
        if (vAvg > 0 && volUsdt5m >= 0) {
          volVsAvgPct = (volUsdt5m / vAvg - 1) * 100;
        }
      }
    }

    return {
      returnPct: ((c - o) / o) * 100,
      barOpenTimeSec,
      lastClose: c,
      volUsdt5m,
      volVsAvgPct,
    };
  } catch {
    return null;
  }
}

type KlineTimeClose = { timeSec: number[]; close: number[] };

async function fetchContractKline60m(perpSymbol: string, limit: number): Promise<KlineTimeClose | null> {
  const url = `https://api.mexc.com/api/v1/contract/kline/${encodeURIComponent(perpSymbol)}`;
  try {
    const { data } = await axios.get<KlineApiResponse>(url, {
      timeout: 14_000,
      params: { interval: "Min60", limit },
    });
    if (!data.success || !data.data?.time?.length || !data.data.close?.length) return null;
    const t = data.data.time;
    const c = data.data.close;
    if (t.length !== c.length) return null;
    return {
      timeSec: t.map((x) => Number(x)),
      close: c.map((x) => Number(x)),
    };
  } catch {
    return null;
  }
}

type SpotKlineRow = (string | number)[];

async function fetchSpotKlines60m(spotSymbol: string, limit: number): Promise<KlineTimeClose | null> {
  try {
    const { data } = await axios.get<SpotKlineRow[]>(MEXC_SPOT_KLINES, {
      timeout: 14_000,
      params: { symbol: spotSymbol, interval: "60m", limit },
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    const timeSec: number[] = [];
    const close: number[] = [];
    for (const row of data) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const tMs = Number(row[0]);
      const cl = Number(row[4]);
      if (!Number.isFinite(tMs) || !Number.isFinite(cl) || cl <= 0) continue;
      timeSec.push(Math.floor(tMs / 1000));
      close.push(cl);
    }
    return timeSec.length ? { timeSec, close } : null;
  } catch {
    return null;
  }
}

function computeBasis24hStatsFromAlignedKlines(fut: KlineTimeClose, spot: KlineTimeClose): SpotFutBasis24hStats | null {
  const smap = new Map<number, number>();
  for (let i = 0; i < spot.timeSec.length; i++) {
    smap.set(spot.timeSec[i], spot.close[i]);
  }
  const basis: number[] = [];
  for (let i = 0; i < fut.timeSec.length; i++) {
    const ts = fut.timeSec[i];
    const sp = smap.get(ts);
    const fc = fut.close[i];
    if (sp == null || sp <= 0 || !Number.isFinite(fc)) continue;
    basis.push(((fc - sp) / sp) * 100);
  }
  if (basis.length < 3) return null;
  let minB = basis[0];
  let maxB = basis[0];
  for (const b of basis) {
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  const deltaBasisPct24h = basis[basis.length - 1] - basis[0];
  return { minBasisPct: minB, maxBasisPct: maxB, deltaBasisPct24h };
}

async function fetchSpotFutBasis24hStats(perpSymbol: string, spotSymbol: string): Promise<SpotFutBasis24hStats | null> {
  const lim = BASIS_24H_KLINE_LIMIT;
  const [fut, spot] = await Promise.all([fetchContractKline60m(perpSymbol, lim), fetchSpotKlines60m(spotSymbol, lim)]);
  if (!fut || !spot) return null;
  return computeBasis24hStatsFromAlignedKlines(fut, spot);
}

async function enrichSpotFutBasisRowsWith24h(rows: SpotFutBasisRow[]): Promise<SpotFutBasisRow[]> {
  if (rows.length === 0) return rows;
  const statsList = await mapPoolConcurrent(rows, BASIS_24H_FETCH_CONCURRENCY, (r) =>
    fetchSpotFutBasis24hStats(r.symbol, r.spotSymbol),
  );
  return rows.map((r, i) => ({
    ...r,
    basis24h: statsList[i] ?? null,
  }));
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

/**
 * อัตราเปลี่ยน 24h แบบทศนิยม (เช่น -0.0066) — ตรง MEXC contract/ticker
 * ค่า default: `riseFallRates.r` ถ้ามี (zone ตาม MEXC) ไม่งั้น `riseFallRate`
 * ตั้ง `MEXC_24H_FUTURES_CHANGE_TZ_INDEX=0|1|2` เพื่อใช้ `riseFallRatesOfTimezone[ดัชนี]` ให้ตรงกับ 24h บนเว็บ (สลับ timezone ได้)
 */
export function mexcFutures24hChangeRateDecimal(t: MexcTickerRow): number {
  const idxRaw = process.env.MEXC_24H_FUTURES_CHANGE_TZ_INDEX?.trim();
  if (idxRaw === "0" || idxRaw === "1" || idxRaw === "2") {
    const i = Number(idxRaw);
    const arr = t.riseFallRatesOfTimezone;
    if (Array.isArray(arr) && arr.length > i && typeof arr[i] === "number" && !Number.isNaN(arr[i]!)) {
      return arr[i] as number;
    }
  }
  const nest = t.riseFallRates?.r;
  if (typeof nest === "number" && !Number.isNaN(nest)) {
    return nest;
  }
  const r = t.riseFallRate;
  return typeof r === "number" && !Number.isNaN(r) ? r : 0;
}

/** % เปลี่ยน 24h (เช่น -0.66) — ใช้ filter Top loser + ตาราง Markets */
export function mexcFutures24hChangePercent(t: MexcTickerRow): number {
  return mexcFutures24hChangeRateDecimal(t) * 100;
}

function change24hPercentFromTicker(t: MexcTickerRow): number {
  return mexcFutures24hChangePercent(t);
}

function toTopMarketRow(
  t: MexcTickerRow,
  detailBySymbol: Map<string, MexcDetailRow>,
  mom: { score: number; volRatio: number; returnPct: number }
): TopMarketRow {
  const sym = t.symbol!.trim();
  const detail = detailBySymbol.get(sym);
  const changePct = change24hPercentFromTicker(t);
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

export type MarketsSortMode = "momentum" | "funding" | "basis";

export function parseMarketsSort(raw: string | string[] | undefined): MarketsSortMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "funding") return "funding";
  if (v === "basis") return "basis";
  return "momentum";
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

/**
 * USDT perpetual: 24h ติดลบในช่วง [TOP_LOSER_24H_PCT_MIN, TOP_LOSER_24H_PCT_MAX] — เรียงตาม amount24
 * กรอง amount24 > TOP_LOSER_MIN_AMOUNT24_USDT
 * ไม่เรียก kline; momentum / 15m ในแถว = 0 (placeholder)
 */
export async function getTopUsdtMarketsLoserByVolume(options?: { limit?: number }): Promise<TopMarketRow[]> {
  const limit = options?.limit ?? 50;
  const [tickers, details] = await Promise.all([fetchContractTickers(), fetchContractDetails()]);

  const detailBySymbol = new Map<string, MexcDetailRow>();
  for (const d of details) {
    if (d.symbol) detailBySymbol.set(d.symbol, d);
  }

  const usdtPerp = tickers.filter((t) => {
    const sym = t.symbol?.trim();
    if (!sym || !sym.endsWith("_USDT")) return false;
    const amt = t.amount24;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= TOP_LOSER_MIN_AMOUNT24_USDT) return false;
    const price = t.lastPrice;
    if (typeof price !== "number" || Number.isNaN(price) || price <= 0) return false;
    const d = detailBySymbol.get(sym);
    if (d && typeof d.state === "number" && d.state !== 0) return false;
    return true;
  });

  const losers = usdtPerp.filter((t) => {
    const ch = change24hPercentFromTicker(t);
    return ch >= TOP_LOSER_24H_PCT_MIN && ch <= TOP_LOSER_24H_PCT_MAX;
  });

  losers.sort((a, b) => (b.amount24 ?? 0) - (a.amount24 ?? 0));
  const picked = losers.slice(0, limit);
  const built = picked.map((t) => toTopMarketRow(t, detailBySymbol, EMPTY_MOM));
  return enrichFundingMeta(built);
}

/**
 * ทุกสัญญาที่ผ่าน Vol filter และจับคู่ราคา spot ได้ — basis = (perp − spot) / spot × 100
 * ไม่เรียก kline
 */
export async function listAllSpotFutBasisRows(): Promise<SpotFutBasisRow[]> {
  const [tickers, details, spotBySymbol] = await Promise.all([
    fetchContractTickers(),
    fetchContractDetails(),
    fetchSpotTickerPrices(),
  ]);

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

  const rows: SpotFutBasisRow[] = [];

  for (const t of usdtPerp) {
    const sym = t.symbol!.trim();
    const fut = t.lastPrice!;
    const spotSym = perpSymbolToSpotSymbol(sym);
    const spot = spotBySymbol.get(spotSym);
    if (spot == null || spot <= 0) continue;

    const basisPct = ((fut - spot) / spot) * 100;
    const absBasisPct = Math.abs(basisPct);
    const detail = detailBySymbol.get(sym);
    const maxContracts = detail ? maxFromRiskTiers(detail) : null;
    const maxUsdt = maxContracts != null && maxContracts > 0 ? maxContracts * fut : null;
    const changePct = change24hPercentFromTicker(t);

    rows.push({
      symbol: sym,
      spotSymbol: spotSym,
      spotPrice: spot,
      futPrice: fut,
      basisPct,
      absBasisPct,
      change24hPercent: changePct,
      volume24: typeof t.volume24 === "number" && !Number.isNaN(t.volume24) ? t.volume24 : 0,
      amount24Usdt: typeof t.amount24 === "number" && !Number.isNaN(t.amount24) ? t.amount24 : 0,
      fundingRate: fundingRateNum(t),
      maxPositionUsdt: maxUsdt,
    });
  }

  return rows;
}

/**
 * Top N ตาม |basis| มากสุดก่อน — basis = (ราคา perp − ราคา spot) / spot × 100
 * ดึง spot แบบ batch ครั้งเดียว ไม่เรียก kline
 */
export async function getTopUsdtMarketsBySpotFutBasis(options: { limit?: number } = {}): Promise<SpotFutBasisRow[]> {
  const limit = options.limit ?? 10;
  const rows = await listAllSpotFutBasisRows();
  rows.sort((a, b) => {
    const d = b.absBasisPct - a.absBasisPct;
    if (d !== 0) return d;
    return b.amount24Usdt - a.amount24Usdt;
  });
  const top = rows.slice(0, limit);
  return enrichSpotFutBasisRowsWith24h(top);
}

/**
 * Top N สัญญา USDT perpetual ตาม amount24 มากสุดก่อน (กรอง liquidity เหมือน getTopUsdtMarkets)
 */
export async function getTopUsdtSymbolsByAmount24(limit: number): Promise<string[]> {
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

  const ranked = [...usdtPerp].sort((a, b) => (b.amount24 ?? 0) - (a.amount24 ?? 0));
  return ranked.slice(0, limit).map((t) => t.symbol!.trim());
}

/**
 * Top N สัญญา USDT ที่ผ่าน Vol filter — เรียง |funding| จาก ticker (ไม่เรียก kline)
 * ใช้ sample ประวัติ funding รายชั่วโมงให้สอดคล้องโหมด Funding บนหน้า Markets
 */
export async function getFundingHistorySampleRows(
  limit = 50
): Promise<Array<{ symbol: string; fundingRate: number }>> {
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
  const sorted = [...usdtPerp].sort((a, b) => {
    const diff = Math.abs(fundingRateNum(b)) - Math.abs(fundingRateNum(a));
    if (diff !== 0) return diff;
    return (b.amount24 ?? 0) - (a.amount24 ?? 0);
  });
  return sorted.slice(0, limit).map((t) => ({
    symbol: t.symbol!.trim(),
    fundingRate: fundingRateNum(t),
  }));
}

/** ดึง ticker สัญญาเดียว — checklist / basis รายคู่ */
export async function fetchContractTickerSingle(contractSymbol: string): Promise<MexcTickerRow | null> {
  const sym = contractSymbol.trim();
  if (!sym) return null;
  try {
    const { data } = await axios.get<MexcTickerResponse>(MEXC_TICKER, {
      params: { symbol: sym },
      timeout: 15_000,
    });
    if (!data.success || data.data === undefined) return null;
    const rows = asArray(data.data);
    const row = rows[0];
    if (!row?.symbol) return null;
    return row;
  } catch {
    return null;
  }
}

/** ราคา spot คู่เดียว เช่น BTCUSDT */
export async function fetchSpotPriceSingle(spotSymbol: string): Promise<number | null> {
  const sym = spotSymbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const { data } = await axios.get<MexcSpotPriceRow | MexcSpotPriceRow[]>(MEXC_SPOT_TICKER_PRICE, {
      params: { symbol: sym },
      timeout: 12_000,
    });
    const row = Array.isArray(data) ? data[0] : data;
    const p = Number(row?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * ปริมาณเทิร์นโอเวอร์ 24h ฝั่ง spot เป็นสกุล quote (USDT) — ใช้เทียบกับ perp amount24
 * ลอง quoteVolume ก่อน แล้วค่อย volume × lastPrice
 */
export async function fetchSpot24hrQuoteVolumeUsdt(spotSymbol: string): Promise<number | null> {
  const sym = spotSymbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const { data } = await axios.get<MexcSpot24hrRow>(MEXC_SPOT_TICKER_24HR, {
      params: { symbol: sym },
      timeout: 12_000,
    });
    const qv = Number(data?.quoteVolume);
    if (Number.isFinite(qv) && qv > 0) return qv;
    const vol = Number(data?.volume);
    const lp = Number(data?.lastPrice);
    if (Number.isFinite(vol) && vol > 0 && Number.isFinite(lp) && lp > 0) return vol * lp;
    return null;
  } catch {
    return null;
  }
}

/** 48 แท่ง × 1h ≈ ยอดสูงสุดในช่วง ~48 ชม. (ATH ในหน้าต่างนี้ ไม่ใช่ ATH ตลาดทั้งหมด) */
const NEAR_HIGH_KLINE_LIMIT = 48;

/** max(close) แท่ง 1h ย้อนหลัง ~48 ชม. — ใช้ ATH Guard (48h) */
export async function fetchPerpHourlyClosesForNearHigh(perpSymbol: string): Promise<{ maxClose: number } | null> {
  const k = await fetchContractKline60m(perpSymbol.trim(), NEAR_HIGH_KLINE_LIMIT);
  if (!k?.close.length) return null;
  const valid = k.close.filter((c) => typeof c === "number" && !Number.isNaN(c) && c > 0);
  if (valid.length === 0) return null;
  return { maxClose: Math.max(...valid) };
}

/**
 * ขนาดออเดอร์สูงสุดต่อครั้ง (สัญญา) จาก GET contract/detail — เทียบกับ risk tier / limitMaxVol / maxVol
 * เรียกดึงรายการสัญญาทั้งหมดแล้วกรองตาม symbol
 */
export async function fetchMaxOrderContractsForSymbol(contractSymbol: string): Promise<number | null> {
  const details = await fetchContractDetails();
  const sym = contractSymbol.trim();
  for (const d of details) {
    if (d.symbol?.trim() === sym) {
      return maxFromRiskTiers(d);
    }
  }
  return null;
}
