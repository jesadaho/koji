import axios from "axios";

const MEXC_TICKER = "https://api.mexc.com/api/v1/contract/ticker";
const MEXC_DETAIL = "https://api.mexc.com/api/v1/contract/detail";

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
  /** สูงสุดจาก risk tiers (สัญญา) — ไม่มีจะเป็น null */
  maxPositionContracts: number | null;
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

/**
 * Top USDT perpetual ตามมูลค่าเทิร์นโอเวอร์ 24h (amount24)
 */
export async function getTopUsdtMarketsByAmount24(limit = 25): Promise<TopMarketRow[]> {
  const [tickers, details] = await Promise.all([fetchContractTickers(), fetchContractDetails()]);

  const detailBySymbol = new Map<string, MexcDetailRow>();
  for (const d of details) {
    if (d.symbol) detailBySymbol.set(d.symbol, d);
  }

  const usdtPerp = tickers.filter((t) => {
    const sym = t.symbol?.trim();
    if (!sym || !sym.endsWith("_USDT")) return false;
    const amt = t.amount24;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt <= 0) return false;
    const price = t.lastPrice;
    if (typeof price !== "number" || Number.isNaN(price) || price <= 0) return false;
    const d = detailBySymbol.get(sym);
    if (d && typeof d.state === "number" && d.state !== 0) return false;
    return true;
  });

  usdtPerp.sort((a, b) => (b.amount24 ?? 0) - (a.amount24 ?? 0));

  const top = usdtPerp.slice(0, limit);

  return top.map((t) => {
    const sym = t.symbol!;
    const detail = detailBySymbol.get(sym);
    const r = t.riseFallRate;
    const changePct = typeof r === "number" && !Number.isNaN(r) ? r * 100 : 0;
    const fr = t.fundingRate;
    const funding = typeof fr === "number" && !Number.isNaN(fr) ? fr : 0;

    return {
      symbol: sym,
      lastPrice: t.lastPrice!,
      change24hPercent: changePct,
      volume24: typeof t.volume24 === "number" && !Number.isNaN(t.volume24) ? t.volume24 : 0,
      amount24Usdt: t.amount24!,
      fundingRate: funding,
      maxPositionContracts: detail ? maxFromRiskTiers(detail) : null,
    };
  });
}
