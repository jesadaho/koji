import { fetchBinanceUsdmKlines, type BinanceKlinePack } from "./binanceIndicatorKline";

const SNOWBALL_TREND_1H_BARS = 120;

/** โมเมนตัมเทรนด์ระยะสั้นจาก 3 แท่ง 1H ปิดล่าสุด */
export type TrendMomentumMetrics = {
  isLowDrawback: boolean;
  isVolumeCascading: boolean;
  maxDrawbackPercent: number;
  /** จำนวนแท่ง 1H ที่ใช้คำนวณ (ปกติ 3) */
  candleCount: number;
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

/**
 * คำนวณ Max Drawback (1H) และ Volume Cascade จาก 3 แท่ง 1H ปิดล่าสุด
 * (เทียบเท่า slice(-4, -1) บน array ที่ไม่รวมแท่งกำลังก่อตัว)
 */
/** Max % retracement จาก peak high ถึง low ถัดไปในช่วง 3 แท่ง 1H ปิด */
function maxDrawbackPercentIn1hWindow(
  high: number[],
  low: number[],
  iStart: number,
  iEnd: number
): number {
  let peakHigh = -Infinity;
  let maxDd = 0;
  for (let i = iStart; i <= iEnd; i++) {
    const h = high[i]!;
    const l = low[i]!;
    if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
    if (h > peakHigh) peakHigh = h;
    if (peakHigh > 0 && l < peakHigh) {
      const dd = ((peakHigh - l) / peakHigh) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function calculateTrendMomentumMetrics(pack1h: BinanceKlinePack | null): TrendMomentumMetrics | null {
  if (!pack1h?.close?.length) return null;
  const { open, close, high, low, volume } = pack1h;
  const n = close.length;
  const iEnd = n - 2;
  const iStart = iEnd - 2;
  if (iStart < 0 || iEnd < iStart) return null;

  let maxDrawbackPercent = 0;
  let isVolumeCascading = true;

  for (let i = iStart + 1; i <= iEnd; i++) {
    const o0 = open[i - 1]!;
    const c0 = close[i - 1]!;
    const o1 = open[i]!;
    const c1 = close[i]!;
    const v0 = volume[i - 1]!;
    const v1 = volume[i]!;

    if (
      !Number.isFinite(o0) ||
      !Number.isFinite(c0) ||
      !Number.isFinite(o1) ||
      !Number.isFinite(c1) ||
      !Number.isFinite(v0) ||
      !Number.isFinite(v1)
    ) {
      return null;
    }

    if (c0 > o0 && c1 < o1) {
      const prevGreenBody = c0 - o0;
      const currentRedBody = o1 - c1;
      if (prevGreenBody > 0) {
        const drawbackRatio = (currentRedBody / prevGreenBody) * 100;
        if (drawbackRatio > maxDrawbackPercent) maxDrawbackPercent = drawbackRatio;
      }
    }

    if (v1 <= v0) isVolumeCascading = false;
  }

  /** DD 1H% ในตารางสถิติ — peak high → low ในช่วง 3 แท่ง (ไม่ผูกเฉพาะเขียว→แดง) */
  const windowDd = maxDrawbackPercentIn1hWindow(high, low, iStart, iEnd);
  if (windowDd > maxDrawbackPercent) maxDrawbackPercent = windowDd;

  /** เสริม: pullback จาก close สูงสุดในช่วง (กรณี wick แคบ) */
  if (maxDrawbackPercent <= 0) {
    let peakClose = -Infinity;
    for (let i = iStart; i <= iEnd; i++) {
      const c = close[i]!;
      if (Number.isFinite(c) && c > peakClose) peakClose = c;
    }
    if (peakClose > 0) {
      for (let i = iStart; i <= iEnd; i++) {
        const c = close[i]!;
        if (!Number.isFinite(c) || c >= peakClose) continue;
        const dd = ((peakClose - c) / peakClose) * 100;
        if (dd > maxDrawbackPercent) maxDrawbackPercent = dd;
      }
    }
  }

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
    `  • Max drawback: ${metrics.maxDrawbackPercent.toFixed(1)}% (≤${snowballTrendMomentumMaxDrawbackPct()}% = ${metrics.isLowDrawback ? "✓" : "—"})`,
    `  • Volume cascade: ${metrics.isVolumeCascading ? "✓ เรียงตัวขึ้น" : "— ไม่เรียง"}`,
    `  • Sustained buying pressure: ${sustained ? "✓" : "—"}`,
  ].join("\n");
}
