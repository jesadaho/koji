import axios from "axios";

const MEXC_DETAIL = "https://api.mexc.com/api/v1/contract/detail";
const MEXC_FUNDING = "https://api.mexc.com/api/v1/contract/funding_rate";

type MexcDetailResponse = {
  success: boolean;
  code: number;
  data?: MexcDetailRow | MexcDetailRow[];
};

export type MexcDetailRow = {
  symbol?: string;
  state?: number;
  minVol?: number;
  maxVol?: number;
  limitMaxVol?: number;
};

type MexcFundingResponse = {
  success: boolean;
  code: number;
  data?: {
    symbol?: string;
    fundingRate?: number;
    maxFundingRate?: number;
    minFundingRate?: number;
    collectCycle?: number;
    nextSettleTime?: number;
    timestamp?: number;
  };
};

function asArray<T>(data: T | T[] | undefined): T[] {
  if (data === undefined) return [];
  return Array.isArray(data) ? data : [data];
}

export async function fetchAllContractDetails(): Promise<Map<string, MexcDetailRow>> {
  const { data } = await axios.get<MexcDetailResponse>(MEXC_DETAIL, { timeout: 60_000 });
  if (!data.success || data.data === undefined) return new Map();
  const rows = asArray(data.data);
  const map = new Map<string, MexcDetailRow>();
  for (const r of rows) {
    if (r.symbol) map.set(r.symbol.trim(), r);
  }
  return map;
}

export type FundingMeta = {
  fundingRate: number;
  collectCycle: number;
  nextSettleTime: number;
};

export async function fetchContractFunding(symbol: string): Promise<FundingMeta | null> {
  const url = `${MEXC_FUNDING}/${encodeURIComponent(symbol)}`;
  try {
    const { data } = await axios.get<MexcFundingResponse>(url, { timeout: 15_000 });
    if (!data.success || !data.data) return null;
    const d = data.data;
    const fr = typeof d.fundingRate === "number" && !Number.isNaN(d.fundingRate) ? d.fundingRate : 0;
    const cc = typeof d.collectCycle === "number" && !Number.isNaN(d.collectCycle) ? d.collectCycle : 0;
    const ns = typeof d.nextSettleTime === "number" && !Number.isNaN(d.nextSettleTime) ? d.nextSettleTime : 0;
    return { fundingRate: fr, collectCycle: cc, nextSettleTime: ns };
  } catch {
    return null;
  }
}

export function orderMetaFromDetail(d: MexcDetailRow | undefined): {
  minVol: number;
  maxVol: number;
  limitMaxVol: number | null;
} | null {
  if (!d) return null;
  const minV = d.minVol;
  const maxV = d.maxVol;
  if (typeof minV !== "number" || Number.isNaN(minV) || typeof maxV !== "number" || Number.isNaN(maxV)) {
    return null;
  }
  const lim = d.limitMaxVol;
  const limitMaxVol =
    typeof lim === "number" && !Number.isNaN(lim) ? lim : null;
  return { minVol: minV, maxVol: maxV, limitMaxVol };
}
