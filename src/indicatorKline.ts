import axios from "axios";

const KLINE_URL = "https://api.mexc.com/api/v1/contract/kline";

type KlineApiResponse = {
  success: boolean;
  code: number;
  data?: {
    open?: number[];
    close?: number[];
    time?: number[];
  };
};

export type IndicatorKlinePack = {
  close: number[];
  /** Unix sec — เปิดแท่ง ให้ตรงกับ index ของ close */
  timeSec: number[];
};

/** ~100 แท่ง 1h + buffer */
const BAR_COUNT = 100;
const LOOKBACK_SEC = BAR_COUNT * 3600 + 7200;

function parseKline(raw: KlineApiResponse["data"]): IndicatorKlinePack | null {
  if (!raw?.close?.length || !raw.time?.length) return null;
  const n = raw.close.length;
  if (raw.time.length !== n) return null;
  return {
    close: raw.close.map((c) => Number(c)),
    timeSec: raw.time.map((t) => Number(t)),
  };
}

/** TF 1h เท่านั้น (Phase 1.5) */
export async function fetchContractKline1h(symbol: string): Promise<IndicatorKlinePack | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - LOOKBACK_SEC;
  try {
    const { data } = await axios.get<KlineApiResponse>(`${KLINE_URL}/${encodeURIComponent(symbol)}`, {
      timeout: 20_000,
      params: { interval: "Min60", start, end },
    });
    if (!data.success || !data.data) return null;
    return parseKline(data.data);
  } catch {
    return null;
  }
}
