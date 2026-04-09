import axios from "axios";
import type { VolumeSignalTimeframe } from "./volumeSignalAlertsStore";

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

const MIN_BASELINE_BARS = 12;

/** สอดคล้อง momentum บนหน้า Markets: score = w_v·(V/Vavg)·(w_p·ΔP/P), w_v=w_p=1 */
const MOMENTUM_W_V = 1;
const MOMENTUM_W_P = 1;

const INTERVAL: Record<VolumeSignalTimeframe, string> = {
  "1h": "Min60",
  "4h": "Min240",
};

const LOOKBACK_SEC: Record<VolumeSignalTimeframe, number> = {
  "1h": 80 * 3600,
  "4h": 40 * 24 * 3600,
};

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
 * แท่ง index n-2 = แท่งที่ปิดล่าสุด
 * momentumScore = w_v·volRatio·(w_p·ret) โดย ret เป็นทศนิยม (สอดคล้อง mexcMarkets computeMomentum15m)
 */
export function computeVolumeSpikeRatio(k: KlineArrays): {
  volRatio: number;
  returnPct: number;
  momentumScore: number;
} | null {
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
  const momentumScore = MOMENTUM_W_V * volRatio * (MOMENTUM_W_P * ret);
  return { volRatio, returnPct: ret * 100, momentumScore };
}

export async function fetchContractKlineVolumeSignal(
  symbol: string,
  timeframe: VolumeSignalTimeframe
): Promise<KlineArrays | null> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - LOOKBACK_SEC[timeframe];
  const url = `https://api.mexc.com/api/v1/contract/kline/${encodeURIComponent(symbol)}`;
  try {
    const { data } = await axios.get<KlineApiResponse>(url, {
      timeout: 15_000,
      params: { interval: INTERVAL[timeframe], start, end },
    });
    if (!data.success || !data.data) return null;
    return parseKlineArrays(data.data);
  } catch {
    return null;
  }
}
