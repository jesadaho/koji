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
  updatePublicFeedFiredKey,
  type IndicatorPublicFeedState,
} from "./indicatorPublicFeedStore";
import { appendSnowballStatsRow } from "./snowballStatsStore";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";

const TF: BinanceIndicatorTf = "1h";

const DIVERGENCE_TFS: BinanceIndicatorTf[] = ["1h", "4h"];

/** Snowball ใช้ TF นี้จาก Binance USDM (15m / 1h / 4h) — ค่าเริ่ม 4h */
function snowballBinanceTf(): BinanceIndicatorTf {
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

function isPublicSnowballTripleCheckEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_ENABLED", true);
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
      `Indicator: RSI (${period}) - 1h Timeframe`,
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
      `Indicator: RSI (${period}) - 1h Timeframe`,
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
    `Indicator: RSI (${period}) - 1h · prev ${rPrev.toFixed(2)} → now ${rNow.toFixed(2)}`,
    "สัญญาณไม่ตรงแบบข้ามเกณฑ์มาตรฐาน — ตรวจ INDICATOR_PUBLIC_RSI_DIRECTION",
  ].join("\n");
}

function buildPublicEmaMessage(
  symbol: string,
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
      `🔹 Timeframe: 1h (EMA ${fast} / ${slow})`,
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
    `🔹 Timeframe: 1h (EMA ${fast} / ${slow})`,
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

  return [
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
    "",
    "⚠️ Not financial advice",
  ].join("\n");
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

/**
 * Feed สาธารณะ RSI + EMA จาก Binance USDT-M (1h) + RSI divergence (1h / 4h)
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

  const rsiOn = envFlagOn("INDICATOR_PUBLIC_RSI_ENABLED", true);
  const emaOn = envFlagOn("INDICATOR_PUBLIC_EMA_ENABLED", true);
  const divOn = isPublicRsiDivergenceEnabled();
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
  const packs1h: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const packs4h: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const snowTf = snowballBinanceTf();
  const snowballPacks: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  for (let i = 0; i < symbols.length; i += concurrency) {
    const chunk = symbols.slice(i, i + concurrency);
    const part1h = await Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, TF)));
    packs1h.push(...part1h);
    if (divOn) {
      const part4h = await Promise.all(
        chunk.map((s, j) => {
          const globalIdx = i + j;
          return globalIdx < maxIdxCoreFeed
            ? fetchBinanceUsdmKlines(s, "4h")
            : Promise.resolve(null);
        })
      );
      packs4h.push(...part4h);
    } else {
      packs4h.push(...chunk.map(() => null));
    }
    if (snowballOn) {
      const partSb = await Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, snowTf)));
      snowballPacks.push(...partSb);
    } else {
      snowballPacks.push(...chunk.map(() => null));
    }
  }

  let state = await loadIndicatorPublicFeedState();
  let notified = 0;

  for (let idx = 0; idx < symbols.length; idx++) {
    const symbol = symbols[idx]!;
    const pack = packs1h[idx];
    if (!pack) continue;

    const { close, timeSec } = pack;
    const n = close.length;
    const i = n - 2;
    const iPrev = i - 1;
    if (iPrev < 0) continue;

    const barTimeSec = timeSec[i];
    if (typeof barTimeSec !== "number" || !Number.isFinite(barTimeSec)) continue;

    const iso = new Date().toISOString();

    if (rsiOn && idx < maxIdxCoreFeed && !isNeutralRsi50Threshold(rsiP.threshold)) {
      const period = rsiP.period;
      if (n >= period + 3) {
        const rsi = rsiWilder(close, period);
        const rNow = rsi[i]!;
        const rPrev = rsi[iPrev]!;
        if (Number.isFinite(rNow) && Number.isFinite(rPrev)) {
          const key = `${symbol}|RSI`;
          if (
            rsiCrossMatch(rPrev, rNow, rsiP.threshold, rsiP.direction) &&
            state.lastFiredBarSec[key] !== barTimeSec &&
            !inCooldown(state, key, now)
          ) {
            const msg = buildPublicRsiMessage(
              symbol,
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
      if (i < minIdx || iPrev < minIdx) continue;

      const efNow = emaF[i]!;
      const esNow = emaS[i]!;
      const efPrev = emaF[iPrev]!;
      const esPrev = emaS[iPrev]!;
      if (
        !Number.isFinite(efNow) ||
        !Number.isFinite(esNow) ||
        !Number.isFinite(efPrev) ||
        !Number.isFinite(esPrev)
      ) {
        continue;
      }

      const fastAboveNow = efNow > esNow;
      const fastAbovePrev = efPrev > esPrev;

      for (const kind of ["golden", "death"] as const) {
        if (!emaCrossMatch(fastAbovePrev, fastAboveNow, kind)) continue;
        const key = `${symbol}|EMA_${kind.toUpperCase()}`;
        if (state.lastFiredBarSec[key] === barTimeSec || inCooldown(state, key, now)) continue;

        const msg = buildPublicEmaMessage(
          symbol,
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

    if (divOn && idx < maxIdxCoreFeed) {
      const wing = divergencePivotWing();
      const minGap = divergenceMinPivotGapBars();
      const strongD = divergenceStrongRsiDelta();
      const period = rsiP.period;
      const rsiMaP = divergenceRsiMaPeriod();
      const lb = divergenceLookbackBars();
      const minBars = period + lb + rsiMaP + wing + 12;

      for (const divTf of DIVERGENCE_TFS) {
        const divPack = divTf === "1h" ? pack : packs4h[idx];
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

    if (snowballOn) {
      const packSb = snowballPacks[idx];
      if (!packSb) continue;
      const { close: c15, high: h15, low: l15, volume: v15, timeSec: t15 } = packSb;
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
      if (n15 < minBars || iClosed < 1 || iForming < 1) continue;

      const volSmaArr = smaLine(v15, volP);
      const stochArr = snowballStochSeries(c15, rsiP, stLen, kSm);
      const stochLastClosed = stochArr[iClosed];

      if (!Number.isFinite(stochLastClosed)) continue;

      const emaResArr = emaLine(c15, emaResP);
      const emaLongSlopeArr =
        longSlopeEmaOn && longSlopeEmaP !== emaResP ? emaLine(c15, longSlopeEmaP) : emaResArr;
      const emaLongSlope2Arr = longEma2On ? emaLine(c15, longEma2P) : null;

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

        const key = `${symbol}|SNOWBALL|${snowTf}|BULL`;
        if (state.lastFiredBarSec[key] === barOpenSec || inCooldown(state, key, now)) return;

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
        });
        try {
          const ok = await sendPublicSnowballFeedToSparkGroup(msg);
          if (ok) {
            await updatePublicFeedFiredKey(state, key, barOpenSec, iso, now);
            notified += 1;
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
            }
          }
        } catch (e) {
          console.error("[indicatorPublicFeed] Snowball LONG", symbol, intrabar ? "intrabar" : "close", e);
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

        const key = `${symbol}|SNOWBALL|${snowTf}|BEAR`;
        if (state.lastFiredBarSec[key] === barOpenSec || inCooldown(state, key, now)) return;

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
        });
        try {
          const ok = await sendPublicSnowballFeedToSparkGroup(msg);
          if (ok) {
            await updatePublicFeedFiredKey(state, key, barOpenSec, iso, now);
            notified += 1;
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
            }
          }
        } catch (e) {
          console.error("[indicatorPublicFeed] Snowball BEAR", symbol, intrabar ? "intrabar" : "close", e);
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

  return notified;
}
