import { fetchBinanceUsdmKlines, type BinanceKlinePack } from "./binanceIndicatorKline";

const SNOWBALL_TREND_1H_BARS = 120;
const ONE_HOUR_SEC = 3600;
/** จำนวนแท่ง 1H ปิดที่ใช้คำนวณ DD 1H% / Vol↗ (เทียบเท่า slice(-9, -1)) */
export const SNOWBALL_TREND_1H_LOOKBACK = 8;

export type TrendMomentumMetrics = {
  isLowDrawback: boolean;
  isVolumeCascading: boolean;
  maxDrawbackPercent: number;
  /** จำนวนแท่ง 1H ที่ใช้คำนวณ (ปกติ 8) */
  candleCount: number;
  /** จำนวนครั้งที่ vol ไม่ยกฐานใน lookback */
  volumeDropCount: number;
};

export type TrendMomentumMetricsOpts = {
  /** Unix sec — ใช้ 8 แท่ง 1H ปิดล่าสุดที่ปิดไม่เกินเวลานี้ (ห้ามใช้แท่งอนาคต) */
  asOfSec?: number;
};

function envMaxDrawbackPct(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TREND_MOMENTUM_MAX_DRAWBACK_PCT?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
  return 30;
}

/** ยอมให้ vol ไม่ยกฐานได้กี่ครั้งใน lookback (ดีฟอลต์ 1) */
function envMaxVolumeDrops(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TREND_MOMENTUM_MAX_VOL_DROPS?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= SNOWBALL_TREND_1H_LOOKBACK) return Math.floor(v);
  return 1;
}

export function snowballTrendMomentumMaxVolumeDrops(): number {
  return envMaxVolumeDrops();
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

/** 8 แท่ง 1H ปิดล่าสุด ณ asOfSec (หรือ slice(-9,-1) เมื่อไม่ระบุเวลา) */
export function resolveClosed1hWindowIndices(
  pack: BinanceKlinePack,
  asOfSec?: number,
  lookback = SNOWBALL_TREND_1H_LOOKBACK
): { iStart: number; iEnd: number } | null {
  const n = pack.close.length;
  const minEnd = lookback - 1;
  if (n < lookback + 1) return null;

  let iEnd: number;
  if (asOfSec != null && Number.isFinite(asOfSec)) {
    iEnd = -1;
    for (let i = 0; i < n; i++) {
      const barCloseSec = pack.timeSec[i]! + ONE_HOUR_SEC;
      if (barCloseSec <= asOfSec) iEnd = i;
    }
    if (iEnd < minEnd) return null;
  } else {
    iEnd = n - 2;
    if (iEnd < minEnd) return null;
  }

  const iStart = iEnd - (lookback - 1);
  if (iStart < 0) return null;
  return { iStart, iEnd };
}

/**
 * Flexible Drawback 1H% — ไส้บนแท่งเขียว + ไส้ล่างสะบัดเทียบเนื้อแท่งเขียวก่อนหน้า
 * (8 แท่งปิดล่าสุดก่อนสัญญาณ)
 */
export function calculateFlexibleDrawback1hPercent(
  open: number[],
  high: number[],
  low: number[],
  close: number[],
  iStart: number,
  iEnd: number
): number {
  let maxDrawbackPercent = 0;

  for (let i = iStart; i <= iEnd; i++) {
    const o = open[i]!;
    const h = high[i]!;
    const l = low[i]!;
    const c = close[i]!;
    if (![o, h, l, c].every(Number.isFinite)) continue;

    const currentRange = h - l;
    if (currentRange <= 0) continue;

    if (c > o) {
      const upperWick = h - c;
      const upperDd = (upperWick / currentRange) * 100;
      if (upperDd > maxDrawbackPercent) maxDrawbackPercent = upperDd;
    }

    if (i > iStart) {
      const prevO = open[i - 1]!;
      const prevC = close[i - 1]!;
      const prevBody = prevC - prevO;
      if (prevBody > 0 && l < o) {
        const lowerWick = o - l;
        const lowerDd = (lowerWick / prevBody) * 100;
        if (lowerDd > maxDrawbackPercent) maxDrawbackPercent = lowerDd;
      }
    }
  }

  return parseFloat(maxDrawbackPercent.toFixed(2));
}

/** @deprecated ใช้ calculateFlexibleDrawback1hPercent — คง export เพื่อ backward compat */
export function calculateTrueDrawback1hPercent(
  open: number[],
  close: number[],
  iStart: number,
  iEnd: number,
  high?: number[],
  low?: number[]
): number {
  if (high?.length && low?.length) {
    return calculateFlexibleDrawback1hPercent(open, high, low, close, iStart, iEnd);
  }
  return calculateFlexibleDrawback1hPercent(
    open,
    open.map((_, i) => Math.max(open[i]!, close[i]!)),
    open.map((_, i) => Math.min(open[i]!, close[i]!)),
    close,
    iStart,
    iEnd
  );
}

function countVolumeDrops(volume: number[], iStart: number, iEnd: number): number | null {
  let volDropCount = 0;
  for (let i = iStart + 1; i <= iEnd; i++) {
    const v0 = volume[i - 1]!;
    const v1 = volume[i]!;
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;
    if (v1 <= v0) volDropCount++;
  }
  return volDropCount;
}

/**
 * DD 1H% + Vol↗ จาก 8 แท่ง 1H ปิดล่าสุด — vol ยอมสะดุดได้ ≤1 ครั้ง (env)
 */
export function calculateTrendMomentumMetrics(
  pack1h: BinanceKlinePack | null,
  opts?: TrendMomentumMetricsOpts
): TrendMomentumMetrics | null {
  if (!pack1h?.close?.length) return null;
  const { open, high, low, close, volume } = pack1h;

  const window = resolveClosed1hWindowIndices(pack1h, opts?.asOfSec);
  if (!window) return null;
  const { iStart, iEnd } = window;

  for (let i = iStart; i <= iEnd; i++) {
    const o = open[i]!;
    const h = high[i]!;
    const l = low[i]!;
    const c = close[i]!;
    if (![o, h, l, c].every(Number.isFinite)) return null;
  }

  const volumeDropCount = countVolumeDrops(volume, iStart, iEnd);
  if (volumeDropCount == null) return null;

  const maxVolDrops = envMaxVolumeDrops();
  const isVolumeCascading = volumeDropCount <= maxVolDrops;
  const maxDrawbackPercent = calculateFlexibleDrawback1hPercent(open, high, low, close, iStart, iEnd);
  const threshold = envMaxDrawbackPct();
  return {
    isLowDrawback: maxDrawbackPercent <= threshold,
    isVolumeCascading,
    maxDrawbackPercent,
    candleCount: iEnd - iStart + 1,
    volumeDropCount,
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
  if (!metrics) {
    return `📎 Trend momentum (1H): ข้อมูล 1H ไม่พอ (ต้อง ≥${SNOWBALL_TREND_1H_LOOKBACK + 1} แท่งในชุด)`;
  }
  const sustained = isSustainedBuyingPressure(metrics);
  const maxDrops = snowballTrendMomentumMaxVolumeDrops();
  return [
    `📎 Trend momentum (1H · ${metrics.candleCount} แท่งปิด):`,
    `  • Flexible drawback (ไส้บน/ล่าง): ${metrics.maxDrawbackPercent.toFixed(2)}% (≤${snowballTrendMomentumMaxDrawbackPct()}% = ${metrics.isLowDrawback ? "✓" : "—"})`,
    `  • Volume cascade: ${metrics.isVolumeCascading ? "✓" : "—"} (vol สะดุด ${metrics.volumeDropCount}× · ยอม ≤${maxDrops})`,
    `  • Sustained buying pressure: ${sustained ? "✓" : "—"}`,
  ].join("\n");
}
