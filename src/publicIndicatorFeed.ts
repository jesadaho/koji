import type { Client } from "@line/bot-sdk";
import {
  fetchBinanceUsdmKlines,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceIndicatorTf,
} from "./binanceIndicatorKline";
import { sendPublicIndicatorFeedToSparkGroup, sendPublicSnowballFeedToSparkGroup } from "./alertNotify";
import { emaLine, rsiWilder, smaLine, stochRsiLine } from "./indicatorMath";
import {
  loadIndicatorPublicFeedState,
  saveIndicatorPublicFeedState,
  updatePublicFeedFiredKey,
  type IndicatorPublicFeedState,
} from "./indicatorPublicFeedStore";
import {
  acquireIndicatorPublicFeedLock,
  releaseIndicatorPublicFeedLock,
  useCloudStorage,
} from "./remoteJsonStore";
import { runSnowballAutoTradeAfterSnowballAlert } from "./snowballAutoTradeExecutor";
import { appendSnowballStatsRow, loadSnowballStatsState, type SnowballStatsRow } from "./snowballStatsStore";
import { addSnowballPendingConfirm } from "./snowballConfirmStore";
import {
  loadSnowballConfirmLastRoundStats,
  type SnowballConfirmLastRoundStats,
} from "./snowballConfirmRoundStatsStore";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";

/**
 * RSI cross + EMA golden/death (public Telegram) — ค่าเริ่ม 4h ให้สอดคล้อง divergence
 * ตั้ง INDICATOR_PUBLIC_RSI_EMA_TF=1h หรือ 15m ได้
 */
export function publicRsiEmaCrossTf(): BinanceIndicatorTf {
  const raw = process.env.INDICATOR_PUBLIC_RSI_EMA_TF?.trim().toLowerCase();
  if (raw === "1h") return "1h";
  if (raw === "15m") return "15m";
  if (raw === "4h" || raw === "4hr") return "4h";
  return "4h";
}

/**
 * Timeframe สำหรับ RSI divergence (public Telegram) — ค่าเริ่มเฉพาะ 4h (โครงสร้างชัดกว่า 1h)
 * ตั้ง INDICATOR_PUBLIC_RSI_DIVERGENCE_TFS=1h,4h เพื่อคืนทั้งคู่
 */
export function publicRsiDivergenceTfs(): BinanceIndicatorTf[] {
  const raw = process.env.INDICATOR_PUBLIC_RSI_DIVERGENCE_TFS?.trim().toLowerCase();
  if (!raw) return ["4h"];
  const out: BinanceIndicatorTf[] = [];
  for (const part of raw.split(/[\s,;+]+/)) {
    const t = part.replace(/hr$/i, "h").trim();
    if (t === "1h" && !out.includes("1h")) out.push("1h");
    if (t === "4h" && !out.includes("4h")) out.push("4h");
  }
  return out.length > 0 ? out : ["4h"];
}

/** Snowball ใช้ TF นี้จาก Binance USDM (15m / 1h / 4h) — ค่าเริ่ม 4h */
export function snowballBinanceTf(): BinanceIndicatorTf {
  const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_TF?.trim().toLowerCase();
  if (raw === "4h" || raw === "4hr") return "4h";
  if (raw === "1h") return "1h";
  if (raw === "15m") return "15m";
  return "4h";
}

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isIndicatorPublicFeedEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_FEED_ENABLED", true);
}

function isPublicRsiDivergenceEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_RSI_DIVERGENCE_ENABLED", true);
}

export function isPublicSnowballTripleCheckEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_ENABLED", true);
}

/** สำหรับ debug / เอกสาร — ค่าเดียวกับรอบ runPublicIndicatorFeedInternal */
export function getIndicatorPublicScanParams(): {
  coreTopAlts: number;
  snowballTopAlts: number;
  snowTf: BinanceIndicatorTf;
  symbolListTtlMs: number;
  publicCooldownMs: number;
} {
  return {
    coreTopAlts: topAltsCount(),
    snowballTopAlts: snowballUniverseTopAltsCount(),
    snowTf: snowballBinanceTf(),
    symbolListTtlMs: symbolListTtlMs(),
    publicCooldownMs: publicCooldownMs(),
  };
}

function divergencePivotWing(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_PIVOT_WING);
  if (Number.isFinite(v) && v >= 1 && v <= 5) return Math.floor(v);
  return 2;
}

function divergenceMinPivotGapBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_MIN_PIVOT_GAP);
  if (Number.isFinite(v) && v >= 1 && v <= 50) return Math.floor(v);
  return 4;
}

function divergenceStrongRsiDelta(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_STRONG_RSI_DELTA);
  if (Number.isFinite(v) && v >= 3 && v <= 40) return v;
  return 8;
}

/** จำนวนแท่งย้อนหลังสำหรับหา Wave1 / Wave2 (peak/valley) */
function divergenceLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_LOOKBACK);
  if (Number.isFinite(v) && v >= 40 && v <= 150) return Math.floor(v);
  return 80;
}

function divergenceOversoldThreshold(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_OVERSOLD);
  if (Number.isFinite(v) && v > 0 && v < 45) return v;
  return 30;
}

function divergenceOverboughtThreshold(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_OVERBOUGHT);
  if (Number.isFinite(v) && v > 55 && v < 100) return v;
  return 70;
}

/** SMA บน RSI สำหรับเงื่อนไขยืนยัน "RSI ตัด MA ขึ้น/ลง" */
function divergenceRsiMaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_RSI_MA_PERIOD);
  if (Number.isFinite(v) && v >= 3 && v <= 21) return Math.floor(v);
  return 9;
}

/** |RSI wave2 − RSI wave1| ขั้นต่ำ (bull: wave2 สูงกว่า wave1 ชัดเจน) */
function divergenceWaveMinRsiDelta(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_DIV_WAVE_MIN_RSI_DELTA);
  if (Number.isFinite(v) && v >= 0 && v <= 25) return v;
  return 3;
}

function publicCooldownMs(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_COOLDOWN_MS);
  if (Number.isFinite(v) && v > 0) return v;
  const fallback = Number(process.env.INDICATOR_ALERT_COOLDOWN_MS);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return 4 * 3600 * 1000;
}

function symbolListTtlMs(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SYMBOL_LIST_TTL_MS);
  if (Number.isFinite(v) && v >= 60_000) return v;
  return 2 * 3600 * 1000;
}

function topAltsCount(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_TOP_ALTS);
  if (Number.isFinite(v) && v >= 0 && v <= 50) return Math.floor(v);
  return 15;
}

/**
 * จำนวน alt จาก Binance 24h quoteVolume ที่สแกน Snowball (แยกจาก INDICATOR_PUBLIC_TOP_ALTS ที่ใช้ RSI/EMA/Div)
 * เมื่อเปิด Snowball จะดึง universe = max(TOP_ALTS, ค่านี้) แต่ RSI/EMA/Divergence ยังรันที่ BTC+ETH+TOP_ALTS เท่านั้น
 */
function snowballUniverseTopAltsCount(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TOP_ALTS);
  if (Number.isFinite(v) && v >= 0 && v <= 150) return Math.floor(v);
  return 100;
}

/** Swing HH/LL — ย้อนหลังหา High/Low ก่อนแท่งปิด · ดีฟอลต์ 48 แท่ง (ระยะเวลาแล้วแต่ TF Snowball) */
function snowballSwingLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 120) return Math.floor(v);
  return 48;
}

/**
 * ไม่นับ high/low ของแท่งล่าสุด N แท่งก่อนแท่งสัญญาณ (กันยอด impulse เดียวกันไปเป็นเพดาน HH / พื้น LL)
 */
function snowballSwingExcludeRecentBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS);
  if (Number.isFinite(v) && v >= 0 && v <= 10) return Math.floor(v);
  return 2;
}

function snowballVolSmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_SMA);
  if (Number.isFinite(v) && v >= 3 && v <= 100) return Math.floor(v);
  return 20;
}

/** Snowball: ต้องเป็น “แรงกระแทก” — Vol ต้องมากกว่า SMA * multiplier (default 2.5x) */
function snowballVolMultiplier(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_MULT);
  if (Number.isFinite(v) && v >= 1 && v <= 10) return v;
  return 2.5;
}

function snowballStochRsiPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_RSI_PERIOD);
  if (Number.isFinite(v) && v >= 2 && v <= 50) return Math.floor(v);
  return 14;
}

function snowballStochLength(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_LENGTH);
  if (Number.isFinite(v) && v >= 2 && v <= 50) return Math.floor(v);
  return 14;
}

function snowballStochKSmooth(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_K_SMOOTH);
  if (Number.isFinite(v) && v >= 1 && v <= 14) return Math.floor(v);
  return 1;
}

/** LL: Stoch RSI ต้องสูงกว่านี้ (ค่าเริ่ม 10 — ยังไม่ OS เกินไป) */
function snowballOversoldFloor(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_OVERSOLD_MIN);
  if (Number.isFinite(v) && v >= 0 && v < 50) return v;
  return 10;
}

/** EMA ที่ใช้อ้างอิงแนวต้าน playbook ขา Short (Sell the Rally) — TF เดียวกับสัญญาณ Snowball */
function snowballResistanceEmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_RESISTANCE_EMA);
  if (Number.isFinite(v) && v >= 2 && v <= 200) return Math.floor(v);
  return 20;
}

/**
 * โหมดโปร: SHORT ต้องปิดใต้ Low ของแท่งที่มี Vol สูงสุดในช่วงด้านใน (proxy จุด Vol หา / Session VP แบบง่าย)
 * ปิดในค่าเริ่ม — ถ้าตั้ง =1 จะคมขึ้นแต่อาจได้สัญญาณน้อยลง
 */
function snowballShortRequireSvpHdBreak(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_SHORT_REQUIRE_SVP_HD", false);
}

/** ความยาวช่วงย้อนหลังที่ใช้หาแท่ง HVN ก่อนแท่งสัญญาณ */
function snowballSvpHdInnerLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SVP_HD_INNER_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 120) return Math.floor(v);
  return 24;
}

/** ทะลุ Value Area High แบบ proxy = High ของแท่งที่ Vol สูงสุดในช่วงสั้น (ไวกว่ารอเบรคยอด HH ยาว) */
function snowballLongVahBreakEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_BREAK", true);
}

function snowballLongVahLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 120) return Math.floor(v);
  return 20;
}

/**
 * Long: ห้ามแจ้งเมื่อราคายัง “หมกใต้” ก้อน Vol หา (HVN proxy) — ต้องโผล่เหนือ High ของแท่ง Vol สูงสุดในช่วง inner (เดียวกับ SHORT HVN)
 * ถือเป็น proxy ของ “หลุดจากใต้ก้อนหนาเข้าโซนโปร่ง/รูโหว่ด้านบน”
 */
function snowballLongRequireAboveInnerHvn(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_REQUIRE_ABOVE_INNER_HVN", true);
}

/** Long: EMA นี้ต้องมีความชันขึ้น (ค่าปัจจุบัน > ค่าแท่งก่อน) — ค่าเริ่ม 20 */
function snowballLongTrendEmaSlopeEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_EMA_SLOPE_ENABLED", true);
}

function snowballLongTrendEmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_EMA_SLOPE_PERIOD);
  if (Number.isFinite(v) && v >= 2 && v <= 200) return Math.floor(v);
  return 20;
}

/** Long: ต้องเชิดหัวต่อเนื่อง N แท่ง (default 2 = eNow>ePrev และ ePrev>ePrev2) */
function snowballLongTrendEmaSlopeMinUpBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_EMA_SLOPE_MIN_UP_BARS);
  if (Number.isFinite(v) && v >= 1 && v <= 5) return Math.floor(v);
  return 2;
}

/** Long: เพิ่ม Trend alignment โดยให้ EMA2 เชิดหัวด้วย (default เปิด + period 50) */
function snowballLongTrendEma2Enabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_EMA2_SLOPE_ENABLED", true);
}

function snowballLongTrendEma2Period(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_EMA2_SLOPE_PERIOD);
  if (Number.isFinite(v) && v >= 2 && v <= 200) return Math.floor(v);
  return 50;
}

/**
 * ประเมินด้วยแท่งกำลังก่อน (kline สด — แท่งสุดท้ายยังไม่ปิด) — ค่าเริ่มปิด; รอปิดแท่งตาม TF Snowball เป็นหลัก
 * เปิดด้วย INDICATOR_PUBLIC_SNOWBALL_INTRABAR=1 เมื่อต้องการแจ้งก่อนจบแท่ง
 */
function snowballIntrabarEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_INTRABAR", false);
}

/** ในโหมด intrabar: ไม่บังคับ Vol > SMA — ค่าเริ่มปิด */
function snowballIntrabarRelaxVolume(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_INTRABAR_RELAX_VOLUME", false);
}

/** Double Barrier: Barrier1 = swing lookback เดิม · Barrier2 = โซน “ภูเขา” ใกล้ราคา → B+ / A+ */
function snowballDoubleBarrierEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_DOUBLE_BARRIER_ENABLED", true);
}

function snowballDoubleBarrierLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_DOUBLE_BARRIER_LOOKBACK);
  if (Number.isFinite(v) && v >= 50 && v <= 400) return Math.floor(v);
  return 200;
}

function snowballDoubleBarrierWatchBandPct(): { min: number; max: number } {
  let minV = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_DOUBLE_BARRIER_WATCH_MIN_PCT);
  let maxV = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_DOUBLE_BARRIER_WATCH_MAX_PCT);
  if (!Number.isFinite(minV) || minV < 0.005 || minV > 0.5) minV = 0.05;
  if (!Number.isFinite(maxV) || maxV < 0.01 || maxV > 0.5) maxV = 0.1;
  if (maxV <= minV) maxV = minV + 0.001;
  return { min: minV, max: maxV };
}

/** Snowball Confirming Bar — ติด label ความเสี่ยงในแท่ง 1 แล้วส่ง Confirmed follow-up เมื่อแท่ง 2 ปิดผ่านเกณฑ์ */
export function snowballConfirmBarEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_CONFIRM_BAR_ENABLED", true);
}

/**
 * เมื่อแท่งสัญญาณมี Pending Confirm — ไม่ส่งข้อความ Snowball ไปกลุ่ม Telegram จนกว่าแท่ง 2 จะ ✅ Confirmed
 * (Snowball auto-open Super A+ จะรันหลัง Confirm แทนแท่งแรก)
 * ส่งแบบเดิมทั้งแท่ง 1 + บล็อก Pending: INDICATOR_PUBLIC_SNOWBALL_SKIP_TG_ON_PENDING_CONFIRM=0
 */
export function snowballSkipTelegramWhenPendingConfirm(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_SKIP_TG_ON_PENDING_CONFIRM", true);
}

/** กรองแท่งไส้ยาว: |open−close| / (high−low) ต้องไม่ต่ำกว่าเกณฑ์ — ใช้เฉพาะแท่งปิด (ไม่ intrabar) */
export function snowballBodyToRangeFilterEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_BODY_TO_RANGE_FILTER_ENABLED", true);
}

function snowballMinBodyToRangeRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_MIN_BODY_TO_RANGE);
  if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  return 0.7;
}

export function snowballSignalCandleBodyRatioOk(
  open: number,
  high: number,
  low: number,
  close: number
): boolean {
  if (!snowballBodyToRangeFilterEnabled()) return true;
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return false;
  const body = Math.abs(close - open);
  if (!Number.isFinite(body)) return false;
  return body / range >= snowballMinBodyToRangeRatio();
}

/** แท่งถัดไปปิดทะลุ high/low แท่งก่อน → ผ่านกรองไส้ยาวแทน body÷range ของแท่งสัญญาณ */
export function snowballBodyFollowThroughEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_BODY_FOLLOW_THROUGH_ENABLED", true);
}

/**
 * แท่งสัญญาณ (index iEval) ผ่านกรองเนื้อเทียน/ช่วงหรือไม่
 * — ผ่านทันทีถ้า body÷range ถึงเกณฑ์
 * — ถ้าไม่ถึง: LONG ใช้ close[iEval] > high[iEval-1], SHORT ใช้ close[iEval] < low[iEval-1] (แท่งปิดเท่านั้น)
 */
export function snowballSignalBarBodyRangePassed(
  side: "long" | "bear",
  iEval: number,
  open: number[],
  high: number[],
  low: number[],
  close: number[],
): boolean {
  if (!snowballBodyToRangeFilterEnabled()) return true;
  if (iEval < 0 || iEval >= close.length) return false;
  const o = open[iEval];
  const h = high[iEval];
  const l = low[iEval];
  const c = close[iEval];
  if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return false;
  if (snowballSignalCandleBodyRatioOk(o, h, l, c)) return true;
  if (!snowballBodyFollowThroughEnabled() || iEval < 1) return false;
  if (side === "long") {
    const prevH = high[iEval - 1];
    return Number.isFinite(prevH) && c > prevH;
  }
  const prevL = low[iEval - 1];
  return Number.isFinite(prevL) && c < prevL;
}

function mexcContractSymbolFromBinanceSymbol(sym: string): string {
  const s = sym.trim().toUpperCase();
  if (!s) return "";
  if (s.includes("_")) return s;
  if (s.endsWith("USDT") && s.length > 4) {
    const base = s.slice(0, -4);
    return `${base}_USDT`;
  }
  return s;
}

export function snowballWickHistoryLookback(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_WICK_HISTORY_LOOKBACK);
  if (Number.isFinite(v) && v >= 10 && v <= 300) return Math.floor(v);
  return 50;
}

export function snowballWickHistoryRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_WICK_HISTORY_RATIO);
  if (Number.isFinite(v) && v >= 0.05 && v <= 1) return v;
  return 0.3;
}

export function snowballWickBodyRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_WICK_BODY_RATIO);
  if (Number.isFinite(v) && v >= 0.1 && v <= 10) return v;
  return 1;
}

export function snowballSignalWickRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SIGNAL_WICK_RATIO);
  if (Number.isFinite(v) && v >= 0.1 && v <= 10) return v;
  return 1;
}

export function snowballSupplyZoneLookback(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SUPPLY_ZONE_LOOKBACK);
  if (Number.isFinite(v) && v >= 20 && v <= 500) return Math.floor(v);
  return 200;
}

export function snowballSupplyZonePct(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SUPPLY_ZONE_PCT);
  if (Number.isFinite(v) && v >= 0.005 && v <= 0.5) return v;
  return 0.03;
}

export function snowballConfirmVolMinRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_CONFIRM_VOL_MIN_RATIO);
  if (Number.isFinite(v) && v >= 0 && v <= 5) return v;
  return 0.6;
}

export function snowballConfirmMaxAgeHours(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_CONFIRM_MAX_AGE_HOURS);
  if (Number.isFinite(v) && v >= 1 && v <= 72) return v;
  return 12;
}

/** Snowball Wave Gate — กันยิงซ้ำในคลื่นเดิม (ราคายังสูงกว่า/ต่ำกว่าครั้งก่อนและยังไม่มี reset) */
export function snowballWaveGateEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_WAVE_GATE_ENABLED", true);
}

export function snowballWaveRsiResetThreshold(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_WAVE_RSI_RESET_THRESHOLD);
  if (Number.isFinite(v) && v >= 30 && v <= 70) return v;
  return 50;
}

export function snowballWaveRsiPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_WAVE_RSI_PERIOD);
  if (Number.isFinite(v) && v >= 5 && v <= 50) return Math.floor(v);
  return 14;
}

export function snowballWaveEmaResetPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_WAVE_EMA_RESET_PERIOD);
  if (Number.isFinite(v) && v >= 5 && v <= 200) return Math.floor(v);
  return 50;
}

export function snowballWaveNewHighPct(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_WAVE_NEW_HIGH_PCT);
  if (Number.isFinite(v) && v >= 0.05 && v <= 1) return v;
  return 0.2;
}

export type SnowballConfirmRiskFlagId = "wick_history" | "supply_zone" | "signal_wick";

export type SnowballConfirmRiskFlag = {
  id: SnowballConfirmRiskFlagId;
  label: string;
  detail: string;
};

/** ใช้ภายในส่งเข้า buildSnowballTripleCheckMessage + state */
type SnowballConfirmTriggerSnapshot = {
  refLevel: number;
  volMinRatio: number;
};

/** สถานะการตรวจคลื่น (wave gate) — ตรวจก่อนยิงให้แน่ใจว่าเป็นรอบใหม่ ไม่ใช่เสียงรบกวนของคลื่นเดิม */
export type SnowballWaveGateStatus = {
  active: boolean;
  blocked: boolean;
  /** เหตุผลถ้า blocked */
  reason?: string;
  /** เหตุผลที่ถือว่าเป็นรอบใหม่ ถ้า passed */
  resetReason?: string;
  /** ราคา alert ครั้งก่อน */
  lastAlertPrice: number | null;
  /** bar ที่ alert ครั้งก่อน */
  lastAlertBarOpenSec: number | null;
  /** ราคาปิดแท่งปัจจุบัน */
  currentClose: number;
  /** ค่าเปอร์เซ็นต์เกณฑ์ new-high/low */
  newHighPct: number;
  /** ค่าระดับ RSI สำหรับ reset */
  rsiResetThreshold: number;
  emaResetPeriod: number;
};

/**
 * Snowball wave gate — กันยิงซ้ำในคลื่นเดิม
 * - LONG: ห้ามยิงซ้ำถ้าราคายังสูงกว่า lastAlertPrice และระหว่างนั้นยังไม่เกิด reset (RSI <= 50, แตะ EMA50, หรือ new high +20%)
 * - BEAR: ห้ามยิงซ้ำถ้าราคายังต่ำกว่า lastAlertPrice และระหว่างนั้นยังไม่เกิด reset (RSI >= 50, แตะ EMA50, หรือ new low -20%)
 */
export function evaluateSnowballWaveGate(
  side: "long" | "bear",
  close: number[],
  high: number[],
  low: number[],
  timeSec: number[],
  iEval: number,
  lastAlertBarOpenSec: number | undefined,
  lastAlertPrice: number | undefined,
  emaSeries: number[],
  rsiSeries: number[],
): SnowballWaveGateStatus {
  const rsiResetThreshold = snowballWaveRsiResetThreshold();
  const emaResetPeriod = snowballWaveEmaResetPeriod();
  const newHighPct = snowballWaveNewHighPct();
  const clNow = close[iEval];
  const currentClose = typeof clNow === "number" && Number.isFinite(clNow) ? clNow : NaN;

  const baseStatus: SnowballWaveGateStatus = {
    active: snowballWaveGateEnabled(),
    blocked: false,
    lastAlertPrice: typeof lastAlertPrice === "number" && Number.isFinite(lastAlertPrice) ? lastAlertPrice : null,
    lastAlertBarOpenSec:
      typeof lastAlertBarOpenSec === "number" && Number.isFinite(lastAlertBarOpenSec) ? lastAlertBarOpenSec : null,
    currentClose,
    newHighPct,
    rsiResetThreshold,
    emaResetPeriod,
  };

  if (!baseStatus.active) return baseStatus;
  if (baseStatus.lastAlertPrice == null || baseStatus.lastAlertBarOpenSec == null) {
    baseStatus.reason = "ยังไม่เคยยิง — ไม่ใช้ gate";
    return baseStatus;
  }
  if (!Number.isFinite(currentClose)) {
    baseStatus.reason = "ปิดราคาแท่งล่าสุดไม่ valid — ไม่ block";
    return baseStatus;
  }

  /* ราคาฝั่งตรงข้ามคลื่นเดิม → ปล่อยผ่าน (ปริยายคือเข้าคลื่นใหม่) */
  if (side === "long") {
    if (currentClose <= baseStatus.lastAlertPrice) {
      baseStatus.resetReason = `ราคาปิดแท่งล่าสุด ${currentClose.toFixed(6)} ≤ ราคาครั้งก่อน ${baseStatus.lastAlertPrice.toFixed(6)} → ถือเป็นรอบใหม่`;
      return baseStatus;
    }
  } else {
    if (currentClose >= baseStatus.lastAlertPrice) {
      baseStatus.resetReason = `ราคาปิดแท่งล่าสุด ${currentClose.toFixed(6)} ≥ ราคาครั้งก่อน ${baseStatus.lastAlertPrice.toFixed(6)} → ถือเป็นรอบใหม่`;
      return baseStatus;
    }
  }

  /* เช็คเงื่อนไข “รอบใหม่” */
  const lastIdx = timeSec.indexOf(baseStatus.lastAlertBarOpenSec);
  const fromIdx = lastIdx >= 0 ? lastIdx + 1 : 0;
  const toIdx = Math.max(fromIdx, iEval - 1);

  /* เงื่อนไข ก. แตะ EMA50 ในช่วงระหว่าง */
  let touchedEma = false;
  let touchedEmaAt = -1;
  for (let i = fromIdx; i <= toIdx; i++) {
    const e = emaSeries[i];
    const lo = low[i];
    const hi = high[i];
    if (typeof e !== "number" || !Number.isFinite(e)) continue;
    if (side === "long") {
      if (typeof lo === "number" && Number.isFinite(lo) && lo <= e) {
        touchedEma = true;
        touchedEmaAt = i;
        break;
      }
    } else {
      if (typeof hi === "number" && Number.isFinite(hi) && hi >= e) {
        touchedEma = true;
        touchedEmaAt = i;
        break;
      }
    }
  }

  /* เงื่อนไข ข. RSI หลุดเกณฑ์ระหว่าง */
  let rsiCrossed = false;
  let rsiCrossedAt = -1;
  let rsiCrossedValue = NaN;
  for (let i = fromIdx; i <= toIdx; i++) {
    const r = rsiSeries[i];
    if (typeof r !== "number" || !Number.isFinite(r)) continue;
    if (side === "long" ? r <= rsiResetThreshold : r >= rsiResetThreshold) {
      rsiCrossed = true;
      rsiCrossedAt = i;
      rsiCrossedValue = r;
      break;
    }
  }

  /* เงื่อนไข ค. new high / new low เกินเปอร์เซ็นต์ */
  const breakoutLevelLong = baseStatus.lastAlertPrice * (1 + newHighPct);
  const breakoutLevelBear = baseStatus.lastAlertPrice * (1 - newHighPct);
  const bigBreakout =
    side === "long" ? currentClose >= breakoutLevelLong : currentClose <= breakoutLevelBear;

  if (rsiCrossed) {
    const tStr = rsiCrossedAt >= 0 ? ` ที่ idx ${rsiCrossedAt}` : "";
    baseStatus.resetReason = `RSI ${side === "long" ? "≤" : "≥"} ${rsiResetThreshold} (= ${rsiCrossedValue.toFixed(1)})${tStr} → ถือเป็นรอบใหม่`;
    return baseStatus;
  }
  if (touchedEma) {
    const tStr = touchedEmaAt >= 0 ? ` ที่ idx ${touchedEmaAt}` : "";
    baseStatus.resetReason = `${side === "long" ? "Low" : "High"} แตะ EMA${emaResetPeriod}${tStr} → ถือเป็นรอบใหม่`;
    return baseStatus;
  }
  if (bigBreakout) {
    const lvl = side === "long" ? breakoutLevelLong : breakoutLevelBear;
    baseStatus.resetReason = `Close ${currentClose.toFixed(6)} ${side === "long" ? "≥" : "≤"} ${lvl.toFixed(6)} (${(newHighPct * 100).toFixed(0)}% จาก ${baseStatus.lastAlertPrice.toFixed(6)}) → คลื่นใหญ่ถัดไป`;
    return baseStatus;
  }

  baseStatus.blocked = true;
  baseStatus.reason =
    side === "long"
      ? `Close ${currentClose.toFixed(6)} > last ${baseStatus.lastAlertPrice.toFixed(6)} · ระหว่างนี้ RSI ไม่หลุด ${rsiResetThreshold} / ไม่แตะ EMA${emaResetPeriod} / ยังไม่ทะลุ +${(newHighPct * 100).toFixed(0)}%`
      : `Close ${currentClose.toFixed(6)} < last ${baseStatus.lastAlertPrice.toFixed(6)} · ระหว่างนี้ RSI ไม่ขึ้นเกิน ${rsiResetThreshold} / ไม่แตะ EMA${emaResetPeriod} / ยังไม่หลุด -${(newHighPct * 100).toFixed(0)}%`;
  return baseStatus;
}

/** evaluate ความถี่ของแท่งที่ไส้ยาวกว่าตัวในช่วง history ก่อนแท่งสัญญาณ */
export function evaluateWickHistory(
  side: "long" | "bear",
  high: number[],
  low: number[],
  open: number[],
  close: number[],
  iEval: number,
  lookback: number,
  bodyRatio: number,
): { flagged: boolean; wickyCount: number; total: number; ratio: number } {
  const end = iEval - 1; /* ไม่นับแท่งสัญญาณเอง */
  const start = Math.max(0, end - lookback + 1);
  let wicky = 0;
  let total = 0;
  for (let i = start; i <= end; i++) {
    const o = open[i];
    const c = close[i];
    const h = high[i];
    const l = low[i];
    if (
      typeof o !== "number" ||
      typeof c !== "number" ||
      typeof h !== "number" ||
      typeof l !== "number" ||
      !Number.isFinite(o) ||
      !Number.isFinite(c) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l)
    ) {
      continue;
    }
    total += 1;
    const body = Math.abs(c - o);
    const upperShadow = h - Math.max(o, c);
    const lowerShadow = Math.min(o, c) - l;
    const shadow = side === "long" ? upperShadow : lowerShadow;
    if (body > 0 && shadow > body * bodyRatio) {
      wicky += 1;
    } else if (body <= 0 && shadow > 0) {
      /* แท่ง doji + มีไส้ → นับเป็น wicky เพราะไม่มีตัวให้เปรียบ */
      wicky += 1;
    }
  }
  const ratio = total > 0 ? wicky / total : 0;
  return { flagged: total > 0 && ratio >= snowballWickHistoryRatio(), wickyCount: wicky, total, ratio };
}

/** ดูว่าใกล้ peak (long) / floor (bear) ในช่วง lookback หรือไม่ */
export function evaluateSupplyZone(
  side: "long" | "bear",
  high: number[],
  low: number[],
  iEval: number,
  lookback: number,
  zonePct: number,
  closePrice: number,
): { flagged: boolean; refLevel: number | null; distPct: number | null } {
  if (!Number.isFinite(closePrice) || closePrice <= 0) {
    return { flagged: false, refLevel: null, distPct: null };
  }
  const end = iEval - 1;
  const start = Math.max(0, end - lookback + 1);
  if (end < start) return { flagged: false, refLevel: null, distPct: null };
  let refLevel: number | null = null;
  for (let i = start; i <= end; i++) {
    const v = side === "long" ? high[i] : low[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (refLevel == null) refLevel = v;
    else if (side === "long" ? v > refLevel : v < refLevel) refLevel = v;
  }
  if (refLevel == null) return { flagged: false, refLevel: null, distPct: null };
  if (side === "long") {
    const distPct = ((refLevel - closePrice) / closePrice) * 100;
    const flagged = closePrice >= refLevel * (1 - zonePct) && closePrice <= refLevel;
    return { flagged, refLevel, distPct };
  }
  const distPct = ((closePrice - refLevel) / closePrice) * 100;
  const flagged = closePrice <= refLevel * (1 + zonePct) && closePrice >= refLevel;
  return { flagged, refLevel, distPct };
}

/** ไส้บน/ล่างยาวบนแท่งสัญญาณเอง */
export function evaluateSignalWick(
  side: "long" | "bear",
  open: number,
  closePrice: number,
  high: number,
  low: number,
  signalRatio: number,
): { flagged: boolean; body: number; shadow: number } {
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(closePrice) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low)
  ) {
    return { flagged: false, body: 0, shadow: 0 };
  }
  const body = Math.abs(closePrice - open);
  const upperShadow = high - Math.max(open, closePrice);
  const lowerShadow = Math.min(open, closePrice) - low;
  const shadow = side === "long" ? upperShadow : lowerShadow;
  if (body > 0) {
    return { flagged: shadow > body * signalRatio, body, shadow };
  }
  return { flagged: shadow > 0, body, shadow };
}

/** รวม 3 gates → ลิสต์ flag พร้อมรายละเอียดให้แสดงในข้อความ */
export function evaluateSnowballConfirmRisk(
  side: "long" | "bear",
  open: number[],
  high: number[],
  low: number[],
  close: number[],
  iEval: number,
): SnowballConfirmRiskFlag[] {
  const flags: SnowballConfirmRiskFlag[] = [];
  if (!snowballConfirmBarEnabled()) return flags;

  const lookback = snowballWickHistoryLookback();
  const bodyRatio = snowballWickBodyRatio();
  const hist = evaluateWickHistory(side, high, low, open, close, iEval, lookback, bodyRatio);
  if (hist.flagged) {
    const pct = (hist.ratio * 100).toFixed(0);
    const sideLabel = side === "long" ? "ไส้บน" : "ไส้ล่าง";
    flags.push({
      id: "wick_history",
      label: `Wick-heavy history (${pct}%)`,
      detail: `ย้อน ${hist.total} แท่ง พบ ${sideLabel} > body × ${bodyRatio} จำนวน ${hist.wickyCount} แท่ง (${pct}%)`,
    });
  }

  const supplyLb = snowballSupplyZoneLookback();
  const supplyPct = snowballSupplyZonePct();
  const closeV = close[iEval];
  if (typeof closeV === "number" && Number.isFinite(closeV)) {
    const zone = evaluateSupplyZone(side, high, low, iEval, supplyLb, supplyPct, closeV);
    if (zone.flagged && zone.refLevel != null && zone.distPct != null) {
      const zoneName = side === "long" ? "Supply zone" : "Demand zone";
      const refName = side === "long" ? "peak" : "floor";
      flags.push({
        id: "supply_zone",
        label: `${zoneName} proximity`,
        detail: `${refName} ${supplyLb}b = ${zone.refLevel.toFixed(6)} · ห่างจากราคา ${Math.abs(zone.distPct).toFixed(2)}% (เกณฑ์ ≤ ${(supplyPct * 100).toFixed(1)}%)`,
      });
    }
  }

  const o = open[iEval];
  const c = close[iEval];
  const h = high[iEval];
  const l = low[iEval];
  if (
    typeof o === "number" &&
    typeof c === "number" &&
    typeof h === "number" &&
    typeof l === "number"
  ) {
    const sw = evaluateSignalWick(side, o, c, h, l, snowballSignalWickRatio());
    if (sw.flagged) {
      const sideLabel = side === "long" ? "ไส้บน" : "ไส้ล่าง";
      flags.push({
        id: "signal_wick",
        label: `Signal bar ${sideLabel}ยาว`,
        detail: `${sideLabel}=${sw.shadow.toFixed(6)} · body=${sw.body.toFixed(6)}`,
      });
    }
  }

  return flags;
}

type SnowballQualityTier = "a_plus" | "b_plus";

function classifyLongDoubleBarrierTier(
  high: number[],
  iEval: number,
  ref: number
): { tier: SnowballQualityTier; nearestOverhead: number | null; distPct: number | null } {
  const lb = snowballDoubleBarrierLookbackBars();
  const { min, max } = snowballDoubleBarrierWatchBandPct();
  const nearest = nearestOverheadHigh(high, iEval, lb, ref);
  if (nearest == null) {
    return { tier: "a_plus", nearestOverhead: null, distPct: null };
  }
  const d = (nearest - ref) / ref;
  const pct = d * 100;
  if (d >= min && d <= max) return { tier: "b_plus", nearestOverhead: nearest, distPct: pct };
  return { tier: "a_plus", nearestOverhead: nearest, distPct: pct };
}

function classifyShortDoubleBarrierTier(
  low: number[],
  iEval: number,
  ref: number
): { tier: SnowballQualityTier; nearestUnderfoot: number | null; distPct: number | null } {
  const lb = snowballDoubleBarrierLookbackBars();
  const { min, max } = snowballDoubleBarrierWatchBandPct();
  const nearest = nearestUnderfootLow(low, iEval, lb, ref);
  if (nearest == null) {
    return { tier: "a_plus", nearestUnderfoot: null, distPct: null };
  }
  const d = (ref - nearest) / ref;
  const pct = d * 100;
  if (d >= min && d <= max) return { tier: "b_plus", nearestUnderfoot: nearest, distPct: pct };
  return { tier: "a_plus", nearestUnderfoot: nearest, distPct: pct };
}

let topAltsCache: { symbols: string[]; at: number; topN: number } | null = null;

async function getUniverseSymbols(topN: number): Promise<string[]> {
  const ttl = symbolListTtlMs();
  const now = Date.now();
  if (topAltsCache && topAltsCache.topN === topN && now - topAltsCache.at < ttl) {
    return ["BTCUSDT", "ETHUSDT", ...topAltsCache.symbols];
  }
  const top = topN > 0 ? await fetchTopUsdmUsdtSymbolsByQuoteVolume(topN) : [];
  topAltsCache = { symbols: top, at: now, topN };
  return ["BTCUSDT", "ETHUSDT", ...top];
}

function displayBinanceUsdt(sym: string): string {
  const u = sym.toUpperCase();
  const base = u.endsWith("USDT") ? u.slice(0, -4) : u;
  return `$${base}/USDT`;
}

/** BASE/USDT ไม่มี $ — ใช้ในหัวข้อสัญญาณ */
function pairSlashNoDollar(sym: string): string {
  const u = sym.toUpperCase();
  const base = u.endsWith("USDT") ? u.slice(0, -4) : u;
  return `${base}/USDT`;
}

function formatClosedCandleBkk(barTimeSec: number): string {
  const d = new Date(barTimeSec * 1000);
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} | ${timePart} (BKK)`;
}

function emaDeltaCue(now: number, prev: number): string {
  if (now > prev) return "↗️ ดีดจาก";
  if (now < prev) return "↘️ ร่วงจาก";
  return "➡️ เทียบกับ";
}

function rsiCrossMatch(
  rPrev: number,
  rNow: number,
  threshold: number,
  direction: "above" | "below" | "both"
): boolean {
  if (direction === "both") {
    const up = rPrev <= threshold && rNow > threshold;
    const down = rPrev >= threshold && rNow < threshold;
    return up || down;
  }
  if (direction === "above") {
    return rPrev <= threshold && rNow > threshold;
  }
  return rPrev >= threshold && rNow < threshold;
}

function emaCrossMatch(fastAbovePrev: boolean, fastAboveNow: boolean, kind: "golden" | "death"): boolean {
  if (kind === "golden") {
    return !fastAbovePrev && fastAboveNow;
  }
  return fastAbovePrev && !fastAboveNow;
}

function parseRsiDirection(): "above" | "below" | "both" {
  const v = process.env.INDICATOR_PUBLIC_RSI_DIRECTION?.trim().toLowerCase();
  if (v === "above" || v === "below" || v === "both") return v;
  return "both";
}

function rsiParams(): { period: number; threshold: number; direction: "above" | "below" | "both" } {
  const period = Number(process.env.INDICATOR_PUBLIC_RSI_PERIOD);
  const threshold = Number(process.env.INDICATOR_PUBLIC_RSI_THRESHOLD);
  return {
    period: Number.isFinite(period) && period >= 2 ? Math.floor(period) : 14,
    threshold: Number.isFinite(threshold) ? threshold : 50,
    direction: parseRsiDirection(),
  };
}

function isNeutralRsi50Threshold(threshold: number): boolean {
  return Math.abs(threshold - 50) < 1e-9;
}

function emaParams(): { fast: number; slow: number } {
  const fast = Number(process.env.INDICATOR_PUBLIC_EMA_FAST);
  const slow = Number(process.env.INDICATOR_PUBLIC_EMA_SLOW);
  return {
    fast: Number.isFinite(fast) && fast >= 2 ? Math.floor(fast) : 12,
    slow: Number.isFinite(slow) && slow >= 3 ? Math.floor(slow) : 26,
  };
}

function inCooldown(state: IndicatorPublicFeedState, key: string, nowMs: number): boolean {
  const t = state.lastNotifyMs?.[key];
  if (t == null || !Number.isFinite(t)) return false;
  return nowMs - t < publicCooldownMs();
}

function rsiStatusArrowLine(rNow: number, rPrev: number): string {
  if (rNow > rPrev) {
    return `Status: ${rNow.toFixed(2)} ↗️ (ดีดจาก ${rPrev.toFixed(2)})`;
  }
  if (rNow < rPrev) {
    return `Status: ${rNow.toFixed(2)} ↘️ (ร่วงจาก ${rPrev.toFixed(2)})`;
  }
  return `Status: ${rNow.toFixed(2)} ➡️ (เทียบกับ ${rPrev.toFixed(2)})`;
}

function buildPublicRsiMessage(
  symbol: string,
  crossTf: BinanceIndicatorTf,
  period: number,
  threshold: number,
  direction: "above" | "below" | "both",
  rPrev: number,
  rNow: number,
  barTimeSec: number
): string {
  const sym = displayBinanceUsdt(symbol);
  const timeBkk = formatClosedCandleBkk(barTimeSec);
  const statusLine = rsiStatusArrowLine(rNow, rPrev);

  const isBearishBreak = rPrev >= threshold && rNow < threshold;
  const isBullishBreak = rPrev <= threshold && rNow > threshold;

  if (isBearishBreak) {
    return [
      `📉 RSI SIGNAL: BEARISH BREAK (Below ${threshold})`,
      `${sym} (Binance USDT-M)`,
      "",
      `⏰ Time: ${timeBkk}`,
      "",
      "📊 Technical Insight:",
      `Indicator: RSI (${period}) - ${crossTf} Timeframe`,
      `Action: 📉 CROSS BELOW ${threshold} (เสียทรงขาขึ้น)`,
      statusLine,
      "",
      "💡 Analysis:",
      `RSI หลุดระดับ ${threshold} ลงมาในแท่งล่าสุด บ่งบอกว่าแรงขายเริ่มคุมตลาด และโมเมนตัมฝั่ง Bullish เริ่มอ่อนกำลังลง`,
    ].join("\n");
  }

  if (isBullishBreak) {
    return [
      `📈 RSI SIGNAL: BULLISH BREAK (Above ${threshold})`,
      `${sym} (Binance USDT-M)`,
      "",
      `⏰ Time: ${timeBkk}`,
      "",
      "📊 Technical Insight:",
      `Indicator: RSI (${period}) - ${crossTf} Timeframe`,
      `Action: 📈 CROSS ABOVE ${threshold} (กู้โมเมนตัมขาขึ้น)`,
      statusLine,
      "",
      "💡 Analysis:",
      `RSI ข้ามขึ้นเหนือระดับ ${threshold} ในแท่งล่าสุด บ่งบอกว่าแรงซื้อเริ่มคุมตลาด และโมเมนตัมขาขึ้นกำลังกลับมา`,
    ].join("\n");
  }

  return [
    `📊 RSI SIGNAL (threshold ${threshold})`,
    `${sym} (Binance USDT-M)`,
    "",
    `⏰ Time: ${timeBkk}`,
    "",
    `Indicator: RSI (${period}) - ${crossTf} · prev ${rPrev.toFixed(2)} → now ${rNow.toFixed(2)}`,
    "สัญญาณไม่ตรงแบบข้ามเกณฑ์มาตรฐาน — ตรวจ INDICATOR_PUBLIC_RSI_DIRECTION",
  ].join("\n");
}

function buildPublicEmaMessage(
  symbol: string,
  crossTf: BinanceIndicatorTf,
  kind: "golden" | "death",
  fast: number,
  slow: number,
  fastPrev: number,
  slowPrev: number,
  fastNow: number,
  slowNow: number,
  barTimeSec: number
): string {
  const pair = pairSlashNoDollar(symbol);
  const bkk = formatClosedCandleBkk(barTimeSec);
  const equalAtDisplay = fastNow.toFixed(4) === slowNow.toFixed(4);
  const status =
    equalAtDisplay
      ? "เส้นตัดกันสมบูรณ์ที่แท่งปิดล่าสุด"
      : kind === "death"
        ? `EMA ${fast} อยู่ใต้ EMA ${slow} ที่แท่งปิดล่าสุด`
        : `EMA ${fast} อยู่เหนือ EMA ${slow} ที่แท่งปิดล่าสุด`;

  if (kind === "death") {
    return [
      `🔴 SIGNAL: DEATH CROSS (${pair})`,
      `"เทรนด์ขาลงเริ่มชัด - ราคาเริ่มกดตัว"`,
      "",
      "Market: Binance USDT-M (Perpetual)",
      `🔹 Timeframe: ${crossTf} (EMA ${fast} / ${slow})`,
      `🔹 Closed Candle: ${bkk}`,
      "",
      "Technical detail:",
      "Action: [DOWN] CROSS DOWN (สัญญาณกดลง)",
      "",
      `🔹 EMA ${fast}: ${fastNow.toFixed(4)} (${emaDeltaCue(fastNow, fastPrev)} ${fastPrev.toFixed(4)})`,
      `🔹 EMA ${slow}: ${slowNow.toFixed(4)} (${emaDeltaCue(slowNow, slowPrev)} ${slowPrev.toFixed(4)})`,
      `🔹 Status: ${status}`,
      "",
      "⚠️ Signal generated by Koji Bot — Not Financial Advice",
    ].join("\n");
  }

  return [
    `🟢 SIGNAL: GOLDEN CROSS (${pair})`,
    `"เทรนด์ขาขึ้นเริ่มชัด - ราคาเริ่มเร่งตัว"`,
    "",
    "Market: Binance USDT-M (Perpetual)",
    `🔹 Timeframe: ${crossTf} (EMA ${fast} / ${slow})`,
    `🔹 Closed Candle: ${bkk}`,
    "",
    "Technical detail:",
    "Action: [UP] CROSS UP (สัญญาณเร่งตัว)",
    "",
    `🔹 EMA ${fast}: ${fastNow.toFixed(4)} (${emaDeltaCue(fastNow, fastPrev)} ${fastPrev.toFixed(4)})`,
    `🔹 EMA ${slow}: ${slowNow.toFixed(4)} (${emaDeltaCue(slowNow, slowPrev)} ${slowPrev.toFixed(4)})`,
    `🔹 Status: ${status}`,
    "",
    "⚠️ Signal generated by Koji Bot — Not Financial Advice",
  ].join("\n");
}

/** High สูงสุดใน [i−lookback, i−1−excludeRecent] — excludeRecent กันยอด impulse 1–2 แท่งล่าสุด */
function maxHighPriorWindow(high: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

/** Low ต่ำสุดในช่วงเดียวกับ maxHighPriorWindow — สมมาตรฝั่ง Short */
function minLowPriorWindow(low: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return Infinity;
  let m = Infinity;
  for (let j = start; j <= end; j++) m = Math.min(m, low[j]!);
  return m;
}

/** High ต่ำสุดที่ยังอยู่เหนือ ref — แนวต้านใกล้สุด “ภูเขาซ้าย” สำหรับ Long */
function nearestOverheadHigh(high: number[], iEval: number, lookback: number, ref: number): number | null {
  if (!Number.isFinite(ref) || ref <= 0 || iEval < 1) return null;
  const start = Math.max(0, iEval - lookback);
  let best: number | null = null;
  for (let j = start; j < iEval; j++) {
    const h = high[j]!;
    if (!Number.isFinite(h) || h <= ref) continue;
    if (best === null || h < best) best = h;
  }
  return best;
}

/** Low สูงสุดที่ยังอยู่ใต้ ref — แนวรับใกล้สุดสมมาตรฝั่ง Short */
function nearestUnderfootLow(low: number[], iEval: number, lookback: number, ref: number): number | null {
  if (!Number.isFinite(ref) || ref <= 0 || iEval < 1) return null;
  const start = Math.max(0, iEval - lookback);
  let best: number | null = null;
  for (let j = start; j < iEval; j++) {
    const x = low[j]!;
    if (!Number.isFinite(x) || x >= ref) continue;
    if (best === null || x > best) best = x;
  }
  return best;
}

/** แท่งที่ Vol สูงสุดในช่วง [i − lookback, i − 1] — High/Low ของแท่งเดียวกัน (proxy ก้อน HVN / SVP peak) */
function highVolumeNodeBarRange(
  vol: number[],
  high: number[],
  low: number[],
  i: number,
  lookback: number
): { high: number; low: number } | null {
  const start = Math.max(0, i - lookback);
  const end = i - 1;
  if (end < start) return null;
  let bestJ = start;
  let bestV = -Infinity;
  for (let j = start; j <= end; j++) {
    const v = vol[j]!;
    if (v > bestV && Number.isFinite(v)) {
      bestV = v;
      bestJ = j;
    }
  }
  const H = high[bestJ];
  const L = low[bestJ];
  return Number.isFinite(H!) && Number.isFinite(L!) ? { high: H!, low: L! } : null;
}

/** Low ของแท่งที่ Vol สูงสุดในช่วงก่อน index i — ใช้กับ SHORT “หลุดก้อน” */
function highVolumeNodeBarLow(vol: number[], high: number[], low: number[], i: number, lookback: number): number | null {
  return highVolumeNodeBarRange(vol, high, low, i, lookback)?.low ?? null;
}

/** High ของแท่งที่ Vol สูงสุดในช่วงก่อน index i — proxy VAH / ขอบบนก้อน Vol หา */
function highVolumeNodeBarHigh(vol: number[], high: number[], low: number[], i: number, lookback: number): number | null {
  return highVolumeNodeBarRange(vol, high, low, i, lookback)?.high ?? null;
}

function snowballStochSeries(
  close: number[],
  rsiP: number,
  stochLen: number,
  kSmooth: number
): number[] {
  const raw = stochRsiLine(close, rsiP, stochLen);
  if (kSmooth <= 1) return raw;
  return smaLine(raw, kSmooth);
}

function snowballVolumeOk(relax: boolean, vol: number, volSma: number, mult: number): boolean {
  if (!Number.isFinite(vol) || vol <= 0) return false;
  if (relax) return true;
  return Number.isFinite(volSma) && vol > volSma * mult;
}

/** แผนเทรดเมื่อ Master = 4h (จุดเข้า 15m + SL/TP proxy) */
type SnowballMaster4hLongTradePlan = {
  entryMarket: number;
  ema20_15m: number | null;
  entryPullbackLow: number | null;
  entryPullbackHigh: number | null;
  swingLow4h: number | null;
  ema50_4h: number | null;
  stopLoss: number | null;
  takeProfits: number[];
};

/** ครึ่งความกว้างโซนรอบ EMA20 @15m เป็นสัดส่วนของราคา (เช่น 0.003 = ±0.3%) */
function snowball4hPlanEma20PullbackBandPct(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_4H_PLAN_EMA20_PULLBACK_BAND_PCT);
  if (Number.isFinite(v) && v > 0 && v <= 0.02) return v;
  return 0.003;
}

function snowball4hPlanSlBufferPct(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_4H_PLAN_SL_BUFFER_PCT);
  if (Number.isFinite(v) && v > 0 && v <= 0.05) return v;
  return 0.002;
}

function snowball4hPlanTpLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_4H_PLAN_TP_LOOKBACK);
  if (Number.isFinite(v) && v >= 20 && v <= 200) return Math.floor(v);
  return 96;
}

function snowball4hPlanMaxTp(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_4H_PLAN_MAX_TP);
  if (Number.isFinite(v) && v >= 1 && v <= 6) return Math.floor(v);
  return 3;
}

/** แนวต้าน proxy: high ของแท่งที่ Vol สูงในกลุ่มที่ high > ราคาอ้างอิง — เรียงจากต่ำไปสูงเป็น TP1… */
function nextSvpResistanceHighsProxy(
  vol: number[],
  high: number[],
  iEval: number,
  lookback: number,
  refClose: number,
  maxLevels: number
): number[] {
  const start = Math.max(0, iEval - lookback);
  const cands: { h: number; v: number }[] = [];
  for (let j = start; j < iEval; j++) {
    const h = high[j]!;
    const vi = vol[j]!;
    if (!Number.isFinite(h) || !Number.isFinite(vi)) continue;
    if (h <= refClose + 1e-12) continue;
    cands.push({ h, v: vi });
  }
  cands.sort((a, b) => b.v - a.v);
  const out: number[] = [];
  for (const { h } of cands) {
    let dup = false;
    for (const o of out) {
      const denom = Math.max(Math.abs(o), Math.abs(h), 1e-12);
      if (Math.abs(o - h) / denom < 0.005) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    out.push(h);
    if (out.length >= maxLevels) break;
  }
  out.sort((a, b) => a - b);
  return out;
}

async function buildSnowballMaster4hLongTradePlan(
  symbol: string,
  c4: number[],
  h4: number[],
  l4: number[],
  v4: number[],
  iEval: number,
  swingLb: number,
  swingEx: number,
  entryMarket: number
): Promise<SnowballMaster4hLongTradePlan> {
  const ema50_4hArr = emaLine(c4, 50);
  const em50 = ema50_4hArr[iEval];
  const swingLow4h = minLowPriorWindow(l4, iEval, swingLb, swingEx);

  let slBase: number | null = null;
  const swOk = Number.isFinite(swingLow4h);
  const e50Ok = typeof em50 === "number" && Number.isFinite(em50);
  if (swOk && e50Ok) slBase = Math.min(swingLow4h, em50!);
  else if (swOk) slBase = swingLow4h;
  else if (e50Ok) slBase = em50!;

  const buf = snowball4hPlanSlBufferPct();
  const stopLoss =
    slBase != null && Number.isFinite(slBase) && slBase > 0 ? slBase * (1 - buf) : null;

  const tpLook = snowball4hPlanTpLookbackBars();
  const maxTp = snowball4hPlanMaxTp();
  let takeProfits = nextSvpResistanceHighsProxy(v4, h4, iEval, tpLook, entryMarket, maxTp);
  if (takeProfits.length === 0) {
    const priorH = maxHighPriorWindow(h4, iEval, swingLb, swingEx);
    if (Number.isFinite(priorH) && priorH > entryMarket) takeProfits = [priorH];
  }

  let ema20_15m: number | null = null;
  let entryPullbackLow: number | null = null;
  let entryPullbackHigh: number | null = null;
  try {
    const pack15 = await fetchBinanceUsdmKlines(symbol, "15m");
    if (pack15 && pack15.close.length >= 22) {
      const ic = pack15.close.length - 2;
      const e20 = emaLine(pack15.close, 20)[ic];
      if (typeof e20 === "number" && Number.isFinite(e20) && e20 > 0) {
        ema20_15m = e20;
        const bp = snowball4hPlanEma20PullbackBandPct();
        entryPullbackLow = e20 * (1 - bp);
        entryPullbackHigh = e20 * (1 + bp);
      }
    }
  } catch {
    /* 15m optional */
  }

  return {
    entryMarket,
    ema20_15m,
    entryPullbackLow,
    entryPullbackHigh,
    swingLow4h: swOk ? swingLow4h : null,
    ema50_4h: e50Ok ? em50! : null,
    stopLoss,
    takeProfits,
  };
}

type SnowballLongTriggerKind = "swing_hh" | "vah_break" | "both";

function buildPendingConfirmBlock(
  flags: SnowballConfirmRiskFlag[] | undefined,
  trigger: { side: "long" | "bear"; refLevel: number; volMinRatio: number } | undefined,
): string {
  if (!flags || flags.length === 0 || !trigger) return "";
  const lines: string[] = ["🟡 Pending Confirm (รอแท่งที่ 2 ปิด)"];
  for (const f of flags) {
    lines.push(`  • ${f.label}: ${f.detail}`);
  }
  const refPx = formatUsdPrice(trigger.refLevel);
  const cmp = trigger.side === "long" ? ">" : "<";
  const refName = trigger.side === "long" ? "High" : "Low";
  const volPct = Math.round(trigger.volMinRatio * 100);
  lines.push(
    `  • Trigger ยืนยัน: แท่งที่ 2 ปิด ${cmp} ${refName}=${refPx} USDT + Vol ≥ ${volPct}% ของแท่งสัญญาณ`,
  );
  lines.push("  • ถ้า confirm ผ่าน — ระบบจะส่งข้อความ ✅ Confirmed ตามมาในรอบถัดไป");
  return lines.join("\n");
}

function buildSnowballTripleCheckMessage(
  symbol: string,
  side: "bull" | "bear",
  barTimeSec: number,
  args: {
    close: number;
    refSwing: number;
    volume: number;
    volSma: number;
    stochK: number;
    lookback: number;
    /** ไม่นับ N แท่งล่าสุดก่อนแท่งสัญญาณเมื่อหา swing HH/LL */
    swingExcludeRecent?: number;
    volPeriod: number;
    rsiP: number;
    stochLen: number;
    /** Short: เกณฑ์ OS ขั้นต่ำ — Long ไม่ใช้กรองจากฟิลด์นี้แล้ว */
    stochLimit?: number;
    /** แสดงในหัวข้อข้อความ (เช่น 4h / 15m) */
    snowballTfDisplay: string;
    emaResistancePeriod: number;
    emaResistance: number;
    svpHdInnerLb: number;
    svpHdLow: number;
    svpHdRequiredOk: boolean;
    /** แท่งสัญญาณยังไม่ปิด — ประเมินจาก kline ล่าสุดจาก Binance */
    intrabar?: boolean;
    longTriggerKind?: SnowballLongTriggerKind;
    vahHighLevel?: number | null;
    longVahLookback?: number;
    /** เมื่อผ่อนเกณฑ์ปริมาณใน intrabar */
    volCheckRelaxed?: boolean;
    /** ขอบบนก้อน Vol หา (inner lookback) — กรอง Long ไม่ให้แจ้งเมื่อยังหมกใต้ก้อน */
    innerHvnHigh?: number | null;
    innerHvnLookback?: number;
    innerHvnCleared?: boolean;
    /** EMA slope ยืนยันโมเมนตัม */
    emaSlopePeriod?: number;
    emaSlopeNow?: number;
    emaSlopePrev?: number;
    emaSlopeOk?: boolean;
    ema2SlopePeriod?: number;
    ema2SlopeOk?: boolean;
    /** เมื่อสัญญาณ Master = 4h — แผน Entry / SL / TP (จุดเข้า 15m) */
    master4hTradePlan?: SnowballMaster4hLongTradePlan | null;
    /** Double Barrier: หัวข้อ A+ / B+ และบรรทัดอธิบาย Barrier 2 */
    doubleBarrierEnabled?: boolean;
    snowballQualityTier?: SnowballQualityTier;
    doubleBarrierChecklistLine?: string;
    /** Short: ชั้นคุณภาพสมมาตร (แนวรับใต้เท้าในโซน %) */
    shortQualityTier?: SnowballQualityTier;
    shortDoubleBarrierChecklistLine?: string;
    /** Confirming Bar — flag ความเสี่ยงจาก 3 gates ที่ต้องรอแท่งที่ 2 ยืนยัน */
    confirmRiskFlags?: SnowballConfirmRiskFlag[];
    /** เกณฑ์การ confirm ที่จะใช้กับแท่งที่ 2 — ราคาเทียบ + อัตราส่วนปริมาณขั้นต่ำ */
    confirmTrigger?: {
      side: "long" | "bear";
      refLevel: number;
      volMinRatio: number;
    };
  }
): string {
  const pair = pairSlashNoDollar(symbol);
  const bkk = formatClosedCandleBkk(barTimeSec);
  const px = formatUsdPrice(args.close);
  const playbookRefPx = formatUsdPrice(args.refSwing);
  const emaPx = formatUsdPrice(args.emaResistance);
  const hvnPx = formatUsdPrice(args.svpHdLow);
  const volRatio =
    args.volSma > 0 && Number.isFinite(args.volSma)
      ? (args.volume / args.volSma).toFixed(2)
      : "—";
  const vahLb = args.longVahLookback ?? 20;
  const vahLvl = args.vahHighLevel;

  if (side === "bull") {
    const trig: SnowballLongTriggerKind = args.longTriggerKind ?? "swing_hh";
    const sniperSuffix = args.intrabar ? " · ⚡ Sniper (แท่งกำลังก่อน)" : "";
    const timeLine = args.intrabar
      ? `⏰ เปิดแท่ง ~ ${bkk} · intrabar · ข้อมูลอาจเปลี่ยนจนกว่าจะปิดแท่ง ${args.snowballTfDisplay}`
      : `⏰ Closed candle: ${bkk}`;

    let hhBullet = "";
    if (trig === "swing_hh" || trig === "both") {
      const ex = args.swingExcludeRecent ?? 0;
      const exNote =
        ex > 0
          ? ` — ไม่นับแท่งล่าสุด ${ex} แท่งก่อนแท่งนี้ (กันยอด impulse เดียวกันเป็นเพดาน)`
          : "";
      hhBullet += `• เงื่อนไข Swing HH: ${args.intrabar ? "ระดับ High แท่งนี้" : "ปิด "}เหนือ High ใน ${args.lookback} แท่งก่อนหน้า${exNote} (ระดับอ้างอิง swing ~ ${playbookRefPx})`;
    }
    if (trig === "vah_break" || trig === "both") {
      const vahPx = vahLvl != null && Number.isFinite(vahLvl) ? formatUsdPrice(vahLvl) : "—";
      hhBullet +=
        (hhBullet ? "\n" : "") +
        `• เงื่อนไข VAH proxy: ทะลุ High แท่ง Vol หาใน ${vahLb} แท่งล่าสุด (~ ${vahPx} USDT) — ไวกว่ารอเบรคยอดเก่าไกล ๆ`;
    }

    const volLine = args.volCheckRelaxed
      ? `• Volume: โหมด Sniper — ไม่บังคับ Vol > SMA(ยังก่อนแท่ง) · อัตราส่วนสะสม ~ ${volRatio}x`
      : `• Volume: Vol แท่งนี้ > SMA(${args.volPeriod}) — อัตราส่วน ~ ${volRatio}x (กันท้ายไส้หลอก)`;

    const innerLb = args.innerHvnLookback ?? args.svpHdInnerLb;
    const innerHvnPx =
      args.innerHvnHigh != null && Number.isFinite(args.innerHvnHigh)
        ? formatUsdPrice(args.innerHvnHigh)
        : "—";
    const svpLongLine =
      args.innerHvnCleared === true
        ? `• SVP/HVN (proxy): ราคาโผล่เหนือขอบบนก้อน Vol หาใน ${innerLb} แท่งก่อนแท่งสัญญาณ (~ ${innerHvnPx} USDT) — แจ้งเฉพาะเมื่อไม่หมกใต้ก้อนหนา (โซนโปร่งด้านบน)`
        : "";

    const emaSlopeP = args.emaSlopePeriod ?? 20;
    const emaSlopeLine =
      args.emaSlopeOk === true &&
      args.emaSlopeNow !== undefined &&
      args.emaSlopePrev !== undefined
        ? `• EMA(${emaSlopeP}) slope: ${args.emaSlopeNow.toFixed(4)} > ${args.emaSlopePrev.toFixed(4)} — เชิดหัวขึ้น (โมเมนตัมไม่ใช่แค่แท่งดีดหลอก)`
        : "";

    const ema2Line =
      args.ema2SlopeOk === true && typeof args.ema2SlopePeriod === "number"
        ? `• Trend alignment: EMA(${emaSlopeP}) + EMA(${args.ema2SlopePeriod}) เชิดหัวคู่ — เทรนด์หนุน`
        : "";

    const checklistBody = [
      hhBullet,
      volLine,
      svpLongLine,
      emaSlopeLine,
      `• Stoch RSI (${args.rsiP}/${args.stochLen}) บนแท่งปิดล่าสุด: ${args.stochK.toFixed(1)} — แสดงประกอบ (ไม่ใช้กรอง Long)`,
    ]
      .filter((x) => x.length > 0)
      .join("\n");
    const checklistBodyWithTrend = [checklistBody, ema2Line].filter((x) => x.length > 0).join("\n");
    const barrier2 =
      args.doubleBarrierEnabled && args.doubleBarrierChecklistLine
        ? args.doubleBarrierChecklistLine
        : "";

    const plan = args.master4hTradePlan;
    let planBlock = "";
    if (plan) {
      const lines: string[] = [
        "🎯 แผนเทรด (Master 4h · จุดเข้าอ้างอิง 15m)",
        `• Entry 1 (Market): ~ ${formatUsdPrice(plan.entryMarket)} USDT`,
      ];
      if (
        plan.ema20_15m != null &&
        plan.entryPullbackLow != null &&
        plan.entryPullbackHigh != null
      ) {
        lines.push(
          `• Entry 2 (Pullback): โซนรอบ EMA20 @15m ~ ${formatUsdPrice(plan.entryPullbackLow)} – ${formatUsdPrice(plan.entryPullbackHigh)} USDT (กลาง ~ ${formatUsdPrice(plan.ema20_15m)})`
        );
      } else {
        lines.push("• Entry 2 (Pullback): ไม่มีข้อมูล 15m เพียงพอ — ดู EMA20 @15m บนกราฟ");
      }
      const swS = plan.swingLow4h != null ? formatUsdPrice(plan.swingLow4h) : "—";
      const e50S = plan.ema50_4h != null ? formatUsdPrice(plan.ema50_4h) : "—";
      if (plan.stopLoss != null) {
        lines.push(
          `• Stop Loss: ใต้ min(Swing low 4h ~ ${swS} / EMA50 4h ~ ${e50S}) — แนะนำใต้ ~ ${formatUsdPrice(plan.stopLoss)} USDT (+ buffer ตาม INDICATOR_PUBLIC_SNOWBALL_4H_PLAN_SL_BUFFER_PCT)`
        );
      } else {
        lines.push(
          `• Stop Loss: อ้างอิง Swing low 4h ~ ${swS} และ EMA50 4h ~ ${e50S} — วางใต้โครงสร้างบนกราฟ`
        );
      }
      if (plan.takeProfits.length > 0) {
        const tpStr = plan.takeProfits
          .map((p, idx) => `TP${idx + 1} ~ ${formatUsdPrice(p)}`)
          .join(" · ");
        lines.push(`• Take profit (แนวต้าน SVP/HVN proxy เหนือราคา): ${tpStr} USDT`);
      } else {
        lines.push(
          "• Take profit: ไม่พบแท่ง Vol หาเหนือราคาใน lookback — ใช้ยอดถัดไปบนกราฟ / โครงสร้าง"
        );
      }
      lines.push("📎 SVP = proxy จาก Vol บนแท่ง 4h ไม่ใช่ Session VP จริง");
      planBlock = lines.join("\n");
    }

    const dbLong = Boolean(args.doubleBarrierEnabled && args.snowballQualityTier);
    const longHeadline = !dbLong
      ? `🟢 [LONG Candidate] — Snowball Triple-Check (${args.snowballTfDisplay})${sniperSuffix}`
      : args.snowballQualityTier === "b_plus"
        ? `🟡 [WATCHLIST - B+] — Snowball Triple-Check (${args.snowballTfDisplay})${sniperSuffix}`
        : `🟢 [SUPER SNOWBALL - A+] — Snowball Triple-Check (${args.snowballTfDisplay})${sniperSuffix}`;

    const out: string[] = [
      longHeadline,
      `${pair} — Binance USDT-M`,
      "",
      `💼 Playbook:`,
      `"ทรงมาดี มีแรงส่งสะสม รอเข้าเมื่อย่อ (Buy the Dip) ที่แนวรับ ~ ${playbookRefPx} USDT"`,
      "",
      timeLine,
      "",
      `✅ เช็คลิสต์:`,
      [checklistBodyWithTrend, barrier2].filter((x) => x.length > 0).join("\n"),
    ];
    if (planBlock) {
      out.push("", planBlock);
    }
    const pendingBlockLong = buildPendingConfirmBlock(args.confirmRiskFlags, args.confirmTrigger);
    if (pendingBlockLong) {
      out.push("", pendingBlockLong);
    }
    out.push(
      "",
      `📊 ราคาในข้อความ ~ ${px} USDT — Stoch จากแท่งปิดล่าสุด (แสดงประกอบ ไม่ใช้กรอง Long)`,
      "",
      "⚠️ Not financial advice"
    );
    return out.join("\n");
  }

  const svpBrokenBelowHvn =
    Number.isFinite(args.close) &&
    Number.isFinite(args.svpHdLow) &&
    args.close < args.svpHdLow - 1e-12;

  const svpLine = args.svpHdRequiredOk
    ? `📍 โปร · SVP/HVN (proxy): ปิดใต้ Low แท่ง Vol หาใน ${args.svpHdInnerLb} แท่งล่าสุด (~ ${hvnPx} USDT) — ผ่านเกณฑ์กรอง “หลุดก้อน”`
    : `📍 โปร · SVP/HVN (proxy): จุด Vol หาใน ${args.svpHdInnerLb} แท่งล่าสุด — Low ~ ${hvnPx} USDT (ตั้ง INDICATOR_PUBLIC_SNOWBALL_SHORT_REQUIRE_SVP_HD=1 เพื่อให้มีสัญญาณเมื่อหลุดก้อนนี้จริง ๆ)`;

  const playbookShortLead =
    svpBrokenBelowHvn || args.svpHdRequiredOk
      ? "เสียทรงชัดเจน — โปร: หลุดโครงสร้าง + ก้อน Vol หาแบบ SVP/HVN (proxy)"
      : "เสียทรงชัดเจน — LL + Vol เข้า (ก้อน Vol หา/SVP proxy ดูบรรทัดด้านล่าง)";

  const bearSniperSuffix = args.intrabar ? " · ⚡ Sniper (แท่งกำลังก่อน)" : "";
  const bearTimeLine = args.intrabar
    ? `⏰ เปิดแท่ง ~ ${bkk} · intrabar · ข้อมูลอาจเปลี่ยนจนกว่าจะปิดแท่ง ${args.snowballTfDisplay}`
    : `⏰ Closed candle: ${bkk}`;
  const bearVolLine = args.volCheckRelaxed
    ? `• Volume: โหมด Sniper — ไม่บังคับ Vol > SMA · อัตราส่วนสะสม ~ ${volRatio}x`
    : `• Volume: Vol แท่งนี้ > SMA(${args.volPeriod}) — อัตราส่วน ~ ${volRatio}x`;
  const refPx = formatUsdPrice(args.refSwing);

  const dbShort = Boolean(args.doubleBarrierEnabled && args.shortQualityTier);
  const shortHeadline = !dbShort
    ? `🔴 [SHORT Candidate] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`
    : args.shortQualityTier === "b_plus"
      ? `🟡 [WATCHLIST - B+] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`
      : `🔴 [SUPER SNOWBALL - A+] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`;
  const bearBarrier2 =
    args.doubleBarrierEnabled && args.shortDoubleBarrierChecklistLine
      ? args.shortDoubleBarrierChecklistLine
      : "";

  const pendingBlockBear = buildPendingConfirmBlock(args.confirmRiskFlags, args.confirmTrigger);

  const bearOut: string[] = [
    shortHeadline,
    `${pair} — Binance USDT-M`,
    "",
    `💼 Playbook:`,
    `"${playbookShortLead} · รอเด้งเพื่อเปิด Short (Sell the Rally) ที่แนวต้าน EMA(${args.emaResistancePeriod}) ~ ${emaPx} USDT"`,
    "",
    svpLine,
    "",
    bearTimeLine,
    "",
    `✅ เช็คลิสต์:`,
    `• เงื่อนไข 1 (LL): ${args.intrabar ? "Low intrabar " : "ปิด "}หลุด Low ใน ${args.lookback} แท่งก่อนหน้า${
      (args.swingExcludeRecent ?? 0) > 0
        ? ` — ไม่นับแท่งล่าสุด ${args.swingExcludeRecent} แท่งก่อนแท่งนี้ (กันพื้น impulse เดียวกัน)`
        : ""
    } (ระดับอ้างอิง swing ~ ${refPx}) · ราคา ~ ${px}`,
    ...(bearBarrier2 ? [bearBarrier2] : []),
    bearVolLine,
    `• Stoch RSI (${args.rsiP}/${args.stochLen}) แท่งปิดล่าสุด: ${args.stochK.toFixed(1)} > ${args.stochLimit!.toFixed(0)} — ยังไม่ OS เกินไป`,
    "",
    `📊 Stoch RSI (${args.snowballTfDisplay}) · กันสัญญาณ LL ที่ OS ติดใต้ดินแล้ว`,
  ];
  if (pendingBlockBear) {
    bearOut.push("", pendingBlockBear);
  }
  bearOut.push("", "⚠️ Not financial advice");
  return bearOut.join("\n");
}

function formatUsdPrice(p: number): string {
  const abs = Math.abs(p);
  const opts: Intl.NumberFormatOptions =
    abs >= 1000
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : abs >= 1
        ? { minimumFractionDigits: 2, maximumFractionDigits: 4 }
        : { minimumFractionDigits: 4, maximumFractionDigits: 8 };
  return p.toLocaleString("en-US", opts);
}

function williamsFractalHigh(high: number[], i: number, wing: number): boolean {
  if (i < wing || i + wing >= high.length) return false;
  const h = high[i]!;
  for (let k = -wing; k <= wing; k++) {
    if (k === 0) continue;
    if (h <= high[i + k]!) return false;
  }
  return true;
}

function williamsFractalLow(low: number[], i: number, wing: number): boolean {
  if (i < wing || i + wing >= low.length) return false;
  const x = low[i]!;
  for (let k = -wing; k <= wing; k++) {
    if (k === 0) continue;
    if (x >= low[i + k]!) return false;
  }
  return true;
}

function collectFractalHighIndices(high: number[], lastClosedIdx: number, wing: number): number[] {
  const out: number[] = [];
  for (let p = wing; p <= lastClosedIdx - wing; p++) {
    if (williamsFractalHigh(high, p, wing)) out.push(p);
  }
  return out;
}

function collectFractalLowIndices(low: number[], lastClosedIdx: number, wing: number): number[] {
  const out: number[] = [];
  for (let p = wing; p <= lastClosedIdx - wing; p++) {
    if (williamsFractalLow(low, p, wing)) out.push(p);
  }
  return out;
}

function minInRange(arr: number[], a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let m = Infinity;
  for (let j = lo; j <= hi; j++) m = Math.min(m, arr[j]!);
  return m;
}

function maxInRange(arr: number[], a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let m = -Infinity;
  for (let j = lo; j <= hi; j++) m = Math.max(m, arr[j]!);
  return m;
}

type RsiDivKind = "bearish" | "bullish";

type RsiDivTriggerKind = "rsi_ma_cross" | "price_break_prev";

type RsiDivergenceHit = {
  kind: RsiDivKind;
  wave1Idx: number;
  wave2Idx: number;
  priceW1: number;
  priceW2: number;
  rsiW1: number;
  rsiW2: number;
  trigger: RsiDivTriggerKind;
  refLevel: number;
};

/**
 * 2 Waves + Confirmation (Koji filter)
 * Bull: W1 = fractal low + RSI โซน oversold · W2 = low ต่ำกว่า W1 แต่ RSI สูงกว่า W1 ชัดเจน
 * ยืนยันที่แท่งปิดล่าสุด: RSI ตัด SMA(RSI) ขึ้น หรือ close > high แท่งก่อนหน้า
 * Bear: สมมาตร (overbought · lower high RSI · ยืนยัน: ตัด MA ลง หรือ close < low แท่งก่อน)
 */
function detectRsiDivergence(
  high: number[],
  low: number[],
  close: number[],
  rsi: number[],
  lastClosedIdx: number,
  rsiPeriod: number,
  wing: number,
  minGap: number
): RsiDivergenceHit | null {
  if (lastClosedIdx < rsiPeriod) return null;

  const lookback = divergenceLookbackBars();
  const oversold = divergenceOversoldThreshold();
  const overbought = divergenceOverboughtThreshold();
  const rsiMaLen = divergenceRsiMaPeriod();
  const minWaveDelta = divergenceWaveMinRsiDelta();

  const startIdx = Math.max(rsiPeriod, wing, lastClosedIdx - lookback + 1);
  const highs = collectFractalHighIndices(high, lastClosedIdx, wing).filter((p) => p >= startIdx);
  const lows = collectFractalLowIndices(low, lastClosedIdx, wing).filter((p) => p >= startIdx);

  const rsiMa = smaLine(rsi, rsiMaLen);
  const iNow = lastClosedIdx;
  const iPrev = lastClosedIdx - 1;
  if (iPrev < 0) return null;

  const rNow = rsi[iNow];
  const rPrev = rsi[iPrev];
  const maNow = rsiMa[iNow];
  const maPrev = rsiMa[iPrev];
  if (!Number.isFinite(rNow) || !Number.isFinite(rPrev) || !Number.isFinite(maNow) || !Number.isFinite(maPrev)) {
    return null;
  }

  const crossUp = rNow > maNow && rPrev <= maPrev;
  const crossDown = rNow < maNow && rPrev >= maPrev;
  const bullPriceBreak = close[iNow]! > high[iPrev]!;
  const bearPriceBreak = close[iNow]! < low[iPrev]!;

  for (let wi = lows.length - 1; wi >= 1; wi--) {
    const i2 = lows[wi]!;
    if (i2 + wing > lastClosedIdx) continue;
    if (i2 >= iNow) continue;
    for (let wj = wi - 1; wj >= 0; wj--) {
      const i1 = lows[wj]!;
      if (i2 - i1 < minGap) continue;
      const r1 = rsi[i1];
      const r2 = rsi[i2];
      if (!Number.isFinite(r1) || !Number.isFinite(r2)) continue;
      if (r1 >= oversold) continue;
      if (low[i2]! >= low[i1]!) continue;
      if (r2 <= r1 + minWaveDelta) continue;

      let trigger: RsiDivTriggerKind | null = null;
      if (crossUp) trigger = "rsi_ma_cross";
      else if (bullPriceBreak) trigger = "price_break_prev";
      if (!trigger) continue;

      return {
        kind: "bullish",
        wave1Idx: i1,
        wave2Idx: i2,
        priceW1: low[i1]!,
        priceW2: low[i2]!,
        rsiW1: r1,
        rsiW2: r2,
        trigger,
        refLevel: maxInRange(high, i1, i2),
      };
    }
  }

  for (let wi = highs.length - 1; wi >= 1; wi--) {
    const i2 = highs[wi]!;
    if (i2 + wing > lastClosedIdx) continue;
    if (i2 >= iNow) continue;
    for (let wj = wi - 1; wj >= 0; wj--) {
      const i1 = highs[wj]!;
      if (i2 - i1 < minGap) continue;
      const r1 = rsi[i1];
      const r2 = rsi[i2];
      if (!Number.isFinite(r1) || !Number.isFinite(r2)) continue;
      if (r1 <= overbought) continue;
      if (high[i2]! <= high[i1]!) continue;
      if (r2 >= r1 - minWaveDelta) continue;

      let trigger: RsiDivTriggerKind | null = null;
      if (crossDown) trigger = "rsi_ma_cross";
      else if (bearPriceBreak) trigger = "price_break_prev";
      if (!trigger) continue;

      return {
        kind: "bearish",
        wave1Idx: i1,
        wave2Idx: i2,
        priceW1: high[i1]!,
        priceW2: high[i2]!,
        rsiW1: r1,
        rsiW2: r2,
        trigger,
        refLevel: minInRange(low, i1, i2),
      };
    }
  }

  return null;
}

function buildRsiDivergenceMessage(
  symbol: string,
  tfLabel: string,
  hit: RsiDivergenceHit,
  strongDelta: number
): string {
  const pair = pairSlashNoDollar(symbol);
  const rsiDelta = Math.abs(hit.rsiW1 - hit.rsiW2);
  const strong = rsiDelta >= strongDelta;

  const header = hit.kind === "bearish" ? "[ 🔴 Bearish Divergence ]" : "[ 🟢 Bullish Divergence ]";
  const subtitle = `[ ${pair} ] — TF ${tfLabel}`;

  const signalEmoji = hit.kind === "bearish" ? "📉" : "📈";
  const signalText =
    hit.kind === "bearish" ? "Price HH vs RSI LH (Confirmed)" : "Price LL vs RSI HL (Confirmed)";

  const pW2 = formatUsdPrice(hit.priceW2);
  const pW1 = formatUsdPrice(hit.priceW1);
  const r2 = hit.rsiW2.toFixed(0);
  const r1 = hit.rsiW1.toFixed(0);
  const dataLine = `📊 Data: $${pW2} (RSI ${r2}) vs $${pW1} (RSI ${r1})`;

  const statusLine = strong
    ? "🚨 Status: Strong Warning — Momentum Exhausted"
    : "🚨 Status: Warning — Momentum Divergence";

  const refS = formatUsdPrice(hit.refLevel);
  const insightQuote =
    hit.kind === "bearish"
      ? `แรงซื้อแผ่วชัดเจน ระวังเทกระจาดหากหลุด $${refS}`
      : `แรงขายแผ่วชัดเจน ระวังดีดย้อนหากยืนเหนือ $${refS}`;

  return [
    header,
    subtitle,
    "",
    `${signalEmoji} Signal: ${signalText}`,
    dataLine,
    statusLine,
    "",
    `🦉 Koji's Insight:`,
    `"${insightQuote}"`,
    "",
    "⚠️ Not financial advice",
  ].join("\n");
}

function isSnowball4hScanSummaryToChatEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_4H_SCAN_SUMMARY_TO_CHAT", true);
}

function snowballScanSummaryMaxSymbols(): number {
  const n = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SCAN_SUMMARY_MAX_SYMBOLS?.trim());
  return Number.isFinite(n) && n >= 5 && n <= 120 ? Math.floor(n) : 45;
}

function pushSnowScanSymList(list: string[], entry: string): void {
  const max = snowballScanSummaryMaxSymbols();
  if (list.length >= max) return;
  if (list.includes(entry)) return;
  list.push(entry);
}

function formatSymbolListLines(indent: string, symbols: string[]): string[] {
  if (symbols.length === 0) return [];
  const max = snowballScanSummaryMaxSymbols();
  const shown = symbols.slice(0, max);
  const tail = symbols.length > max ? ` … (+${symbols.length - max})` : "";
  const joined = shown.join(", ");
  const lines: string[] = [];
  const chunk = 900;
  if (joined.length + indent.length <= chunk) {
    lines.push(`${indent}(${joined}${tail})`);
    return lines;
  }
  lines.push(`${indent}(รายการยาว — แสดงบรรทัดต่อไป)`);
  let rest = `${shown.join(", ")}${tail}`;
  while (rest.length > 0) {
    lines.push(`${indent}${rest.slice(0, chunk)}`);
    rest = rest.slice(chunk);
  }
  return lines;
}

type Snowball4hScanSummaryStats = {
  closedBarOpenSec: number | null;
  withPack: number;
  noPack: number;
  skippedBars: number;
  skippedStoch: number;
  longTechPass: number;
  longTechPassSymbols: string[];
  /** เนื้อเทียนเทียบช่วงต่ำกว่าเกณฑ์ (ไส้ยาว) */
  longBodyRatioBlocked: number;
  longBodyRatioBlockedSymbols: string[];
  longDeduped: number;
  longDedupedSymbols: string[];
  /** กันยิงซ้ำในคลื่นเดิม (Long) */
  longWaveBlocked: number;
  longWaveBlockedSymbols: string[];
  longSent: number;
  longSentSymbols: string[];
  /** แท่ง 1 ผ่านแล้วคิวรอ confirm (ไม่ส่ง TG) */
  longPendingSkipTg: number;
  longPendingSkipTgSymbols: string[];
  bearTechPass: number;
  bearTechPassSymbols: string[];
  /** เนื้อเทียนเทียบช่วงต่ำกว่าเกณฑ์ (ไส้ยาว) */
  bearBodyRatioBlocked: number;
  bearBodyRatioBlockedSymbols: string[];
  bearDeduped: number;
  bearDedupedSymbols: string[];
  /** กันยิงซ้ำในคลื่นเดิม (Bear) */
  bearWaveBlocked: number;
  bearWaveBlockedSymbols: string[];
  bearSent: number;
  bearSentSymbols: string[];
  bearPendingSkipTg: number;
  bearPendingSkipTgSymbols: string[];
  errors: string[];
};

function pushSnowScanErr(stats: Snowball4hScanSummaryStats, line: string): void {
  const s = line.length > 140 ? `${line.slice(0, 137)}...` : line;
  if (stats.errors.length >= 24) return;
  stats.errors.push(s);
}

function tfBarDurationSecForSummary(tf: BinanceIndicatorTf): number {
  if (tf === "15m") return 15 * 60;
  if (tf === "1h") return 3600;
  return 4 * 3600;
}

function fmtBkkFromUnixSecForSummary(sec: number): string {
  const d = new Date(sec * 1000);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time} BKK`;
}

function formatSnowball4hScanSummaryMessage(opts: {
  iso: string;
  universeLen: number;
  snowballTopAlts: number;
  stats: Snowball4hScanSummaryStats;
  barOpenSec: number;
  snowTf: BinanceIndicatorTf;
  confirmLastRound: SnowballConfirmLastRoundStats;
}): string[] {
  const { iso, universeLen, snowballTopAlts, stats, barOpenSec, snowTf, confirmLastRound } = opts;
  const dur = tfBarDurationSecForSummary(snowTf);
  const barCloseSec = barOpenSec + dur;
  const lines: string[] = [];
  lines.push(`🧪 Snowball ${snowTf} — สรุปหลังสแกนแท่งปิด`);
  lines.push(`UTC: ${iso}`);
  lines.push(`แท่ง: เปิด ${fmtBkkFromUnixSecForSummary(barOpenSec)} → ปิด ${fmtBkkFromUnixSecForSummary(barCloseSec)}`);
  lines.push("");
  lines.push("— สแกน —");
  lines.push(`Universe: ${universeLen} สัญญา (fetch top ~${snowballTopAlts} alts + BTC/ETH)`);
  lines.push(`มี kline Snowball: ${stats.withPack}`);
  lines.push(`ไม่มี kline (null): ${stats.noPack}`);
  lines.push(`ข้าม (แท่งไม่พอ minBars): ${stats.skippedBars}`);
  lines.push(`ข้าม (Stoch แท่งปิดไม่ finite): ${stats.skippedStoch}`);
  lines.push("");
  lines.push("— Long (แท่งปิด) —");
  lines.push(`ครบเกณฑ์ (ถึงก่อน dedupe/cooldown): ${stats.longTechPass}`);
  lines.push(...formatSymbolListLines("  ", stats.longTechPassSymbols));
  lines.push(`ติดกรองเนื้อเทียน/ช่วง (ไส้ยาว): ${stats.longBodyRatioBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.longBodyRatioBlockedSymbols));
  lines.push(`ติด dedupe หรือ cooldown: ${stats.longDeduped}`);
  lines.push(...formatSymbolListLines("  ", stats.longDedupedSymbols));
  lines.push(`ติด wave gate (คลื่นเดิม): ${stats.longWaveBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.longWaveBlockedSymbols));
  lines.push(`ส่ง Telegram สำเร็จ (แท่ง 1): ${stats.longSent}`);
  lines.push(...formatSymbolListLines("  ", stats.longSentSymbols));
  lines.push(`แท่ง 1 คิวรอ confirm (ไม่ส่ง TG): ${stats.longPendingSkipTg}`);
  lines.push(...formatSymbolListLines("  ", stats.longPendingSkipTgSymbols));
  lines.push("");
  lines.push("— Bear (แท่งปิด) —");
  lines.push(`ครบเกณฑ์ (ถึงก่อน dedupe/cooldown): ${stats.bearTechPass}`);
  lines.push(...formatSymbolListLines("  ", stats.bearTechPassSymbols));
  lines.push(`ติดกรองเนื้อเทียน/ช่วง (ไส้ยาว): ${stats.bearBodyRatioBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.bearBodyRatioBlockedSymbols));
  lines.push(`ติด dedupe หรือ cooldown: ${stats.bearDeduped}`);
  lines.push(...formatSymbolListLines("  ", stats.bearDedupedSymbols));
  lines.push(`ติด wave gate (คลื่นเดิม): ${stats.bearWaveBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.bearWaveBlockedSymbols));
  lines.push(`ส่ง Telegram สำเร็จ (แท่ง 1): ${stats.bearSent}`);
  lines.push(...formatSymbolListLines("  ", stats.bearSentSymbols));
  lines.push(`แท่ง 1 คิวรอ confirm (ไม่ส่ง TG): ${stats.bearPendingSkipTg}`);
  lines.push(...formatSymbolListLines("  ", stats.bearPendingSkipTgSymbols));

  lines.push("");
  lines.push("— Confirm แท่ง 2 (รอบ cron snowballConfirm ก่อนสแกนนี้) —");
  lines.push(
    confirmLastRound.atIso
      ? `บันทึกรอบ: ${confirmLastRound.atIso}`
      : "บันทึกรอบ: — (ยังไม่เคยรัน confirm หรือไม่มี state)",
  );
  lines.push(`ยืนยันสำเร็จ (ส่ง TG): ${confirmLastRound.confirmed.length}`);
  lines.push(...formatSymbolListLines("  ", confirmLastRound.confirmed));
  lines.push(`ยืนยันไม่ผ่าน / หมดอายุ / ข้อมูลแท่ง: ${confirmLastRound.failed.length}`);
  lines.push(...formatSymbolListLines("  ", confirmLastRound.failed));
  lines.push(`ผ่านเกณฑ์แต่ส่ง TG ไม่สำเร็จ: ${confirmLastRound.tgFailed.length}`);
  lines.push(...formatSymbolListLines("  ", confirmLastRound.tgFailed));

  if (stats.errors.length > 0) {
    lines.push("");
    lines.push("— errors —");
    for (const e of stats.errors) lines.push(`  • ${e}`);
  }
  lines.push("");
  lines.push("ปิดข้อความนี้: INDICATOR_PUBLIC_SNOWBALL_4H_SCAN_SUMMARY_TO_CHAT=0");
  return lines;
}

/**
 * Feed สาธารณะ RSI cross + EMA cross + RSI divergence จาก Binance USDT-M (ค่าเริ่ม TF เดียวกันที่ 4h — RSI/EMA: INDICATOR_PUBLIC_RSI_EMA_TF, Div: INDICATOR_PUBLIC_RSI_DIVERGENCE_TFS)
 * + Snowball Triple-Check (TF จาก INDICATOR_PUBLIC_SNOWBALL_TF — universe alt ตาม INDICATOR_PUBLIC_SNOWBALL_TOP_ALTS ดีฟอลต์ 100; RSI/EMA/Div ยังใช้ INDICATOR_PUBLIC_TOP_ALTS)
 *   Double Barrier: Barrier1 = swing lookback เดิม · Barrier2 = แนว High/Low ย้อน 200 แท่งในโซน Watchlist % → 🟡 B+ / 🟢/🔴 A+
 */
export async function runPublicIndicatorFeedInternal(_client: Client, now: number): Promise<number> {
  void _client;
  if (!isIndicatorPublicFeedEnabled()) return 0;
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isBinanceIndicatorFapiEnabled()) return 0;
  if (!telegramSparkSystemGroupConfigured()) {
    console.warn(
      "[indicatorPublicFeed] ไม่มี TELEGRAM_BOT_TOKEN + TELEGRAM_PUBLIC_CHAT_ID (หรือ TELEGRAM_SPARK_SYSTEM_CHAT_ID) — ข้าม public indicator feed"
    );
    return 0;
  }

  // กัน cron ซ้อนกัน (โดยเฉพาะบน Vercel ที่อาจมีหลาย instance) — ถ้าไม่มี Redis/KV state จะไม่ persist และทำให้ยิงซ้ำง่ายมาก
  let locked = false;
  if (useCloudStorage()) {
    try {
      locked = await acquireIndicatorPublicFeedLock();
    } catch (e) {
      console.error("[indicatorPublicFeed] acquire lock failed", e);
      locked = false;
    }
    if (!locked) {
      console.info("[indicatorPublicFeed] skipped (lock busy)");
      return 0;
    }
  }

  try {
  const rsiOn = envFlagOn("INDICATOR_PUBLIC_RSI_ENABLED", true);
  const emaOn = envFlagOn("INDICATOR_PUBLIC_EMA_ENABLED", true);
  const divOn = isPublicRsiDivergenceEnabled();
  const divergenceTfs = divOn ? publicRsiDivergenceTfs() : [];
  const rsiEmaTf = publicRsiEmaCrossTf();
  const needDiv1hExtra = divOn && divergenceTfs.includes("1h") && rsiEmaTf !== "1h";
  const needDiv4hExtra = divOn && divergenceTfs.includes("4h") && rsiEmaTf !== "4h";
  const snowballOn = isPublicSnowballTripleCheckEnabled();
  if (!rsiOn && !emaOn && !divOn && !snowballOn) return 0;

  const baseTopAlts = topAltsCount();
  const snowballTopAlts = snowballUniverseTopAltsCount();
  const fetchUniverseTopN = snowballOn ? Math.max(baseTopAlts, snowballTopAlts) : baseTopAlts;
  const symbols = await getUniverseSymbols(fetchUniverseTopN);
  if (symbols.length === 0) return 0;
  /** RSI / EMA / Div: เฉพาะ BTC + ETH + alt ตาม INDICATOR_PUBLIC_TOP_ALTS ตัวแรกของลิสต์ volume */
  const maxIdxCoreFeed = baseTopAlts <= 0 ? 2 : Math.min(symbols.length, 2 + baseTopAlts);

  const rsiP = rsiParams();
  const emaP = emaParams();
  if (emaP.fast >= emaP.slow) {
    console.warn("[indicatorPublicFeed] EMA fast >= slow — ข้าม EMA");
  }

  const concurrency = 8;
  const packsCore: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const packsDiv1hExtra: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const packsDiv4hExtra: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const snowTf = snowballBinanceTf();
  const snowballPacks: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const snowFetchBars = snowballOn
    ? Math.max(
        250,
        (snowballDoubleBarrierEnabled() ? snowballDoubleBarrierLookbackBars() : 0) + 50,
        snowballSwingLookbackBars() + snowballSwingExcludeRecentBars() + 50,
        snowballLongTrendEma2Enabled() ? snowballLongTrendEma2Period() + 50 : 0,
      )
    : 0;
  for (let i = 0; i < symbols.length; i += concurrency) {
    const chunk = symbols.slice(i, i + concurrency);
    const partCore = await Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, rsiEmaTf)));
    packsCore.push(...partCore);
    if (needDiv1hExtra) {
      const p1 = await Promise.all(
        chunk.map((s, j) => {
          const globalIdx = i + j;
          return globalIdx < maxIdxCoreFeed
            ? fetchBinanceUsdmKlines(s, "1h")
            : Promise.resolve(null);
        })
      );
      packsDiv1hExtra.push(...p1);
    } else {
      packsDiv1hExtra.push(...chunk.map(() => null));
    }
    if (needDiv4hExtra) {
      const p4 = await Promise.all(
        chunk.map((s, j) => {
          const globalIdx = i + j;
          return globalIdx < maxIdxCoreFeed
            ? fetchBinanceUsdmKlines(s, "4h")
            : Promise.resolve(null);
        })
      );
      packsDiv4hExtra.push(...p4);
    } else {
      packsDiv4hExtra.push(...chunk.map(() => null));
    }
    if (snowballOn) {
      const partSb = await Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, snowTf, snowFetchBars)));
      snowballPacks.push(...partSb);
    } else {
      snowballPacks.push(...chunk.map(() => null));
    }
  }

  let state = await loadIndicatorPublicFeedState();
  let notified = 0;

  // กัน Snowball ยิงซ้ำข้าม type (SUPER/WATCHLIST/…) โดยดู “pending” ในสถิติ
  // ถ้ามี pending อยู่แล้วสำหรับ (symbol, tf, side) ให้ข้ามแจ้งเตือนเพิ่มจนกว่าจะ finalize
  const snowballPendingKeys = new Set<string>();
  if (snowballOn) {
    try {
      const stats = await loadSnowballStatsState();
      const rows = (stats?.rows ?? []) as SnowballStatsRow[];
      for (const r of rows) {
        if (!r || r.outcome !== "pending") continue;
        const sym = typeof r.symbol === "string" ? r.symbol.trim().toUpperCase() : "";
        const tf = r.signalBarTf ?? "15m";
        const side = r.side;
        const atMs = typeof r.alertedAtMs === "number" && Number.isFinite(r.alertedAtMs) ? r.alertedAtMs : 0;
        // กันค้างยาวผิดปกติ: ถ้าเกิน ~30h ถือว่าไม่เอามาบล็อกแล้ว
        if (atMs > 0 && now - atMs > 30 * 3600 * 1000) continue;
        if (!sym) continue;
        snowballPendingKeys.add(`${sym}|${tf}|${side}`);
      }
    } catch (e) {
      console.error("[indicatorPublicFeed] load snowball stats for pending dedupe failed", e);
    }
  }

  const snowScanStats: Snowball4hScanSummaryStats | null =
    snowballOn && snowTf === "4h" && isSnowball4hScanSummaryToChatEnabled()
      ? {
          closedBarOpenSec: null,
          withPack: 0,
          noPack: 0,
          skippedBars: 0,
          skippedStoch: 0,
          longTechPass: 0,
          longTechPassSymbols: [],
          longBodyRatioBlocked: 0,
          longBodyRatioBlockedSymbols: [],
          longDeduped: 0,
          longDedupedSymbols: [],
          longWaveBlocked: 0,
          longWaveBlockedSymbols: [],
          longSent: 0,
          longSentSymbols: [],
          longPendingSkipTg: 0,
          longPendingSkipTgSymbols: [],
          bearTechPass: 0,
          bearTechPassSymbols: [],
          bearBodyRatioBlocked: 0,
          bearBodyRatioBlockedSymbols: [],
          bearDeduped: 0,
          bearDedupedSymbols: [],
          bearWaveBlocked: 0,
          bearWaveBlockedSymbols: [],
          bearSent: 0,
          bearSentSymbols: [],
          bearPendingSkipTg: 0,
          bearPendingSkipTgSymbols: [],
          errors: [],
        }
      : null;

  for (let idx = 0; idx < symbols.length; idx++) {
    const symbol = symbols[idx]!;
    const pack = packsCore[idx];
    const packSbEarly = snowballPacks[idx];
    /* Snowball ใช้ snowballPacks — อย่า continue เพราะ packsCore ล้มเหลว (timeout ฯลฯ) ไม่งั้นข้าม Snowball ทั้งเหรียญ */
    if (!pack && !(snowballOn && packSbEarly)) continue;

    const iso = new Date().toISOString();

    if (pack) {
      const { close, timeSec } = pack;
      const n = close.length;
      const i = n - 2;
      const iPrev = i - 1;
      if (iPrev >= 0) {
        const barTimeSec = timeSec[i];
        if (typeof barTimeSec === "number" && Number.isFinite(barTimeSec)) {
          if (rsiOn && idx < maxIdxCoreFeed && !isNeutralRsi50Threshold(rsiP.threshold)) {
            const period = rsiP.period;
            if (n >= period + 3) {
              const rsi = rsiWilder(close, period);
              const rNow = rsi[i]!;
              const rPrev = rsi[iPrev]!;
              if (Number.isFinite(rNow) && Number.isFinite(rPrev)) {
                const key = `${symbol}|RSI|${rsiEmaTf}`;
                if (
                  rsiCrossMatch(rPrev, rNow, rsiP.threshold, rsiP.direction) &&
                  state.lastFiredBarSec[key] !== barTimeSec &&
                  !inCooldown(state, key, now)
                ) {
                  const msg = buildPublicRsiMessage(
                    symbol,
                    rsiEmaTf,
                    period,
                    rsiP.threshold,
                    rsiP.direction,
                    rPrev,
                    rNow,
                    barTimeSec
                  );
                  try {
                    const ok = await sendPublicIndicatorFeedToSparkGroup(msg);
                    if (ok) {
                      await updatePublicFeedFiredKey(state, key, barTimeSec, iso, now);
                      notified += 1;
                    }
                  } catch (e) {
                    console.error("[indicatorPublicFeed] RSI Telegram", symbol, e);
                  }
                }
              }
            }
          }

          if (emaOn && idx < maxIdxCoreFeed && emaP.fast < emaP.slow) {
            const { fast, slow } = emaP;
            const minIdx = Math.max(fast, slow) - 1;
            const emaF = emaLine(close, fast);
            const emaS = emaLine(close, slow);
            if (i >= minIdx && iPrev >= minIdx) {
              const efNow = emaF[i]!;
              const esNow = emaS[i]!;
              const efPrev = emaF[iPrev]!;
              const esPrev = emaS[iPrev]!;
              if (
                Number.isFinite(efNow) &&
                Number.isFinite(esNow) &&
                Number.isFinite(efPrev) &&
                Number.isFinite(esPrev)
              ) {
                const fastAboveNow = efNow > esNow;
                const fastAbovePrev = efPrev > esPrev;

                for (const kind of ["golden", "death"] as const) {
                  if (!emaCrossMatch(fastAbovePrev, fastAboveNow, kind)) continue;
                  const key = `${symbol}|EMA_${kind.toUpperCase()}|${rsiEmaTf}`;
                  if (state.lastFiredBarSec[key] === barTimeSec || inCooldown(state, key, now)) continue;

                  const msg = buildPublicEmaMessage(
                    symbol,
                    rsiEmaTf,
                    kind,
                    fast,
                    slow,
                    efPrev,
                    esPrev,
                    efNow,
                    esNow,
                    barTimeSec
                  );
                  try {
                    const ok = await sendPublicIndicatorFeedToSparkGroup(msg);
                    if (ok) {
                      await updatePublicFeedFiredKey(state, key, barTimeSec, iso, now);
                      notified += 1;
                    }
                  } catch (e) {
                    console.error("[indicatorPublicFeed] EMA Telegram", symbol, kind, e);
                  }
                }
              }
            }
          }

          if (divOn && idx < maxIdxCoreFeed) {
            const wing = divergencePivotWing();
            const minGap = divergenceMinPivotGapBars();
            const strongD = divergenceStrongRsiDelta();
            const period = rsiP.period;
            const rsiMaP = divergenceRsiMaPeriod();
            const lb = divergenceLookbackBars();
            const minBars = period + lb + rsiMaP + wing + 12;

            for (const divTf of divergenceTfs) {
              const divPack =
                divTf === rsiEmaTf
                  ? pack
                  : divTf === "1h"
                    ? packsDiv1hExtra[idx]
                    : packsDiv4hExtra[idx];
              if (!divPack) continue;
              const { close: dc, high: dh, low: dl, timeSec: dts } = divPack;
              const nn = dc.length;
              if (nn < minBars) continue;
              const lastClosed = nn - 2;
              if (lastClosed < period) continue;

              const rsiArr = rsiWilder(dc, period);
              const hit = detectRsiDivergence(dh, dl, dc, rsiArr, lastClosed, period, wing, minGap);
              if (!hit) continue;

              const divKey = `${symbol}|RSI_DIV|${divTf}|${hit.kind.toUpperCase()}`;
              const confirmBarSec = dts[lastClosed];
              if (typeof confirmBarSec !== "number" || !Number.isFinite(confirmBarSec)) continue;
              if (state.lastFiredBarSec[divKey] === confirmBarSec) continue;
              if (inCooldown(state, divKey, now)) continue;

              const msg = buildRsiDivergenceMessage(symbol, divTf, hit, strongD);
              try {
                const ok = await sendPublicIndicatorFeedToSparkGroup(msg);
                if (ok) {
                  await updatePublicFeedFiredKey(state, divKey, confirmBarSec, iso, now);
                  notified += 1;
                }
              } catch (e) {
                console.error("[indicatorPublicFeed] RSI divergence Telegram", symbol, divTf, hit.kind, e);
              }
            }
          }
        }
      }
    }

    if (snowballOn) {
      const packSb = snowballPacks[idx];
      if (!packSb) {
        if (snowScanStats) snowScanStats.noPack++;
        continue;
      }
      if (snowScanStats) snowScanStats.withPack++;
      const { close: c15, open: o15, high: h15, low: l15, volume: v15, timeSec: t15 } = packSb;
      const swingLb = snowballSwingLookbackBars();
      const swingEx = snowballSwingExcludeRecentBars();
      const volP = snowballVolSmaPeriod();
      const volMult = snowballVolMultiplier();
      const rsiP = snowballStochRsiPeriod();
      const stLen = snowballStochLength();
      const kSm = snowballStochKSmooth();
      const osMin = snowballOversoldFloor();
      const emaResP = snowballResistanceEmaPeriod();
      const svpInnerLb = snowballSvpHdInnerLookbackBars();
      const shortNeedSvpHd = snowballShortRequireSvpHdBreak();

      const n15 = c15.length;
      const iClosed = n15 - 2;
      const iForming = n15 - 1;
      if (snowScanStats != null && typeof t15[iClosed] === "number" && Number.isFinite(t15[iClosed])) {
        if (snowScanStats.closedBarOpenSec == null) snowScanStats.closedBarOpenSec = t15[iClosed]!;
      }
      const vahLb = snowballLongVahLookbackBars();
      const longVahOn = snowballLongVahBreakEnabled();
      const intrabarOn = snowballIntrabarEnabled();
      const relaxIntrabarVol = snowballIntrabarRelaxVolume();
      const longRequireInnerHvnClear = snowballLongRequireAboveInnerHvn();
      const longSlopeEmaOn = snowballLongTrendEmaSlopeEnabled();
      const longSlopeEmaP = snowballLongTrendEmaPeriod();
      const longSlopeMinUpBars = snowballLongTrendEmaSlopeMinUpBars();
      const longEma2On = snowballLongTrendEma2Enabled();
      const longEma2P = snowballLongTrendEma2Period();
      const dbOn = snowballDoubleBarrierEnabled();
      const barrier2Lb = dbOn ? snowballDoubleBarrierLookbackBars() : 0;

      const minBars = Math.max(
        rsiP + stLen + kSm + 8,
        volP + 2,
        swingLb + swingEx + 3,
        emaResP + 2,
        svpInnerLb + 2,
        vahLb + 3,
        longSlopeEmaOn ? longSlopeEmaP + 2 : 0,
        longEma2On ? longEma2P + 2 : 0,
        longSlopeEmaOn && longSlopeMinUpBars >= 2 ? longSlopeEmaP + (longSlopeMinUpBars + 1) : 0,
        dbOn ? barrier2Lb + 2 : 0,
        4
      );
      if (n15 < minBars || iClosed < 1 || iForming < 1) {
        if (snowScanStats) snowScanStats.skippedBars++;
        continue;
      }

      const volSmaArr = smaLine(v15, volP);
      const stochArr = snowballStochSeries(c15, rsiP, stLen, kSm);
      const stochLastClosed = stochArr[iClosed];

      if (!Number.isFinite(stochLastClosed)) {
        if (snowScanStats) snowScanStats.skippedStoch++;
        continue;
      }

      const emaResArr = emaLine(c15, emaResP);
      const emaLongSlopeArr =
        longSlopeEmaOn && longSlopeEmaP !== emaResP ? emaLine(c15, longSlopeEmaP) : emaResArr;
      const emaLongSlope2Arr = longEma2On ? emaLine(c15, longEma2P) : null;

      const waveGateOn = snowballWaveGateEnabled();
      const waveEmaPeriod = snowballWaveEmaResetPeriod();
      const waveRsiPeriod = snowballWaveRsiPeriod();
      const waveEmaArr = waveGateOn
        ? waveEmaPeriod === emaResP
          ? emaResArr
          : waveEmaPeriod === longSlopeEmaP
            ? emaLongSlopeArr
            : longEma2On && waveEmaPeriod === longEma2P && emaLongSlope2Arr
              ? emaLongSlope2Arr
              : emaLine(c15, waveEmaPeriod)
        : [];
      const waveRsiArr = waveGateOn && c15.length >= waveRsiPeriod + 3 ? rsiWilder(c15, waveRsiPeriod) : [];

      const sendSnowballLong = async (iEval: number, intrabar: boolean): Promise<void> => {
        if (iEval < 1) return;
        const iPrev = iEval - 1;
        const iPrev2 = iEval - 2;
        const relaxVol = intrabar && relaxIntrabarVol;
        const vsE = volSmaArr[iEval];
        const vE = v15[iEval];
        const clE = c15[iEval];
        const hiE = h15[iEval];
        const hiPrev = h15[iPrev];
        const clPrev = c15[iPrev];
        if (
          !snowballVolumeOk(relaxVol, vE!, vsE!, volMult) ||
          !Number.isFinite(clE!) ||
          !Number.isFinite(hiE!) ||
          !Number.isFinite(hiPrev!) ||
          !Number.isFinite(clPrev!)
        ) {
          return;
        }

        const priorMaxHigh = maxHighPriorWindow(h15, iEval, swingLb, swingEx);
        const vahH = longVahOn ? highVolumeNodeBarHigh(v15, h15, l15, iEval, vahLb) : null;

        const swingBreak = intrabar ? hiE! > priorMaxHigh : clE! > priorMaxHigh;
        const classicSwing = Number.isFinite(priorMaxHigh) && swingBreak;

        const vahCross =
          longVahOn &&
          vahH != null &&
          Number.isFinite(vahH) &&
          (intrabar ? hiE! > vahH && hiPrev! <= vahH : clE! > vahH && clPrev! <= vahH);
        const vahOk = Boolean(vahCross);

        if (!classicSwing && !vahOk) return;

        const innerHvn = highVolumeNodeBarRange(v15, h15, l15, iEval, svpInnerLb);
        if (longRequireInnerHvnClear) {
          if (!innerHvn || !Number.isFinite(innerHvn.high)) return;
          const clearedAboveHvn = intrabar ? hiE! > innerHvn.high : clE! > innerHvn.high;
          if (!clearedAboveHvn) return;
        }

        if (longSlopeEmaOn) {
          const eNow = emaLongSlopeArr[iEval];
          const ePrev = emaLongSlopeArr[iPrev];
          const ePrev2 = iPrev2 >= 0 ? emaLongSlopeArr[iPrev2] : NaN;
          if (
            typeof eNow !== "number" ||
            typeof ePrev !== "number" ||
            !Number.isFinite(eNow) ||
            !Number.isFinite(ePrev) ||
            eNow <= ePrev
          ) {
            return;
          }
          if (longSlopeMinUpBars >= 2) {
            if (typeof ePrev2 !== "number" || !Number.isFinite(ePrev2) || ePrev <= ePrev2) return;
          }
        }

        if (longEma2On) {
          const a = emaLongSlope2Arr?.[iEval];
          const b = emaLongSlope2Arr?.[iPrev];
          const c = iPrev2 >= 0 ? emaLongSlope2Arr?.[iPrev2] : undefined;
          if (
            typeof a !== "number" ||
            typeof b !== "number" ||
            !Number.isFinite(a) ||
            !Number.isFinite(b) ||
            a <= b
          ) {
            return;
          }
          if (longSlopeMinUpBars >= 2) {
            if (typeof c !== "number" || !Number.isFinite(c) || b <= c) return;
          }
        }

        const trig: SnowballLongTriggerKind =
          classicSwing && vahOk ? "both" : classicSwing ? "swing_hh" : "vah_break";

        const refPlaybook = trig === "vah_break" ? vahH! : priorMaxHigh;

        const barOpenSec = t15[iEval];
        if (typeof barOpenSec !== "number" || !Number.isFinite(barOpenSec)) return;

        if (!intrabar && snowballPendingKeys.has(`${symbol}|${snowTf}|long`)) {
          if (snowScanStats) {
            snowScanStats.longDeduped++;
            pushSnowScanSymList(snowScanStats.longDedupedSymbols, `${symbol} LONG`);
          }
          return;
        }

        if (!intrabar && snowballBodyToRangeFilterEnabled()) {
          const oE = o15[iEval];
          const loE = l15[iEval];
          if (
            !Number.isFinite(oE!) ||
            !Number.isFinite(hiE!) ||
            !Number.isFinite(loE!) ||
            !Number.isFinite(clE!)
          ) {
            return;
          }
          if (!snowballSignalBarBodyRangePassed("long", iEval, o15, h15, l15, c15)) {
            if (snowScanStats) {
              snowScanStats.longBodyRatioBlocked++;
              pushSnowScanSymList(snowScanStats.longBodyRatioBlockedSymbols, `${symbol} LONG`);
            }
            return;
          }
        }

        if (snowScanStats && !intrabar) {
          snowScanStats.longTechPass++;
          pushSnowScanSymList(snowScanStats.longTechPassSymbols, `${symbol} LONG`);
        }

        const key = `${symbol}|SNOWBALL|${snowTf}|BULL`;
        if (state.lastFiredBarSec[key] === barOpenSec || inCooldown(state, key, now)) {
          if (snowScanStats && !intrabar) {
            snowScanStats.longDeduped++;
            pushSnowScanSymList(snowScanStats.longDedupedSymbols, `${symbol} LONG`);
          }
          return;
        }

        let longWaveGate: SnowballWaveGateStatus | null = null;
        if (waveGateOn && !intrabar) {
          longWaveGate = evaluateSnowballWaveGate(
            "long",
            c15,
            h15,
            l15,
            t15,
            iEval,
            state.lastFiredBarSec[key],
            state.lastAlertPrice?.[key],
            waveEmaArr,
            waveRsiArr,
          );
          if (longWaveGate.blocked) {
            if (snowScanStats) {
              snowScanStats.longWaveBlocked++;
              pushSnowScanSymList(snowScanStats.longWaveBlockedSymbols, `${symbol} LONG`);
            }
            console.info(
              `[indicatorPublicFeed] Snowball LONG wave gate blocked ${symbol} — ${longWaveGate.reason ?? ""}`,
            );
            return;
          }
        }

        const sLp = highVolumeNodeBarLow(v15, h15, l15, iEval, svpInnerLb);
        const emaR =
          typeof emaResArr[iEval] === "number" && Number.isFinite(emaResArr[iEval])
            ? emaResArr[iEval]
            : emaResArr[iClosed];

        const emaSlopeNow =
          longSlopeEmaOn && typeof emaLongSlopeArr[iEval] === "number" ? emaLongSlopeArr[iEval]! : undefined;
        const emaSlopePrev =
          longSlopeEmaOn && typeof emaLongSlopeArr[iPrev] === "number" ? emaLongSlopeArr[iPrev]! : undefined;
        const ema2SlopeOk =
          longEma2On &&
          typeof emaLongSlope2Arr?.[iEval] === "number" &&
          typeof emaLongSlope2Arr?.[iPrev] === "number" &&
          Number.isFinite(emaLongSlope2Arr?.[iEval] as number) &&
          Number.isFinite(emaLongSlope2Arr?.[iPrev] as number) &&
          (emaLongSlope2Arr![iEval]! > emaLongSlope2Arr![iPrev]!);

        let master4hTradePlan: SnowballMaster4hLongTradePlan | null = null;
        if (snowTf === "4h") {
          try {
            master4hTradePlan = await buildSnowballMaster4hLongTradePlan(
              symbol,
              c15,
              h15,
              l15,
              v15,
              iEval,
              swingLb,
              swingEx,
              clE!
            );
          } catch (e) {
            console.error("[indicatorPublicFeed] snowball 4h trade plan", symbol, e);
            if (snowScanStats && !intrabar) {
              pushSnowScanErr(
                snowScanStats,
                `LONG plan ${symbol}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }

        let longTier: SnowballQualityTier = "a_plus";
        let longDoubleBarrierLine = "";
        if (dbOn) {
          const cls = classifyLongDoubleBarrierTier(h15, iEval, clE!);
          longTier = cls.tier;
          const { min, max } = snowballDoubleBarrierWatchBandPct();
          const band = `${(min * 100).toFixed(1)}–${(max * 100).toFixed(1)}%`;
          if (cls.nearestOverhead == null) {
            longDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): ไม่พบ High เหนือราคาในระยะ — โครงเหนือว่าง (A+) · โซน Watchlist กำหนด +${band} เหนือราคา`;
          } else {
            const nearS = formatUsdPrice(cls.nearestOverhead);
            const distS = cls.distPct != null ? cls.distPct.toFixed(2) : "—";
            if (cls.tier === "b_plus") {
              longDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวต้านใกล้ ~ ${nearS} USDT (+${distS}%) อยู่ในโซน Watchlist +${band} — 🟡 B+`;
            } else {
              longDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวต้านใกล้ ~ ${nearS} USDT (+${distS}%) อยู่นอกโซน Watchlist +${band} — 🟢 A+`;
            }
          }
        }

        const longRiskFlags = !intrabar
          ? evaluateSnowballConfirmRisk("long", o15, h15, l15, c15, iEval)
          : [];
        const longSignalHigh = h15[iEval];
        const longSignalLow = l15[iEval];
        const longConfirmVolRatio = snowballConfirmVolMinRatio();
        const longConfirmTrigger: SnowballConfirmTriggerSnapshot | undefined =
          longRiskFlags.length > 0 && typeof longSignalHigh === "number" && Number.isFinite(longSignalHigh)
            ? { refLevel: longSignalHigh, volMinRatio: longConfirmVolRatio }
            : undefined;

        const msg = buildSnowballTripleCheckMessage(symbol, "bull", barOpenSec, {
          close: clE!,
          refSwing: refPlaybook,
          volume: vE!,
          volSma: vsE!,
          stochK: stochLastClosed,
          lookback: swingLb,
          swingExcludeRecent: swingEx,
          snowballTfDisplay: snowTf,
          volPeriod: volP,
          rsiP,
          stochLen: stLen,
          emaResistancePeriod: emaResP,
          emaResistance: Number.isFinite(emaR) ? emaR! : refPlaybook,
          svpHdInnerLb: svpInnerLb,
          svpHdLow: typeof sLp === "number" && Number.isFinite(sLp) ? sLp : refPlaybook,
          svpHdRequiredOk: false,
          intrabar,
          longTriggerKind: trig,
          vahHighLevel: vahH,
          longVahLookback: vahLb,
          volCheckRelaxed: relaxVol,
          innerHvnHigh: innerHvn?.high ?? null,
          innerHvnLookback: svpInnerLb,
          innerHvnCleared: longRequireInnerHvnClear ? true : undefined,
          emaSlopePeriod: longSlopeEmaOn ? longSlopeEmaP : undefined,
          emaSlopeNow,
          emaSlopePrev,
          emaSlopeOk: longSlopeEmaOn ? true : undefined,
          ema2SlopePeriod: longEma2On ? longEma2P : undefined,
          ema2SlopeOk: longEma2On ? Boolean(ema2SlopeOk) : undefined,
          master4hTradePlan: snowTf === "4h" ? master4hTradePlan : null,
          doubleBarrierEnabled: dbOn,
          snowballQualityTier: dbOn ? longTier : undefined,
          doubleBarrierChecklistLine: dbOn ? longDoubleBarrierLine : undefined,
          confirmRiskFlags: longRiskFlags.length > 0 ? longRiskFlags : undefined,
          confirmTrigger: longConfirmTrigger
            ? { side: "long", refLevel: longConfirmTrigger.refLevel, volMinRatio: longConfirmTrigger.volMinRatio }
            : undefined,
        });
        const longPendingConfirm =
          !intrabar && longRiskFlags.length > 0 && Boolean(longConfirmTrigger);
        const skipSnowballTgForPending =
          longPendingConfirm && snowballSkipTelegramWhenPendingConfirm();
        try {
          const ok = skipSnowballTgForPending ? true : await sendPublicSnowballFeedToSparkGroup(msg);
          if (skipSnowballTgForPending) {
            console.info(
              `[indicatorPublicFeed] Snowball LONG skip public TG (pending confirm) ${symbol} ${snowTf}`,
            );
            if (snowScanStats && !intrabar) {
              snowScanStats.longPendingSkipTg++;
              pushSnowScanSymList(snowScanStats.longPendingSkipTgSymbols, `${symbol} LONG`);
            }
          }
          if (ok) {
            await updatePublicFeedFiredKey(state, key, barOpenSec, iso, now, clE!);
            if (!skipSnowballTgForPending) {
              notified += 1;
              if (snowScanStats && !intrabar) {
                snowScanStats.longSent++;
                pushSnowScanSymList(snowScanStats.longSentSymbols, `${symbol} LONG`);
              }
            }
            if (!intrabar && !skipSnowballTgForPending) {
              try {
                // Auto-open เฉพาะ SUPER SNOWBALL (A+) เท่านั้น
                const isSuperSnowball = Boolean(dbOn && longTier === "a_plus");
                if (isSuperSnowball) {
                  await runSnowballAutoTradeAfterSnowballAlert({
                    contractSymbol: mexcContractSymbolFromBinanceSymbol(symbol),
                    binanceSymbol: symbol,
                    side: "long",
                    referenceEntryPrice: clE!,
                    signalBarOpenSec: barOpenSec,
                    signalBarTf: snowTf,
                    signalBarLow:
                      typeof longSignalLow === "number" && Number.isFinite(longSignalLow) ? longSignalLow : null,
                    vol: vE!,
                    volSma: vsE!,
                  });
                }
              } catch (e) {
                console.error("[indicatorPublicFeed] snowball auto-open LONG", symbol, e);
              }
            }
            if (!intrabar && longConfirmTrigger && longRiskFlags.length > 0) {
              try {
                await addSnowballPendingConfirm({
                  symbol,
                  side: "long",
                  snowTf,
                  signalBarOpenSec: barOpenSec,
                  signalHigh: longSignalHigh ?? clE!,
                  signalLow:
                    typeof longSignalLow === "number" && Number.isFinite(longSignalLow) ? longSignalLow : clE!,
                  signalClose: clE!,
                  signalVolume: vE!,
                  alertedAtIso: iso,
                  alertedAtMs: now,
                  riskFlags: longRiskFlags.map((f) => ({ id: f.id, label: f.label, detail: f.detail })),
                  qualityTier: dbOn ? longTier : undefined,
                  ...(skipSnowballTgForPending ? { deferSnowballAutotradeToConfirm: true } : {}),
                });
              } catch (pendErr) {
                console.error("[indicatorPublicFeed] snowball pending confirm LONG", symbol, pendErr);
              }
            }
            try {
              await appendSnowballStatsRow({
                symbol,
                side: "long",
                alertedAtIso: iso,
                alertedAtMs: now,
                signalBarOpenSec: barOpenSec,
                signalBarTf: snowTf,
                entryPrice: clE!,
                intrabar,
                triggerKind: trig,
                vol: vE!,
                volSma: vsE!,
                qualityTier: dbOn ? longTier : undefined,
              });
            } catch (statsErr) {
              console.error("[indicatorPublicFeed] snowball stats LONG", symbol, statsErr);
              if (snowScanStats && !intrabar) {
                pushSnowScanErr(
                  snowScanStats,
                  `LONG stats ${symbol}: ${statsErr instanceof Error ? statsErr.message : String(statsErr)}`,
                );
              }
            }
          }
        } catch (e) {
          console.error("[indicatorPublicFeed] Snowball LONG", symbol, intrabar ? "intrabar" : "close", e);
          if (snowScanStats && !intrabar) {
            pushSnowScanErr(snowScanStats, `LONG TG ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      };

      const sendSnowballBear = async (iEval: number, intrabar: boolean): Promise<void> => {
        if (iEval < 1) return;
        const relaxVol = intrabar && relaxIntrabarVol;
        const vsE = volSmaArr[iEval];
        const vE = v15[iEval];
        const clE = c15[iEval];
        const loE = l15[iEval];
        const loPrev = l15[iEval - 1];
        if (
          !snowballVolumeOk(relaxVol, vE!, vsE!, volMult) ||
          !Number.isFinite(clE!) ||
          !Number.isFinite(loE!) ||
          !Number.isFinite(loPrev!)
        ) {
          return;
        }

        const priorMinLow = minLowPriorWindow(l15, iEval, swingLb, swingEx);
        const swingBreak = intrabar ? loE! < priorMinLow : clE! < priorMinLow;
        const classicBear = Number.isFinite(priorMinLow) && swingBreak;
        if (!classicBear) return;
        if (stochLastClosed <= osMin) return;

        const svpHdLowGuess = highVolumeNodeBarLow(v15, h15, l15, iEval, svpInnerLb);
        const svpHdOkBear =
          typeof svpHdLowGuess === "number" &&
          Number.isFinite(svpHdLowGuess) &&
          clE! < svpHdLowGuess;
        if (shortNeedSvpHd && !svpHdOkBear) return;

        const emaResistance =
          typeof emaResArr[iEval] === "number" && Number.isFinite(emaResArr[iEval])
            ? emaResArr[iEval]
            : emaResArr[iClosed];
        if (!Number.isFinite(emaResistance)) return;

        const barOpenSec = t15[iEval];
        if (typeof barOpenSec !== "number" || !Number.isFinite(barOpenSec)) return;

        if (!intrabar && snowballPendingKeys.has(`${symbol}|${snowTf}|short`)) {
          if (snowScanStats) {
            snowScanStats.bearDeduped++;
            pushSnowScanSymList(snowScanStats.bearDedupedSymbols, `${symbol} BEAR`);
          }
          return;
        }

        if (!intrabar && snowballBodyToRangeFilterEnabled()) {
          const oE = o15[iEval];
          const hiE = h15[iEval];
          if (
            !Number.isFinite(oE!) ||
            !Number.isFinite(hiE!) ||
            !Number.isFinite(loE!) ||
            !Number.isFinite(clE!)
          ) {
            return;
          }
          if (!snowballSignalBarBodyRangePassed("bear", iEval, o15, h15, l15, c15)) {
            if (snowScanStats) {
              snowScanStats.bearBodyRatioBlocked++;
              pushSnowScanSymList(snowScanStats.bearBodyRatioBlockedSymbols, `${symbol} BEAR`);
            }
            return;
          }
        }

        if (snowScanStats && !intrabar) {
          snowScanStats.bearTechPass++;
          pushSnowScanSymList(snowScanStats.bearTechPassSymbols, `${symbol} BEAR`);
        }

        const key = `${symbol}|SNOWBALL|${snowTf}|BEAR`;
        if (state.lastFiredBarSec[key] === barOpenSec || inCooldown(state, key, now)) {
          if (snowScanStats && !intrabar) {
            snowScanStats.bearDeduped++;
            pushSnowScanSymList(snowScanStats.bearDedupedSymbols, `${symbol} BEAR`);
          }
          return;
        }

        let bearWaveGate: SnowballWaveGateStatus | null = null;
        if (waveGateOn && !intrabar) {
          bearWaveGate = evaluateSnowballWaveGate(
            "bear",
            c15,
            h15,
            l15,
            t15,
            iEval,
            state.lastFiredBarSec[key],
            state.lastAlertPrice?.[key],
            waveEmaArr,
            waveRsiArr,
          );
          if (bearWaveGate.blocked) {
            if (snowScanStats) {
              snowScanStats.bearWaveBlocked++;
              pushSnowScanSymList(snowScanStats.bearWaveBlockedSymbols, `${symbol} BEAR`);
            }
            console.info(
              `[indicatorPublicFeed] Snowball BEAR wave gate blocked ${symbol} — ${bearWaveGate.reason ?? ""}`,
            );
            return;
          }
        }

        let shortTier: SnowballQualityTier = "a_plus";
        let shortDoubleBarrierLine = "";
        if (dbOn) {
          const cls = classifyShortDoubleBarrierTier(l15, iEval, clE!);
          shortTier = cls.tier;
          const { min, max } = snowballDoubleBarrierWatchBandPct();
          const band = `${(min * 100).toFixed(1)}–${(max * 100).toFixed(1)}%`;
          if (cls.nearestUnderfoot == null) {
            shortDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): ไม่พบ Low ใต้ราคาในระยะ — โครงใต้ว่าง (A+) · โซน Watchlist −${band} ใต้ราคา`;
          } else {
            const nearS = formatUsdPrice(cls.nearestUnderfoot);
            const distS = cls.distPct != null ? cls.distPct.toFixed(2) : "—";
            if (cls.tier === "b_plus") {
              shortDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวรับใกล้ ~ ${nearS} USDT (−${distS}%) อยู่ในโซน Watchlist −${band} — 🟡 B+`;
            } else {
              shortDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวรับใกล้ ~ ${nearS} USDT (−${distS}%) อยู่นอกโซน Watchlist −${band} — A+`;
            }
          }
        }

        const bearRiskFlags = !intrabar
          ? evaluateSnowballConfirmRisk("bear", o15, h15, l15, c15, iEval)
          : [];
        const bearSignalHigh = h15[iEval];
        const bearSignalLow = l15[iEval];
        const bearConfirmVolRatio = snowballConfirmVolMinRatio();
        const bearConfirmTrigger: SnowballConfirmTriggerSnapshot | undefined =
          bearRiskFlags.length > 0 && typeof bearSignalLow === "number" && Number.isFinite(bearSignalLow)
            ? { refLevel: bearSignalLow, volMinRatio: bearConfirmVolRatio }
            : undefined;

        const msg = buildSnowballTripleCheckMessage(symbol, "bear", barOpenSec, {
          close: clE!,
          refSwing: priorMinLow,
          volume: vE!,
          volSma: vsE!,
          stochK: stochLastClosed,
          lookback: swingLb,
          swingExcludeRecent: swingEx,
          snowballTfDisplay: snowTf,
          volPeriod: volP,
          rsiP,
          stochLen: stLen,
          stochLimit: osMin,
          emaResistancePeriod: emaResP,
          emaResistance: emaResistance!,
          svpHdInnerLb: svpInnerLb,
          svpHdLow:
            typeof svpHdLowGuess === "number" && Number.isFinite(svpHdLowGuess) ? svpHdLowGuess : priorMinLow,
          svpHdRequiredOk: shortNeedSvpHd && svpHdOkBear,
          intrabar,
          volCheckRelaxed: relaxVol,
          doubleBarrierEnabled: dbOn,
          shortQualityTier: dbOn ? shortTier : undefined,
          shortDoubleBarrierChecklistLine: dbOn ? shortDoubleBarrierLine : undefined,
          confirmRiskFlags: bearRiskFlags.length > 0 ? bearRiskFlags : undefined,
          confirmTrigger: bearConfirmTrigger
            ? { side: "bear", refLevel: bearConfirmTrigger.refLevel, volMinRatio: bearConfirmTrigger.volMinRatio }
            : undefined,
        });
        const bearPendingConfirm =
          !intrabar && bearRiskFlags.length > 0 && Boolean(bearConfirmTrigger);
        const skipBearTgForPending =
          bearPendingConfirm && snowballSkipTelegramWhenPendingConfirm();
        try {
          const ok = skipBearTgForPending ? true : await sendPublicSnowballFeedToSparkGroup(msg);
          if (skipBearTgForPending) {
            console.info(
              `[indicatorPublicFeed] Snowball BEAR skip public TG (pending confirm) ${symbol} ${snowTf}`,
            );
            if (snowScanStats && !intrabar) {
              snowScanStats.bearPendingSkipTg++;
              pushSnowScanSymList(snowScanStats.bearPendingSkipTgSymbols, `${symbol} BEAR`);
            }
          }
          if (ok) {
            await updatePublicFeedFiredKey(state, key, barOpenSec, iso, now, clE!);
            if (!skipBearTgForPending) {
              notified += 1;
              if (snowScanStats && !intrabar) {
                snowScanStats.bearSent++;
                pushSnowScanSymList(snowScanStats.bearSentSymbols, `${symbol} BEAR`);
              }
            }
            if (!intrabar && !skipBearTgForPending) {
              try {
                // Auto-open เฉพาะ SUPER SNOWBALL (A+) เท่านั้น
                const isSuperSnowball = Boolean(dbOn && shortTier === "a_plus");
                if (isSuperSnowball) {
                  await runSnowballAutoTradeAfterSnowballAlert({
                    contractSymbol: mexcContractSymbolFromBinanceSymbol(symbol),
                    binanceSymbol: symbol,
                    side: "short",
                    referenceEntryPrice: clE!,
                    signalBarOpenSec: barOpenSec,
                    signalBarTf: snowTf,
                    signalBarLow: null,
                    vol: vE!,
                    volSma: vsE!,
                  });
                }
              } catch (e) {
                console.error("[indicatorPublicFeed] snowball auto-open SHORT", symbol, e);
              }
            }
            if (!intrabar && bearConfirmTrigger && bearRiskFlags.length > 0) {
              try {
                await addSnowballPendingConfirm({
                  symbol,
                  side: "bear",
                  snowTf,
                  signalBarOpenSec: barOpenSec,
                  signalHigh:
                    typeof bearSignalHigh === "number" && Number.isFinite(bearSignalHigh) ? bearSignalHigh : clE!,
                  signalLow: bearSignalLow ?? clE!,
                  signalClose: clE!,
                  signalVolume: vE!,
                  alertedAtIso: iso,
                  alertedAtMs: now,
                  riskFlags: bearRiskFlags.map((f) => ({ id: f.id, label: f.label, detail: f.detail })),
                  qualityTier: dbOn ? shortTier : undefined,
                  ...(skipBearTgForPending ? { deferSnowballAutotradeToConfirm: true } : {}),
                });
              } catch (pendErr) {
                console.error("[indicatorPublicFeed] snowball pending confirm BEAR", symbol, pendErr);
              }
            }
            try {
              await appendSnowballStatsRow({
                symbol,
                side: "short",
                alertedAtIso: iso,
                alertedAtMs: now,
                signalBarOpenSec: barOpenSec,
                signalBarTf: snowTf,
                entryPrice: clE!,
                intrabar,
                triggerKind: "swing_ll",
                vol: vE!,
                volSma: vsE!,
                qualityTier: dbOn ? shortTier : undefined,
              });
            } catch (statsErr) {
              console.error("[indicatorPublicFeed] snowball stats BEAR", symbol, statsErr);
              if (snowScanStats && !intrabar) {
                pushSnowScanErr(
                  snowScanStats,
                  `BEAR stats ${symbol}: ${statsErr instanceof Error ? statsErr.message : String(statsErr)}`,
                );
              }
            }
          }
        } catch (e) {
          console.error("[indicatorPublicFeed] Snowball BEAR", symbol, intrabar ? "intrabar" : "close", e);
          if (snowScanStats && !intrabar) {
            pushSnowScanErr(snowScanStats, `BEAR TG ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      };

      if (intrabarOn) {
        await sendSnowballLong(iForming, true);
        await sendSnowballBear(iForming, true);
      }
      await sendSnowballLong(iClosed, false);
      await sendSnowballBear(iClosed, false);
    }
  }

  if (snowScanStats != null && snowScanStats.closedBarOpenSec != null) {
    const barOpen = snowScanStats.closedBarOpenSec;
    const barDurSec = tfBarDurationSecForSummary(snowTf);
    const barCloseMs = (barOpen + barDurSec) * 1000;
    const ageMs = now - barCloseMs;
    const tooOld = ageMs > 4 * 3600 * 1000;
    const already = state.lastSnowballScanSummaryBarOpenSec === barOpen;
    if (!already) {
      if (tooOld) {
        state.lastSnowballScanSummaryBarOpenSec = barOpen;
        await saveIndicatorPublicFeedState(state);
      } else {
        const summaryIso = new Date(now).toISOString();
        let confirmLastRound: SnowballConfirmLastRoundStats = {
          atIso: "",
          confirmed: [],
          failed: [],
          tgFailed: [],
        };
        try {
          confirmLastRound = await loadSnowballConfirmLastRoundStats();
        } catch (e) {
          console.error("[indicatorPublicFeed] load snowball confirm last round stats", e);
        }
        const body = formatSnowball4hScanSummaryMessage({
          iso: summaryIso,
          universeLen: symbols.length,
          snowballTopAlts,
          stats: snowScanStats,
          barOpenSec: barOpen,
          snowTf,
          confirmLastRound,
        }).join("\n");
        try {
          const ok = await sendPublicSnowballFeedToSparkGroup(body);
          console.info("[indicatorPublicFeed] Snowball scan summary (full text follows)\n" + body);
          if (ok) {
            state.lastSnowballScanSummaryBarOpenSec = barOpen;
            await saveIndicatorPublicFeedState(state);
          }
        } catch (e) {
          console.error("[indicatorPublicFeed] snowball 4h scan summary to chat", e);
        }
      }
    }
  }

    return notified;
  } finally {
    if (locked) {
      try {
        await releaseIndicatorPublicFeedLock();
      } catch (e) {
        console.error("[indicatorPublicFeed] release lock failed", e);
      }
    }
  }
}

/** เครื่องมือ debug — เดิน checklist เดียวกับ Snowball live tick บนแท่งปิดล่าสุด (+ intrabar ถ้าเปิด) */
export type SnowballCheckStep = { id: string; label: string; ok: boolean; detail: string };

export type SnowballSideEval = {
  side: "long" | "bear";
  iEval: number;
  intrabar: boolean;
  barOpenSec: number;
  barOpenIsoBkk: string;
  closePrice: number;
  steps: SnowballCheckStep[];
  allPassed: boolean;
};

export type SnowballConfirmRiskGateStatus = {
  /** ติด flag เนื่องจากเข้าเงื่อนไขใด ๆ ใน 3 gates หรือไม่ (label only — ไม่บล็อก) */
  flagged: boolean;
  flags: SnowballConfirmRiskFlag[];
  /** รายละเอียดของแต่ละ gate (รวมตอนไม่ติดด้วย) สำหรับ debug */
  detail: {
    wickHistory: { flagged: boolean; wickyCount: number; total: number; ratio: number; lookback: number; bodyRatio: number };
    supplyZone: { flagged: boolean; refLevel: number | null; distPct: number | null; lookback: number; zonePct: number };
    signalWick: { flagged: boolean; body: number; shadow: number; signalRatio: number };
  };
  /** เงื่อนไข confirm ที่จะใช้กับแท่งที่ 2 */
  trigger: { side: "long" | "bear"; refLevel: number | null; volMinRatio: number };
};

export type SnowballChecklistResult = {
  symbol: string;
  enabled: boolean;
  envOk: boolean;
  snowTf: BinanceIndicatorTf;
  bars: number | null;
  paramsSummary: string[];
  long: { closed: SnowballSideEval | null; intrabar: SnowballSideEval | null };
  bear: { closed: SnowballSideEval | null; intrabar: SnowballSideEval | null };
  /** Confirming Bar — 3 risk gates บนแท่งปิดล่าสุด (long + bear) */
  confirmRisk: { long: SnowballConfirmRiskGateStatus | null; bear: SnowballConfirmRiskGateStatus | null } | null;
  /** Wave Gate — กันยิงซ้ำในคลื่นเดิม */
  waveGate: { long: SnowballWaveGateStatus | null; bear: SnowballWaveGateStatus | null } | null;
  errors: string[];
};

function buildSnowballConfirmRiskStatus(
  side: "long" | "bear",
  open: number[],
  high: number[],
  low: number[],
  close: number[],
  iEval: number,
): SnowballConfirmRiskGateStatus {
  const lookback = snowballWickHistoryLookback();
  const bodyRatio = snowballWickBodyRatio();
  const hist = evaluateWickHistory(side, high, low, open, close, iEval, lookback, bodyRatio);

  const supplyLb = snowballSupplyZoneLookback();
  const zonePct = snowballSupplyZonePct();
  const clVal = close[iEval];
  const closeNum = typeof clVal === "number" && Number.isFinite(clVal) ? clVal : NaN;
  const zone = Number.isFinite(closeNum)
    ? evaluateSupplyZone(side, high, low, iEval, supplyLb, zonePct, closeNum)
    : { flagged: false, refLevel: null as number | null, distPct: null as number | null };

  const signalRatio = snowballSignalWickRatio();
  const o = open[iEval];
  const h = high[iEval];
  const l = low[iEval];
  const sw =
    typeof o === "number" && typeof clVal === "number" && typeof h === "number" && typeof l === "number"
      ? evaluateSignalWick(side, o, clVal, h, l, signalRatio)
      : { flagged: false, body: 0, shadow: 0 };

  const flags = evaluateSnowballConfirmRisk(side, open, high, low, close, iEval);
  const refLevel = side === "long" ? (typeof h === "number" ? h : null) : typeof l === "number" ? l : null;

  return {
    flagged: flags.length > 0,
    flags,
    detail: {
      wickHistory: { ...hist, lookback, bodyRatio },
      supplyZone: { ...zone, lookback: supplyLb, zonePct },
      signalWick: { ...sw, signalRatio },
    },
    trigger: { side, refLevel, volMinRatio: snowballConfirmVolMinRatio() },
  };
}

function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return "NaN";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toFixed(Math.min(digits, 4));
  return n.toFixed(digits);
}

/** ขั้น checklist / debug — ตรงกับ live tick ก่อน dedupe (เฉพาะแท่งปิด) */
function snowballBodyToRangeCheckStep(
  intrabar: boolean,
  side: "long" | "bear",
  iEval: number,
  open: number[],
  high: number[],
  low: number[],
  close: number[],
): SnowballCheckStep {
  if (intrabar) {
    return {
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: true,
      detail: "intrabar — ใน live ไม่ใช้กรองนี้ (เฉพาะแท่งปิด)",
    };
  }
  if (!snowballBodyToRangeFilterEnabled()) {
    return {
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: true,
      detail: "ปิด (INDICATOR_PUBLIC_SNOWBALL_BODY_TO_RANGE_FILTER_ENABLED=0)",
    };
  }
  const oN = open[iEval];
  const hN = high[iEval];
  const lN = low[iEval];
  const cN = close[iEval];
  if (!Number.isFinite(oN) || !Number.isFinite(hN) || !Number.isFinite(lN) || !Number.isFinite(cN)) {
    return {
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: false,
      detail: "OHLC บางค่าไม่ finite",
    };
  }
  const range = hN - lN;
  const body = Math.abs(cN - oN);
  const minR = snowballMinBodyToRangeRatio();
  if (!Number.isFinite(range) || range <= 0) {
    return {
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: false,
      detail: "ช่วงราคาไม่ถูกต้อง (high−low ≤ 0)",
    };
  }
  const ratio = body / range;
  const primaryOk = snowballSignalCandleBodyRatioOk(oN, hN, lN, cN);
  if (primaryOk) {
    return {
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: true,
      detail: `body/range=${fmtNum(ratio)} ≥ เกณฑ์ ${minR}`,
    };
  }
  const passFollow = snowballSignalBarBodyRangePassed(side, iEval, open, high, low, close);
  if (passFollow) {
    const ft =
      side === "long" && iEval >= 1
        ? `body/range=${fmtNum(ratio)} < ${minR} แต่ close=${fmtNum(cN)} > prev high=${fmtNum(high[iEval - 1])} (follow-through)`
        : side === "bear" && iEval >= 1
          ? `body/range=${fmtNum(ratio)} < ${minR} แต่ close=${fmtNum(cN)} < prev low=${fmtNum(low[iEval - 1])} (follow-through)`
          : `body/range=${fmtNum(ratio)} < ${minR} (ผ่าน follow-through)`;
    return {
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: true,
      detail: ft,
    };
  }
  let extra = "";
  if (snowballBodyFollowThroughEnabled() && iEval >= 1) {
    extra =
      side === "long"
        ? ` · close ยังไม่ทะลุ prev high (${fmtNum(high[iEval - 1])})`
        : ` · close ยังไม่ต่ำกว่า prev low (${fmtNum(low[iEval - 1])})`;
  } else if (!snowballBodyFollowThroughEnabled()) {
    extra = " · follow-through ปิด (INDICATOR_PUBLIC_SNOWBALL_BODY_FOLLOW_THROUGH_ENABLED=0)";
  }
  return {
    id: "bodyToRange",
    label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
    ok: false,
    detail: `body/range=${fmtNum(ratio)} < เกณฑ์ ${minR}${extra}`,
  };
}

function fmtBarBkkFromOpenSec(openSec: number): string {
  const d = new Date(openSec * 1000);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time} BKK`;
}

function normalizeBinanceSym(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/^@/, "");
  if (!s) return "";
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function evaluateSnowballLongAt(
  iEval: number,
  intrabar: boolean,
  data: { close: number[]; high: number[]; low: number[]; open: number[]; volume: number[]; timeSec: number[] },
  ctx: {
    volSmaArr: number[];
    emaResArr: number[];
    emaLongSlopeArr: number[];
    emaLongSlope2Arr: number[] | null;
    volMult: number;
    swingLb: number;
    swingEx: number;
    vahLb: number;
    longVahOn: boolean;
    longRequireInnerHvnClear: boolean;
    svpInnerLb: number;
    longSlopeEmaOn: boolean;
    longSlopeMinUpBars: number;
    longSlopeEmaP: number;
    longEma2On: boolean;
    longEma2P: number;
    relaxIntrabarVol: boolean;
    state: IndicatorPublicFeedState;
    nowMs: number;
    symbol: string;
    snowTf: BinanceIndicatorTf;
  },
): SnowballSideEval | null {
  if (iEval < 1) return null;
  const iPrev = iEval - 1;
  const iPrev2 = iEval - 2;
  const relaxVol = intrabar && ctx.relaxIntrabarVol;
  const steps: SnowballCheckStep[] = [];

  const push = (s: SnowballCheckStep) => {
    steps.push(s);
  };

  const { close, high, low, open, volume, timeSec } = data;
  const vE = volume[iEval];
  const vsE = ctx.volSmaArr[iEval];
  const clE = close[iEval];
  const hiE = high[iEval];
  const hiPrev = high[iPrev];
  const clPrev = close[iPrev];

  const volOk = snowballVolumeOk(relaxVol, vE!, vsE!, ctx.volMult);
  push({
    id: "volume",
    label: "Volume × SMA",
    ok: volOk,
    detail: relaxVol
      ? `intrabar relax — ผ่าน (vol=${fmtNum(vE!, 0)})`
      : `vol=${fmtNum(vE!, 0)} ${volOk ? ">" : "≤"} SMA*${ctx.volMult} = ${fmtNum((vsE ?? 0) * ctx.volMult, 0)}`,
  });

  const priceFinite =
    Number.isFinite(clE!) && Number.isFinite(hiE!) && Number.isFinite(hiPrev!) && Number.isFinite(clPrev!);
  push({
    id: "priceFinite",
    label: "ราคาแท่งครบ",
    ok: priceFinite,
    detail: priceFinite ? "ok" : "ค่าราคาบางตัวไม่ finite",
  });

  const priorMaxHigh = maxHighPriorWindow(high, iEval, ctx.swingLb, ctx.swingEx);
  const vahH = ctx.longVahOn ? highVolumeNodeBarHigh(volume, high, low, iEval, ctx.vahLb) : null;
  const swingBreak = intrabar ? hiE! > priorMaxHigh : clE! > priorMaxHigh;
  const classicSwing = Number.isFinite(priorMaxHigh) && swingBreak;
  const vahCross =
    ctx.longVahOn &&
    vahH != null &&
    Number.isFinite(vahH) &&
    (intrabar ? hiE! > vahH && hiPrev! <= vahH : clE! > vahH && clPrev! <= vahH);
  const vahOk = Boolean(vahCross);
  const swingOrVahOk = classicSwing || vahOk;
  push({
    id: "swingOrVah",
    label: `Swing HH${ctx.swingLb}/Ex${ctx.swingEx} หรือ VAH${ctx.vahLb}`,
    ok: swingOrVahOk,
    detail: [
      `swingHH max=${fmtNum(priorMaxHigh)} (close=${fmtNum(clE!)} ${classicSwing ? ">" : "≤"})`,
      ctx.longVahOn
        ? `vah=${vahH != null ? fmtNum(vahH) : "—"} (${vahOk ? "เบรค" : "ยังไม่"})`
        : "vah: ปิด",
    ].join(" · "),
  });

  let innerHvnOk = true;
  let innerHvnDetail = "skip (config off)";
  if (ctx.longRequireInnerHvnClear) {
    const innerHvn = highVolumeNodeBarRange(volume, high, low, iEval, ctx.svpInnerLb);
    if (!innerHvn || !Number.isFinite(innerHvn.high)) {
      innerHvnOk = false;
      innerHvnDetail = "ไม่พบ HVN proxy";
    } else {
      const cleared = intrabar ? hiE! > innerHvn.high : clE! > innerHvn.high;
      innerHvnOk = cleared;
      innerHvnDetail = `hvnHigh=${fmtNum(innerHvn.high)} (close=${fmtNum(clE!)} ${cleared ? ">" : "≤"})`;
    }
  }
  push({ id: "innerHvnClear", label: `Inner HVN${ctx.svpInnerLb}`, ok: innerHvnOk, detail: innerHvnDetail });

  let emaSlopeOk = true;
  let emaSlopeDetail = "skip (config off)";
  if (ctx.longSlopeEmaOn) {
    const eNow = ctx.emaLongSlopeArr[iEval];
    const ePrev = ctx.emaLongSlopeArr[iPrev];
    const ePrev2 = iPrev2 >= 0 ? ctx.emaLongSlopeArr[iPrev2] : NaN;
    const cond1 = Number.isFinite(eNow) && Number.isFinite(ePrev) && eNow! > ePrev!;
    let cond2 = true;
    if (ctx.longSlopeMinUpBars >= 2) {
      cond2 = Number.isFinite(ePrev2) && ePrev! > (ePrev2 as number);
    }
    emaSlopeOk = cond1 && cond2;
    emaSlopeDetail = `EMA${ctx.longSlopeEmaP}: now=${fmtNum(eNow ?? NaN)} prev=${fmtNum(ePrev ?? NaN)}${ctx.longSlopeMinUpBars >= 2 ? ` prev2=${fmtNum((ePrev2 as number) ?? NaN)}` : ""} (${cond1 && cond2 ? "ขึ้น" : "ยัง"})`;
  }
  push({ id: "emaSlope", label: `EMA slope (${ctx.longSlopeEmaP})`, ok: emaSlopeOk, detail: emaSlopeDetail });

  let ema2SlopeOk = true;
  let ema2SlopeDetail = "skip (config off)";
  if (ctx.longEma2On) {
    const arr = ctx.emaLongSlope2Arr;
    const a = arr ? arr[iEval] : undefined;
    const b = arr ? arr[iPrev] : undefined;
    const c = arr && iPrev2 >= 0 ? arr[iPrev2] : undefined;
    const cond1 = Number.isFinite(a) && Number.isFinite(b) && a! > b!;
    let cond2 = true;
    if (ctx.longSlopeMinUpBars >= 2) {
      cond2 = Number.isFinite(c) && b! > (c as number);
    }
    ema2SlopeOk = cond1 && cond2;
    ema2SlopeDetail = `EMA${ctx.longEma2P}: now=${fmtNum(a ?? NaN)} prev=${fmtNum(b ?? NaN)}${ctx.longSlopeMinUpBars >= 2 ? ` prev2=${fmtNum((c as number) ?? NaN)}` : ""} (${cond1 && cond2 ? "ขึ้น" : "ยัง"})`;
  }
  push({ id: "ema2Slope", label: `EMA2 slope (${ctx.longEma2P})`, ok: ema2SlopeOk, detail: ema2SlopeDetail });

  push(snowballBodyToRangeCheckStep(intrabar, "long", iEval, open, high, low, close));

  const barOpenSec = timeSec[iEval] ?? -1;
  const key = `${ctx.symbol}|SNOWBALL|${ctx.snowTf}|BULL`;
  const lastFired = ctx.state.lastFiredBarSec[key];
  const dedupeOk = lastFired !== barOpenSec;
  push({
    id: "dedupe",
    label: "dedupe (bar เดียวกันยังไม่ยิง)",
    ok: dedupeOk,
    detail: `key=${key} · lastFiredBarSec=${lastFired ?? "—"} · barOpenSec=${barOpenSec}`,
  });

  const lastNotify = ctx.state.lastNotifyMs?.[key];
  const cd = publicCooldownMs();
  const cooldownLeft = lastNotify != null && Number.isFinite(lastNotify) ? Math.max(0, lastNotify + cd - ctx.nowMs) : 0;
  const cooldownOk = cooldownLeft <= 0;
  push({
    id: "cooldown",
    label: `cooldown (${Math.round(cd / 60000)} นาที)`,
    ok: cooldownOk,
    detail: cooldownOk
      ? lastNotify != null
        ? `พ้นแล้ว (lastNotify ${new Date(lastNotify).toISOString()})`
        : "ยังไม่เคยยิง"
      : `เหลืออีก ${Math.round(cooldownLeft / 1000)} วินาที (lastNotify ${new Date(lastNotify!).toISOString()})`,
  });

  const allPassed = steps.every((s) => s.ok);
  return {
    side: "long",
    iEval,
    intrabar,
    barOpenSec,
    barOpenIsoBkk: barOpenSec > 0 ? fmtBarBkkFromOpenSec(barOpenSec) : "—",
    closePrice: clE ?? NaN,
    steps,
    allPassed,
  };
}

function evaluateSnowballBearAt(
  iEval: number,
  intrabar: boolean,
  data: { close: number[]; high: number[]; low: number[]; open: number[]; volume: number[]; timeSec: number[] },
  ctx: {
    volSmaArr: number[];
    emaResArr: number[];
    stochLastClosed: number;
    volMult: number;
    swingLb: number;
    swingEx: number;
    osMin: number;
    shortNeedSvpHd: boolean;
    svpInnerLb: number;
    relaxIntrabarVol: boolean;
    state: IndicatorPublicFeedState;
    nowMs: number;
    symbol: string;
    snowTf: BinanceIndicatorTf;
  },
): SnowballSideEval | null {
  if (iEval < 1) return null;
  const relaxVol = intrabar && ctx.relaxIntrabarVol;
  const steps: SnowballCheckStep[] = [];
  const push = (s: SnowballCheckStep) => steps.push(s);

  const { close, high, low, open, volume, timeSec } = data;
  const vE = volume[iEval];
  const vsE = ctx.volSmaArr[iEval];
  const clE = close[iEval];
  const loE = low[iEval];
  const loPrev = low[iEval - 1];

  const volOk = snowballVolumeOk(relaxVol, vE!, vsE!, ctx.volMult);
  push({
    id: "volume",
    label: "Volume × SMA",
    ok: volOk,
    detail: relaxVol
      ? `intrabar relax — ผ่าน (vol=${fmtNum(vE!, 0)})`
      : `vol=${fmtNum(vE!, 0)} ${volOk ? ">" : "≤"} SMA*${ctx.volMult} = ${fmtNum((vsE ?? 0) * ctx.volMult, 0)}`,
  });

  const priceFinite = Number.isFinite(clE!) && Number.isFinite(loE!) && Number.isFinite(loPrev!);
  push({ id: "priceFinite", label: "ราคาแท่งครบ", ok: priceFinite, detail: priceFinite ? "ok" : "ค่าราคาไม่ finite" });

  const priorMinLow = minLowPriorWindow(low, iEval, ctx.swingLb, ctx.swingEx);
  const swingBreak = intrabar ? loE! < priorMinLow : clE! < priorMinLow;
  const classicBear = Number.isFinite(priorMinLow) && swingBreak;
  push({
    id: "swingLL",
    label: `Swing LL${ctx.swingLb}/Ex${ctx.swingEx}`,
    ok: classicBear,
    detail: `priorMinLow=${fmtNum(priorMinLow)} (close=${fmtNum(clE!)} ${classicBear ? "<" : "≥"})`,
  });

  const stochOk = ctx.stochLastClosed > ctx.osMin;
  push({
    id: "stochFloor",
    label: `Stoch > ${ctx.osMin}`,
    ok: stochOk,
    detail: `stoch=${fmtNum(ctx.stochLastClosed, 2)} ${stochOk ? ">" : "≤"} ${ctx.osMin}`,
  });

  let svpOk = true;
  let svpDetail = "skip (SHORT_REQUIRE_SVP_HD=off)";
  if (ctx.shortNeedSvpHd) {
    const svpLow = highVolumeNodeBarLow(volume, high, low, iEval, ctx.svpInnerLb);
    const ok = typeof svpLow === "number" && Number.isFinite(svpLow) && clE! < svpLow;
    svpOk = ok;
    svpDetail = `svpLow=${svpLow != null ? fmtNum(svpLow) : "—"} (close=${fmtNum(clE!)} ${ok ? "<" : "≥"})`;
  }
  push({ id: "svpHd", label: "SVP HD break", ok: svpOk, detail: svpDetail });

  const emaR = ctx.emaResArr[iEval];
  const emaOk = Number.isFinite(emaR);
  push({ id: "emaResistance", label: "EMA resistance finite", ok: emaOk, detail: emaOk ? `ema=${fmtNum(emaR!)}` : "ema = NaN" });

  push(snowballBodyToRangeCheckStep(intrabar, "bear", iEval, open, high, low, close));

  const barOpenSec = timeSec[iEval] ?? -1;
  const key = `${ctx.symbol}|SNOWBALL|${ctx.snowTf}|BEAR`;
  const lastFired = ctx.state.lastFiredBarSec[key];
  const dedupeOk = lastFired !== barOpenSec;
  push({
    id: "dedupe",
    label: "dedupe (bar เดียวกันยังไม่ยิง)",
    ok: dedupeOk,
    detail: `key=${key} · lastFiredBarSec=${lastFired ?? "—"} · barOpenSec=${barOpenSec}`,
  });

  const lastNotify = ctx.state.lastNotifyMs?.[key];
  const cd = publicCooldownMs();
  const cooldownLeft = lastNotify != null && Number.isFinite(lastNotify) ? Math.max(0, lastNotify + cd - ctx.nowMs) : 0;
  const cooldownOk = cooldownLeft <= 0;
  push({
    id: "cooldown",
    label: `cooldown (${Math.round(cd / 60000)} นาที)`,
    ok: cooldownOk,
    detail: cooldownOk
      ? lastNotify != null
        ? `พ้นแล้ว (lastNotify ${new Date(lastNotify).toISOString()})`
        : "ยังไม่เคยยิง"
      : `เหลืออีก ${Math.round(cooldownLeft / 1000)} วินาที (lastNotify ${new Date(lastNotify!).toISOString()})`,
  });

  return {
    side: "bear",
    iEval,
    intrabar,
    barOpenSec,
    barOpenIsoBkk: barOpenSec > 0 ? fmtBarBkkFromOpenSec(barOpenSec) : "—",
    closePrice: clE ?? NaN,
    steps,
    allPassed: steps.every((s) => s.ok),
  };
}

export async function evaluateSnowballChecklist(rawSymbol: string): Promise<SnowballChecklistResult> {
  const symbol = normalizeBinanceSym(rawSymbol);
  const errors: string[] = [];
  const enabled = isPublicSnowballTripleCheckEnabled();
  const envOk = isBinanceIndicatorFapiEnabled();
  const snowTf = snowballBinanceTf();

  const swingLb = snowballSwingLookbackBars();
  const swingEx = snowballSwingExcludeRecentBars();
  const volP = snowballVolSmaPeriod();
  const volMult = snowballVolMultiplier();
  const rsiP = snowballStochRsiPeriod();
  const stLen = snowballStochLength();
  const kSm = snowballStochKSmooth();
  const osMin = snowballOversoldFloor();
  const emaResP = snowballResistanceEmaPeriod();
  const svpInnerLb = snowballSvpHdInnerLookbackBars();
  const shortNeedSvpHd = snowballShortRequireSvpHdBreak();
  const vahLb = snowballLongVahLookbackBars();
  const longVahOn = snowballLongVahBreakEnabled();
  const intrabarOn = snowballIntrabarEnabled();
  const relaxIntrabarVol = snowballIntrabarRelaxVolume();
  const longRequireInnerHvnClear = snowballLongRequireAboveInnerHvn();
  const longSlopeEmaOn = snowballLongTrendEmaSlopeEnabled();
  const longSlopeEmaP = snowballLongTrendEmaPeriod();
  const longSlopeMinUpBars = snowballLongTrendEmaSlopeMinUpBars();
  const longEma2On = snowballLongTrendEma2Enabled();
  const longEma2P = snowballLongTrendEma2Period();

  const paramsSummary = [
    `Snowball TF: ${snowTf} (INDICATOR_PUBLIC_SNOWBALL_TF)`,
    `Swing: lookback ${swingLb} · excludeRecent ${swingEx}`,
    `Volume: SMA ${volP} · mult ${volMult}x`,
    `VAH break: ${longVahOn ? `on (lookback ${vahLb})` : "off"}`,
    `Inner HVN gate: ${longRequireInnerHvnClear ? `on (lookback ${svpInnerLb})` : "off"}`,
    `EMA slope: ${longSlopeEmaOn ? `EMA${longSlopeEmaP} (minUp ${longSlopeMinUpBars})` : "off"}`,
    `EMA2 slope: ${longEma2On ? `EMA${longEma2P}` : "off"}`,
    `Stoch RSI: rsiP ${rsiP} · stochLen ${stLen} · kSmooth ${kSm} · bearFloor ${osMin}`,
    `Short SVP HD gate: ${shortNeedSvpHd ? "on" : "off"}`,
    `Intrabar: ${intrabarOn ? `on${relaxIntrabarVol ? " (relax vol)" : ""}` : "off"}`,
    `Body/range (ไส้ยาว): ${snowballBodyToRangeFilterEnabled() ? `on (min ${snowballMinBodyToRangeRatio()})` : "off"} (INDICATOR_PUBLIC_SNOWBALL_MIN_BODY_TO_RANGE)`,
    `Follow-through (แท่งถัดไปทะลุ high/low แท่งก่อน): ${snowballBodyFollowThroughEnabled() ? "on" : "off"} (INDICATOR_PUBLIC_SNOWBALL_BODY_FOLLOW_THROUGH_ENABLED)`,
    `EMA resistance period: ${emaResP}`,
    `Public cooldown: ${Math.round(publicCooldownMs() / 60000)} นาที`,
  ];

  const baseResult: SnowballChecklistResult = {
    symbol,
    enabled,
    envOk,
    snowTf,
    bars: null,
    paramsSummary,
    long: { closed: null, intrabar: null },
    bear: { closed: null, intrabar: null },
    confirmRisk: null,
    waveGate: null,
    errors,
  };

  if (!symbol) {
    errors.push("symbol ว่าง");
    return baseResult;
  }
  if (!envOk) {
    errors.push("BINANCE_INDICATOR_FAPI_ENABLED=0 — ไม่ดึง kline จาก Binance");
    return baseResult;
  }

  const dbOnChecklist = snowballDoubleBarrierEnabled();
  const barrier2LbChecklist = dbOnChecklist ? snowballDoubleBarrierLookbackBars() : 0;
  const fetchBars = Math.max(
    250,
    barrier2LbChecklist + 50,
    swingLb + swingEx + 50,
    longEma2On ? longEma2P + 50 : 0,
  );
  const pack = await fetchBinanceUsdmKlines(symbol, snowTf, fetchBars);
  if (!pack) {
    errors.push(`fetchBinanceUsdmKlines(${symbol}, ${snowTf}) คืน null`);
    return baseResult;
  }

  const { close, open: openArr, high, low, volume, timeSec } = pack;
  const n = close.length;
  baseResult.bars = n;
  const iClosed = n - 2;
  const iForming = n - 1;

  const minBars = Math.max(
    rsiP + stLen + kSm + 8,
    volP + 2,
    swingLb + swingEx + 3,
    emaResP + 2,
    svpInnerLb + 2,
    vahLb + 3,
    longSlopeEmaOn ? longSlopeEmaP + 2 : 0,
    longEma2On ? longEma2P + 2 : 0,
    longSlopeEmaOn && longSlopeMinUpBars >= 2 ? longSlopeEmaP + (longSlopeMinUpBars + 1) : 0,
    4,
  );
  if (n < minBars || iClosed < 1) {
    errors.push(`klines น้อยเกินไป — ต้อง ≥ ${minBars} (มี ${n})`);
    return baseResult;
  }

  const volSmaArr = smaLine(volume, volP);
  const stochArr = snowballStochSeries(close, rsiP, stLen, kSm);
  const emaResArr = emaLine(close, emaResP);
  const emaLongSlopeArr = longSlopeEmaOn && longSlopeEmaP !== emaResP ? emaLine(close, longSlopeEmaP) : emaResArr;
  const emaLongSlope2Arr = longEma2On ? emaLine(close, longEma2P) : null;

  const state = await loadIndicatorPublicFeedState();
  const nowMs = Date.now();
  const data = { close, high, low, open: openArr, volume, timeSec };

  const longCtxBase = {
    volSmaArr,
    emaResArr,
    emaLongSlopeArr,
    emaLongSlope2Arr,
    volMult,
    swingLb,
    swingEx,
    vahLb,
    longVahOn,
    longRequireInnerHvnClear,
    svpInnerLb,
    longSlopeEmaOn,
    longSlopeMinUpBars,
    longSlopeEmaP,
    longEma2On,
    longEma2P,
    relaxIntrabarVol,
    state,
    nowMs,
    symbol,
    snowTf,
  };

  const bearCtxBase = {
    volSmaArr,
    emaResArr,
    stochLastClosed: stochArr[iClosed] ?? NaN,
    volMult,
    swingLb,
    swingEx,
    osMin,
    shortNeedSvpHd,
    svpInnerLb,
    relaxIntrabarVol,
    state,
    nowMs,
    symbol,
    snowTf,
  };

  baseResult.long.closed = evaluateSnowballLongAt(iClosed, false, data, longCtxBase);
  baseResult.bear.closed = evaluateSnowballBearAt(iClosed, false, data, bearCtxBase);
  if (intrabarOn) {
    baseResult.long.intrabar = evaluateSnowballLongAt(iForming, true, data, longCtxBase);
    baseResult.bear.intrabar = evaluateSnowballBearAt(iForming, true, data, bearCtxBase);
  }

  if (snowballConfirmBarEnabled()) {
    baseResult.confirmRisk = {
      long: buildSnowballConfirmRiskStatus("long", openArr, high, low, close, iClosed),
      bear: buildSnowballConfirmRiskStatus("bear", openArr, high, low, close, iClosed),
    };
  }

  if (snowballWaveGateEnabled()) {
    const waveEmaPeriod = snowballWaveEmaResetPeriod();
    const waveRsiPeriod = snowballWaveRsiPeriod();
    const waveEmaArr =
      waveEmaPeriod === emaResP
        ? emaResArr
        : waveEmaPeriod === longSlopeEmaP
          ? emaLongSlopeArr
          : longEma2On && waveEmaPeriod === longEma2P && emaLongSlope2Arr
            ? emaLongSlope2Arr
            : emaLine(close, waveEmaPeriod);
    const waveRsiArr = close.length >= waveRsiPeriod + 3 ? rsiWilder(close, waveRsiPeriod) : [];
    const longKey = `${symbol}|SNOWBALL|${snowTf}|BULL`;
    const bearKey = `${symbol}|SNOWBALL|${snowTf}|BEAR`;
    baseResult.waveGate = {
      long: evaluateSnowballWaveGate(
        "long",
        close,
        high,
        low,
        timeSec,
        iClosed,
        state.lastFiredBarSec[longKey],
        state.lastAlertPrice?.[longKey],
        waveEmaArr,
        waveRsiArr,
      ),
      bear: evaluateSnowballWaveGate(
        "bear",
        close,
        high,
        low,
        timeSec,
        iClosed,
        state.lastFiredBarSec[bearKey],
        state.lastAlertPrice?.[bearKey],
        waveEmaArr,
        waveRsiArr,
      ),
    };
  }

  return baseResult;
}
