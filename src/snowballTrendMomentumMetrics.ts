import { fetchBinanceUsdmKlines, type BinanceKlinePack } from "./binanceIndicatorKline";

const SNOWBALL_TREND_1H_BARS = 120;
const ONE_HOUR_SEC = 3600;

/** โมเมนตัมเทรนด์ระยะสั้นจาก 3 แท่ง 1H ปิดล่าสุด */
export type TrendMomentumMetrics = {
  isLowDrawback: boolean;
  isVolumeCascading: boolean;
  maxDrawbackPercent: number;
  /** จำนวนแท่ง 1H ที่ใช้คำนวณ (ปกติ 3) */
  candleCount: number;
};

export type TrendMomentumMetricsOpts = {
  /** Unix sec — ใช้ 3 แท่ง 1H ปิดล่าสุดที่ปิดไม่เกินเวลานี้ (ห้ามใช้แท่งอนาคต) */
  asOfSec?: number;
};

function envMaxDrawbackPct(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TREND_MOMENTUM_MAX_DRAWBACK_PCT?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
  return 30;
}

export function snowballTrendMomentumMaxDrawbackPct(): number {
  return envMaxDrawbackPct();
}

/** Grade B ต้องผ่านแรงซื้อหนุนต่อเนื่อง (low drawback + volume cascade) ถึงจะแจ้ง */
export function snowballGradeBRequiresSustainedMomentum(): boolean {
  const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_GRADE_B_REQUIRES_SUSTAINED_MOMENTUM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

/** Auto-open Grade B เมื่อ sustained momentum (ต้องเปิด Double Barrier) */
export function snowballGradeBAutoOpenSustainedEnabled(): boolean {
  const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_GRADE_B_AUTO_OPEN_SUSTAINED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

export function snowballGradeBSustainedMarginScale(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_GRADE_B_SUSTAINED_MARGIN_SCALE?.trim());
  if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  return 0.5;
}

/** แรงซื้อหนุนต่อเนื่อง — drawback ต่ำ + vol เรียงตัวขึ้น */
export function isSustainedBuyingPressure(metrics: TrendMomentumMetrics | null | undefined): boolean {
  if (!metrics) return false;
  return metrics.isLowDrawback && metrics.isVolumeCascading;
}

export function isStrongTrendMomentum(metrics: TrendMomentumMetrics | null | undefined): boolean {
  return isSustainedBuyingPressure(metrics);
}

export function isHighQualityAccumulation(metrics: TrendMomentumMetrics | null | undefined): boolean {
  return isSustainedBuyingPressure(metrics);
}

/** ดึงแท่ง 1H สำหรับ DD 1H% / Vol↗ — ต้องใช้ TF 1H เท่านั้น (ห้ามส่ง pack 15m) */
export async function fetchSnowball1hPackForTrendMomentum(
  symbol: string
): Promise<BinanceKlinePack | null> {
  try {
    return await fetchBinanceUsdmKlines(symbol.trim().toUpperCase(), "1h", SNOWBALL_TREND_1H_BARS);
  } catch (e) {
    console.error("[snowballTrendMomentum] fetch 1h", symbol, e);
    return null;
  }
}

function isGreenBar(open: number, close: number): boolean {
  return Number.isFinite(open) && Number.isFinite(close) && close > open;
}

function isRedBar(open: number, close: number): boolean {
  return Number.isFinite(open) && Number.isFinite(close) && close < open;
}

/** 3 แท่ง 1H ปิดล่าสุด ณ asOfSec (หรือก่อนแท่งกำลังก่อตัวถ้าไม่ระบุเวลา) */
export function resolveClosed1hWindowIndices(
  pack: BinanceKlinePack,
  asOfSec?: number
): { iStart: number; iEnd: number } | null {
  const n = pack.close.length;
  if (n < 4) return null;

  let iEnd: number;
  if (asOfSec != null && Number.isFinite(asOfSec)) {
    iEnd = -1;
    for (let i = 0; i < n; i++) {
      const barCloseSec = pack.timeSec[i]! + ONE_HOUR_SEC;
      if (barCloseSec <= asOfSec) iEnd = i;
    }
    if (iEnd < 2) return null;
  } else {
    iEnd = n - 2;
    if (iEnd < 2) return null;
  }

  const iStart = iEnd - 2;
  if (iStart < 0) return null;
  return { iStart, iEnd };
}

/**
 * True Drawback 1H% — เฉพาะเนื้อแดงย่อสวนหลังแท่งเขียว (Actual Counter-Trend Retracement)
 * ถ้า 3 แท่งเป็นเขียวล้วน → 0%
 */
export function calculateTrueDrawback1hPercent(
  open: number[],
  close: number[],
  iStart: number,
  iEnd: number
): number {
  let allGreen = true;
  for (let i = iStart; i <= iEnd; i++) {
    if (!isGreenBar(open[i]!, close[i]!)) {
      allGreen = false;
      break;
    }
  }
  if (allGreen) return 0;

  let maxDrawbackPercent = 0;
  for (let i = iStart + 1; i <= iEnd; i++) {
    const o0 = open[i - 1]!;
    const c0 = close[i - 1]!;
    const o1 = open[i]!;
    const c1 = close[i]!;

    if (isGreenBar(o0, c0) && isRedBar(o1, c1)) {
      const greenBodyHeight = c0 - o0;
      const redBodyHeight = o1 - c1;
      if (greenBodyHeight > 0) {
        const currentDd = (redBodyHeight / greenBodyHeight) * 100;
        if (currentDd > maxDrawbackPercent) maxDrawbackPercent = currentDd;
      }
    }
  }

  return parseFloat(maxDrawbackPercent.toFixed(2));
}

/**
 * คำนวณ True Drawback 1H% และ Volume Cascade จาก 3 แท่ง 1H ปิดล่าสุด ณ เวลาอ้างอิง
 * (เทียบเท่า slice(-4, -1) เมื่อไม่ระบุ asOfSec)
 */
export function calculateTrendMomentumMetrics(
  pack1h: BinanceKlinePack | null,
  opts?: TrendMomentumMetricsOpts
): TrendMomentumMetrics | null {
  if (!pack1h?.close?.length) return null;
  const { open, close, volume } = pack1h;

  const window = resolveClosed1hWindowIndices(pack1h, opts?.asOfSec);
  if (!window) return null;
  const { iStart, iEnd } = window;

  let isVolumeCascading = true;
  for (let i = iStart + 1; i <= iEnd; i++) {
    const v0 = volume[i - 1]!;
    const v1 = volume[i]!;
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;
    if (v1 <= v0) isVolumeCascading = false;
  }

  for (let i = iStart; i <= iEnd; i++) {
    const o = open[i]!;
    const c = close[i]!;
    if (!Number.isFinite(o) || !Number.isFinite(c)) return null;
  }

  const maxDrawbackPercent = calculateTrueDrawback1hPercent(open, close, iStart, iEnd);
  const threshold = envMaxDrawbackPct();
  return {
    isLowDrawback: maxDrawbackPercent <= threshold,
    isVolumeCascading,
    maxDrawbackPercent,
    candleCount: iEnd - iStart + 1,
  };
}

export function trendMomentumStatsFields(metrics: TrendMomentumMetrics | null): {
  maxDrawback1hPct: number | null;
  volumeCascadeYn: "Y" | "N" | null;
} {
  if (!metrics) return { maxDrawback1hPct: null, volumeCascadeYn: null };
  return {
    maxDrawback1hPct: metrics.maxDrawbackPercent,
    volumeCascadeYn: metrics.isVolumeCascading ? "Y" : "N",
  };
}

export function formatTrendMomentumMetricsLine(metrics: TrendMomentumMetrics | null): string {
  if (!metrics) return "📎 Trend momentum (1H): ข้อมูล 1H ไม่พอ (ต้อง ≥3 แท่งปิด)";
  const sustained = isSustainedBuyingPressure(metrics);
  return [
    "📎 Trend momentum (1H · 3 แท่งปิด):",
    `  • True drawback (เขียว→แดง): ${metrics.maxDrawbackPercent.toFixed(2)}% (≤${snowballTrendMomentumMaxDrawbackPct()}% = ${metrics.isLowDrawback ? "✓" : "—"})`,
    `  • Volume cascade: ${metrics.isVolumeCascading ? "✓ เรียงตัวขึ้น" : "— ไม่เรียง"}`,
    `  • Sustained buying pressure: ${sustained ? "✓" : "—"}`,
  ].join("\n");
}
