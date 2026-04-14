import axios from "axios";

const TIMEOUT_MS = 14_000;

const FNG_URL = "https://api.alternative.me/fng/";
const COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global";

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
    public readonly source: "fng" | "coingecko",
  ) {
    super(message);
    this.name = "MarketPulseFetchError";
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
  const [fng, global] = await Promise.all([fetchFearGreedLatest(), fetchCoinGeckoGlobal()]);
  return { fng, global };
}
