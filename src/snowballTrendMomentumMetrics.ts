import { fetchBinanceUsdmKlines, type BinanceKlinePack } from "./binanceIndicatorKline";

const SNOWBALL_TREND_1H_BARS = 120;
const ONE_HOUR_SEC = 3600;
const FIFTEEN_MIN_SEC = 900;
/** Max DD (momentum) — แท่ง 15m ย้อนหลัง 8 ชม. (= 8 แท่ง 1H เดิม) */
export const SNOWBALL_TREND_15M_DD_LOOKBACK = 32;
export const SNOWBALL_TREND_15M_DD_BARS = 80;
/** @deprecated ใช้กับ Vol↗ / label เก่า — เกณ DD ใช้ 15m Max DD แล้ว */
export const SNOWBALL_TREND_1H_DD_LOOKBACK = 8;
/** Vol↗ — 5 แท่ง 1H ปิดล่าสุดในกรอบเดียวกัน (slice(-6, -1)) */
export const SNOWBALL_TREND_1H_VOL_LOOKBACK = 5;
/** จำนวนแท่งขั้นต่ำในชุด kline (max ของ DD / Vol) */
export const SNOWBALL_TREND_1H_LOOKBACK = Math.max(
  SNOWBALL_TREND_1H_DD_LOOKBACK,
  SNOWBALL_TREND_1H_VOL_LOOKBACK
);

export type TrendMomentumMetrics = {
  isLowDrawback: boolean;
  isVolumeCascading: boolean;
  maxDrawbackPercent: number;
  /** แท่งที่ใช้คำนวณ DD (ปกติ 8) */
  candleCount: number;
  /** แท่งที่ใช้คำนวณ Vol↗ (ปกติ 5) */
  volumeCandleCount: number;
  /** จำนวนครั้งที่ vol ไม่ยกฐานใน lookback Vol */
  volumeDropCount: number;
};

export type TrendMomentumMetricsOpts = {
  /** Unix sec — ใช้แท่งปิดล่าสุดที่ปิดไม่เกินเวลานี้ (ห้ามใช้แท่งอนาคต) */
  asOfSec?: number;
  /** 15m klines สำหรับ Max DD (stats-style); ไม่ส่ง = ไม่คำนวณ momentum ได้ */
  pack15m?: BinanceKlinePack | null;
};

function envMaxDrawbackPct(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TREND_MOMENTUM_MAX_DRAWBACK_PCT?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
  return 7;
}

function envMomentumMaxDdLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TREND_MOMENTUM_MAX_DD_LOOKBACK_BARS?.trim());
  if (Number.isFinite(v) && v >= 4 && v <= 200) return Math.floor(v);
  return SNOWBALL_TREND_15M_DD_LOOKBACK;
}

/** ยอมให้ vol ไม่ยกฐานได้กี่ครั้งใน lookback (ดีฟอลต์ 1) */
function envMaxVolumeDrops(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TREND_MOMENTUM_MAX_VOL_DROPS?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= SNOWBALL_TREND_1H_VOL_LOOKBACK) return Math.floor(v);
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

/** โครงสร้าง+momentum+1H confirm ผ่าน แต่ vol ไม่ถึง SMA×strict — ส่ง Grade B (vol near-miss) */
export function snowballGradeBNearMissVolumeEnabled(): boolean {
  const raw =
    (
      process.env.INDICATOR_PUBLIC_SNOWBALL_GRADE_B_NEAR_MISS_VOLUME ??
      process.env.INDICATOR_PUBLIC_SNOWBALL_GRADE_D_PLUS_NEAR_MISS_VOLUME
    )
      ?.trim()
      .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

/** @deprecated ใช้ snowballGradeBNearMissVolumeEnabled */
export function snowballGradeDPlusNearMissVolumeEnabled(): boolean {
  return snowballGradeBNearMissVolumeEnabled();
}

/** momentum ไม่ผ่าน แต่ 1H confirm ผ่าน → ส่ง Grade D+ (Long) แทนบล็อก (ไม่จำกัดแค่ B) */
export function snowballGradeBMomentumFailGradeDOn1hConfirmPass(): boolean {
  const raw =
    process.env.INDICATOR_PUBLIC_SNOWBALL_GRADE_B_MOMENTUM_FAIL_GRADE_D_ON_1H_CONFIRM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

/** momentum ไม่ผ่าน + 1H confirm ไม่ผ่าน → ส่ง Grade F (Long) แทนบล็อกเงียบ */
export function snowballGradeFOnMomentumAnd1hConfirmFail(): boolean {
  const raw =
    process.env.INDICATOR_PUBLIC_SNOWBALL_GRADE_F_ON_MOMENTUM_AND_1H_FAIL?.trim().toLowerCase();
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

/** ดึงแท่ง 1H สำหรับ Vol↗ */
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

/** ดึงแท่ง 15m สำหรับ Max DD (momentum) */
export async function fetchSnowball15mPackForTrendMomentum(
  symbol: string
): Promise<BinanceKlinePack | null> {
  try {
    return await fetchBinanceUsdmKlines(
      symbol.trim().toUpperCase(),
      "15m",
      SNOWBALL_TREND_15M_DD_BARS
    );
  } catch (e) {
    console.error("[snowballTrendMomentum] fetch 15m", symbol, e);
    return null;
  }
}

/** แท่งปิดล่าสุด ณ asOfSec (หรือ slice(-2) เมื่อไม่ระบุเวลา) */
export function resolveClosedKlineWindowIndices(
  pack: BinanceKlinePack,
  barDurSec: number,
  asOfSec?: number,
  lookback?: number
): { iStart: number; iEnd: number } | null {
  const lb = lookback ?? SNOWBALL_TREND_1H_LOOKBACK;
  const n = pack.close.length;
  const minEnd = lb - 1;
  if (n < lb + 1) return null;

  let iEnd: number;
  if (asOfSec != null && Number.isFinite(asOfSec)) {
    iEnd = -1;
    for (let i = 0; i < n; i++) {
      const barCloseSec = pack.timeSec[i]! + barDurSec;
      if (barCloseSec <= asOfSec) iEnd = i;
    }
    if (iEnd < minEnd) return null;
  } else {
    iEnd = n - 2;
    if (iEnd < minEnd) return null;
  }

  const iStart = iEnd - (lb - 1);
  if (iStart < 0) return null;
  return { iStart, iEnd };
}

/** 8 แท่ง 1H ปิดล่าสุด ณ asOfSec */
export function resolveClosed1hWindowIndices(
  pack: BinanceKlinePack,
  asOfSec?: number,
  lookback = SNOWBALL_TREND_1H_LOOKBACK
): { iStart: number; iEnd: number } | null {
  return resolveClosedKlineWindowIndices(pack, ONE_HOUR_SEC, asOfSec, lookback);
}

/**
 * Max DD% (LONG) — เดียวกับ stats: entry = close แท่งสุดท้ายในหน้าต่าง, MFE จาก high, DD ถึง min low ก่อน MFE
 */
export function calculateSnowballMaxDrawdownPctLong(
  high: number[],
  low: number[],
  close: number[],
  iStart: number,
  iEnd: number
): number {
  const entry = close[iEnd]!;
  if (!Number.isFinite(entry) || entry <= 0) return 0;

  let maxRoi = -Infinity;
  let mfeIdx = iStart;
  for (let i = iStart; i <= iEnd; i++) {
    const roi = ((high[i]! - entry) / entry) * 100;
    if (roi > maxRoi) {
      maxRoi = roi;
      mfeIdx = i;
    }
  }
  if (!Number.isFinite(maxRoi)) return 0;

  let minLow = Infinity;
  for (let i = iStart; i <= mfeIdx; i++) {
    minLow = Math.min(minLow, low[i]!);
  }
  let maxDd = ((entry - minLow) / entry) * 100;
  if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;
  return parseFloat(maxDd.toFixed(2));
}

/**
 * DD 1H% (แสดงง่าย) — ในแต่ละแท่ง 1H ดูไส้บนและไส้ล่างว่าเป็นกี่ % ของช่วงแท่ง (H−L) แล้วเอาค่าสูงสุดใน 8 แท่ง
 * ค่าอยู่ 0–100% ไม่เกิดเลขระเบือเมื่อเนื้อแท่งก่อนหน้าเล็ก (เทียบกับของเดิมที่หาร prevBody)
 */
export function calculateFlexibleDrawback1hPercent(
  open: number[],
  high: number[],
  low: number[],
  close: number[],
  iStart: number,
  iEnd: number
): number {
  let maxDd = 0;

  for (let i = iStart; i <= iEnd; i++) {
    const o = open[i]!;
    const h = high[i]!;
    const l = low[i]!;
    const c = close[i]!;
    if (![o, h, l, c].every(Number.isFinite)) continue;

    const range = h - l;
    if (range <= 0) continue;

    const upperWick = h - Math.max(o, c);
    const upperPct = (upperWick / range) * 100;

    const lowerWick = Math.min(o, c) - l;
    const lowerPct = (lowerWick / range) * 100;

    const barMax = Math.max(upperPct, lowerPct);
    if (barMax > maxDd) maxDd = barMax;
  }

  return parseFloat(maxDd.toFixed(2));
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

/** Vol↗ จาก 5 แท่ง 1H — ใช้บันทึกสถิติ (ไม่ต้องดึง 15m) */
export function calculateTrendMomentumVolumeCascadeYn(
  pack1h: BinanceKlinePack | null,
  opts?: Pick<TrendMomentumMetricsOpts, "asOfSec">
): "Y" | "N" | null {
  if (!pack1h?.close?.length) return null;
  const volWindow = resolveClosed1hWindowIndices(pack1h, opts?.asOfSec, SNOWBALL_TREND_1H_VOL_LOOKBACK);
  if (!volWindow) return null;
  const { iStart: iVolStart, iEnd } = volWindow;
  const { open, high, low, close, volume } = pack1h;
  for (let i = iVolStart; i <= iEnd; i++) {
    const o = open[i]!;
    const h = high[i]!;
    const l = low[i]!;
    const c = close[i]!;
    if (![o, h, l, c].every(Number.isFinite)) return null;
  }
  const volumeDropCount = countVolumeDrops(volume, iVolStart, iEnd);
  if (volumeDropCount == null) return null;
  return volumeDropCount <= envMaxVolumeDrops() ? "Y" : "N";
}

/**
 * Max DD จาก 15m (stats-style) · Vol↗ จาก 5 แท่ง 1H ล่าสุด — vol ยอมสะดุด ≤1 ครั้ง (env)
 */
export function calculateTrendMomentumMetrics(
  pack1h: BinanceKlinePack | null,
  opts?: TrendMomentumMetricsOpts
): TrendMomentumMetrics | null {
  if (!pack1h?.close?.length) return null;
  const pack15m = opts?.pack15m;
  if (!pack15m?.close?.length) return null;

  const ddLookback = envMomentumMaxDdLookbackBars();
  const ddWindow15 = resolveClosedKlineWindowIndices(
    pack15m,
    FIFTEEN_MIN_SEC,
    opts?.asOfSec,
    ddLookback
  );
  if (!ddWindow15) return null;
  const { iStart: iDdStart, iEnd: iDdEnd } = ddWindow15;

  const volWindow = resolveClosed1hWindowIndices(pack1h, opts?.asOfSec, SNOWBALL_TREND_1H_VOL_LOOKBACK);
  if (!volWindow) return null;
  const { iStart: iVolStart, iEnd } = volWindow;
  const { open, high, low, close, volume } = pack1h;

  for (let i = iVolStart; i <= iEnd; i++) {
    const o = open[i]!;
    const h = high[i]!;
    const l = low[i]!;
    const c = close[i]!;
    if (![o, h, l, c].every(Number.isFinite)) return null;
  }

  const volumeDropCount = countVolumeDrops(volume, iVolStart, iEnd);
  if (volumeDropCount == null) return null;

  const maxVolDrops = envMaxVolumeDrops();
  const isVolumeCascading = volumeDropCount <= maxVolDrops;
  const maxDrawbackPercent = calculateSnowballMaxDrawdownPctLong(
    pack15m.high,
    pack15m.low,
    pack15m.close,
    iDdStart,
    iDdEnd
  );
  const threshold = envMaxDrawbackPct();
  return {
    isLowDrawback: maxDrawbackPercent <= threshold,
    isVolumeCascading,
    maxDrawbackPercent,
    candleCount: iDdEnd - iDdStart + 1,
    volumeCandleCount: iEnd - iVolStart + 1,
    volumeDropCount,
  };
}

export function trendMomentumStatsFields(metrics: TrendMomentumMetrics | null): {
  volumeCascadeYn: "Y" | "N" | null;
  signalMaxDdPct: number | null;
} {
  if (!metrics) return { volumeCascadeYn: null, signalMaxDdPct: null };
  return {
    volumeCascadeYn: metrics.isVolumeCascading ? "Y" : "N",
    signalMaxDdPct:
      Number.isFinite(metrics.maxDrawbackPercent) && metrics.maxDrawbackPercent >= 0
        ? metrics.maxDrawbackPercent
        : null,
  };
}

export function formatTrendMomentumMetricsLine(metrics: TrendMomentumMetrics | null): string {
  if (!metrics) {
    return `📎 Trend momentum (1H): ข้อมูล 1H ไม่พอ (ต้อง ≥${SNOWBALL_TREND_1H_LOOKBACK + 1} แท่งในชุด)`;
  }
  const sustained = isSustainedBuyingPressure(metrics);
  const maxDrops = snowballTrendMomentumMaxVolumeDrops();
  return [
    `📎 Trend momentum (Max DD 15m ${metrics.candleCount} แท่ง · Vol 1H ${metrics.volumeCandleCount} แท่ง):`,
    `  • Max DD: ${metrics.maxDrawbackPercent.toFixed(2)}% (≤${snowballTrendMomentumMaxDrawbackPct()}% = ${metrics.isLowDrawback ? "✓" : "—"})`,
    `  • Volume cascade: ${metrics.isVolumeCascading ? "✓" : "—"} (vol สะดุด ${metrics.volumeDropCount}× ใน ${metrics.volumeCandleCount} แท่ง · ยอม ≤${maxDrops})`,
    `  • Sustained buying pressure: ${sustained ? "✓" : "—"}`,
  ].join("\n");
}
