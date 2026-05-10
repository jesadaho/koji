import type { Client } from "@line/bot-sdk";
import {
  fetchBinanceUsdmKlines,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceIndicatorTf,
} from "./binanceIndicatorKline";
import { sendPublicIndicatorFeedToSparkGroup } from "./alertNotify";
import { emaLine, rsiWilder, smaLine, stochRsiLine } from "./indicatorMath";
import {
  loadIndicatorPublicFeedState,
  updatePublicFeedFiredKey,
  type IndicatorPublicFeedState,
} from "./indicatorPublicFeedStore";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";

const TF: BinanceIndicatorTf = "1h";

const DIVERGENCE_TFS: BinanceIndicatorTf[] = ["1h", "4h"];
const SNOWBALL_TF: BinanceIndicatorTf = "15m";

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

/** ย้อนหลังกี่แท่ง 15m ใช้หา "High ล่าสุด" / "Low ล่าสุด" ก่อนแท่งปิด (HH / LL) */
function snowballSwingLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 120) return Math.floor(v);
  return 48;
}

function snowballVolSmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_SMA);
  if (Number.isFinite(v) && v >= 3 && v <= 100) return Math.floor(v);
  return 20;
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

/** HH: Stoch RSI ต้องต่ำกว่านี้ (ค่าเริ่ม 90 — ยังไม่ OB เกินไป) */
function snowballOverboughtCeiling(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_OVERBOUGHT_MAX);
  if (Number.isFinite(v) && v > 50 && v <= 100) return v;
  return 90;
}

/** LL: Stoch RSI ต้องสูงกว่านี้ (ค่าเริ่ม 10 — ยังไม่ OS เกินไป) */
function snowballOversoldFloor(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_OVERSOLD_MIN);
  if (Number.isFinite(v) && v >= 0 && v < 50) return v;
  return 10;
}

let topAltsCache: { symbols: string[]; at: number } | null = null;

async function getUniverseSymbols(): Promise<string[]> {
  const topN = topAltsCount();
  const ttl = symbolListTtlMs();
  const now = Date.now();
  if (topAltsCache && now - topAltsCache.at < ttl) {
    return ["BTCUSDT", "ETHUSDT", ...topAltsCache.symbols];
  }
  const top = topN > 0 ? await fetchTopUsdmUsdtSymbolsByQuoteVolume(topN) : [];
  topAltsCache = { symbols: top, at: now };
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

function maxHighPriorWindow(high: number[], i: number, lookback: number): number {
  const start = Math.max(0, i - lookback);
  let m = -Infinity;
  for (let j = start; j < i; j++) m = Math.max(m, high[j]!);
  return m;
}

function minLowPriorWindow(low: number[], i: number, lookback: number): number {
  const start = Math.max(0, i - lookback);
  let m = Infinity;
  for (let j = start; j < i; j++) m = Math.min(m, low[j]!);
  return m;
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
    volPeriod: number;
    rsiP: number;
    stochLen: number;
    stochLimit: number;
  }
): string {
  const pair = pairSlashNoDollar(symbol);
  const bkk = formatClosedCandleBkk(barTimeSec);
  const px = formatUsdPrice(args.close);
  const refPx = formatUsdPrice(args.refSwing);
  const volRatio =
    args.volSma > 0 && Number.isFinite(args.volSma)
      ? (args.volume / args.volSma).toFixed(2)
      : "—";

  if (side === "bull") {
    return [
      `🏹 Snowball Triple-Check · HH (15m)`,
      `${pair} — Binance USDT-M`,
      "",
      `⏰ Closed candle: ${bkk}`,
      "",
      `✅ เงื่อนไข 1 (HH): ปิด ${px} USDT เหนือ High สูงสุดใน ${args.lookback} แท่งก่อนหน้า (ระดับอ้างอิง ~ ${refPx})`,
      `✅ เงื่อนไข 2 (Volume): Vol แท่งนี้ > SMA(${args.volPeriod}) — อัตราส่วน ~ ${volRatio}x (ไม่ใช่แท่งไส้หลอก)`,
      `✅ เงื่อนไข 3 (Stoch RSI ${args.rsiP}/${args.stochLen}): ${args.stochK.toFixed(1)} < ${args.stochLimit.toFixed(0)} — ยังไม่ Overbought เกินไป`,
      "",
      `📊 Stoch RSI (${SNOWBALL_TF}) · ใช้ตัดเหรียญหัวหมอที่ทำ HH แต่ OB ติดลิฟต์แล้ว`,
      "",
      "⚠️ Not financial advice",
    ].join("\n");
  }

  return [
    `🏹 Snowball Triple-Check · LL (15m)`,
    `${pair} — Binance USDT-M`,
    "",
    `⏰ Closed candle: ${bkk}`,
    "",
    `✅ เงื่อนไข 1 (LL): ปิด ${px} USDT ต่ำกว่า Low ต่ำสุดใน ${args.lookback} แท่งก่อนหน้า (ระดับอ้างอิง ~ ${refPx})`,
    `✅ เงื่อนไข 2 (Volume): Vol แท่งนี้ > SMA(${args.volPeriod}) — อัตราส่วน ~ ${volRatio}x`,
    `✅ เงื่อนไข 3 (Stoch RSI ${args.rsiP}/${args.stochLen}): ${args.stochK.toFixed(1)} > ${args.stochLimit.toFixed(0)} — ยังไม่ Oversold เกินไป`,
    "",
    `📊 Stoch RSI (${SNOWBALL_TF}) · ใช้ตัดเหรียญหัวหมอที่ทำ LL แต่ OS ติดใต้ดินแล้ว`,
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
 * + Snowball Triple-Check (15m HH/LL + volume + Stoch RSI) → Telegram กลุ่ม Spark/System
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

  const symbols = await getUniverseSymbols();
  if (symbols.length === 0) return 0;

  const rsiP = rsiParams();
  const emaP = emaParams();
  if (emaP.fast >= emaP.slow) {
    console.warn("[indicatorPublicFeed] EMA fast >= slow — ข้าม EMA");
  }

  const concurrency = 8;
  const packs1h: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const packs4h: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  const packs15m: (Awaited<ReturnType<typeof fetchBinanceUsdmKlines>> | null)[] = [];
  for (let i = 0; i < symbols.length; i += concurrency) {
    const chunk = symbols.slice(i, i + concurrency);
    const part1h = await Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, TF)));
    packs1h.push(...part1h);
    if (divOn) {
      const part4h = await Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, "4h")));
      packs4h.push(...part4h);
    }
    if (snowballOn) {
      const part15 = await Promise.all(chunk.map((s) => fetchBinanceUsdmKlines(s, SNOWBALL_TF)));
      packs15m.push(...part15);
    } else {
      packs15m.push(...chunk.map(() => null));
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

    if (rsiOn && !isNeutralRsi50Threshold(rsiP.threshold)) {
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

    if (emaOn && emaP.fast < emaP.slow) {
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

    if (divOn) {
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
      const pack15 = packs15m[idx];
      if (!pack15) continue;
      const { close: c15, high: h15, low: l15, volume: v15, timeSec: t15 } = pack15;
      const swingLb = snowballSwingLookbackBars();
      const volP = snowballVolSmaPeriod();
      const rsiP = snowballStochRsiPeriod();
      const stLen = snowballStochLength();
      const kSm = snowballStochKSmooth();
      const obMax = snowballOverboughtCeiling();
      const osMin = snowballOversoldFloor();

      const n15 = c15.length;
      const i15 = n15 - 2;
      const minBars = Math.max(rsiP + stLen + kSm + 8, volP + 2, swingLb + 3);
      if (n15 < minBars || i15 < 1) continue;

      const barTimeSec15 = t15[i15];
      if (typeof barTimeSec15 !== "number" || !Number.isFinite(barTimeSec15)) continue;

      const volSmaArr = smaLine(v15, volP);
      const stochArr = snowballStochSeries(c15, rsiP, stLen, kSm);

      const vsNow = volSmaArr[i15];
      const stNow = stochArr[i15];
      const clNow = c15[i15];
      const viNow = v15[i15];

      if (
        !Number.isFinite(vsNow) ||
        !Number.isFinite(stNow) ||
        !Number.isFinite(clNow) ||
        typeof viNow !== "number" ||
        !Number.isFinite(viNow)
      ) {
        continue;
      }

      const priorMaxHigh = maxHighPriorWindow(h15, i15, swingLb);
      const priorMinLow = minLowPriorWindow(l15, i15, swingLb);

      const baseArgs = {
        close: clNow,
        volume: viNow,
        volSma: vsNow,
        stochK: stNow,
        lookback: swingLb,
        volPeriod: volP,
        rsiP,
        stochLen: stLen,
      };

      if (
        Number.isFinite(priorMaxHigh) &&
        clNow > priorMaxHigh &&
        viNow > 0 &&
        viNow > vsNow &&
        stNow < obMax
      ) {
        const key = `${symbol}|SNOWBALL|15m|BULL`;
        if (state.lastFiredBarSec[key] !== barTimeSec15 && !inCooldown(state, key, now)) {
          const msg = buildSnowballTripleCheckMessage(symbol, "bull", barTimeSec15, {
            ...baseArgs,
            refSwing: priorMaxHigh,
            stochLimit: obMax,
          });
          try {
            const ok = await sendPublicIndicatorFeedToSparkGroup(msg);
            if (ok) {
              await updatePublicFeedFiredKey(state, key, barTimeSec15, iso, now);
              notified += 1;
            }
          } catch (e) {
            console.error("[indicatorPublicFeed] Snowball HH Telegram", symbol, e);
          }
        }
      }

      if (
        Number.isFinite(priorMinLow) &&
        clNow < priorMinLow &&
        viNow > 0 &&
        viNow > vsNow &&
        stNow > osMin
      ) {
        const key = `${symbol}|SNOWBALL|15m|BEAR`;
        if (state.lastFiredBarSec[key] !== barTimeSec15 && !inCooldown(state, key, now)) {
          const msg = buildSnowballTripleCheckMessage(symbol, "bear", barTimeSec15, {
            ...baseArgs,
            refSwing: priorMinLow,
            stochLimit: osMin,
          });
          try {
            const ok = await sendPublicIndicatorFeedToSparkGroup(msg);
            if (ok) {
              await updatePublicFeedFiredKey(state, key, barTimeSec15, iso, now);
              notified += 1;
            }
          } catch (e) {
            console.error("[indicatorPublicFeed] Snowball LL Telegram", symbol, e);
          }
        }
      }
    }
  }

  return notified;
}
