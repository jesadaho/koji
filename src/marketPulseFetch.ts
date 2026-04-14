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

type CmcStatus = { error_code?: number; error_message?: string };

function throwIfCmcStatusBad(status: CmcStatus | undefined, ctx: string): void {
  if (status == null) return;
  const code = status.error_code;
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
    const cls = String(row?.value_classification ?? "").trim();
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
