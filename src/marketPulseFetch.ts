import axios from "axios";

const TIMEOUT_MS = 14_000;

const FNG_URL = "https://api.alternative.me/fng/";
const COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global";
const CMC_PRO_BASE = "https://pro-api.coinmarketcap.com";

function cmcProApiKey(): string | undefined {
  const k = process.env.CMC_PRO_API_KEY?.trim();
  return k || undefined;
}

export type FearGreedSnapshot = {
  value: number;
  /** เช่น Extreme Fear, Greed — จาก API */
  valueClassification: string;
};

export type FearGreedAtTime = FearGreedSnapshot & {
  /** ms ของ reading ที่ใช้ (อาจก่อน alertedAt เล็กน้อย — F&G อัปเดตรายวัน) */
  asOfMs: number;
};

type FngHistoricalRow = {
  tsSec: number;
  value: number;
  valueClassification: string;
};

let altMeFngHistoricalCache: { fetchedAtMs: number; rows: FngHistoricalRow[] } | null = null;

const ALT_ME_FNG_CACHE_TTL_MS = 60 * 60_000;

export type GlobalMarketSnapshot = {
  btcDominancePct: number;
  totalVolumeUsd: number;
};

export class MarketPulseFetchError extends Error {
  constructor(
    message: string,
    public readonly source: "fng" | "coingecko" | "cmc",
  ) {
    super(message);
    this.name = "MarketPulseFetchError";
  }
}

type CmcStatus = { error_code?: number | string; error_message?: string | null };

/** CMC บางครั้งส่ง error_code เป็น string "0" — ต้องเทียบแบบเลขเท่านั้น */
function cmcErrorCodeNum(code: number | string | undefined | null): number | undefined {
  if (code === undefined || code === null) return undefined;
  const n = typeof code === "string" ? Number(code.trim()) : code;
  return Number.isFinite(n) ? n : undefined;
}

function throwIfCmcStatusBad(status: CmcStatus | undefined, ctx: string): void {
  if (status == null) return;
  const code = cmcErrorCodeNum(status.error_code);
  if (code !== undefined && code !== 0) {
    const msg = status.error_message?.trim() || `error_code ${code}`;
    throw new MarketPulseFetchError(`${ctx}: ${msg}`, "cmc");
  }
}

/**
 * เมื่อมี CMC_PRO_API_KEY — ใช้ดัชนี F&G + global metrics ของ CoinMarketCap (ตรงกับการ์ดบน coinmarketcap.com)
 * เมื่อไม่มี — ใช้ Alternative.me (F&G) + CoinGecko (BTC.D / Vol) แบบเดิม
 */
export function marketPulseUsesCoinMarketCap(): boolean {
  return Boolean(cmcProApiKey());
}

/** เมื่อ API ไม่ส่ง value_classification — ใกล้เคียงแบนของ CMC */
function fallbackCmcFngClassification(value: number): string {
  if (value >= 75) return "Extreme Greed";
  if (value >= 55) return "Greed";
  if (value >= 45) return "Neutral";
  if (value >= 25) return "Fear";
  return "Extreme Fear";
}

async function fetchCmcFearGreedLatest(): Promise<FearGreedSnapshot> {
  const key = cmcProApiKey();
  if (!key) {
    throw new MarketPulseFetchError("ไม่มี CMC_PRO_API_KEY", "cmc");
  }
  try {
    const { data } = await axios.get<{
      data?: { value?: number | string; value_classification?: string };
      status?: CmcStatus;
    }>(`${CMC_PRO_BASE}/v3/fear-and-greed/latest`, {
      timeout: TIMEOUT_MS,
      headers: { "X-CMC_PRO_API_KEY": key },
    });
    throwIfCmcStatusBad(data?.status, "CMC F&G");
    const row = data?.data;
    const v = row?.value != null ? Number(row.value) : Number.NaN;
    const clsRaw = String(row?.value_classification ?? "").trim();
    const cls = clsRaw || (Number.isFinite(v) ? fallbackCmcFngClassification(v) : "");
    if (!Number.isFinite(v) || v < 0 || v > 100 || !cls) {
      throw new MarketPulseFetchError("รูปแบบข้อมูล CMC F&G ไม่ถูกต้อง", "cmc");
    }
    return { value: v, valueClassification: cls };
  } catch (e) {
    if (e instanceof MarketPulseFetchError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new MarketPulseFetchError(`CMC F&G: ${msg}`, "cmc");
  }
}

async function fetchCmcGlobalMetricsLatest(): Promise<GlobalMarketSnapshot> {
  const key = cmcProApiKey();
  if (!key) {
    throw new MarketPulseFetchError("ไม่มี CMC_PRO_API_KEY", "cmc");
  }
  try {
    const { data } = await axios.get<{
      data?: {
        btc_dominance?: number;
        quote?: { USD?: { total_volume_24h?: number } };
      };
      status?: CmcStatus;
    }>(`${CMC_PRO_BASE}/v1/global-metrics/quotes/latest`, {
      timeout: TIMEOUT_MS,
      headers: { "X-CMC_PRO_API_KEY": key },
    });
    throwIfCmcStatusBad(data?.status, "CMC global");
    const d = data?.data;
    const btc = d?.btc_dominance;
    const vol = d?.quote?.USD?.total_volume_24h;
    if (typeof btc !== "number" || Number.isNaN(btc) || btc <= 0) {
      throw new MarketPulseFetchError("ไม่มี btc_dominance", "cmc");
    }
    if (typeof vol !== "number" || Number.isNaN(vol) || vol <= 0) {
      throw new MarketPulseFetchError("ไม่มี quote.USD.total_volume_24h", "cmc");
    }
    return { btcDominancePct: btc, totalVolumeUsd: vol };
  } catch (e) {
    if (e instanceof MarketPulseFetchError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new MarketPulseFetchError(`CMC global: ${msg}`, "cmc");
  }
}

/**
 * Fear & Greed Index — ค่า 0–100
 */
export async function fetchFearGreedLatest(): Promise<FearGreedSnapshot> {
  try {
    const { data } = await axios.get<{
      data?: Array<{ value?: string; value_classification?: string }>;
    }>(FNG_URL, {
      timeout: TIMEOUT_MS,
      params: { limit: 1 },
    });
    const row = data?.data?.[0];
    const v = row?.value != null ? Number(row.value) : Number.NaN;
    const cls = row?.value_classification?.trim() || "";
    if (!Number.isFinite(v) || v < 0 || v > 100 || !cls) {
      throw new MarketPulseFetchError("รูปแบบข้อมูล F&G ไม่ถูกต้อง", "fng");
    }
    return { value: v, valueClassification: cls };
  } catch (e) {
    if (e instanceof MarketPulseFetchError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new MarketPulseFetchError(`F&G: ${msg}`, "fng");
  }
}

async function loadAltMeFngHistoricalRows(): Promise<FngHistoricalRow[]> {
  const now = Date.now();
  if (altMeFngHistoricalCache && now - altMeFngHistoricalCache.fetchedAtMs < ALT_ME_FNG_CACHE_TTL_MS) {
    return altMeFngHistoricalCache.rows;
  }
  const { data } = await axios.get<{
    data?: Array<{ value?: string; value_classification?: string; timestamp?: string }>;
  }>(FNG_URL, {
    timeout: TIMEOUT_MS,
    params: { limit: 0 },
  });
  const rows: FngHistoricalRow[] = [];
  for (const row of data?.data ?? []) {
    const tsSec = row.timestamp != null ? Number(row.timestamp) : Number.NaN;
    const v = row.value != null ? Number(row.value) : Number.NaN;
    const cls = row.value_classification?.trim() || "";
    if (!Number.isFinite(tsSec) || tsSec <= 0) continue;
    if (!Number.isFinite(v) || v < 0 || v > 100 || !cls) continue;
    rows.push({ tsSec: Math.floor(tsSec), value: v, valueClassification: cls });
  }
  if (rows.length === 0) {
    throw new MarketPulseFetchError("ไม่มีข้อมูล F&G historical (Alternative.me)", "fng");
  }
  altMeFngHistoricalCache = { fetchedAtMs: now, rows };
  return rows;
}

function pickAltMeFngAtSec(rows: FngHistoricalRow[], atSec: number): FngHistoricalRow | null {
  if (rows.length === 0) return null;
  for (const row of rows) {
    if (row.tsSec <= atSec) return row;
  }
  return rows[rows.length - 1] ?? null;
}

async function fetchCmcFearGreedAtTime(atMs: number): Promise<FearGreedAtTime> {
  const key = cmcProApiKey();
  if (!key) {
    throw new MarketPulseFetchError("ไม่มี CMC_PRO_API_KEY", "cmc");
  }
  const daysAgo = Math.ceil((Date.now() - atMs) / (24 * 3600_000)) + 3;
  const limit = Math.min(500, Math.max(30, daysAgo + 5));
  const { data } = await axios.get<{
    data?: Array<{ timestamp?: string; value?: number | string; value_classification?: string }>;
    status?: CmcStatus;
  }>(`${CMC_PRO_BASE}/v3/fear-and-greed/historical`, {
    timeout: TIMEOUT_MS,
    headers: { "X-CMC_PRO_API_KEY": key },
    params: { limit },
  });
  throwIfCmcStatusBad(data?.status, "CMC F&G historical");
  const atSec = Math.floor(atMs / 1000);
  let best: { tsSec: number; value: number; valueClassification: string } | null = null;
  for (const row of data?.data ?? []) {
    const tsMs = row.timestamp ? Date.parse(row.timestamp) : Number.NaN;
    if (!Number.isFinite(tsMs)) continue;
    const tsSec = Math.floor(tsMs / 1000);
    const v = row.value != null ? Number(row.value) : Number.NaN;
    const clsRaw = String(row.value_classification ?? "").trim();
    const cls = clsRaw || (Number.isFinite(v) ? fallbackCmcFngClassification(v) : "");
    if (!Number.isFinite(v) || v < 0 || v > 100 || !cls) continue;
    if (tsSec > atSec) continue;
    if (!best || tsSec > best.tsSec) {
      best = { tsSec, value: v, valueClassification: cls };
    }
  }
  if (!best) {
    throw new MarketPulseFetchError("ไม่พบ CMC F&G ณ เวลาที่ขอ", "cmc");
  }
  return { value: best.value, valueClassification: best.valueClassification, asOfMs: best.tsSec * 1000 };
}

async function fetchAltMeFearGreedAtTime(atMs: number): Promise<FearGreedAtTime> {
  const rows = await loadAltMeFngHistoricalRows();
  const picked = pickAltMeFngAtSec(rows, Math.floor(atMs / 1000));
  if (!picked) {
    throw new MarketPulseFetchError("ไม่พบ F&G ณ เวลาที่ขอ", "fng");
  }
  return {
    value: picked.value,
    valueClassification: picked.valueClassification,
    asOfMs: picked.tsSec * 1000,
  };
}

/**
 * F&G ณ เวลาแจ้ง (ย้อนหลังได้) — CMC historical ถ้ามี key · ไม่งั้น Alternative.me
 */
export async function fetchFearGreedAtTime(atMs: number): Promise<FearGreedAtTime> {
  if (!Number.isFinite(atMs) || atMs <= 0) {
    throw new MarketPulseFetchError("เวลาไม่ถูกต้อง", "fng");
  }
  if (marketPulseUsesCoinMarketCap()) {
    try {
      return await fetchCmcFearGreedAtTime(atMs);
    } catch (e) {
      console.warn("[marketPulseFetch] CMC historical F&G failed, fallback Alternative.me", e);
    }
  }
  return fetchAltMeFearGreedAtTime(atMs);
}

/**
 * BTC dominance + ปริมาณซื้อขายรวม (USD) จาก CoinGecko global
 */
export async function fetchCoinGeckoGlobal(): Promise<GlobalMarketSnapshot> {
  try {
    const { data } = await axios.get<{
      data?: {
        market_cap_percentage?: { btc?: number };
        total_volume?: { usd?: number };
      };
    }>(COINGECKO_GLOBAL, { timeout: TIMEOUT_MS });
    const btc = data?.data?.market_cap_percentage?.btc;
    const vol = data?.data?.total_volume?.usd;
    if (typeof btc !== "number" || Number.isNaN(btc) || btc <= 0) {
      throw new MarketPulseFetchError("ไม่มี market_cap_percentage.btc", "coingecko");
    }
    if (typeof vol !== "number" || Number.isNaN(vol) || vol <= 0) {
      throw new MarketPulseFetchError("ไม่มี total_volume.usd", "coingecko");
    }
    return { btcDominancePct: btc, totalVolumeUsd: vol };
  } catch (e) {
    if (e instanceof MarketPulseFetchError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new MarketPulseFetchError(`CoinGecko: ${msg}`, "coingecko");
  }
}

export async function fetchMarketPulseData(): Promise<{
  fng: FearGreedSnapshot;
  global: GlobalMarketSnapshot;
}> {
  if (marketPulseUsesCoinMarketCap()) {
    const [fng, global] = await Promise.all([fetchCmcFearGreedLatest(), fetchCmcGlobalMetricsLatest()]);
    return { fng, global };
  }
  const [fng, global] = await Promise.all([fetchFearGreedLatest(), fetchCoinGeckoGlobal()]);
  return { fng, global };
}
