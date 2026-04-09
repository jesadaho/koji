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

/** TF สำหรับ indicator alerts */
export type IndicatorChartTf = "1h" | "4h";

const BAR_COUNT = 100;

const INTERVAL: Record<IndicatorChartTf, string> = {
  "1h": "Min60",
  "4h": "Min240",
};

const LOOKBACK_SEC: Record<IndicatorChartTf, number> = {
  "1h": BAR_COUNT * 3600 + 7200,
  "4h": BAR_COUNT * 4 * 3600 + 7200,
};

function parseKline(raw: KlineApiResponse["data"]): IndicatorKlinePack | null {
  if (!raw?.close?.length || !raw.time?.length) return null;
  const n = raw.close.length;
  if (raw.time.length !== n) return null;
  return {
    close: raw.close.map((c) => Number(c)),
    timeSec: raw.time.map((t) => Number(t)),
  };
}

export async function fetchContractKlineForTf(
  symbol: string,
  tf: IndicatorChartTf
): Promise<IndicatorKlinePack | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - LOOKBACK_SEC[tf];
  try {
    const { data } = await axios.get<KlineApiResponse>(`${KLINE_URL}/${encodeURIComponent(symbol)}`, {
      timeout: 20_000,
      params: { interval: INTERVAL[tf], start, end },
    });
    if (!data.success || !data.data) return null;
    return parseKline(data.data);
  } catch {
    return null;
  }
}

/** ความเข้ากันได้ย้อนหลัง — RSI 1h */
export async function fetchContractKline1h(symbol: string): Promise<IndicatorKlinePack | null> {
  return fetchContractKlineForTf(symbol, "1h");
}
