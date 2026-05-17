import type { BinanceKlinePack } from "./binanceIndicatorKline";

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

/**
 * คำนวณ Max Drawback (1H) และ Volume Cascade จาก 3 แท่ง 1H ปิดล่าสุด
 * (เทียบเท่า slice(-4, -1) บน array ที่ไม่รวมแท่งกำลังก่อตัว)
 */
export function calculateTrendMomentumMetrics(pack1h: BinanceKlinePack | null): TrendMomentumMetrics | null {
  if (!pack1h?.close?.length) return null;
  const { open, close, volume } = pack1h;
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
