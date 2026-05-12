import {
  fetchContractKlineOHLCV,
  type ContractKlineArrays,
  type MexcContractKlineInterval,
} from "./mexcMarkets";

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

/** ปิดเป็นค่าเริ่ม — ตั้ง SPARK_KLINE_CONFIRM_ENABLED=1 เพื่อกรองด้วยแท่ง kline + vol */
export function sparkKlineConfirmEnabled(): boolean {
  return envFlagOn("SPARK_KLINE_CONFIRM_ENABLED", false);
}

function sparkKlineConfirmFailOpen(): boolean {
  return envFlagOn("SPARK_KLINE_CONFIRM_FAIL_OPEN", false);
}

function sparkKlineConfirmInterval(): MexcContractKlineInterval {
  const raw = process.env.SPARK_KLINE_CONFIRM_INTERVAL?.trim();
  if (raw === "Hour4" || raw === "Min60" || raw === "Min15") return raw;
  return "Min15";
}

function sparkKlineConfirmBars(): number {
  const n = Number(process.env.SPARK_KLINE_CONFIRM_BARS?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.floor(n) : 2;
}

function sparkKlineConfirmBaselineBars(): number {
  const n = Number(process.env.SPARK_KLINE_CONFIRM_BASELINE_BARS?.trim());
  return Number.isFinite(n) && n >= 3 && n <= 80 ? Math.floor(n) : 20;
}

function sparkKlineConfirmMinVolRatio(): number {
  const n = Number(process.env.SPARK_KLINE_CONFIRM_MIN_VOL_RATIO?.trim());
  return Number.isFinite(n) && n > 0 ? n : 1.0;
}

function medianNonNeg(nums: number[]): number | null {
  const a = nums.filter((x) => Number.isFinite(x) && x >= 0).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

const MIN_BASELINE_SAMPLES = 3;

/**
 * ตรวจจาก OHLCV ดิบ (เก่า→ใหม่) — แท่งปิดล่าสุดที่ index n-2, ก่อนหน้า n-3, … รวม nBars แท่ง
 */
export function evaluateSparkKlineConfirmFromOHLCV(
  k: ContractKlineArrays,
  returnPct: number,
  nBars: number,
  baselineBars: number,
  minVolRatio: number
): boolean {
  const { open, close, vol } = k;
  const n = close.length;
  if (nBars < 1 || n < nBars + 2) return false;

  const lastClosed = n - 2;
  const firstStreak = lastClosed - (nBars - 1);
  if (firstStreak < 0) return false;

  const baselineStart = Math.max(0, firstStreak - baselineBars);
  const baselineEnd = firstStreak - 1;
  if (baselineEnd < baselineStart) return false;

  const baselineVols = vol.slice(baselineStart, baselineEnd + 1);
  if (baselineVols.length < MIN_BASELINE_SAMPLES) return false;

  const med = medianNonNeg(baselineVols);
  if (med == null || med <= 0) return false;
  const threshold = med * minVolRatio;

  const wantLong = returnPct > 0;

  for (let i = firstStreak; i <= lastClosed; i++) {
    const o = open[i];
    const c = close[i];
    const v = vol[i];
    if (!Number.isFinite(o) || o <= 0 || !Number.isFinite(c) || Number.isNaN(c) || !Number.isFinite(v) || v < 0) {
      return false;
    }
    if (wantLong) {
      if (c <= o) return false;
    } else {
      if (c >= o) return false;
    }
    if (v < threshold) return false;
  }
  return true;
}

/**
 * ดึง kline MEXC แล้วตรวจแท่งปิด + volume — ดึงไม่ได้หรือข้อมูลไม่พอ: conservative = false, fail-open = true
 */
export async function passesSparkKlineConfirm(contractSymbol: string, returnPct: number): Promise<boolean> {
  const interval = sparkKlineConfirmInterval();
  const nBars = sparkKlineConfirmBars();
  const baselineBars = sparkKlineConfirmBaselineBars();
  const minVolRatio = sparkKlineConfirmMinVolRatio();
  const limit = Math.min(100, Math.max(12, baselineBars + nBars + 6));

  const k = await fetchContractKlineOHLCV(contractSymbol, interval, limit);
  if (!k) {
    return sparkKlineConfirmFailOpen();
  }
  const ok = evaluateSparkKlineConfirmFromOHLCV(k, returnPct, nBars, baselineBars, minVolRatio);
  if (!ok && process.env.SPARK_KLINE_CONFIRM_DEBUG?.trim() === "1") {
    console.warn("[sparkKlineConfirm] rejected", contractSymbol, { returnPct: returnPct.toFixed(2), interval });
  }
  return ok;
}
