import type { Client } from "@line/bot-sdk";
import {
  fetchBinanceUsdmKlines,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceIndicatorTf,
  type SnowballBinanceTf,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import { fetchCoinGeckoMarketCapUsd } from "./coinGeckoMarketCap";
import {
  appendRsiDivergenceStatsRow,
  isRsiDivergenceStatsEnabled,
} from "./rsiDivergenceStatsStore";
import { sendPublicIndicatorFeedToSparkGroup, sendPublicSnowballFeedToSparkGroup } from "./alertNotify";
import { fetchGreenDaysBeforeSignalBar } from "./greenDayStreak";
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
import { resolveMexcContractFromBinanceSymbolAsync } from "./mexcContractResolver";
import { runSnowballAutoTradeAfterSnowballAlert } from "./snowballAutoTradeExecutor";
import { snowballEma20_1hReferencePrice } from "./snowballReferenceEma20_1h";
import {
  buildSnowballLongBreakout1hConfirmGateSteps,
  evaluateSnowballLongBreakout1hConfirm,
  formatSnowballLongBreakout1hCriteriaSummary,
  snowballLongBreakout1hSwingLookback,
  snowballLongBreakout1hTwoBarEnabled,
  snowballLongBreakout1hTwoBarMode,
  snowballLongBreakout1hVolRankMax,
  type SnowballLongBreakout1hConfirmEval,
} from "./snowballLongBreakoutConfirm";
import {
  classifyLongStructureTier,
  resolveSnowballLongFinalGrade,
  snowballIsGradeF,
  snowballLongStructureTierShortLabel,
  snowballLongGradeShortLabel,
  type SnowballLongBreakoutGrade,
  type SnowballLongGradeResolution,
  type SnowballLongStructureTier,
} from "./snowballLongBreakoutGrade";
import {
  displayGradeToBaseTier,
  snowballTrendGradeDisplayWithDangerous,
} from "./snowballCompositeGrade";
import {
  classifySnowballTrendGrade,
  snowballTrendGradeActionPlan,
  snowballTrendGradeDisplayLabel,
  snowballTrendGradeToDisplay,
  snowballTrendActionPlanMarginScale,
  type SnowballTrendGradeDisplay,
} from "./snowballTrendGrade";

export type { SnowballLongBreakoutGrade };
import {
  appendSnowballStatsRow,
  isSnowballStatsEnabled,
  loadSnowballStatsState,
  type SnowballStatsRow,
} from "./snowballStatsStore";
import { resolveSnowballStatsTradeSide } from "./snowballStatsTradeSide";
import { buildSnowballLongConfirmGateStepsForStats } from "./snowballStatsGateSteps";
import { formatSnowball4hStagedDebugChecklist } from "./snowballDebugStagedFormat";
import {
  evaluateSnowballTwoBarInlineLong,
  snowballMinLow1hBetweenClosedBars,
  snowballTwoBarInlinePullbackMaxFrac,
  type SnowballTwoBarInlineEval,
} from "./snowballTwoBarInline";
import {
  snowballMatchesQualityShortSignal,
  snowballMatchesQualitySignal,
} from "@/lib/snowballMatrixFilters";
import { withQualitySignalAlertHeader } from "@/lib/qualitySignalAlertHeader";
import { fetchSnowballAlertMarketContext, resetSnowballBtcPsar4hCache } from "./snowballMarketContext";
import { computeSnowballSignalLenPercentile } from "./statsLenPercentile";
import { fetchStatsQuoteVol24hUsdt } from "./statsQuoteVol24h";
import { snowballVolatilityLookbackBars, snowballVolatilitySnapshotAt } from "./snowballVolatilityMetrics";
import {
  calculateTrendMomentumMetrics,
  formatTrendMomentumMetricsLine,
  isSustainedBuyingPressure,
  snowballGradeBMomentumFailGradeDOn1hConfirmPass,
  snowballGradeBNearMissVolumeEnabled,
  snowballGradeFOnMomentumAnd1hConfirmFail,
  snowballGradeBRequiresSustainedMomentum,
  snowballGradeBSustainedMarginScale,
  SNOWBALL_TREND_15M_DD_BARS,
  type TrendMomentumMetrics,
  trendMomentumStatsFields,
} from "./snowballTrendMomentumMetrics";
import { snowballStatsConfirmVolFieldsFrom1hEval } from "@/lib/snowballStatsClient";
import { addSnowballPendingConfirm, loadSnowballPendingConfirms } from "./snowballConfirmStore";
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

/** Snowball Master TF — รองรับเฉพาะ 4h (15m/1h ถอดแล้ว) */
export function snowballBinanceTf(): SnowballBinanceTf {
  const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_TF?.trim().toLowerCase();
  if (raw === "4h" || raw === "4hr") return "4h";
  if (raw === "1h" || raw === "15m") {
    console.warn(
      "[indicatorPublicFeed] INDICATOR_PUBLIC_SNOWBALL_TF=15m/1h ถอดแล้ว — ใช้ 4h",
    );
  }
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

/** Cooldown แจ้ง Snowball ต่อ key (เหรียญ+TF+ทิศ) — default 48 ชม. */
export function snowballPublicCooldownMs(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_COOLDOWN_MS);
  if (Number.isFinite(v) && v > 0) return v;
  return 48 * 3600 * 1000;
}

function cooldownMsForFeedKey(key: string): number {
  return key.includes("|SNOWBALL|") ? snowballPublicCooldownMs() : publicCooldownMs();
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
  if (Number.isFinite(v) && v >= 0 && v <= 200) return Math.floor(v);
  return 150;
}

/** Swing HH/LL — ย้อนหลังหา High/Low ก่อนแท่งปิด · ดีฟอลต์ 48 แท่ง (ทริกเกอร์สัญญาณ) */
function snowballSwingLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 400) return Math.floor(v);
  return 48;
}

/** Swing HH โครงสร้างใหญ่ — ใช้จัด Grade LONG (ดีฟอลต์ 200 แท่ง) */
function snowballSwingGradeLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_GRADE_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 400) return Math.floor(v);
  return 200;
}

/**
 * ไม่นับ high/low ของแท่งล่าสุด N แท่งก่อนแท่งสัญญาณ (กันยอด impulse เดียวกันไปเป็นเพดาน HH / พื้น LL)
 */
function snowballSwingExcludeRecentBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS);
  if (Number.isFinite(v) && v >= 0 && v <= 10) return Math.floor(v);
  return 3;
}

/**
 * Long Breakout Entry — ยืนยันด้วยแท่ง 1H ปิดเดียว (แทน two-bar inline ฝั่ง Long)
 * Logic ใน snowballLongBreakoutConfirm.ts — Dynamic body + God Vol + อันดับ vol top-N
 */
export function snowballLongBreakout1hConfirmEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_CONFIRM_ENABLED", true);
}

export {
  snowballLongBreakout1hBodyMinRatio,
  snowballLongBreakout1hVolMult,
  snowballLongBreakout1hSwingLookback,
  evaluateSnowballLongBreakout1hConfirm,
  type SnowballLongBreakout1hConfirmEval,
} from "./snowballLongBreakoutConfirm";

/** ไม่นับ high แท่งล่าสุด N แท่งบน 1H ก่อนแท่ง confirm — ค่าเริ่ม 3 (ช่วง 3–4 แท่ง) */
function snowballLongBreakout1hExcludeRecent(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_EXCLUDE_RECENT);
  if (Number.isFinite(v) && v >= 3 && v <= 4) return Math.floor(v);
  const ex = snowballSwingExcludeRecentBars();
  return ex >= 3 && ex <= 4 ? ex : 3;
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

/** Snowball 4h สแกนผ่าน /api/cron/snowball-scan หลังปิดแท่ง — ไม่สแกนซ้ำใน price-sync */
export function snowballDedicatedCronOnlyEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_DEDICATED_CRON_ONLY", true);
}

/** ข้ามส่ง TG เมื่อสแกนช้าเกิน N วินาทีหลังปิดแท่ง confirm — ค่าเริ่มปิด */
export function snowballAlertStaleSkipEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_ALERT_STALE_SKIP", false);
}

/** แจ้งกลุ่ม Snowball เมื่อรอบสแกนไม่รัน / ติด skip (ค่าเริ่มเปิด) */
export function snowballScanSkipNoticeToChatEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_SCAN_SKIP_NOTIFY", true);
}

/** ส่งข้อความเตือนเมื่อ cron/manual snowball-scan ข้ามหรือล้มเหลว (ไม่ส่งถ้ารอบนั้นมีสรุปสแกนปกติแล้ว) */
export async function notifySnowballScanSkippedToChat(args: {
  atMs: number;
  reason: string;
  confirmFollowUpN?: number;
  lockRetried?: boolean;
}): Promise<boolean> {
  if (!snowballScanSkipNoticeToChatEnabled()) return false;
  if (!telegramSparkSystemGroupConfigured()) return false;
  const iso = new Date(args.atMs).toISOString();
  const snowTf = snowballBinanceTf();
  const lines = [
    `⚠️ Snowball ${snowTf} scan — ข้าม / ไม่สำเร็จ`,
    `UTC: ${iso}`,
    `เวลา BKK: ${fmtBkkFromUnixSecForSummary(Math.floor(args.atMs / 1000))}`,
    "",
    `สาเหตุ: ${args.reason}`,
  ];
  if (typeof args.confirmFollowUpN === "number" && args.confirmFollowUpN > 0) {
    lines.push(`confirm แท่ง 2 (ก่อนสแกน): ${args.confirmFollowUpN}`);
  }
  if (args.lockRetried) {
    lines.push("", "ลองรอ feed lock 45 วินาทีแล้วสแกนซ้ำ — ยังไม่สำเร็จ");
  }
  lines.push("", "แนะนำ: admin → run cron snowball · รอ price-sync จบ (~1–2 นาที)");
  lines.push("ปิดข้อความนี้: INDICATOR_PUBLIC_SNOWBALL_SCAN_SKIP_NOTIFY=0");
  return sendPublicSnowballFeedToSparkGroup(lines.join("\n"));
}

/** หลังปิดแท่ง confirm — เกินนี้ไม่ส่ง TG (ใช้เมื่อเปิด STALE_SKIP; ดีฟอลต์ 900 = 15 นาที) */
export function snowballAlertMaxAgeSec(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_ALERT_MAX_AGE_SEC);
  if (Number.isFinite(v) && v >= 60 && v <= 7200) return Math.floor(v);
  return 900;
}

function snowballAlertAnchorCloseSec(
  barOpenSec: number,
  tf: BinanceIndicatorTf,
): number {
  return barOpenSec + tfBarDurationSecForSummary(tf);
}

function formatSnowballBarCloseBkk(barOpenSec: number, tf: BinanceIndicatorTf): string {
  return formatClosedCandleBkk(snowballAlertAnchorCloseSec(barOpenSec, tf));
}

function snowballAlertIsStale(
  anchorCloseSec: number,
  nowMs: number,
  maxAgeSec: number = snowballAlertMaxAgeSec(),
): boolean {
  if (!snowballAlertStaleSkipEnabled()) return false;
  const ageSec = Math.floor(nowMs / 1000) - anchorCloseSec;
  return ageSec > maxAgeSec;
}

/** ในโหมด intrabar: ไม่บังคับ Vol > SMA — ค่าเริ่มปิด */
function snowballIntrabarRelaxVolume(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_INTRABAR_RELAX_VOLUME", false);
}

/** Double Barrier: Barrier1 = swing lookback เดิม · Barrier2 = โซน “ภูเขา” ใกล้ราคา → B+ / A+ */
export function snowballDoubleBarrierEnabled(): boolean {
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

/**
 * โหมดสองแท่งปิดในครั้งเดียว — แท่งสัญญาณ = แท่งปิดก่อนล่าสุด (iClosed-1), confirm = แท่งปิดล่าสุด (iClosed)
 * ค่าเริ่ม **เปิด** (เมื่อไม่ตั้ง env) — ตั้ง INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_INLINE_ENABLED=0/false เพื่อโหมดแท่งเดียว + pending confirm เดิม
 * ไม่ใช้ pending confirm / snowballConfirmTick สำหรับสัญญาณใหม่เมื่อโหมดนี้เปิด (รายการ pending เก่ายังถูกประมวลผลตามเดิม)
 */
export function snowballTwoBarInlineModeEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_INLINE_ENABLED", true);
}

export { snowballTwoBarInlinePullbackMaxFrac, snowballMinLow1hBetweenClosedBars } from "./snowballTwoBarInline";

/** High สูงสุดของแท่ง 1h ที่ปิดในช่วง (signalOpenSec, confirmBarEndSec] — ใช้ Bear inline */
export function snowballMaxHigh1hBetweenClosedBars(
  timeSec1h: number[],
  high1h: number[],
  signalOpenSec: number,
  confirmBarEndSec: number,
): number | null {
  const H1 = 3600;
  let maxH = -Infinity;
  let hit = false;
  for (let i = 0; i < timeSec1h.length; i++) {
    const barEnd = timeSec1h[i]! + H1;
    if (barEnd <= signalOpenSec) continue;
    if (barEnd > confirmBarEndSec) continue;
    const hi = high1h[i];
    if (typeof hi === "number" && Number.isFinite(hi)) {
      hit = true;
      maxH = Math.max(maxH, hi);
    }
  }
  if (!hit || !Number.isFinite(maxH)) return null;
  return maxH;
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

/** Double Barrier เทียบแนวใกล้ราคา — คนละความหมายกับ Grade HH/VAH */
type SnowballDoubleBarrierTier = "a_plus" | "b_plus";

/**
 * Grade LONG: ทริกเกอร์ผ่าน HH48 หรือ VAH · A+ = HH48+HH200+VAH · B = VAH อย่างเดียว · C = HH48 แต่ไม่ผ่าน HH200 (หรือผ่าน HH200 แต่ไม่มี VAH)
 */
function snowballLongSwingHighBreak(
  high: number[],
  close: number[],
  iSig: number,
  lookback: number,
  excludeRecent: number,
  intrabar: boolean,
): boolean {
  const priorMaxHigh = maxHighPriorWindow(high, iSig, lookback, excludeRecent);
  if (!Number.isFinite(priorMaxHigh)) return false;
  const hiE = high[iSig]!;
  const clE = close[iSig]!;
  return intrabar ? hiE > priorMaxHigh : clE > priorMaxHigh;
}

function classifyLongDoubleBarrierTier(
  high: number[],
  iEval: number,
  ref: number
): { tier: SnowballDoubleBarrierTier; nearestOverhead: number | null; distPct: number | null } {
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
): { tier: SnowballDoubleBarrierTier; nearestUnderfoot: number | null; distPct: number | null } {
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
  return nowMs - t < cooldownMsForFeedKey(key);
}

/** Snowball dedupe ต่อเหรียญ+TF+ทิศ+แท่งสัญญาณ — ยิงแล้วไม่ยิงซ้ำแท่งเดิม (แท่ง 4h ใหม่ยิงได้) */
export function snowballSymbolDedupeBlocks(
  state: Pick<IndicatorPublicFeedState, "lastFiredBarSec">,
  key: string,
  signalBarOpenSec: number,
): boolean {
  const t = state.lastFiredBarSec[key];
  if (t == null || !Number.isFinite(t)) return false;
  if (!Number.isFinite(signalBarOpenSec) || signalBarOpenSec <= 0) return false;
  return t === signalBarOpenSec;
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

/** Vol near-miss สำหรับ Grade B — ต่ำกว่า strict mult (default 2.0 เมื่อ strict 2.5) */
function snowballVolNearMissMultiplier(strictMult: number): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_NEAR_MISS_MULT);
  if (Number.isFinite(v) && v >= 1 && v < strictMult) return v;
  return 2;
}

/** strict ไม่ผ่าน แต่ vol > SMA×near — ใช้ดัก “ทรงสวย vol ขาดนิด” */
function snowballVolumeNearMissOnly(
  relax: boolean,
  vol: number,
  volSma: number,
  strictMult: number,
  nearMult: number,
): boolean {
  if (relax || !snowballGradeBNearMissVolumeEnabled()) return false;
  if (snowballVolumeOk(false, vol, volSma, strictMult)) return false;
  if (!Number.isFinite(vol) || vol <= 0 || !Number.isFinite(volSma) || volSma <= 0) return false;
  return vol > volSma * nearMult;
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
    /** Grade LONG (HH48/HH200/VAH) — หัวข้อ Telegram */
    snowballLongBreakoutGrade?: SnowballLongBreakoutGrade;
    /** Display grade (S+/S/A+/A/B+/B/C/F) — composite เมื่อ 4h LONG */
    snowballTrendDisplayGrade?: SnowballTrendGradeDisplay;
    /** Max DD > 7% → suffix ⚠️ บนป้ายเกรด */
    gradeDangerous?: boolean;
    /** ผ่าน Swing HH โครงสร้าง (ดีฟอลต์ 200 แท่ง) — ใช้ข้อความ Grade C */
    longSwing200Ok?: boolean;
    doubleBarrierEnabled?: boolean;
    /** Double Barrier (แนวใกล้ในโซน %) — บรรทัด checklist */
    doubleBarrierChecklistLine?: string;
    /** Short: ชั้นคุณภาพ Double Barrier สมมาตร */
    shortTrendGrade?: SnowballLongBreakoutGrade;
    shortDoubleBarrierChecklistLine?: string;
    /** Confirming Bar — flag ความเสี่ยงจาก 3 gates ที่ต้องรอแท่งที่ 2 ยืนยัน */
    confirmRiskFlags?: SnowballConfirmRiskFlag[];
    /** เกณฑ์การ confirm ที่จะใช้กับแท่งที่ 2 — ราคาเทียบ + อัตราส่วนปริมาณขั้นต่ำ */
    confirmTrigger?: {
      side: "long" | "bear";
      refLevel: number;
      volMinRatio: number;
    };
    /** โหมด two-bar inline — บรรทัดท้ายอธิบายแท่ง confirm + 1h */
    inlineTwoBarFootnote?: string;
    /** Breakout Entry — ยืนยันด้วยแท่ง 1H ปิดเดียว */
    breakout1hConfirmUsed?: boolean;
    breakout1hConfirmFootnote?: string;
    gradeFootnote?: string;
    trendMomentum?: TrendMomentumMetrics | null;
    sustainedBuyingPressure?: boolean;
    /** เปิดแท่งที่ใช้แสดงเวลาปิดในหัวข้อ (two-bar = แท่ง confirm) */
    alertClosedBarOpenSec?: number;
    /** ผ่านเกณฑ์ Quality Signal (EMA4h > 15% · เขียว ≤ 3 วัน) */
    qualitySignal?: boolean;
  }
): string {
  const pair = pairSlashNoDollar(symbol);
  const closedOpenSec =
    typeof args.alertClosedBarOpenSec === "number" && Number.isFinite(args.alertClosedBarOpenSec)
      ? args.alertClosedBarOpenSec
      : barTimeSec;
  const tfForClose =
    args.snowballTfDisplay === "1h" || args.snowballTfDisplay === "15m"
      ? args.snowballTfDisplay
      : "4h";
  const bkk =
    args.intrabar || tfForClose === "1h" || tfForClose === "15m"
      ? formatClosedCandleBkk(closedOpenSec)
      : formatSnowballBarCloseBkk(closedOpenSec, tfForClose);
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

    const g = args.snowballLongBreakoutGrade;
    const dg =
      args.snowballTrendDisplayGrade ?? (g ? snowballTrendGradeToDisplay(g) : null);
    const gradeF = snowballIsGradeF(g) || dg === "F" || (dg != null && displayGradeToBaseTier(dg) === "f");
    const gradeDangerous = args.gradeDangerous === true;
    const gradeLine = args.gradeFootnote ?? (g ? snowballTrendGradeDisplayLabel(g, "long") : "");
    const actionPlan = g ? snowballTrendGradeActionPlan(g) : null;
    const displayForAuto = dg
      ? snowballTrendGradeDisplayWithDangerous(dg, gradeDangerous)
      : g
        ? snowballTrendGradeToDisplay(g)
        : "—";
    const longAutotradeBiasLine =
      actionPlan === "monitor"
        ? `📎 Auto-open: Grade ${displayForAuto} — Monitor (no auto-open)`
        : actionPlan === "light"
          ? "📎 Auto-open: Grade B — Light (0.5× margin) เมื่อเปิดใช้ใน Settings"
          : g
            ? "📎 Auto-open: ตามทิศสัญญาณ LONG เมื่อเปิดใช้ใน Settings"
            : "";
    const longHeadline = withQualitySignalAlertHeader(
      (() => {
        const sfx = sniperSuffix;
        if (dg) {
          const tier = displayGradeToBaseTier(dg);
          const label = snowballTrendGradeDisplayWithDangerous(dg, gradeDangerous);
          const emoji =
            tier === "f" ? "🔴" : tier === "c" ? "🟠" : tier === "b" ? "🟡" : "🟢";
          return `${emoji} [Grade ${label}] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
        }
        if (gradeF) {
          return `🔴 [Grade ${snowballTrendGradeDisplayWithDangerous("F", gradeDangerous)}] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
        }
        if (g === "s") return `🟢 [Grade S] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
        if (g === "a") return `🟢 [Grade A] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
        if (g === "b") return `🟡 [Grade B] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
        if (g === "c") return `🟠 [Grade C] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
        if (args.breakout1hConfirmUsed) {
          return `🟢 [Breakout Entry · 1H Confirm] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
        }
        return `🟢 [LONG Candidate] — Snowball Triple-Check (${args.snowballTfDisplay})${sfx}`;
      })(),
      args.qualitySignal === true,
    );

    const out: string[] = [
      longHeadline,
      `${pair} — Binance USDT-M`,
      "",
      `💼 Playbook:`,
      `"ทรงมาดี มีแรงส่งสะสม รอเข้าเมื่อย่อ (Buy the Dip) ที่แนวรับ ~ ${playbookRefPx} USDT"`,
      ...(gradeLine ? ["", gradeLine] : []),
      ...(longAutotradeBiasLine ? ["", longAutotradeBiasLine] : []),
      "",
      formatTrendMomentumMetricsLine(args.trendMomentum ?? null),
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
      `📊 ราคาในข้อความ ~ ${px} USDT — Stoch จากแท่งสัญญาณ (แสดงประกอบ ไม่ใช้กรอง Long)`,
      "",
      "⚠️ Not financial advice"
    );
    if (args.inlineTwoBarFootnote) {
      out.splice(out.length - 1, 0, "", args.inlineTwoBarFootnote);
    }
    if (args.breakout1hConfirmFootnote) {
      out.splice(out.length - 1, 0, "", args.breakout1hConfirmFootnote);
    }
    if (args.gradeFootnote) {
      out.splice(out.length - 1, 0, "", args.gradeFootnote);
    }
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

  const sg = args.shortTrendGrade;
  const shortHeadline = withQualitySignalAlertHeader(
    sg === "s"
      ? `🔴 [Grade S] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`
      : sg === "a"
        ? `🔴 [Grade A] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`
        : sg === "b"
          ? `🟡 [Grade B] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`
          : sg === "f"
            ? `🟡 [Grade F] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`
            : sg === "c"
              ? `🟠 [Grade C] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`
              : `🔴 [SHORT Candidate] — Snowball Triple-Check (${args.snowballTfDisplay} LL)${bearSniperSuffix}`,
    args.qualitySignal === true,
  );
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
  if (args.inlineTwoBarFootnote) {
    bearOut.splice(bearOut.length - 1, 0, "", args.inlineTwoBarFootnote);
  }
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

function breakout1hFailReasonShort(ev: SnowballLongBreakout1hConfirmEval | null | undefined): string {
  if (!ev) return "no_eval";
  const reasons: string[] = [];
  const bullish = Number.isFinite(ev.close) && Number.isFinite(ev.open) ? ev.close > ev.open : false;
  if (!bullish) reasons.push("bullish");
  // ในโหมด 2-bar split เรา overwrite cleanCloseOk = structOk (bullish+cleanClose) ของแท่งล่าสุด
  if (!ev.cleanCloseOk) reasons.push("clean_close");
  if (!ev.bodyOk) reasons.push("body");
  if (!ev.volSmaOk) reasons.push("vol_sma");
  if (!ev.volRankOk) reasons.push("vol_rank");
  if (reasons.length === 0) return "unknown";
  return reasons.join("+");
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
  /** โหมด two-bar inline: ไม่ผ่าน pullback / vol / 1h */
  longTwoBarInlineBlocked: number;
  longTwoBarInlineBlockedSymbols: string[];
  /** Breakout Entry 1H confirm ไม่ผ่าน (บล็อก) */
  longBreakout1hBlocked: number;
  longBreakout1hBlockedSymbols: string[];
  /** momentum ไม่ผ่าน + 1H confirm ผ่าน → ส่ง Grade D+ (Long) */
  longGradeBMomentumToGradeD: number;
  longGradeBMomentumToGradeDSymbols: string[];
  /** momentum ไม่ผ่าน + 1H confirm ไม่ผ่าน → Grade F (Long) */
  longGradeBMomentumToGradeF: number;
  longGradeBMomentumToGradeFSymbols: string[];
  /** momentum ไม่ผ่าน + 1H confirm ไม่ผ่าน — บล็อก (ปิด Grade F) */
  longGradeBMomentumBlocked: number;
  longGradeBMomentumBlockedSymbols: string[];
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
  longStaleSkipped: number;
  longStaleSkippedSymbols: string[];
  bearTechPass: number;
  bearTechPassSymbols: string[];
  /** เนื้อเทียนเทียบช่วงต่ำกว่าเกณฑ์ (ไส้ยาว) */
  bearBodyRatioBlocked: number;
  bearBodyRatioBlockedSymbols: string[];
  bearTwoBarInlineBlocked: number;
  bearTwoBarInlineBlockedSymbols: string[];
  bearDeduped: number;
  bearDedupedSymbols: string[];
  /** กันยิงซ้ำในคลื่นเดิม (Bear) */
  bearWaveBlocked: number;
  bearWaveBlockedSymbols: string[];
  bearSent: number;
  bearSentSymbols: string[];
  bearPendingSkipTg: number;
  bearPendingSkipTgSymbols: string[];
  bearStaleSkipped: number;
  bearStaleSkippedSymbols: string[];
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
  if (tf === "1d") return 24 * 3600;
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
  if (snowballLongBreakout1hConfirmEnabled()) {
    const twoBarNote = snowballLongBreakout1hTwoBarEnabled()
      ? snowballLongBreakout1hTwoBarMode() === "strict"
        ? " · 2-bar strict (แท่งใดแท่งหนึ่งผ่านครบ)"
        : " · 2-bar split (โครงสร้างแท่งล่าสุด + body/vol จาก 2 แท่ง)"
      : "";
    lines.push(
      `โหมด Long Breakout Entry เปิด — ยืนยัน 1H (vol rank ≤${snowballLongBreakout1hVolRankMax()} ใน 48 แท่ง${twoBarNote}); ไม่ผ่าน → บล็อก`,
    );
    lines.push("");
  } else if (snowballTwoBarInlineModeEnabled()) {
    lines.push(
      "โหมด two-bar inline เปิดอยู่ — สัญญาณที่แท่งปิดก่อนล่าสุด + confirm ที่แท่งปิดล่าสุดในครั้งเดียว (ไม่คิว pending confirm สำหรับสัญญาณใหม่)",
    );
    lines.push("");
  }
  lines.push("— Long (แท่งปิด) —");
  lines.push(`ครบเกณฑ์ (ถึงก่อน dedupe/cooldown): ${stats.longTechPass}`);
  lines.push(...formatSymbolListLines("  ", stats.longTechPassSymbols));
    lines.push(`ติดกรองเนื้อเทียน/ช่วง (ไส้ยาว): ${stats.longBodyRatioBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.longBodyRatioBlockedSymbols));
  if (snowballGradeBRequiresSustainedMomentum()) {
    if (snowballGradeBMomentumFailGradeDOn1hConfirmPass()) {
      lines.push(`Momentum ไม่ผ่าน → Grade D+ (Long): ${stats.longGradeBMomentumToGradeD}`);
      lines.push(...formatSymbolListLines("  ", stats.longGradeBMomentumToGradeDSymbols));
    }
    if (snowballGradeFOnMomentumAnd1hConfirmFail()) {
      lines.push(`Momentum ไม่ผ่าน → Grade F (Long): ${stats.longGradeBMomentumToGradeF}`);
      lines.push(...formatSymbolListLines("  ", stats.longGradeBMomentumToGradeFSymbols));
    }
    lines.push(`Momentum ไม่ผ่าน (บล็อก · ปิด Grade F): ${stats.longGradeBMomentumBlocked}`);
    lines.push(...formatSymbolListLines("  ", stats.longGradeBMomentumBlockedSymbols));
  }
  if (snowballLongBreakout1hConfirmEnabled()) {
    lines.push(`Breakout 1H confirm ไม่ผ่าน (บล็อก): ${stats.longBreakout1hBlocked}`);
    lines.push(...formatSymbolListLines("  ", stats.longBreakout1hBlockedSymbols));
  } else if (snowballTwoBarInlineModeEnabled()) {
    lines.push(`two-bar inline ไม่ผ่าน (pullback / vol / 1h): ${stats.longTwoBarInlineBlocked}`);
    lines.push(...formatSymbolListLines("  ", stats.longTwoBarInlineBlockedSymbols));
  }
  lines.push(`ติด dedupe หรือ cooldown: ${stats.longDeduped}`);
  lines.push(...formatSymbolListLines("  ", stats.longDedupedSymbols));
  lines.push(`ติด wave gate (คลื่นเดิม): ${stats.longWaveBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.longWaveBlockedSymbols));
  lines.push(`ส่ง Telegram สำเร็จ (แท่ง 1): ${stats.longSent}`);
  lines.push(...formatSymbolListLines("  ", stats.longSentSymbols));
  lines.push(`แท่ง 1 คิวรอ confirm (ไม่ส่ง TG): ${stats.longPendingSkipTg}`);
  lines.push(...formatSymbolListLines("  ", stats.longPendingSkipTgSymbols));
  if (snowballAlertStaleSkipEnabled()) {
    lines.push(
      `ข้ามส่ง (เกิน ${Math.round(snowballAlertMaxAgeSec() / 60)} นาทีหลังปิดแท่ง confirm): ${stats.longStaleSkipped}`,
    );
    lines.push(...formatSymbolListLines("  ", stats.longStaleSkippedSymbols));
  }
  lines.push("");
  lines.push("— Bear (แท่งปิด) —");
  lines.push(`ครบเกณฑ์ (ถึงก่อน dedupe/cooldown): ${stats.bearTechPass}`);
  lines.push(...formatSymbolListLines("  ", stats.bearTechPassSymbols));
  lines.push(`ติดกรองเนื้อเทียน/ช่วง (ไส้ยาว): ${stats.bearBodyRatioBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.bearBodyRatioBlockedSymbols));
  if (snowballTwoBarInlineModeEnabled()) {
    lines.push(`two-bar inline ไม่ผ่าน (pullback / vol / 1h): ${stats.bearTwoBarInlineBlocked}`);
    lines.push(...formatSymbolListLines("  ", stats.bearTwoBarInlineBlockedSymbols));
  }
  lines.push(`ติด dedupe หรือ cooldown: ${stats.bearDeduped}`);
  lines.push(...formatSymbolListLines("  ", stats.bearDedupedSymbols));
  lines.push(`ติด wave gate (คลื่นเดิม): ${stats.bearWaveBlocked}`);
  lines.push(...formatSymbolListLines("  ", stats.bearWaveBlockedSymbols));
  lines.push(`ส่ง Telegram สำเร็จ (แท่ง 1): ${stats.bearSent}`);
  lines.push(...formatSymbolListLines("  ", stats.bearSentSymbols));
  lines.push(`แท่ง 1 คิวรอ confirm (ไม่ส่ง TG): ${stats.bearPendingSkipTg}`);
  lines.push(...formatSymbolListLines("  ", stats.bearPendingSkipTgSymbols));
  if (snowballAlertStaleSkipEnabled()) {
    lines.push(
      `ข้ามส่ง (เกิน ${Math.round(snowballAlertMaxAgeSec() / 60)} นาทีหลังปิดแท่ง confirm): ${stats.bearStaleSkipped}`,
    );
    lines.push(...formatSymbolListLines("  ", stats.bearStaleSkippedSymbols));
  }

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

/** ผลรัน public indicator feed — `skippedReason` มีเมื่อไม่ได้เข้าลูปสแกนหลัก (env / lock) */
export type PublicIndicatorFeedRunResult = {
  notified: number;
  skippedReason?: string;
  /** ข้อความ 🧪 Snowball 4h scan summary (เมื่อเก็บสถิติและประกอบข้อความแล้ว) */
  snowballScanSummaryText?: string;
};

/**
 * Feed สาธารณะ RSI cross + EMA cross + RSI divergence จาก Binance USDT-M (ค่าเริ่ม TF เดียวกันที่ 4h — RSI/EMA: INDICATOR_PUBLIC_RSI_EMA_TF, Div: INDICATOR_PUBLIC_RSI_DIVERGENCE_TFS)
 * + Snowball Triple-Check (TF จาก INDICATOR_PUBLIC_SNOWBALL_TF — universe alt ตาม INDICATOR_PUBLIC_SNOWBALL_TOP_ALTS ดีฟอลต์ 150; RSI/EMA/Div ยังใช้ INDICATOR_PUBLIC_TOP_ALTS)
 *   Double Barrier: Barrier2 = แนว High/Low ใกล้ราคาในโซน Watchlist % (บรรทัด checklist) — คนละชุดกับ Grade LONG A+/B/C (หัวข้อ TG จาก Swing HH + VAH)
 * @param opts.snowballOnly ถ้า true — รันเฉพาะ Snowball (ใช้ GET /api/cron/snowball-scan / run cron snowball)
 */
export async function runPublicIndicatorFeedInternal(
  _client: Client,
  now: number,
  opts?: { snowballOnly?: boolean },
): Promise<PublicIndicatorFeedRunResult> {
  void _client;
  if (!isIndicatorPublicFeedEnabled()) {
    return { notified: 0, skippedReason: "public feed ปิด (INDICATOR_PUBLIC_FEED_ENABLED=0)" };
  }
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isBinanceIndicatorFapiEnabled()) {
    return { notified: 0, skippedReason: "Binance USDM indicator ปิด (BINANCE_INDICATOR_FAPI_ENABLED=0)" };
  }
  if (!telegramSparkSystemGroupConfigured()) {
    console.warn(
      "[indicatorPublicFeed] ไม่มี TELEGRAM_BOT_TOKEN + TELEGRAM_PUBLIC_CHAT_ID (หรือ TELEGRAM_SPARK_SYSTEM_CHAT_ID) — ข้าม public indicator feed"
    );
    return {
      notified: 0,
      skippedReason: "ไม่มี Telegram สาธารณะ (TELEGRAM_BOT_TOKEN + TELEGRAM_PUBLIC_CHAT_ID หรือ TELEGRAM_SPARK_SYSTEM_CHAT_ID)",
    };
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
      return {
        notified: 0,
        skippedReason: "feed lock ถูกจับอยู่ (รอบ price-sync/snowball อื่น — รอ ~1–2 นาทีแล้วลองใหม่)",
      };
    }
  }

  try {
  const rsiOn = envFlagOn("INDICATOR_PUBLIC_RSI_ENABLED", true);
  const emaOn = envFlagOn("INDICATOR_PUBLIC_EMA_ENABLED", true);
  const divOn = isPublicRsiDivergenceEnabled();
  const snowballOn = isPublicSnowballTripleCheckEnabled();
  const snowballOnly = Boolean(opts?.snowballOnly);
  const snowballDedicatedCron = snowballDedicatedCronOnlyEnabled();
  const effectiveSnowballOn =
    snowballOn && (snowballOnly || !snowballDedicatedCron);
  if (snowballOnly && !snowballOn) {
    return { notified: 0, skippedReason: "Snowball ปิดใน env (INDICATOR_PUBLIC_SNOWBALL_ENABLED)" };
  }

  const effectiveRsiOn = snowballOnly ? false : rsiOn;
  const effectiveEmaOn = snowballOnly ? false : emaOn;
  const effectiveDivOn = snowballOnly ? false : divOn;

  const rsiEmaTf = publicRsiEmaCrossTf();
  const divergenceTfs = effectiveDivOn ? publicRsiDivergenceTfs() : [];
  const needDiv1hExtra = effectiveDivOn && divergenceTfs.includes("1h") && rsiEmaTf !== "1h";
  const needDiv4hExtra = effectiveDivOn && divergenceTfs.includes("4h") && rsiEmaTf !== "4h";
  if (!effectiveRsiOn && !effectiveEmaOn && !effectiveDivOn && !effectiveSnowballOn) {
    return {
      notified: 0,
      skippedReason: "สัญญาณ public ปิดหมดใน env (RSI / EMA / Div / Snowball)",
    };
  }

  const baseTopAlts = topAltsCount();
  const snowballTopAlts = snowballUniverseTopAltsCount();
  const fetchUniverseTopN = effectiveSnowballOn ? Math.max(baseTopAlts, snowballTopAlts) : baseTopAlts;
  const symbols = await getUniverseSymbols(fetchUniverseTopN);
  if (symbols.length === 0) {
    return { notified: 0, skippedReason: "universe สัญญาว่าง (ดึงรายการไม่ได้หรือกรองหมด)" };
  }
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
  const packs15mMomentum: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const snowTf = snowballBinanceTf();
  const snowballPacks: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const snowSwingLb = snowballSwingLookbackBars();
  const snowSwingGradeLb = snowballSwingGradeLookbackBars();
  const snowSwingEx = snowballSwingExcludeRecentBars();
  const snowVolLb = snowballVolatilityLookbackBars();
  const snowFetchBars = effectiveSnowballOn
    ? Math.max(
        250,
        (snowballDoubleBarrierEnabled() ? snowballDoubleBarrierLookbackBars() : 0) + 50,
        snowSwingLb + snowSwingEx + 50,
        snowSwingGradeLb + snowSwingEx + 50,
        snowVolLb + 20,
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
    if (effectiveSnowballOn) {
      const [partSb, part15m] = await Promise.all([
        Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, snowTf, snowFetchBars))),
        Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, "15m", SNOWBALL_TREND_15M_DD_BARS))),
      ]);
      snowballPacks.push(...partSb);
      packs15mMomentum.push(...part15m);
    } else {
      snowballPacks.push(...chunk.map(() => null));
      packs15mMomentum.push(...chunk.map(() => null));
    }
  }

  let state = await loadIndicatorPublicFeedState();
  let notified = 0;
  let snowballScanSummaryText: string | undefined;

  /** เหรียญที่มีสัญญาณ pending — ห้ามแจ้ง Snowball ซ้ำจน outcome ไม่ pending / คิว confirm หาย */
  const snowballPendingSymbols = new Set<string>();
  if (effectiveSnowballOn) {
    const pendingMaxAgeMs = 30 * 3600 * 1000;
    try {
      const stats = await loadSnowballStatsState();
      const rows = (stats?.rows ?? []) as SnowballStatsRow[];
      for (const r of rows) {
        if (!r || r.outcome !== "pending") continue;
        const sym = typeof r.symbol === "string" ? r.symbol.trim().toUpperCase() : "";
        const atMs = typeof r.alertedAtMs === "number" && Number.isFinite(r.alertedAtMs) ? r.alertedAtMs : 0;
        if (atMs > 0 && now - atMs > pendingMaxAgeMs) continue;
        if (sym) snowballPendingSymbols.add(sym);
      }
    } catch (e) {
      console.error("[indicatorPublicFeed] load snowball stats for pending dedupe failed", e);
    }
    try {
      const pend = await loadSnowballPendingConfirms();
      for (const it of pend.items) {
        const sym = typeof it.symbol === "string" ? it.symbol.trim().toUpperCase() : "";
        if (sym) snowballPendingSymbols.add(sym);
      }
    } catch (e) {
      console.error("[indicatorPublicFeed] load snowball pending confirm for dedupe failed", e);
    }
  }

  const collectSnowScanStats =
    effectiveSnowballOn && snowTf === "4h" && (isSnowball4hScanSummaryToChatEnabled() || snowballOnly);
  const snowScanStats: Snowball4hScanSummaryStats | null = collectSnowScanStats
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
          longTwoBarInlineBlocked: 0,
          longTwoBarInlineBlockedSymbols: [],
          longBreakout1hBlocked: 0,
          longBreakout1hBlockedSymbols: [],
          longGradeBMomentumToGradeD: 0,
          longGradeBMomentumToGradeDSymbols: [],
          longGradeBMomentumToGradeF: 0,
          longGradeBMomentumToGradeFSymbols: [],
          longGradeBMomentumBlocked: 0,
          longGradeBMomentumBlockedSymbols: [],
          longDeduped: 0,
          longDedupedSymbols: [],
          longWaveBlocked: 0,
          longWaveBlockedSymbols: [],
          longSent: 0,
          longSentSymbols: [],
          longPendingSkipTg: 0,
          longPendingSkipTgSymbols: [],
          longStaleSkipped: 0,
          longStaleSkippedSymbols: [],
          bearTechPass: 0,
          bearTechPassSymbols: [],
          bearBodyRatioBlocked: 0,
          bearBodyRatioBlockedSymbols: [],
          bearTwoBarInlineBlocked: 0,
          bearTwoBarInlineBlockedSymbols: [],
          bearDeduped: 0,
          bearDedupedSymbols: [],
          bearWaveBlocked: 0,
          bearWaveBlockedSymbols: [],
          bearSent: 0,
          bearSentSymbols: [],
          bearPendingSkipTg: 0,
          bearPendingSkipTgSymbols: [],
          bearStaleSkipped: 0,
          bearStaleSkippedSymbols: [],
          errors: [],
        }
      : null;

  if (effectiveSnowballOn) resetSnowballBtcPsar4hCache();

  for (let idx = 0; idx < symbols.length; idx++) {
    const symbol = symbols[idx]!;
    const pack = packsCore[idx];
    const packSbEarly = snowballPacks[idx];
    /* Snowball ใช้ snowballPacks — อย่า continue เพราะ packsCore ล้มเหลว (timeout ฯลฯ) ไม่งั้นข้าม Snowball ทั้งเหรียญ */
    if (!pack && !(effectiveSnowballOn && packSbEarly)) continue;

    const iso = new Date().toISOString();

    if (pack) {
      const { close, timeSec } = pack;
      const n = close.length;
      const i = n - 2;
      const iPrev = i - 1;
      if (iPrev >= 0) {
        const barTimeSec = timeSec[i];
        if (typeof barTimeSec === "number" && Number.isFinite(barTimeSec)) {
          if (effectiveRsiOn && idx < maxIdxCoreFeed && !isNeutralRsi50Threshold(rsiP.threshold)) {
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

          if (effectiveEmaOn && idx < maxIdxCoreFeed && emaP.fast < emaP.slow) {
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

          if (effectiveDivOn && idx < maxIdxCoreFeed) {
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
                  if (isRsiDivergenceStatsEnabled()) {
                    try {
                      const base = symbol.toUpperCase().endsWith("USDT")
                        ? symbol.slice(0, -4)
                        : null;
                      const [quoteVol24hUsdt, marketCapUsd] = await Promise.all([
                        fetchStatsQuoteVol24hUsdt(symbol).catch(() => null),
                        base ? fetchCoinGeckoMarketCapUsd(base).catch(() => null) : Promise.resolve(null),
                      ]);
                      await appendRsiDivergenceStatsRow({
                        symbol,
                        tf: divTf === "1h" ? "1h" : "4h",
                        kind: hit.kind,
                        trigger: hit.trigger,
                        alertedAtIso: iso,
                        alertedAtMs: now,
                        signalBarOpenSec: confirmBarSec,
                        entryPrice: dc[lastClosed]!,
                        refLevel: hit.refLevel,
                        priceW1: hit.priceW1,
                        priceW2: hit.priceW2,
                        rsiW1: hit.rsiW1,
                        rsiW2: hit.rsiW2,
                        barsBetween: hit.wave2Idx - hit.wave1Idx,
                        strongDelta: strongD,
                        quoteVol24hUsdt,
                        marketCapUsd,
                      });
                    } catch (e) {
                      console.error(
                        "[indicatorPublicFeed] RSI divergence stats append",
                        symbol,
                        divTf,
                        hit.kind,
                        e,
                      );
                    }
                  }
                }
              } catch (e) {
                console.error("[indicatorPublicFeed] RSI divergence Telegram", symbol, divTf, hit.kind, e);
              }
            }
          }
        }
      }
    }

    if (effectiveSnowballOn) {
      const packSb = snowballPacks[idx];
      if (!packSb) {
        if (snowScanStats) snowScanStats.noPack++;
        continue;
      }
      if (snowScanStats) snowScanStats.withPack++;
      const { close: c15, open: o15, high: h15, low: l15, volume: v15, timeSec: t15 } = packSb;
      const swingLb = snowSwingLb;
      const swingGradeLb = snowSwingGradeLb;
      const swingEx = snowSwingEx;
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
        swingGradeLb + swingEx + 3,
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

      /* Historical backtest reuses snowballBacktestDetect.ts (wave gate, two-bar, grade) — keep sendSnowball* in sync */
      const sendSnowballLong = async (
        iEval: number,
        intrabar: boolean,
        pack1hForTwoBar: BinanceKlinePack | null,
      ): Promise<void> => {
        if (iEval < 1) return;
        if (!intrabar && snowballPendingSymbols.has(symbol)) {
          if (snowScanStats) {
            snowScanStats.longDeduped++;
            pushSnowScanSymList(
              snowScanStats.longDedupedSymbols,
              `${symbol} LONG (สถิติ/คิว pending)`,
            );
          }
          return;
        }
        const longBreakout1h = false;
        const twoBarInline = snowTf === "4h" && !intrabar && iEval >= 1;
        const iConf = iEval;
        const iSig = twoBarInline ? iEval - 1 : iEval;
        const iPrev = iSig - 1;
        const iPrev2 = iSig - 2;
        const relaxVol = intrabar && relaxIntrabarVol;
        const vsE = volSmaArr[iSig];
        const vE = v15[iSig];
        const volNearMult = snowballVolNearMissMultiplier(volMult);
        const volStrictOk = snowballVolumeOk(relaxVol, vE!, vsE!, volMult);
        const volNearMissOnly = snowballVolumeNearMissOnly(
          relaxVol,
          vE!,
          vsE!,
          volMult,
          volNearMult,
        );
        const clE = c15[iSig];
        const hiE = h15[iSig];
        const hiPrev = h15[iPrev];
        const clPrev = c15[iPrev];
        if (
          snowTf !== "4h" &&
          !volStrictOk &&
          !volNearMissOnly
        ) {
          return;
        }
        if (
          !Number.isFinite(clE!) ||
          !Number.isFinite(hiE!) ||
          !Number.isFinite(hiPrev!) ||
          !Number.isFinite(clPrev!)
        ) {
          return;
        }

        const priorMaxHigh = maxHighPriorWindow(h15, iSig, swingLb, swingEx);
        const swing48 = snowballLongSwingHighBreak(h15, c15, iSig, swingLb, swingEx, intrabar);
        const swing200 = snowballLongSwingHighBreak(h15, c15, iSig, swingGradeLb, swingEx, intrabar);
        const classicSwing = swing48;
        const vahH = longVahOn ? highVolumeNodeBarHigh(v15, h15, l15, iSig, vahLb) : null;

        const vahCross =
          longVahOn &&
          vahH != null &&
          Number.isFinite(vahH) &&
          (intrabar ? hiE! > vahH && hiPrev! <= vahH : clE! > vahH && clPrev! <= vahH);
        const vahOk = Boolean(vahCross);

        if (!classicSwing && !vahOk && !swing200) return;

        const innerHvn = highVolumeNodeBarRange(v15, h15, l15, iSig, svpInnerLb);
        if (longRequireInnerHvnClear) {
          if (!innerHvn || !Number.isFinite(innerHvn.high)) return;
          const clearedAboveHvn = intrabar ? hiE! > innerHvn.high : clE! > innerHvn.high;
          if (!clearedAboveHvn) return;
        }

        if (longSlopeEmaOn) {
          const eNow = emaLongSlopeArr[iSig];
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
          const a = emaLongSlope2Arr?.[iSig];
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

        if (!twoBarInline && !longBreakout1h && !intrabar && snowballBodyToRangeFilterEnabled()) {
          const oE = o15[iSig];
          const loE = l15[iSig];
          if (
            !Number.isFinite(oE!) ||
            !Number.isFinite(hiE!) ||
            !Number.isFinite(loE!) ||
            !Number.isFinite(clE!)
          ) {
            return;
          }
          if (!snowballSignalBarBodyRangePassed("long", iSig, o15, h15, l15, c15)) {
            if (snowScanStats) {
              snowScanStats.longBodyRatioBlocked++;
              pushSnowScanSymList(snowScanStats.longBodyRatioBlockedSymbols, `${symbol} LONG`);
            }
            return;
          }
        }

        let breakout1hEval: SnowballLongBreakout1hConfirmEval | null = null;
        if (!intrabar && pack1hForTwoBar?.timeSec?.length) {
          breakout1hEval = evaluateSnowballLongBreakout1hConfirm(
            pack1hForTwoBar,
            snowballLongBreakout1hSwingLookback(),
            snowballLongBreakout1hExcludeRecent(),
          );
        }
        let twoBarInlinePassed = false;

        const trig: SnowballLongTriggerKind =
          classicSwing && vahOk ? "both" : classicSwing ? "swing_hh" : "vah_break";

        const refPlaybook = trig === "vah_break" ? vahH! : priorMaxHigh;

        const signalBarOpenSec = t15[iSig];
        if (typeof signalBarOpenSec !== "number" || !Number.isFinite(signalBarOpenSec)) return;

        let twoBarEval: SnowballTwoBarInlineEval | null = null;
        if (twoBarInline) {
          twoBarEval = evaluateSnowballTwoBarInlineLong({
            open: o15,
            close: c15,
            high: h15,
            low: l15,
            volume: v15,
            timeSec: t15,
            iSig,
            iConf,
            snowTf,
            pack1h: pack1hForTwoBar,
          });
          twoBarInlinePassed = twoBarEval.ok;
        }

        if (snowScanStats && !intrabar) {
          snowScanStats.longTechPass++;
          pushSnowScanSymList(snowScanStats.longTechPassSymbols, `${symbol} LONG`);
        }

        const key = `${symbol}|SNOWBALL|${snowTf}|BULL`;
        const barDedupeBlocked = snowballSymbolDedupeBlocks(state, key, signalBarOpenSec);
        if (barDedupeBlocked) {
          if (snowScanStats && !intrabar) {
            snowScanStats.longDeduped++;
            pushSnowScanSymList(
              snowScanStats.longDedupedSymbols,
              `${symbol} LONG (แท่งเดิม)`,
            );
          }
          return;
        }

        let longWaveGate: SnowballWaveGateStatus | null = null;
        const iWave = longBreakout1h ? iEval : twoBarInline ? iConf : iEval;
        if (waveGateOn && !intrabar) {
          longWaveGate = evaluateSnowballWaveGate(
            "long",
            c15,
            h15,
            l15,
            t15,
            iWave,
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

        const sLp = highVolumeNodeBarLow(v15, h15, l15, iSig, svpInnerLb);
        const emaR =
          typeof emaResArr[iSig] === "number" && Number.isFinite(emaResArr[iSig])
            ? emaResArr[iSig]
            : emaResArr[iClosed];

        const emaSlopeNow =
          longSlopeEmaOn && typeof emaLongSlopeArr[iSig] === "number" ? emaLongSlopeArr[iSig]! : undefined;
        const emaSlopePrev =
          longSlopeEmaOn && typeof emaLongSlopeArr[iPrev] === "number" ? emaLongSlopeArr[iPrev]! : undefined;
        const ema2SlopeOk =
          longEma2On &&
          typeof emaLongSlope2Arr?.[iSig] === "number" &&
          typeof emaLongSlope2Arr?.[iPrev] === "number" &&
          Number.isFinite(emaLongSlope2Arr?.[iSig] as number) &&
          Number.isFinite(emaLongSlope2Arr?.[iPrev] as number) &&
          (emaLongSlope2Arr![iSig]! > emaLongSlope2Arr![iPrev]!);

        let master4hTradePlan: SnowballMaster4hLongTradePlan | null = null;
        const planBarIdx = twoBarInline ? iConf : iSig;
        const planEntryPx = twoBarInline ? c15[iConf]! : clE!;
        if (snowTf === "4h") {
          try {
            master4hTradePlan = await buildSnowballMaster4hLongTradePlan(
              symbol,
              c15,
              h15,
              l15,
              v15,
              planBarIdx,
              swingLb,
              swingEx,
              planEntryPx
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

        const pack1hTrend = packsDiv1hExtra[idx] ?? pack1hForTwoBar;
        const trendMomentum: TrendMomentumMetrics | null = calculateTrendMomentumMetrics(pack1hTrend, {
          pack15m: packs15mMomentum[idx] ?? null,
        });
        const sustainedBuyingPressure = isSustainedBuyingPressure(trendMomentum);

        const [longGreenDaysForAlert, longMktCtxForAlert] = await Promise.all([
          fetchGreenDaysBeforeSignalBar(symbol, signalBarOpenSec, snowTf),
          fetchSnowballAlertMarketContext(symbol),
        ]);
        const longTrendGradeInput = {
          alertSide: "long" as const,
          ema4hSlopePct7d: longMktCtxForAlert?.ema4hSlopePct7d ?? null,
          ema1dSlopePct7d: longMktCtxForAlert?.ema1dSlopePct7d ?? null,
          btcEma4hSlopePct7d: longMktCtxForAlert?.btcEma4hSlopePct7d ?? null,
          greenDaysBeforeSignal: longGreenDaysForAlert,
        };

        const gradeResolution: SnowballLongGradeResolution = !intrabar
          ? resolveSnowballLongFinalGrade({
              snowTf,
              swing48,
              swing200,
              vahOk,
              twoBarEval,
              trendMomentum,
              signalVolVsSma:
                typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 ? vE! / vsE : null,
              twoBarInlinePassed,
              longBreakout1h,
              breakout1hEval,
              momentumRequired: snowballGradeBRequiresSustainedMomentum(),
              momentumOk: sustainedBuyingPressure,
              gradeDPlusOnMomentumFail: snowballGradeBMomentumFailGradeDOn1hConfirmPass(),
              gradeFOnMomentumAndConfirmFail: snowballGradeFOnMomentumAnd1hConfirmFail(),
              volumeStrictOk: volStrictOk,
              volumeNearMissOnly: volNearMissOnly,
              gradeDPlusNearMissVolumeEnabled: snowballGradeBNearMissVolumeEnabled(),
              trendGradeInput: longTrendGradeInput,
            })
          : {
              kind: "grade",
              grade: "c",
              displayGrade: "C",
              gradeDangerous: false,
              compositeGrade: false,
              structureTier: classifyLongStructureTier(swing48, swing200, vahOk),
              confirm1hOk: true,
              momentumOk: true,
              confirm1hEval: breakout1hEval,
            };

        const longBreakoutGrade = gradeResolution.grade;
        const longDisplayGrade = gradeResolution.displayGrade;
        const longGradeDangerous = gradeResolution.gradeDangerous;
        const gradeBMomentum1hEval = gradeResolution.confirm1hEval;
        const gradeFootnote: string | undefined = gradeResolution.footnote;

        let longDoubleBarrierLine = "";
        if (dbOn) {
          const cls = classifyLongDoubleBarrierTier(h15, iSig, clE!);
          const { min, max } = snowballDoubleBarrierWatchBandPct();
          const band = `${(min * 100).toFixed(1)}–${(max * 100).toFixed(1)}%`;
          if (cls.nearestOverhead == null) {
            longDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): ไม่พบ High เหนือราคาในระยะ — โครงเหนือว่าง · โซน Watchlist กำหนด +${band} เหนือราคา`;
          } else {
            const nearS = formatUsdPrice(cls.nearestOverhead);
            const distS = cls.distPct != null ? cls.distPct.toFixed(2) : "—";
            if (cls.tier === "b_plus") {
              longDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวต้านใกล้ ~ ${nearS} USDT (+${distS}%) อยู่ในโซน Watchlist +${band} — ระวังแนวบน`;
            } else {
              longDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวต้านใกล้ ~ ${nearS} USDT (+${distS}%) อยู่นอกโซน Watchlist +${band} — โครงเหนือว่างขึ้นไป`;
            }
          }
        }

        const longRiskFlags =
          !intrabar && !twoBarInline && !longBreakout1h
            ? evaluateSnowballConfirmRisk("long", o15, h15, l15, c15, iSig)
            : [];
        const longSignalHigh = h15[iSig];
        const longSignalLow = l15[iSig];
        const longConfirmVolRatio = snowballConfirmVolMinRatio();
        const longConfirmTrigger: SnowballConfirmTriggerSnapshot | undefined =
          !twoBarInline &&
          !longBreakout1h &&
          longRiskFlags.length > 0 &&
          typeof longSignalHigh === "number" &&
          Number.isFinite(longSignalHigh)
            ? { refLevel: longSignalHigh, volMinRatio: longConfirmVolRatio }
            : undefined;

        const confCloseForFoot = longBreakout1h
          ? breakout1hEval!.close
          : twoBarInline
            ? c15[iConf]!
            : clE!;
        const minL1hForFoot =
          twoBarInline && pack1hForTwoBar?.timeSec?.length
            ? snowballMinLow1hBetweenClosedBars(
                pack1hForTwoBar.timeSec,
                pack1hForTwoBar.low,
                t15[iSig]!,
                t15[iConf]! + tfBarDurationSecForSummary(snowTf),
              )
            : null;
        const inlineTwoBarFootnote =
          twoBarInline && Number.isFinite(confCloseForFoot)
            ? `📎 Two-bar inline: แท่งสัญญาณปิด ~ ${formatSnowballBarCloseBkk(t15[iSig]!, snowTf)} · แท่ง confirm ปิด ~ ${formatSnowballBarCloseBkk(t15[iConf]!, snowTf)} @ ${formatUsdPrice(confCloseForFoot)} USDT · 1h min-low ในช่วงสองแท่ง = ${minL1hForFoot != null ? formatUsdPrice(minL1hForFoot) : "—"} (เทียบ low สัญญาณ ${longSignalLow != null && Number.isFinite(longSignalLow) ? formatUsdPrice(longSignalLow) : "—"})`
            : undefined;
        const breakout1hFootnote =
          longBreakout1h && breakout1hEval
            ? `📎 Breakout Entry (1H confirm): ปิด ~ ${formatClosedCandleBkk(breakout1hEval.barOpenSec)} @ ${formatUsdPrice(breakout1hEval.close)} USDT · ${breakout1hEval.detail}`
            : undefined;
        const entryClosePx =
          longBreakout1h && breakout1hEval && Number.isFinite(breakout1hEval.close)
            ? breakout1hEval.close
            : twoBarInline
              ? c15[iConf]!
              : clE!;

        if (!intrabar && snowTf === "4h") {
          const alertBarOpen = twoBarInline ? t15[iConf]! : signalBarOpenSec;
          const anchorClose = snowballAlertAnchorCloseSec(alertBarOpen, snowTf);
          if (snowballAlertIsStale(anchorClose, now)) {
            console.info(
              `[indicatorPublicFeed] Snowball LONG skip stale (${Math.floor((now / 1000 - anchorClose) / 60)}m after bar close) ${symbol} ${snowTf}`,
            );
            if (snowScanStats) {
              snowScanStats.longStaleSkipped++;
              pushSnowScanSymList(snowScanStats.longStaleSkippedSymbols, `${symbol} LONG`);
            }
            return;
          }
        }

        const longQualitySignal = snowballMatchesQualitySignal({
          ema4hSlopePct7d: longMktCtxForAlert?.ema4hSlopePct7d ?? null,
          greenDaysBeforeSignal: longGreenDaysForAlert,
        });

        const msg = buildSnowballTripleCheckMessage(symbol, "bull", signalBarOpenSec, {
          close: entryClosePx,
          refSwing: refPlaybook,
          volume: vE!,
          volSma: vsE!,
          stochK:
            typeof stochArr[iSig] === "number" && Number.isFinite(stochArr[iSig]!)
              ? stochArr[iSig]!
              : stochLastClosed,
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
          snowballLongBreakoutGrade: longBreakoutGrade,
          snowballTrendDisplayGrade: longDisplayGrade,
          gradeDangerous: longGradeDangerous,
          longSwing200Ok: swing200,
          doubleBarrierChecklistLine: dbOn ? longDoubleBarrierLine : undefined,
          confirmRiskFlags:
            twoBarInline || longBreakout1h ? undefined : longRiskFlags.length > 0 ? longRiskFlags : undefined,
          confirmTrigger:
            twoBarInline || longBreakout1h
              ? undefined
              : longConfirmTrigger
                ? { side: "long", refLevel: longConfirmTrigger.refLevel, volMinRatio: longConfirmTrigger.volMinRatio }
                : undefined,
          inlineTwoBarFootnote,
          breakout1hConfirmUsed:
            longBreakout1h && !snowballIsGradeF(longBreakoutGrade),
          breakout1hConfirmFootnote: breakout1hFootnote,
          gradeFootnote,
          trendMomentum,
          sustainedBuyingPressure,
          alertClosedBarOpenSec: twoBarInline ? t15[iConf]! : signalBarOpenSec,
          qualitySignal: longQualitySignal,
        });
        const longPendingConfirm =
          !twoBarInline && !longBreakout1h && !intrabar && longRiskFlags.length > 0 && Boolean(longConfirmTrigger);
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
            await updatePublicFeedFiredKey(
              state,
              key,
              signalBarOpenSec,
              iso,
              now,
              entryClosePx,
            );
            if (!skipSnowballTgForPending) {
              notified += 1;
              if (snowScanStats && !intrabar) {
                snowScanStats.longSent++;
                pushSnowScanSymList(
                  snowScanStats.longSentSymbols,
                  `${symbol} LONG (Grade ${snowballTrendGradeDisplayWithDangerous(longDisplayGrade, longGradeDangerous)})`,
                );
              }
            }
            let longMktCtx: Awaited<ReturnType<typeof fetchSnowballAlertMarketContext>> | null =
              longMktCtxForAlert;
            const longVolSnapAuto = snowballVolatilitySnapshotAt(h15, l15, c15, o15, iSig);
            const longSignalVolVsSma =
              typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 && Number.isFinite(vE!)
                ? vE! / vsE
                : null;
            const longGradeFFade = snowballMatchesQualityShortSignal({
              ema4hSlopePct7d: longMktCtxForAlert?.ema4hSlopePct7d ?? null,
              ema1dSlopePct7d: longMktCtxForAlert?.ema1dSlopePct7d ?? null,
            });
            const runLongAutoOpenNow =
              !intrabar &&
              (!skipSnowballTgForPending || longQualitySignal || longGradeFFade);
            if (runLongAutoOpenNow) {
              try {
                const mexcContract = await resolveMexcContractFromBinanceSymbolAsync(symbol);
                if (mexcContract) {
                const longActionPlan = gradeResolution.actionPlan ?? null;
                let marginScale: number | undefined;
                if (!longQualitySignal && !longGradeFFade && longActionPlan != null) {
                  const apm = snowballTrendActionPlanMarginScale(longActionPlan);
                  if (apm !== 1.0) marginScale = apm;
                }
                await runSnowballAutoTradeAfterSnowballAlert({
                  contractSymbol: mexcContract,
                  binanceSymbol: symbol,
                  alertSide: "long",
                  displayGrade: longDisplayGrade,
                  qualityTier: longBreakoutGrade,
                  momentumFailGradeF: snowballIsGradeF(longBreakoutGrade),
                  momentumDowngrade: false,
                  referenceEntryPrice: entryClosePx,
                  referenceEntryPriceEma20_1h: snowballEma20_1hReferencePrice(
                    pack1hTrend,
                    Math.floor(now / 1000),
                  ),
                  signalBarOpenSec,
                  signalBarTf: snowTf,
                  signalBarLow:
                    typeof longSignalLow === "number" && Number.isFinite(longSignalLow)
                      ? longSignalLow
                      : null,
                  vol: vE!,
                  volSma: vsE!,
                  actionPlan:
                    longQualitySignal || longGradeFFade ? null : longActionPlan,
                  greenDaysBeforeSignal: longGreenDaysForAlert,
                  fundingRate: longMktCtxForAlert?.fundingRate ?? null,
                  ema4hSlopePct7d: longMktCtxForAlert?.ema4hSlopePct7d ?? null,
                  ema1dSlopePct7d: longMktCtxForAlert?.ema1dSlopePct7d ?? null,
                  barRangePctSignal: longVolSnapAuto.barRangePctSignal,
                  signalVolVsSma: longSignalVolVsSma,
                  btcEma4hSlopePct7d: longMktCtxForAlert?.btcEma4hSlopePct7d ?? null,
                  psar4hTrend: longMktCtxForAlert?.psar4hTrend ?? null,
                  ...(marginScale != null ? { marginScale } : {}),
                });
                if ((longQualitySignal || longGradeFFade) && skipSnowballTgForPending) {
                  console.info(
                    `[indicatorPublicFeed] Snowball LONG auto-open at alert (${longQualitySignal ? "✨ Quality Signal" : "Long → fade SHORT · เกรด F"}, pending confirm) ${symbol} ${snowTf}`,
                  );
                }
                }
              } catch (e) {
                console.error("[indicatorPublicFeed] snowball auto-open", symbol, e);
              }
            }
            const longVolSnap = snowballVolatilitySnapshotAt(h15, l15, c15, o15, iSig);
            const longLenSnap = packSb ? computeSnowballSignalLenPercentile(packSb, iSig) : null;
            if (!intrabar && longMktCtx == null) {
              longMktCtx = await fetchSnowballAlertMarketContext(symbol);
            }
            const longConfirmGateSteps = buildSnowballLongConfirmGateStepsForStats(
              snowTf,
              twoBarInline,
              pack1hTrend ?? pack1hForTwoBar,
              twoBarInline
                ? {
                    open: o15,
                    close: c15,
                    high: h15,
                    low: l15,
                    volume: v15,
                    timeSec: t15,
                    iSig,
                    iConf,
                    snowTf,
                    pack1h: pack1hForTwoBar,
                  }
                : null,
              swingEx,
            );
            if (
              !twoBarInline &&
              !longBreakout1h &&
              !intrabar &&
              longConfirmTrigger &&
              longRiskFlags.length > 0
            ) {
              try {
                await addSnowballPendingConfirm({
                  symbol,
                  side: "long",
                  snowTf,
                  signalBarOpenSec,
                  signalHigh: longSignalHigh ?? clE!,
                  signalLow:
                    typeof longSignalLow === "number" && Number.isFinite(longSignalLow) ? longSignalLow : clE!,
                  signalClose: clE!,
                  signalVolume: vE!,
                  alertedAtIso: iso,
                  alertedAtMs: now,
                  riskFlags: longRiskFlags.map((f) => ({ id: f.id, label: f.label, detail: f.detail })),
                  qualityTier: longBreakoutGrade,
                  statsDisplayGrade: longDisplayGrade,
                  statsTriggerKind: String(trig),
                  statsVolSma: typeof vsE === "number" && Number.isFinite(vsE) ? vsE : undefined,
                  statsAtr100: longVolSnap.atr100,
                  statsMaxUpperWick100: longVolSnap.maxUpperWick100,
                  statsRangeScore: longVolSnap.rangeScore,
                  statsWickScore: longVolSnap.wickScore,
                  statsBarRangePctPrev: longVolSnap.barRangePctPrev,
                  statsBarRangePctSignal: longVolSnap.barRangePctSignal,
                  statsBarRangePct2Sum: longVolSnap.barRangePct2Sum,
                  statsBtcPsar4hTrend: longMktCtx?.btcPsar4hTrend ?? null,
                  statsBtcPsar4hClose: longMktCtx?.btcPsar4hClose ?? null,
                  statsBtcPsar1hTrend: longMktCtx?.btcPsar1hTrend ?? null,
                  statsBtcPsar1hClose: longMktCtx?.btcPsar1hClose ?? null,
                  statsQuoteVol24hUsdt: longMktCtx?.quoteVol24hUsdt ?? null,
                  statsMarketCapUsd: longMktCtx?.marketCapUsd ?? null,
                  statsFundingRate: longMktCtx?.fundingRate ?? null,
                  statsAtrPct14d: longMktCtx?.atrPct14d ?? null,
                  statsEma4hSlopePct7d: longMktCtx?.ema4hSlopePct7d ?? null,
                  statsEma1dSlopePct7d: longMktCtx?.ema1dSlopePct7d ?? null,
                  statsBtcEma4hSlopePct7d: longMktCtx?.btcEma4hSlopePct7d ?? null,
                  statsBtcEma1dSlopePct7d: longMktCtx?.btcEma1dSlopePct7d ?? null,
                  statsPsar4hTrend: longMktCtx?.psar4hTrend ?? null,
                  statsPsar4hDistPct: longMktCtx?.psar4hDistPct ?? null,
                  statsRangeRankInLookback: longLenSnap?.rangeRankInLookback ?? null,
                  statsLenLookbackBars: longLenSnap?.lookbackBars ?? null,
                  statsLenPercentilePct: longLenSnap?.lenPercentilePct ?? null,
                  statsSignalVolVsSma:
                    typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 && Number.isFinite(vE!)
                      ? vE! / vsE
                      : undefined,
                  statsVolStrictOk: volStrictOk,
                  statsVolNearMissOnly: volNearMissOnly,
                  statsVolMultAtAlert: volMult,
                  statsVolNearMultAtAlert: volNearMult,
                  ...(longConfirmGateSteps.length > 0
                    ? { statsConfirmGateSteps: longConfirmGateSteps }
                    : {}),
                  ...(gradeResolution.kind === "grade"
                    ? { statsStructureTier: gradeResolution.structureTier }
                    : {}),
                  statsSwing200Ok: swing200,
                  ...(skipSnowballTgForPending ? { deferSnowballAutotradeToConfirm: true } : {}),
                });
              } catch (pendErr) {
                console.error("[indicatorPublicFeed] snowball pending confirm LONG", symbol, pendErr);
              }
            }
            try {
              if (!skipSnowballTgForPending) {
                const longStatsTradeSide = resolveSnowballStatsTradeSide({
                  alertSide: "long",
                  qualityTier: longBreakoutGrade,
                  signalOpen: o15[iSig]!,
                  signalClose: clE!,
                  signalHigh: longSignalHigh,
                  signalLow: longSignalLow,
                  signalVolume: vE!,
                  confirmOpen: twoBarInline
                    ? o15[iConf]!
                    : gradeBMomentum1hEval
                      ? pack1hTrend?.open?.[gradeBMomentum1hEval.i1h] ?? null
                      : longBreakout1h && breakout1hEval
                        ? pack1hForTwoBar?.open?.[breakout1hEval.i1h] ?? null
                        : null,
                  confirmClose: twoBarInline
                    ? c15[iConf]!
                    : gradeBMomentum1hEval?.close ??
                      (longBreakout1h && breakout1hEval ? breakout1hEval.close : null),
                  confirmVolume: twoBarInline
                    ? v15[iConf]!
                    : gradeBMomentum1hEval
                      ? pack1hTrend?.volume?.[gradeBMomentum1hEval.i1h] ?? null
                      : longBreakout1h && breakout1hEval
                        ? pack1hForTwoBar?.volume?.[breakout1hEval!.i1h] ?? null
                        : null,
                });
                const longStatsBarOpenSec = signalBarOpenSec;
                const longStatsBarTf = snowTf;
                const longGreenDays = await fetchGreenDaysBeforeSignalBar(
                  symbol,
                  longStatsBarOpenSec,
                  longStatsBarTf,
                );
                await appendSnowballStatsRow({
                  symbol,
                  side: longStatsTradeSide,
                  alertSide: "long",
                  alertedAtIso: iso,
                  alertedAtMs: now,
                  signalBarOpenSec: longStatsBarOpenSec,
                  signalBarTf: longStatsBarTf,
                  entryPrice: entryClosePx,
                  intrabar,
                  triggerKind: trig,
                  vol: vE!,
                  volSma: vsE!,
                  qualityTier: longBreakoutGrade,
                  alertQualityTier: longBreakoutGrade,
                  displayGrade: longDisplayGrade,
                  ...(gradeResolution.structureTier
                    ? { structureTier: gradeResolution.structureTier }
                    : {}),
                  swing200Ok: swing200,
                  ...(gradeResolution.actionPlan ? { actionPlan: gradeResolution.actionPlan } : {}),
                  momentumDowngrade: false,
                  momentumFailGradeF: snowballIsGradeF(longBreakoutGrade),
                  ...(longGradeDangerous ? { gradeDangerous: true } : {}),
                  atr100: longVolSnap.atr100,
                  maxUpperWick100: longVolSnap.maxUpperWick100,
                  rangeScore: longVolSnap.rangeScore,
                  wickScore: longVolSnap.wickScore,
                  barRangePctPrev: longVolSnap.barRangePctPrev,
                  barRangePctSignal: longVolSnap.barRangePctSignal,
                  barRangePct2Sum: longVolSnap.barRangePct2Sum,
                  btcPsar4hTrend: longMktCtx?.btcPsar4hTrend ?? null,
                  btcPsar4hClose: longMktCtx?.btcPsar4hClose ?? null,
                  btcPsar1hTrend: longMktCtx?.btcPsar1hTrend ?? null,
                  btcPsar1hClose: longMktCtx?.btcPsar1hClose ?? null,
                  quoteVol24hUsdt: longMktCtx?.quoteVol24hUsdt ?? null,
                  marketCapUsd: longMktCtx?.marketCapUsd ?? null,
                  fundingRate: longMktCtx?.fundingRate ?? null,
                  atrPct14d: longMktCtx?.atrPct14d ?? null,
                  ema1hSlopePct7d: longMktCtx?.ema1hSlopePct7d ?? null,
                  ema4hSlopePct7d: longMktCtx?.ema4hSlopePct7d ?? null,
                  ema1dSlopePct7d: longMktCtx?.ema1dSlopePct7d ?? null,
                  btcEma4hSlopePct7d: longMktCtx?.btcEma4hSlopePct7d ?? null,
                  btcEma1dSlopePct7d: longMktCtx?.btcEma1dSlopePct7d ?? null,
                  psar4hTrend: longMktCtx?.psar4hTrend ?? null,
                  psar4hDistPct: longMktCtx?.psar4hDistPct ?? null,
                  rangeRankInLookback: longLenSnap?.rangeRankInLookback ?? null,
                  lenLookbackBars: longLenSnap?.lookbackBars ?? null,
                  lenPercentilePct: longLenSnap?.lenPercentilePct ?? null,
                  signalVolVsSma:
                    typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 ? vE! / vsE : null,
                  volStrictOk,
                  volNearMissOnly,
                  volMultAtAlert: volMult,
                  volNearMultAtAlert: volNearMult,
                  ...(longConfirmGateSteps.length > 0 ? { confirmGateSteps: longConfirmGateSteps } : {}),
                  ...trendMomentumStatsFields(trendMomentum),
                  greenDaysBeforeSignal: longGreenDays,
                  ...snowballStatsConfirmVolFieldsFrom1hEval(
                    gradeBMomentum1hEval ??
                      (longBreakout1h || snowTf === "4h" ? breakout1hEval : null),
                  ),
                });
              }
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

      const sendSnowballBear = async (
        iEval: number,
        intrabar: boolean,
        pack1hForTwoBar: BinanceKlinePack | null,
      ): Promise<void> => {
        if (iEval < 1) return;
        if (!intrabar && snowballPendingSymbols.has(symbol)) {
          if (snowScanStats) {
            snowScanStats.bearDeduped++;
            pushSnowScanSymList(
              snowScanStats.bearDedupedSymbols,
              `${symbol} BEAR (สถิติ/คิว pending)`,
            );
          }
          return;
        }
        const twoBarInline = !intrabar && snowballTwoBarInlineModeEnabled() && iEval >= 2;
        const iConf = iEval;
        const iSig = twoBarInline ? iEval - 1 : iEval;
        const relaxVol = intrabar && relaxIntrabarVol;
        const vsE = volSmaArr[iSig];
        const vE = v15[iSig];
        const clE = c15[iSig];
        const loE = l15[iSig];
        const loPrev = l15[iSig - 1];
        if (
          !snowballVolumeOk(relaxVol, vE!, vsE!, volMult) ||
          !Number.isFinite(clE!) ||
          !Number.isFinite(loE!) ||
          !Number.isFinite(loPrev!)
        ) {
          return;
        }

        const priorMinLow = minLowPriorWindow(l15, iSig, swingLb, swingEx);
        const swingBreak = intrabar ? loE! < priorMinLow : clE! < priorMinLow;
        const classicBear = Number.isFinite(priorMinLow) && swingBreak;
        if (!classicBear) return;
        if (stochLastClosed <= osMin) return;

        const svpHdLowGuess = highVolumeNodeBarLow(v15, h15, l15, iSig, svpInnerLb);
        const svpHdOkBear =
          typeof svpHdLowGuess === "number" &&
          Number.isFinite(svpHdLowGuess) &&
          clE! < svpHdLowGuess;
        if (shortNeedSvpHd && !svpHdOkBear) return;

        const emaResistance =
          typeof emaResArr[iSig] === "number" && Number.isFinite(emaResArr[iSig])
            ? emaResArr[iSig]
            : emaResArr[iClosed];
        if (!Number.isFinite(emaResistance)) return;

        const signalBarOpenSec = t15[iSig];
        if (typeof signalBarOpenSec !== "number" || !Number.isFinite(signalBarOpenSec)) return;

        if (!twoBarInline && !intrabar && snowballBodyToRangeFilterEnabled()) {
          const oE = o15[iSig];
          const hiE = h15[iSig];
          if (
            !Number.isFinite(oE!) ||
            !Number.isFinite(hiE!) ||
            !Number.isFinite(loE!) ||
            !Number.isFinite(clE!)
          ) {
            return;
          }
          if (!snowballSignalBarBodyRangePassed("bear", iSig, o15, h15, l15, c15)) {
            if (snowScanStats) {
              snowScanStats.bearBodyRatioBlocked++;
              pushSnowScanSymList(snowScanStats.bearBodyRatioBlockedSymbols, `${symbol} BEAR`);
            }
            return;
          }
        }

        if (twoBarInline) {
          const tfDur = tfBarDurationSecForSummary(snowTf);
          const sigOpen = t15[iSig]!;
          const confEnd = t15[iConf]! + tfDur;
          const sigH = h15[iSig]!;
          const sigL = l15[iSig]!;
          const sigC = c15[iSig]!;
          const confC = c15[iConf]!;
          const sigV = v15[iSig]!;
          const confV = v15[iConf]!;
          if (
            !Number.isFinite(confC) ||
            !Number.isFinite(confV) ||
            !Number.isFinite(sigH) ||
            !Number.isFinite(sigL) ||
            !Number.isFinite(sigC) ||
            !Number.isFinite(sigV)
          ) {
            return;
          }
          const range = sigH - sigL;
          if (!Number.isFinite(range) || range <= 0) return;
          const maxPull = snowballTwoBarInlinePullbackMaxFrac();
          if (confC > sigC + maxPull * range) {
            if (snowScanStats && !intrabar) {
              snowScanStats.bearTwoBarInlineBlocked++;
              pushSnowScanSymList(snowScanStats.bearTwoBarInlineBlockedSymbols, `${symbol} BEAR (pullback)`);
            }
            return;
          }
          const volRatioNeed = snowballConfirmVolMinRatio();
          if (sigV <= 0 || confV / sigV < volRatioNeed) {
            if (snowScanStats && !intrabar) {
              snowScanStats.bearTwoBarInlineBlocked++;
              pushSnowScanSymList(snowScanStats.bearTwoBarInlineBlockedSymbols, `${symbol} BEAR (vol)`);
            }
            return;
          }
          if (!pack1hForTwoBar?.timeSec?.length) {
            if (snowScanStats && !intrabar) {
              snowScanStats.bearTwoBarInlineBlocked++;
              pushSnowScanSymList(snowScanStats.bearTwoBarInlineBlockedSymbols, `${symbol} BEAR (no 1h)`);
            }
            return;
          }
          const maxH1h = snowballMaxHigh1hBetweenClosedBars(
            pack1hForTwoBar.timeSec,
            pack1hForTwoBar.high,
            sigOpen,
            confEnd,
          );
          if (maxH1h == null || maxH1h > sigH) {
            if (snowScanStats && !intrabar) {
              snowScanStats.bearTwoBarInlineBlocked++;
              pushSnowScanSymList(snowScanStats.bearTwoBarInlineBlockedSymbols, `${symbol} BEAR (1h HH)`);
            }
            return;
          }
        }

        if (snowScanStats && !intrabar) {
          snowScanStats.bearTechPass++;
          pushSnowScanSymList(snowScanStats.bearTechPassSymbols, `${symbol} BEAR`);
        }

        const key = `${symbol}|SNOWBALL|${snowTf}|BEAR`;
        if (snowballSymbolDedupeBlocks(state, key, signalBarOpenSec)) {
          if (snowScanStats && !intrabar) {
            snowScanStats.bearDeduped++;
            pushSnowScanSymList(
              snowScanStats.bearDedupedSymbols,
              `${symbol} BEAR (แท่งเดิม)`,
            );
          }
          return;
        }

        let bearWaveGate: SnowballWaveGateStatus | null = null;
        const iWave = twoBarInline ? iConf : iEval;
        if (waveGateOn && !intrabar) {
          bearWaveGate = evaluateSnowballWaveGate(
            "bear",
            c15,
            h15,
            l15,
            t15,
            iWave,
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

        let shortDoubleBarrierLine = "";
        if (dbOn) {
          const cls = classifyShortDoubleBarrierTier(l15, iSig, clE!);
          const { min, max } = snowballDoubleBarrierWatchBandPct();
          const band = `${(min * 100).toFixed(1)}–${(max * 100).toFixed(1)}%`;
          if (cls.nearestUnderfoot == null) {
            shortDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): ไม่พบ Low ใต้ราคาในระยะ — โครงใต้ว่าง · โซน Watchlist −${band} ใต้ราคา`;
          } else {
            const nearS = formatUsdPrice(cls.nearestUnderfoot);
            const distS = cls.distPct != null ? cls.distPct.toFixed(2) : "—";
            if (cls.tier === "b_plus") {
              shortDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวรับใกล้ ~ ${nearS} USDT (−${distS}%) อยู่ในโซน Watchlist −${band} — ระวังแนวล่าง`;
            } else {
              shortDoubleBarrierLine = `• Barrier 2 (คุณภาพ · ย้อน ${barrier2Lb} แท่ง): แนวรับใกล้ ~ ${nearS} USDT (−${distS}%) อยู่นอกโซน Watchlist −${band} — โครงใต้ว่างลงไป`;
            }
          }
        }

        const bearRiskFlags = !intrabar && !twoBarInline ? evaluateSnowballConfirmRisk("bear", o15, h15, l15, c15, iSig) : [];
        const bearSignalHigh = h15[iSig];
        const bearSignalLow = l15[iSig];
        const bearConfirmVolRatio = snowballConfirmVolMinRatio();
        const bearConfirmTrigger: SnowballConfirmTriggerSnapshot | undefined =
          !twoBarInline &&
          bearRiskFlags.length > 0 &&
          typeof bearSignalLow === "number" &&
          Number.isFinite(bearSignalLow)
            ? { refLevel: bearSignalLow, volMinRatio: bearConfirmVolRatio }
            : undefined;

        const confCloseForFootB = twoBarInline ? c15[iConf]! : clE!;
        const maxH1hForFoot =
          twoBarInline && pack1hForTwoBar?.timeSec?.length
            ? snowballMaxHigh1hBetweenClosedBars(
                pack1hForTwoBar.timeSec,
                pack1hForTwoBar.high,
                t15[iSig]!,
                t15[iConf]! + tfBarDurationSecForSummary(snowTf),
              )
            : null;
        const inlineTwoBarFootnoteBear =
          twoBarInline && Number.isFinite(confCloseForFootB)
            ? `📎 Two-bar inline: แท่งสัญญาณปิด ~ ${formatSnowballBarCloseBkk(t15[iSig]!, snowTf)} · แท่ง confirm ปิด ~ ${formatSnowballBarCloseBkk(t15[iConf]!, snowTf)} @ ${formatUsdPrice(confCloseForFootB)} USDT · 1h max-high ในช่วงสองแท่ง = ${maxH1hForFoot != null ? formatUsdPrice(maxH1hForFoot) : "—"} (เทียบ high สัญญาณ ${bearSignalHigh != null && Number.isFinite(bearSignalHigh) ? formatUsdPrice(bearSignalHigh) : "—"})`
            : undefined;

        if (!intrabar && snowTf === "4h") {
          const alertBarOpen = twoBarInline ? t15[iConf]! : signalBarOpenSec;
          const anchorClose = snowballAlertAnchorCloseSec(alertBarOpen, snowTf);
          if (snowballAlertIsStale(anchorClose, now)) {
            console.info(
              `[indicatorPublicFeed] Snowball BEAR skip stale (${Math.floor((now / 1000 - anchorClose) / 60)}m after bar close) ${symbol} ${snowTf}`,
            );
            if (snowScanStats) {
              snowScanStats.bearStaleSkipped++;
              pushSnowScanSymList(snowScanStats.bearStaleSkippedSymbols, `${symbol} BEAR`);
            }
            return;
          }
        }

        const [bearGreenDaysForAlert, bearMktCtxForAlert] = await Promise.all([
          fetchGreenDaysBeforeSignalBar(symbol, signalBarOpenSec, snowTf),
          fetchSnowballAlertMarketContext(symbol),
        ]);
        const bearQualitySignal = snowballMatchesQualitySignal({
          ema4hSlopePct7d: bearMktCtxForAlert?.ema4hSlopePct7d ?? null,
          greenDaysBeforeSignal: bearGreenDaysForAlert,
        });
        const bearVolSnapAuto = snowballVolatilitySnapshotAt(h15, l15, c15, o15, iSig);
        const bearSignalVolVsSma =
          typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 && Number.isFinite(vE!)
            ? vE! / vsE
            : null;
        const bearTrendGrade = classifySnowballTrendGrade({
          alertSide: "bear",
          ema4hSlopePct7d: bearMktCtxForAlert?.ema4hSlopePct7d ?? null,
          ema1dSlopePct7d: bearMktCtxForAlert?.ema1dSlopePct7d ?? null,
          btcEma4hSlopePct7d: bearMktCtxForAlert?.btcEma4hSlopePct7d ?? null,
        });

        const msg = buildSnowballTripleCheckMessage(symbol, "bear", signalBarOpenSec, {
          close: clE!,
          refSwing: priorMinLow,
          volume: vE!,
          volSma: vsE!,
          stochK:
            typeof stochArr[iSig] === "number" && Number.isFinite(stochArr[iSig]!)
              ? stochArr[iSig]!
              : stochLastClosed,
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
          shortTrendGrade: bearTrendGrade,
          shortDoubleBarrierChecklistLine: dbOn ? shortDoubleBarrierLine : undefined,
          confirmRiskFlags: twoBarInline ? undefined : bearRiskFlags.length > 0 ? bearRiskFlags : undefined,
          confirmTrigger: twoBarInline
            ? undefined
            : bearConfirmTrigger
              ? { side: "bear", refLevel: bearConfirmTrigger.refLevel, volMinRatio: bearConfirmTrigger.volMinRatio }
              : undefined,
          inlineTwoBarFootnote: inlineTwoBarFootnoteBear,
          alertClosedBarOpenSec: twoBarInline ? t15[iConf]! : signalBarOpenSec,
          qualitySignal: bearQualitySignal,
        });
        const bearPendingConfirm =
          !twoBarInline && !intrabar && bearRiskFlags.length > 0 && Boolean(bearConfirmTrigger);
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
            await updatePublicFeedFiredKey(
              state,
              key,
              signalBarOpenSec,
              iso,
              now,
              twoBarInline ? c15[iConf]! : clE!,
            );
            if (!skipBearTgForPending) {
              notified += 1;
              if (snowScanStats && !intrabar) {
                snowScanStats.bearSent++;
                pushSnowScanSymList(snowScanStats.bearSentSymbols, `${symbol} BEAR`);
              }
            }
            // SHORT ทิศ BEAR — เปิดทันทีตอนแจ้ง (ไม่รอ confirm) ตามตั้งค่า Snowball SHORT
            const runBearAutoOpenNow = !intrabar;
            if (runBearAutoOpenNow) {
              try {
                const mexcContract = await resolveMexcContractFromBinanceSymbolAsync(symbol);
                if (mexcContract) {
                await runSnowballAutoTradeAfterSnowballAlert({
                  contractSymbol: mexcContract,
                  binanceSymbol: symbol,
                  alertSide: "bear",
                  displayGrade: snowballTrendGradeToDisplay(bearTrendGrade),
                  qualityTier: bearTrendGrade,
                  referenceEntryPrice: twoBarInline ? c15[iConf]! : clE!,
                  referenceEntryPriceEma20_1h: snowballEma20_1hReferencePrice(
                    packsDiv1hExtra[idx] ?? pack1hForTwoBar,
                    Math.floor(now / 1000),
                  ),
                  signalBarOpenSec,
                  signalBarTf: snowTf,
                  signalBarLow: null,
                  vol: vE!,
                  volSma: vsE!,
                  greenDaysBeforeSignal: bearGreenDaysForAlert,
                  fundingRate: bearMktCtxForAlert?.fundingRate ?? null,
                  ema4hSlopePct7d: bearMktCtxForAlert?.ema4hSlopePct7d ?? null,
                  ema1dSlopePct7d: bearMktCtxForAlert?.ema1dSlopePct7d ?? null,
                  barRangePctSignal: bearVolSnapAuto.barRangePctSignal,
                  signalVolVsSma: bearSignalVolVsSma,
                });
                }
              } catch (e) {
                console.error("[indicatorPublicFeed] snowball auto-open SHORT", symbol, e);
              }
            }
            const bearVolSnap = snowballVolatilitySnapshotAt(h15, l15, c15, o15, iSig);
            const bearLenSnap = packSb ? computeSnowballSignalLenPercentile(packSb, iSig) : null;
            const bearMktCtx = !intrabar ? await fetchSnowballAlertMarketContext(symbol) : null;
            const pack1hTrendBear = packsDiv1hExtra[idx] ?? pack1hForTwoBar;
            const trendMomentumBear = calculateTrendMomentumMetrics(pack1hTrendBear, {
              pack15m: packs15mMomentum[idx] ?? null,
            });
            if (!twoBarInline && !intrabar && bearConfirmTrigger && bearRiskFlags.length > 0) {
              try {
                await addSnowballPendingConfirm({
                  symbol,
                  side: "bear",
                  snowTf,
                  signalBarOpenSec,
                  signalHigh:
                    typeof bearSignalHigh === "number" && Number.isFinite(bearSignalHigh) ? bearSignalHigh : clE!,
                  signalLow: bearSignalLow ?? clE!,
                  signalClose: clE!,
                  signalVolume: vE!,
                  alertedAtIso: iso,
                  alertedAtMs: now,
                  riskFlags: bearRiskFlags.map((f) => ({ id: f.id, label: f.label, detail: f.detail })),
                  qualityTier: bearTrendGrade,
                  statsDisplayGrade: snowballTrendGradeToDisplay(bearTrendGrade),
                  statsTriggerKind: "swing_ll",
                  statsVolSma: typeof vsE === "number" && Number.isFinite(vsE) ? vsE : undefined,
                  statsAtr100: bearVolSnap.atr100,
                  statsMaxUpperWick100: bearVolSnap.maxUpperWick100,
                  statsRangeScore: bearVolSnap.rangeScore,
                  statsWickScore: bearVolSnap.wickScore,
                  statsBtcPsar4hTrend: bearMktCtx?.btcPsar4hTrend ?? null,
                  statsBtcPsar4hClose: bearMktCtx?.btcPsar4hClose ?? null,
                  statsBtcPsar1hTrend: bearMktCtx?.btcPsar1hTrend ?? null,
                  statsBtcPsar1hClose: bearMktCtx?.btcPsar1hClose ?? null,
                  statsQuoteVol24hUsdt: bearMktCtx?.quoteVol24hUsdt ?? null,
                  statsMarketCapUsd: bearMktCtx?.marketCapUsd ?? null,
                  statsFundingRate: bearMktCtx?.fundingRate ?? null,
                  statsAtrPct14d: bearMktCtx?.atrPct14d ?? null,
                  statsEma4hSlopePct7d: bearMktCtx?.ema4hSlopePct7d ?? null,
                  statsEma1dSlopePct7d: bearMktCtx?.ema1dSlopePct7d ?? null,
                  statsBtcEma4hSlopePct7d: bearMktCtx?.btcEma4hSlopePct7d ?? null,
                  statsBtcEma1dSlopePct7d: bearMktCtx?.btcEma1dSlopePct7d ?? null,
                  statsPsar4hTrend: bearMktCtx?.psar4hTrend ?? null,
                  statsPsar4hDistPct: bearMktCtx?.psar4hDistPct ?? null,
                  statsRangeRankInLookback: bearLenSnap?.rangeRankInLookback ?? null,
                  statsLenLookbackBars: bearLenSnap?.lookbackBars ?? null,
                  statsLenPercentilePct: bearLenSnap?.lenPercentilePct ?? null,
                  ...(skipBearTgForPending ? { deferSnowballAutotradeToConfirm: true } : {}),
                });
              } catch (pendErr) {
                console.error("[indicatorPublicFeed] snowball pending confirm BEAR", symbol, pendErr);
              }
            }
            try {
              if (!skipBearTgForPending) {
                const bearStatsTradeSide = resolveSnowballStatsTradeSide({
                  alertSide: "bear",
                  qualityTier: bearTrendGrade,
                  signalOpen: o15[iSig]!,
                  signalClose: clE!,
                  signalHigh: bearSignalHigh,
                  signalLow: bearSignalLow,
                  signalVolume: vE!,
                  confirmOpen: twoBarInline ? o15[iConf]! : null,
                  confirmClose: twoBarInline ? c15[iConf]! : null,
                  confirmVolume: twoBarInline ? v15[iConf]! : null,
                });
                const bearGreenDays = await fetchGreenDaysBeforeSignalBar(symbol, signalBarOpenSec, snowTf);
                await appendSnowballStatsRow({
                  symbol,
                  side: bearStatsTradeSide,
                  alertSide: "bear",
                  alertedAtIso: iso,
                  alertedAtMs: now,
                  signalBarOpenSec,
                  signalBarTf: snowTf,
                  entryPrice: twoBarInline ? c15[iConf]! : clE!,
                  intrabar,
                  triggerKind: "swing_ll",
                  vol: vE!,
                  volSma: vsE!,
                  qualityTier: bearTrendGrade,
                  alertQualityTier: bearTrendGrade,
                  displayGrade: snowballTrendGradeToDisplay(bearTrendGrade),
                  actionPlan: snowballTrendGradeActionPlan(bearTrendGrade),
                  atr100: bearVolSnap.atr100,
                  maxUpperWick100: bearVolSnap.maxUpperWick100,
                  rangeScore: bearVolSnap.rangeScore,
                  wickScore: bearVolSnap.wickScore,
                  barRangePctPrev: bearVolSnap.barRangePctPrev,
                  barRangePctSignal: bearVolSnap.barRangePctSignal,
                  barRangePct2Sum: bearVolSnap.barRangePct2Sum,
                  btcPsar4hTrend: bearMktCtx?.btcPsar4hTrend ?? null,
                  btcPsar4hClose: bearMktCtx?.btcPsar4hClose ?? null,
                  btcPsar1hTrend: bearMktCtx?.btcPsar1hTrend ?? null,
                  btcPsar1hClose: bearMktCtx?.btcPsar1hClose ?? null,
                  quoteVol24hUsdt: bearMktCtx?.quoteVol24hUsdt ?? null,
                  marketCapUsd: bearMktCtx?.marketCapUsd ?? null,
                  fundingRate: bearMktCtx?.fundingRate ?? null,
                  atrPct14d: bearMktCtx?.atrPct14d ?? null,
                  ema1hSlopePct7d: bearMktCtx?.ema1hSlopePct7d ?? null,
                  ema4hSlopePct7d: bearMktCtx?.ema4hSlopePct7d ?? null,
                  ema1dSlopePct7d: bearMktCtx?.ema1dSlopePct7d ?? null,
                  btcEma4hSlopePct7d: bearMktCtx?.btcEma4hSlopePct7d ?? null,
                  btcEma1dSlopePct7d: bearMktCtx?.btcEma1dSlopePct7d ?? null,
                  psar4hTrend: bearMktCtx?.psar4hTrend ?? null,
                  psar4hDistPct: bearMktCtx?.psar4hDistPct ?? null,
                  rangeRankInLookback: bearLenSnap?.rangeRankInLookback ?? null,
                  lenLookbackBars: bearLenSnap?.lookbackBars ?? null,
                  lenPercentilePct: bearLenSnap?.lenPercentilePct ?? null,
                  ...trendMomentumStatsFields(trendMomentumBear),
                  greenDaysBeforeSignal: bearGreenDays,
                });
              }
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
        await sendSnowballLong(iForming, true, null);
        await sendSnowballBear(iForming, true, null);
      }
      let pack1hTwoBar: BinanceKlinePack | null = null;
      const needPack1h =
        snowballLongBreakout1hConfirmEnabled() ||
        (snowballTwoBarInlineModeEnabled() && iClosed >= 2) ||
        isSnowballStatsEnabled();
      if (needPack1h) {
        try {
          pack1hTwoBar = await fetchBinanceUsdmKlines(symbol, "1h", 120);
        } catch (e) {
          console.error("[indicatorPublicFeed] snowball 1h fetch", symbol, e);
        }
      }
      await sendSnowballLong(iClosed, false, pack1hTwoBar);
      await sendSnowballBear(iClosed, false, pack1hTwoBar);
    }
  }

  if (snowScanStats != null && snowScanStats.closedBarOpenSec != null) {
    const barOpen = snowScanStats.closedBarOpenSec;
    const barDurSec = tfBarDurationSecForSummary(snowTf);
    const barCloseMs = (barOpen + barDurSec) * 1000;
    const ageMs = now - barCloseMs;
    const tooOld = ageMs > 4 * 3600 * 1000;
    const already = state.lastSnowballScanSummaryBarOpenSec === barOpen;
    const manualSnowballResend = Boolean(opts?.snowballOnly);

    if (tooOld) {
      if (!already) {
        state.lastSnowballScanSummaryBarOpenSec = barOpen;
        await saveIndicatorPublicFeedState(state);
      }
    } else if (!already || manualSnowballResend) {
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
      snowballScanSummaryText = body;
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

    return { notified, snowballScanSummaryText };
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
  /** เมื่อโหมด two-bar inline เปิด (ค่าเริ่ม) — สรุปเกณฑ์สองแท่ง + 1h */
  twoBarInlineNotes?: string[];
  /** two-bar inline + iClosed≥2 — เกณฑ์ confirm แยกจาก checklist สัญญาณ */
  twoBarConfirmGateRows?: { long: SnowballCheckStep[]; bear: SnowballCheckStep[] } | null;
  /** Long Breakout Entry — เกณฑ์ยืนยันบนแท่ง 1H ปิดล่าสุด */
  longBreakout1hConfirmGateRows?: SnowballCheckStep[] | null;
  /** หมายเหตุโหมด Breakout 1H */
  longBreakout1hNotes?: string[];
  /** สรุปโครงสร้าง + momentum + confirm → เกรดสุทธิ (เดียวกับ live tick) */
  gradeDebug?: { long: string[]; bear: string[] };
  /** Master 4h two-bar — รายงาน 3 ด่าน (debug snowball) */
  stagedDebugLong?: string;
  errors: string[];
};

function snowballLongStructureTierHint(tier: SnowballLongStructureTier): string {
  if (tier === "a_plus") return "HH48+HH200+VAH";
  if (tier === "b_plus") return "VAH only";
  return "HH48 (C)";
}

function snowballLongGradeResolutionSummaryLines(res: SnowballLongGradeResolution): string[] {
  const g = res.grade;
  const display = snowballTrendGradeDisplayWithDangerous(
    res.displayGrade,
    res.gradeDangerous,
  );
  return [
    `โครงสร้าง 4H: ${snowballLongStructureTierShortLabel(res.structureTier)} (${snowballLongStructureTierHint(res.structureTier)})`,
    `momentum 1H (sustained): ${res.momentumOk ? "✅ ผ่าน" : "❌ ไม่ผ่าน"}`,
    `1H confirm: ${res.confirm1hOk ? "✅ ผ่าน" : "❌ ไม่ผ่าน"}${
      res.confirm1hEval?.detail ? ` · ${res.confirm1hEval.detail.slice(0, 120)}` : ""
    }`,
    `เกรดสุทธิที่แจ้ง: Grade ${display} [${snowballLongGradeShortLabel(g)}]`,
    res.footnote ? `  ${res.footnote}` : "",
  ].filter(Boolean);
}

function buildSnowballChecklistGradeDebug(input: {
  snowTf: BinanceIndicatorTf;
  iClosed: number;
  close: number[];
  high: number[];
  low: number[];
  volume: number[];
  volSmaArr: number[];
  volMult: number;
  swingLb: number;
  swingGradeLb: number;
  swingEx: number;
  vahLb: number;
  longVahOn: boolean;
  longBreakout1hChecklistOn: boolean;
  twoBarChecklistOn: boolean;
  pack1h: BinanceKlinePack | null;
  pack15m?: BinanceKlinePack | null;
  twoBarConfirmGateRows: { long: SnowballCheckStep[]; bear: SnowballCheckStep[] } | null | undefined;
  dbOn: boolean;
}): { long: string[]; bear: string[] } {
  const iSig = input.twoBarChecklistOn ? input.iClosed - 1 : input.iClosed;
  if (iSig < 1) {
    return { long: ["แท่งสัญญาณ index ไม่พร้อม"], bear: [] };
  }

  const { close, high, low, volume, volSmaArr, volMult, swingLb, swingGradeLb, swingEx, vahLb, longVahOn, snowTf } =
    input;

  const swing48 = snowballLongSwingHighBreak(high, close, iSig, swingLb, swingEx, false);
  const swing200 = snowballLongSwingHighBreak(high, close, iSig, swingGradeLb, swingEx, false);
  const vahH = longVahOn ? highVolumeNodeBarHigh(volume, high, low, iSig, vahLb) : null;
  const iPrev = iSig - 1;
  const clE = close[iSig]!;
  const hiPrev = high[iPrev]!;
  const clPrev = close[iPrev]!;
  const vahOk =
    longVahOn &&
    vahH != null &&
    Number.isFinite(vahH) &&
    Number.isFinite(clE) &&
    Number.isFinite(clPrev) &&
    clE > vahH &&
    clPrev <= vahH;

  const twoBarPassed = input.twoBarConfirmGateRows?.long?.every((s) => s.ok) ?? false;
  const longBreakout1h = snowTf !== "4h" && snowballLongBreakout1hConfirmEnabled();
  const breakout1hEval = longBreakout1h
    ? evaluateSnowballLongBreakout1hConfirm(
        input.pack1h,
        snowballLongBreakout1hSwingLookback(),
        snowballLongBreakout1hExcludeRecent(),
      )
    : null;

  const vE = volume[iSig]!;
  const vsE = volSmaArr[iSig];
  const volNearMult = snowballVolNearMissMultiplier(volMult);
  const volStrictOk = snowballVolumeOk(false, vE, vsE, volMult);
  const volNearMissOnly = snowballVolumeNearMissOnly(false, vE, vsE, volMult, volNearMult);

  const trendMomentum = calculateTrendMomentumMetrics(input.pack1h, {
    pack15m: input.pack15m ?? null,
  });
  const sustained = isSustainedBuyingPressure(trendMomentum);

  const gradeRes = resolveSnowballLongFinalGrade({
    snowTf,
    swing48,
    swing200,
    vahOk,
    twoBarInlinePassed: twoBarPassed,
    longBreakout1h,
    breakout1hEval,
    momentumRequired: snowballGradeBRequiresSustainedMomentum(),
    momentumOk: sustained,
    gradeDPlusOnMomentumFail: snowballGradeBMomentumFailGradeDOn1hConfirmPass(),
    gradeFOnMomentumAndConfirmFail: snowballGradeFOnMomentumAnd1hConfirmFail(),
    volumeStrictOk: volStrictOk,
    volumeNearMissOnly: volNearMissOnly,
    gradeDPlusNearMissVolumeEnabled: snowballGradeBNearMissVolumeEnabled(),
    trendGradeInput: {
      alertSide: "long",
      ema4hSlopePct7d: null,
      ema1dSlopePct7d: null,
      btcEma4hSlopePct7d: null,
      greenDaysBeforeSignal: null,
    },
  });

  const modeLabel = input.longBreakout1hChecklistOn
    ? "Breakout 1H (สัญญาณ = แท่ง Snowball ปิดล่าสุด)"
    : input.twoBarChecklistOn
      ? "two-bar inline (สัญญาณ = แท่งปิดก่อนล่าสุด)"
      : "แท่งเดียว (สัญญาณ = แท่งปิดล่าสุด)";

  const longLines: string[] = [
    `โหมด: ${modeLabel} · แท่งสัญญาณ i=${iSig}`,
  ];
  longLines.push(
    `Swing/VAH: HH${swingLb}=${swing48 ? "ผ่าน" : "—"} · HH${swingGradeLb}=${swing200 ? "ผ่าน" : "—"} · VAH=${vahOk ? "เบรค" : longVahOn ? "ยังไม่" : "ปิด"}`,
    `Vol×SMA: ${volStrictOk ? "strict ผ่าน" : volNearMissOnly ? `near-miss (>${volNearMult}× ไม่ถึง ${volMult}×)` : "ไม่ผ่าน"}`,
  );
  if (input.twoBarChecklistOn) {
    longLines.push(
      `two-bar confirm LONG: ${twoBarPassed ? "✅ ผ่าน" : "❌ ไม่ผ่าน"} (diagnostic — ไม่ block alert)`,
    );
  } else if (longBreakout1h && breakout1hEval) {
    longLines.push(
      `Breakout 1H confirm: ${breakout1hEval.ok ? "✅ ผ่าน" : "❌ ไม่ผ่าน"} · ${breakout1hEval.detail.slice(0, 100)}`,
    );
  }
  longLines.push(...snowballLongGradeResolutionSummaryLines(gradeRes));

  const bearLines: string[] = [];
  if (input.dbOn) {
    const cls = classifyShortDoubleBarrierTier(low, iSig, clE);
    const tierLabel = cls.tier === "a_plus" ? "A+ (Super)" : "B (Barrier ในโซน Watchlist)";
    bearLines.push(
      `Double Barrier SHORT: ${tierLabel}${
        cls.nearestUnderfoot != null ? ` · แนวใต้ ~${fmtNum(cls.nearestUnderfoot)} (−${cls.distPct?.toFixed(2) ?? "—"}%)` : " · ไม่พบ Low ใต้ราคา"
      }`,
    );
    bearLines.push("  A+ = defer TG/autotrade รอ confirm · B = แจ้งทันทีเมื่อ checklist ผ่าน");
  } else {
    bearLines.push("Double Barrier: ปิด — ไม่จัด tier SHORT ใน TG");
  }
  if (input.twoBarConfirmGateRows?.bear?.length) {
    const bearConfirmOk = input.twoBarConfirmGateRows.bear.every((s) => s.ok);
    bearLines.push(`two-bar confirm BEAR: ${bearConfirmOk ? "✅ ผ่าน (พร้อมยิงถ้า checklist สัญญาณผ่าน)" : "❌ ไม่ผ่าน"}`);
  }

  return { long: longLines, bear: bearLines };
}

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

/** ขั้น confirm สำหรับ debug two-bar inline (แท่ง iConf ปิดล่าสุด) */
function buildSnowballTwoBarConfirmGateSteps(
  close: number[],
  high: number[],
  low: number[],
  volume: number[],
  timeSec: number[],
  iSig: number,
  iConf: number,
  snowTf: BinanceIndicatorTf,
  pack1h: BinanceKlinePack | null,
): { long: SnowballCheckStep[]; bear: SnowballCheckStep[] } {
  const dur = tfBarDurationSecForSummary(snowTf);
  const sigOpen = timeSec[iSig]!;
  const confEnd = timeSec[iConf]! + dur;
  const sigH = high[iSig]!;
  const sigL = low[iSig]!;
  const sigC = close[iSig]!;
  const confC = close[iConf]!;
  const sigV = volume[iSig]!;
  const confV = volume[iConf]!;
  const range = sigH - sigL;
  const frac = snowballTwoBarInlinePullbackMaxFrac();
  const vr = snowballConfirmVolMinRatio();

  const rangeOk = Number.isFinite(range) && range > 0;
  const pullLongOk =
    rangeOk && Number.isFinite(confC) && confC >= sigC - frac * range;
  const pullBearOk =
    rangeOk && Number.isFinite(confC) && confC <= sigC + frac * range;
  const volOk = sigV > 0 && Number.isFinite(confV) && confV / sigV >= vr;

  let minL: number | null = null;
  let maxH: number | null = null;
  if (pack1h?.timeSec?.length) {
    minL = snowballMinLow1hBetweenClosedBars(pack1h.timeSec, pack1h.low, sigOpen, confEnd);
    maxH = snowballMaxHigh1hBetweenClosedBars(pack1h.timeSec, pack1h.high, sigOpen, confEnd);
  }
  const h1LongOk = minL != null && minL >= sigL;
  const h1BearOk = maxH != null && maxH <= sigH;

  const longSteps: SnowballCheckStep[] = [
    {
      id: "twoBarPullLong",
      label: "Confirm pullback (LONG)",
      ok: pullLongOk,
      detail: rangeOk
        ? `confirmClose=${fmtNum(confC)} ≥ signalClose−${(frac * 100).toFixed(0)}%×range (${fmtNum(sigC - frac * range)})`
        : "ช่วงสัญญาณไม่ถูกต้อง",
    },
    {
      id: "twoBarVolLong",
      label: "Confirm vol vs signal (LONG)",
      ok: volOk,
      detail: `confVol/sigVol=${sigV > 0 ? fmtNum(confV / sigV, 4) : "—"} (ต้อง ≥ ${vr})`,
    },
    {
      id: "twoBar1hLong",
      label: "1h min-low ≥ signal low (LONG)",
      ok: Boolean(pack1h?.timeSec?.length) && h1LongOk,
      detail: pack1h?.timeSec?.length
        ? `minLow1h=${minL != null ? fmtNum(minL) : "—"} vs signalLow=${fmtNum(sigL)}`
        : "ไม่มีข้อมูล 1h",
    },
  ];

  const bearSteps: SnowballCheckStep[] = [
    {
      id: "twoBarPullBear",
      label: "Confirm pullback (BEAR)",
      ok: pullBearOk,
      detail: rangeOk
        ? `confirmClose=${fmtNum(confC)} ≤ signalClose+${(frac * 100).toFixed(0)}%×range (${fmtNum(sigC + frac * range)})`
        : "ช่วงสัญญาณไม่ถูกต้อง",
    },
    {
      id: "twoBarVolBear",
      label: "Confirm vol vs signal (BEAR)",
      ok: volOk,
      detail: `confVol/sigVol=${sigV > 0 ? fmtNum(confV / sigV, 4) : "—"} (ต้อง ≥ ${vr})`,
    },
    {
      id: "twoBar1hBear",
      label: "1h max-high ≤ signal high (BEAR)",
      ok: Boolean(pack1h?.timeSec?.length) && h1BearOk,
      detail: pack1h?.timeSec?.length
        ? `maxHigh1h=${maxH != null ? fmtNum(maxH) : "—"} vs signalHigh=${fmtNum(sigH)}`
        : "ไม่มีข้อมูล 1h",
    },
  ];

  return { long: longSteps, bear: bearSteps };
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

/** Checklist / backtest shared gate — โหมด two-bar ใช้ iEval เป็นแท่ง confirm */
export function evaluateSnowballLongAt(
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
    swingGradeLb: number;
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
    checklistSkipBodyToRange?: boolean;
    checklistTwoBarDedupeOpenSec?: number;
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

  const volNearMult = snowballVolNearMissMultiplier(ctx.volMult);
  const volStrictOk = snowballVolumeOk(relaxVol, vE!, vsE!, ctx.volMult);
  const volNearMissOnly = snowballVolumeNearMissOnly(
    relaxVol,
    vE!,
    vsE!,
    ctx.volMult,
    volNearMult,
  );
  const volGateOk = volStrictOk || volNearMissOnly;
  push({
    id: "volume",
    label: "Volume × SMA",
    ok: volGateOk,
    detail: relaxVol
      ? `intrabar relax — ผ่าน (vol=${fmtNum(vE!, 0)})`
      : volNearMissOnly
        ? `near-miss Grade B — vol=${fmtNum(vE!, 0)} > SMA×${volNearMult} แต่ ≤ SMA×${ctx.volMult} = ${fmtNum((vsE ?? 0) * ctx.volMult, 0)}`
        : `vol=${fmtNum(vE!, 0)} ${volStrictOk ? ">" : "≤"} SMA*${ctx.volMult} = ${fmtNum((vsE ?? 0) * ctx.volMult, 0)}`,
  });

  const priceFinite =
    Number.isFinite(clE!) && Number.isFinite(hiE!) && Number.isFinite(hiPrev!) && Number.isFinite(clPrev!);
  push({
    id: "priceFinite",
    label: "ราคาแท่งครบ",
    ok: priceFinite,
    detail: priceFinite ? "ok" : "ค่าราคาบางตัวไม่ finite",
  });

  const priorMaxHigh48 = maxHighPriorWindow(high, iEval, ctx.swingLb, ctx.swingEx);
  const priorMaxHighGrade = maxHighPriorWindow(high, iEval, ctx.swingGradeLb, ctx.swingEx);
  const swing48 = snowballLongSwingHighBreak(high, close, iEval, ctx.swingLb, ctx.swingEx, intrabar);
  const swing200 = snowballLongSwingHighBreak(high, close, iEval, ctx.swingGradeLb, ctx.swingEx, intrabar);
  const classicSwing = swing48;
  const vahH = ctx.longVahOn ? highVolumeNodeBarHigh(volume, high, low, iEval, ctx.vahLb) : null;
  const vahCross =
    ctx.longVahOn &&
    vahH != null &&
    Number.isFinite(vahH) &&
    (intrabar ? hiE! > vahH && hiPrev! <= vahH : clE! > vahH && clPrev! <= vahH);
  const vahOk = Boolean(vahCross);
  const swingOrVahOk = classicSwing || vahOk;
  const breakoutGrade = classifyLongStructureTier(swing48, swing200, vahOk);
  const gradeHint = `Grade: ${
    breakoutGrade === "a_plus"
      ? "A+ (HH48+HH200+VAH)"
      : breakoutGrade === "b_plus"
        ? "B (VAH only)"
        : swing200
          ? "C (HH48+HH200 ไม่มี VAH)"
          : "C (HH48 ไม่ผ่าน HH200)"
  }`;
  push({
    id: "swingOrVah",
    label: `Swing HH${ctx.swingLb}/HH${ctx.swingGradeLb}/Ex${ctx.swingEx} หรือ VAH${ctx.vahLb}`,
    ok: swingOrVahOk,
    detail: [
      `HH48 max=${fmtNum(priorMaxHigh48)} (${swing48 ? "ผ่าน" : "ไม่ผ่าน"})`,
      `HH${ctx.swingGradeLb} max=${fmtNum(priorMaxHighGrade)} (${swing200 ? "ผ่าน" : "ไม่ผ่าน"})`,
      ctx.longVahOn
        ? `vah=${vahH != null ? fmtNum(vahH) : "—"} (${vahOk ? "เบรค" : "ยังไม่"})`
        : "vah: ปิด",
      gradeHint,
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

  if (ctx.checklistSkipBodyToRange) {
    push({
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: true,
      detail:
        "ข้ามในโหมด two-bar inline — สแกนจริงไม่ใช้ INDICATOR_PUBLIC_SNOWBALL_BODY_TO_RANGE / follow-through บนแท่งสัญญาณ (ค่าเริ่ม two-bar inline เปิด; ปิดด้วย INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_INLINE_ENABLED=0)",
    });
  } else {
    push(snowballBodyToRangeCheckStep(intrabar, "long", iEval, open, high, low, close));
  }

  const barOpenSec = timeSec[iEval] ?? -1;
  const key = `${ctx.symbol}|SNOWBALL|${ctx.snowTf}|BULL`;
  const lastFired = ctx.state.lastFiredBarSec[key];
  const dedupeOk = !snowballSymbolDedupeBlocks(ctx.state, key, barOpenSec);
  push({
    id: "dedupe",
    label: "dedupe (แท่งสัญญาณนี้ยังไม่ยิง)",
    ok: dedupeOk,
    detail: `key=${key} · lastFiredBarSec=${lastFired ?? "—"} · แท่งสัญญาณเปิด=${barOpenSec} (ยิงซ้ำเฉพาะแท่งเดิม)`,
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

export function evaluateSnowballBearAt(
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
    checklistSkipBodyToRange?: boolean;
    checklistTwoBarDedupeOpenSec?: number;
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

  if (ctx.checklistSkipBodyToRange) {
    push({
      id: "bodyToRange",
      label: "เนื้อเทียน/ช่วง (ไส้ยาว)",
      ok: true,
      detail:
        "ข้ามในโหมด two-bar inline — สแกนจริงไม่ใช้ INDICATOR_PUBLIC_SNOWBALL_BODY_TO_RANGE / follow-through บนแท่งสัญญาณ (ค่าเริ่ม two-bar inline เปิด; ปิดด้วย INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_INLINE_ENABLED=0)",
    });
  } else {
    push(snowballBodyToRangeCheckStep(intrabar, "bear", iEval, open, high, low, close));
  }

  const barOpenSec = timeSec[iEval] ?? -1;
  const key = `${ctx.symbol}|SNOWBALL|${ctx.snowTf}|BEAR`;
  const lastFired = ctx.state.lastFiredBarSec[key];
  const dedupeOk = !snowballSymbolDedupeBlocks(ctx.state, key, barOpenSec);
  push({
    id: "dedupe",
    label: "dedupe (แท่งสัญญาณนี้ยังไม่ยิง)",
    ok: dedupeOk,
    detail: `key=${key} · lastFiredBarSec=${lastFired ?? "—"} · แท่งสัญญาณเปิด=${barOpenSec} (ยิงซ้ำเฉพาะแท่งเดิม)`,
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
  const swingGradeLb = snowballSwingGradeLookbackBars();
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
    `Swing trigger: HH${swingLb} · Grade HH${swingGradeLb} · excludeRecent ${swingEx}`,
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
    snowballLongBreakout1hConfirmEnabled()
      ? `Long Breakout 1H confirm: on (${formatSnowballLongBreakout1hCriteriaSummary(snowballLongBreakout1hExcludeRecent())})`
      : "Long Breakout 1H confirm: off",
    snowballTwoBarInlineModeEnabled()
      ? "Two-bar inline: on (BEAR + legacy LONG ถ้าปิด Breakout 1H) — ดูบล็อกด้านล่าง"
      : "Two-bar inline: off — โหมดแท่งเดียว + pending confirm (legacy)",
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
    swingGradeLb + swingEx + 50,
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
    swingGradeLb + swingEx + 3,
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
    swingGradeLb,
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

  const longBreakout1hChecklistOn =
    snowTf !== "4h" && snowballLongBreakout1hConfirmEnabled();
  const twoBarChecklistOn =
    snowballTwoBarInlineModeEnabled() && iClosed >= 2 && !longBreakout1hChecklistOn;
  const needPack1hChecklist = longBreakout1hChecklistOn || twoBarChecklistOn;
  let pack1hForTwoBarChecklist: BinanceKlinePack | null = null;
  let pack15mForMomentumChecklist: BinanceKlinePack | null = null;
  if (needPack1hChecklist) {
    try {
      pack1hForTwoBarChecklist = await fetchBinanceUsdmKlines(symbol, "1h", 120);
    } catch (e) {
      errors.push(`checklist 1h: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120));
    }
  }
  try {
    pack15mForMomentumChecklist = await fetchBinanceUsdmKlines(symbol, "15m", SNOWBALL_TREND_15M_DD_BARS);
  } catch (e) {
    errors.push(`checklist 15m momentum: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120));
  }

  if (longBreakout1hChecklistOn) {
    const b1h = evaluateSnowballLongBreakout1hConfirm(
      pack1hForTwoBarChecklist,
      snowballLongBreakout1hSwingLookback(),
      snowballLongBreakout1hExcludeRecent(),
    );
    baseResult.long.closed = evaluateSnowballLongAt(iClosed, false, data, {
      ...longCtxBase,
      checklistSkipBodyToRange: true,
      checklistTwoBarDedupeOpenSec: b1h?.ok ? b1h.barOpenSec : timeSec[iClosed],
    });
    baseResult.longBreakout1hConfirmGateRows = buildSnowballLongBreakout1hConfirmGateSteps(
      pack1hForTwoBarChecklist,
      snowballLongBreakout1hSwingLookback(),
      snowballLongBreakout1hExcludeRecent(),
    );
    baseResult.longBreakout1hNotes = [
      "Long Breakout Entry: สัญญาณบน TF Snowball + ยืนยันด้วยแท่ง 1H ปิดล่าสุด (ไม่ใช้ two-bar inline ฝั่ง Long)",
      `เกณฑ์ 1H: ${formatSnowballLongBreakout1hCriteriaSummary(snowballLongBreakout1hExcludeRecent())}`,
      b1h ? `ล่าสุด: ${b1h.ok ? "ผ่าน" : "ไม่ผ่าน"}${b1h.bodyPassMode === "god_volume" ? " (God Vol)" : ""} — ${b1h.detail}` : "ยังประเมิน 1H ไม่ได้",
    ];
    if (snowballTwoBarInlineModeEnabled() && iClosed >= 2) {
      const iSig = iClosed - 1;
      baseResult.bear.closed = evaluateSnowballBearAt(iClosed - 1, false, data, {
        ...bearCtxBase,
        checklistSkipBodyToRange: true,
        checklistTwoBarDedupeOpenSec: timeSec[iClosed],
      });
      baseResult.twoBarConfirmGateRows = buildSnowballTwoBarConfirmGateSteps(
        close,
        high,
        low,
        volume,
        timeSec,
        iSig,
        iClosed,
        snowTf,
        pack1hForTwoBarChecklist,
      );
    } else {
      baseResult.bear.closed = evaluateSnowballBearAt(iClosed, false, data, bearCtxBase);
    }
  } else if (twoBarChecklistOn) {
    const iSig = iClosed - 1;
    baseResult.long.closed = evaluateSnowballLongAt(iClosed - 1, false, data, {
      ...longCtxBase,
      checklistSkipBodyToRange: true,
      checklistTwoBarDedupeOpenSec: timeSec[iClosed],
    });
    baseResult.bear.closed = evaluateSnowballBearAt(iClosed - 1, false, data, {
      ...bearCtxBase,
      checklistSkipBodyToRange: true,
      checklistTwoBarDedupeOpenSec: timeSec[iClosed],
    });
    baseResult.twoBarConfirmGateRows = buildSnowballTwoBarConfirmGateSteps(
      close,
      high,
      low,
      volume,
      timeSec,
      iSig,
      iClosed,
      snowTf,
      pack1hForTwoBarChecklist,
    );
  } else {
    baseResult.long.closed = evaluateSnowballLongAt(iClosed, false, data, longCtxBase);
    baseResult.bear.closed = evaluateSnowballBearAt(iClosed, false, data, bearCtxBase);
  }
  if (longBreakout1hChecklistOn) {
    baseResult.paramsSummary.push(
      "Closed checklist (Breakout 1H): สัญญาณ = แท่ง Snowball ปิดล่าสุด — ข้าม body/range; ต้องผ่านเกณฑ์ 1H ในบล็อก Breakout confirm; dedupe ใช้เวลาเปิดแท่ง 1H ที่ยืนยัน",
    );
  } else if (twoBarChecklistOn) {
    baseResult.paramsSummary.push(
      "Closed checklist (two-bar inline): สัญญาณ = แท่งปิดก่อนล่าสุด (index n−3) — ข้าม body/range; dedupe/cooldown ในรายการสัญญาณใช้เวลาเปิดแท่ง confirm (ปิดล่าสุด)",
    );
  } else if (snowballTwoBarInlineModeEnabled() && iClosed < 2) {
    baseResult.paramsSummary.push(
      "Two-bar inline เปิดอยู่ (ค่าเริ่ม) แต่ iClosed < 2 — checklist แท่งปิดยังใช้แท่งเดียว (รอข้อมูลย้อนหลังเพิ่ม)",
    );
  }
  if (intrabarOn) {
    baseResult.long.intrabar = evaluateSnowballLongAt(iForming, true, data, longCtxBase);
    baseResult.bear.intrabar = evaluateSnowballBearAt(iForming, true, data, bearCtxBase);
  }

  if (snowballConfirmBarEnabled()) {
    const iRisk =
      twoBarChecklistOn && !longBreakout1hChecklistOn
        ? iClosed - 1
        : iClosed;
    baseResult.confirmRisk = {
      long: buildSnowballConfirmRiskStatus("long", openArr, high, low, close, iRisk),
      bear: buildSnowballConfirmRiskStatus("bear", openArr, high, low, close, iRisk),
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

  if (snowballTwoBarInlineModeEnabled()) {
    const notes: string[] = [];
    notes.push(
      "Two-bar inline เปิด: สัญญาณที่แท่งปิดก่อนล่าสุด (iClosed−1), confirm ที่แท่งปิดล่าสุด (iClosed); กรอง body/follow-through ของแท่งสัญญาณถูกข้าม; dedupe ใช้เวลเปิดแท่ง confirm",
    );
    notes.push(
      `Max pullback ของช่วง (high−low) แท่งสัญญาณ: ≤ ${(snowballTwoBarInlinePullbackMaxFrac() * 100).toFixed(0)}% (INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_INLINE_MAX_PULLBACK_OF_RANGE)`,
    );
    if (iClosed >= 2) {
      const dur = tfBarDurationSecForSummary(snowTf);
      const sigOpen = timeSec[iClosed - 1]!;
      const confEnd = timeSec[iClosed]! + dur;
      let pack1h: BinanceKlinePack | null = pack1hForTwoBarChecklist;
      if (!pack1h) {
        try {
          pack1h = await fetchBinanceUsdmKlines(symbol, "1h", 120);
        } catch (e) {
          errors.push(`two-bar debug 1h: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120));
        }
      }
      const sigH = high[iClosed - 1]!;
      const sigL = low[iClosed - 1]!;
      const sigC = close[iClosed - 1]!;
      const confC = close[iClosed]!;
      const sigV = volume[iClosed - 1]!;
      const confV = volume[iClosed]!;
      const range = sigH - sigL;
      const frac = snowballTwoBarInlinePullbackMaxFrac();
      const pullLong = range > 0 && Number.isFinite(confC) && confC >= sigC - frac * range;
      const pullBear = range > 0 && Number.isFinite(confC) && confC <= sigC + frac * range;
      const vr = snowballConfirmVolMinRatio();
      const volOk = sigV > 0 && confV / sigV >= vr;
      let minL: number | null = null;
      let maxH: number | null = null;
      if (pack1h?.timeSec?.length) {
        minL = snowballMinLow1hBetweenClosedBars(pack1h.timeSec, pack1h.low, sigOpen, confEnd);
        maxH = snowballMaxHigh1hBetweenClosedBars(pack1h.timeSec, pack1h.high, sigOpen, confEnd);
      }
      const h1Long = minL != null && minL >= sigL;
      const h1Bear = maxH != null && maxH <= sigH;
      notes.push(
        `Long inline (ดูอย่างเดียว): pullback ≤${(frac * 100).toFixed(0)}% → ${pullLong ? "ผ่าน" : "ไม่ผ่าน"} · vol ≥${(vr * 100).toFixed(0)}% → ${volOk ? "ผ่าน" : "ไม่ผ่าน"} · 1h min-low ≥ signal low → ${pack1h ? (h1Long ? "ผ่าน" : "ไม่ผ่าน") : "ไม่มี 1h"} (${minL != null ? fmtNum(minL) : "—"} vs ${fmtNum(sigL)})`,
      );
      notes.push(
        `Bear inline (ดูอย่างเดียว): pullback ≤${(frac * 100).toFixed(0)}% (ด้านบน) → ${pullBear ? "ผ่าน" : "ไม่ผ่าน"} · vol ≥${(vr * 100).toFixed(0)}% → ${volOk ? "ผ่าน" : "ไม่ผ่าน"} · 1h max-high ≤ signal high → ${pack1h ? (h1Bear ? "ผ่าน" : "ไม่ผ่าน") : "ไม่มี 1h"} (${maxH != null ? fmtNum(maxH) : "—"} vs ${fmtNum(sigH)})`,
      );
    } else {
      notes.push("(แท่งปิดล่าสุด index < 2 — ยังประเมิน two-bar inline ไม่ได้)");
    }
    baseResult.twoBarInlineNotes = notes;
  }

  baseResult.gradeDebug = buildSnowballChecklistGradeDebug({
    snowTf,
    iClosed,
    close,
    high,
    low,
    volume,
    volSmaArr,
    volMult,
    swingLb,
    swingGradeLb,
    swingEx,
    vahLb,
    longVahOn,
    longBreakout1hChecklistOn,
    twoBarChecklistOn,
    pack1h: pack1hForTwoBarChecklist,
    pack15m: pack15mForMomentumChecklist,
    twoBarConfirmGateRows: baseResult.twoBarConfirmGateRows,
    dbOn: dbOnChecklist,
  });

  if (snowTf === "4h" && iClosed >= 2) {
    const iSigSt = iClosed - 1;
    const iConfSt = iClosed;
    const iPrevSt = iSigSt - 1;
    const iPrev2St = iSigSt - 2;
    const clSt = close[iSigSt]!;
    const hiPrevSt = high[iPrevSt]!;
    const clPrevSt = close[iPrevSt]!;
    const priorMaxSt = maxHighPriorWindow(high, iSigSt, swingLb, swingEx);
    const priorMaxGradeSt = maxHighPriorWindow(high, iSigSt, swingGradeLb, swingEx);
    const swing48St = snowballLongSwingHighBreak(high, close, iSigSt, swingLb, swingEx, false);
    const swing200St = snowballLongSwingHighBreak(high, close, iSigSt, swingGradeLb, swingEx, false);
    const vahHSt = longVahOn ? highVolumeNodeBarHigh(volume, high, low, iSigSt, vahLb) : null;
    const vahOkSt =
      longVahOn &&
      vahHSt != null &&
      Number.isFinite(vahHSt) &&
      Number.isFinite(clSt) &&
      Number.isFinite(clPrevSt) &&
      clSt > vahHSt &&
      clPrevSt <= vahHSt;
    const innerHvnSt = highVolumeNodeBarRange(volume, high, low, iSigSt, svpInnerLb);
    const innerClearedSt =
      !longRequireInnerHvnClear ||
      (innerHvnSt != null &&
        Number.isFinite(innerHvnSt.high) &&
        Number.isFinite(close[iSigSt]!) &&
        close[iSigSt]! > innerHvnSt.high);
    const eNowSt = emaLongSlopeArr[iSigSt];
    const ePrevSt = emaLongSlopeArr[iPrevSt];
    const ePrev2St = iPrev2St >= 0 ? emaLongSlopeArr[iPrev2St] : NaN;
    const emaSlopeOkSt =
      !longSlopeEmaOn ||
      (typeof eNowSt === "number" &&
        typeof ePrevSt === "number" &&
        Number.isFinite(eNowSt) &&
        Number.isFinite(ePrevSt) &&
        eNowSt > ePrevSt &&
        (longSlopeMinUpBars < 2 ||
          (typeof ePrev2St === "number" && Number.isFinite(ePrev2St) && ePrevSt > ePrev2St)));
    const a2 = emaLongSlope2Arr?.[iSigSt];
    const b2 = emaLongSlope2Arr?.[iPrevSt];
    const c2 = iPrev2St >= 0 ? emaLongSlope2Arr?.[iPrev2St] : undefined;
    const ema2OkSt =
      !longEma2On ||
      (typeof a2 === "number" &&
        typeof b2 === "number" &&
        Number.isFinite(a2) &&
        Number.isFinite(b2) &&
        a2 > b2 &&
        (longSlopeMinUpBars < 2 ||
          (typeof c2 === "number" && Number.isFinite(c2) && b2 > c2)));
    const vsSt = volSmaArr[iSigSt];
    const vSt = volume[iSigSt]!;
    const volNearMultSt = snowballVolNearMissMultiplier(volMult);
    const volStrictOkSt = snowballVolumeOk(false, vSt, vsSt, volMult);
    const volNearMissSt = snowballVolumeNearMissOnly(false, vSt, vsSt, volMult, volNearMultSt);
    baseResult.stagedDebugLong = formatSnowball4hStagedDebugChecklist({
      symbol,
      snowTf,
      iSig: iSigSt,
      iConf: iConfSt,
      open: openArr,
      close,
      high,
      low,
      volume,
      timeSec,
      pack1h: pack1hForTwoBarChecklist,
      pack15m: pack15mForMomentumChecklist,
      swingLb,
      swingGradeLb,
      swingEx,
      priorMaxHigh: Number.isFinite(priorMaxSt) ? priorMaxSt : null,
      priorMaxHighGrade: Number.isFinite(priorMaxGradeSt) ? priorMaxGradeSt : null,
      swing48: swing48St,
      swing200: swing200St,
      vahOk: vahOkSt,
      vahHigh: vahHSt,
      longVahOn,
      longSlopeEmaOn,
      longSlopeEmaP,
      longSlopeMinUpBars,
      emaSlopeOk: emaSlopeOkSt,
      longEma2On,
      longEma2P,
      ema2SlopeOk: ema2OkSt,
      longRequireInnerHvnClear,
      innerHvnCleared: innerClearedSt,
      innerHvnHigh: innerHvnSt?.high ?? null,
      volMult,
      volNearMult: volNearMultSt,
      volStrictOk: volStrictOkSt,
      volNearMissOnly: volNearMissSt,
      signalVolVsSma:
        typeof vsSt === "number" && Number.isFinite(vsSt) && vsSt > 0 ? vSt / vsSt : null,
    });
  }

  return baseResult;
}
