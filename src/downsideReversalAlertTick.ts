import {
  fetchAllBinanceUsdmLinearSymbols,
  fetchBinanceUsdmKlines,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
} from "./binanceIndicatorKline";
import { sendTechnicalPublicBroadcastMessage, telegramSparkSystemGroupConfigured } from "./telegramAlert";
import { emaLine, smaLine } from "./indicatorMath";
import {
  loadDownsideReversalAlertState,
  saveDownsideReversalAlertState,
  type DownsideSymbolState,
} from "./downsideReversalAlertStateStore";

function isDownsideReversalAlertsEnabled(): boolean {
  const raw = process.env.DOWNSIDE_REVERSAL_ALERTS_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function scanConcurrency(): number {
  const n = Number(process.env.DOWNSIDE_REVERSAL_SCAN_CONCURRENCY?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 32 ? Math.floor(n) : 10;
}

/** บังคับ Forum topic (เช่น ให้ตรงห้อง technical) — ถ้าไม่ตั้งใช้ `sendTechnicalPublicBroadcastMessage` ตาม TELEGRAM_PUBLIC_TECHNICAL_MESSAGE_THREAD_ID */
function downsideReversalTechnicalThreadOverride(): number | undefined {
  const raw = process.env.DOWNSIDE_REVERSAL_TELEGRAM_MESSAGE_THREAD_ID?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/** 0 = ไม่จำกัด (ทุกสัญญา USDT-M จาก exchangeInfo) */
function maxSymbolsScan(): number {
  const n = Number(process.env.DOWNSIDE_REVERSAL_MAX_SYMBOLS?.trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function maxAlertsPerRun(): number {
  const n = Number(process.env.DOWNSIDE_REVERSAL_MAX_ALERTS_PER_RUN?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 200 ? Math.floor(n) : 45;
}

function weakWickMinRatio(): number {
  const n = Number(process.env.DOWNSIDE_REVERSAL_WEAK_WICK_MIN_RATIO?.trim());
  return Number.isFinite(n) && n > 0.2 && n < 0.95 ? n : 0.4;
}

function envFlagOn(key: string, defaultTrue: boolean): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return defaultTrue;
}

function snowballSwingLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK?.trim());
  if (Number.isFinite(v) && v >= 5 && v <= 400) return Math.floor(v);
  return 48;
}

function snowballSwingExcludeRecentBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 10) return Math.floor(v);
  return 2;
}

/** จำนวนแท่ง 15m ที่ดึง — ต้องครอบ swingLb+swingEx (+ buffer) ไม่ให้ eval ข้ามทุกสัญญาเมื่อ lookback ใหญ่ */
function downsideReversal15mFetchLimit(): number {
  const need = snowballSwingLookbackBars() + snowballSwingExcludeRecentBars() + 15;
  return Math.min(1500, Math.max(96, need));
}

function snowballVolSmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_SMA?.trim());
  if (Number.isFinite(v) && v >= 3 && v <= 100) return Math.floor(v);
  return 20;
}

function snowballVolMultiplier(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_MULT?.trim());
  if (Number.isFinite(v) && v >= 1 && v <= 10) return v;
  return 2.5;
}

function snowballLongVahLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_LOOKBACK?.trim());
  if (Number.isFinite(v) && v >= 5 && v <= 120) return Math.floor(v);
  return 20;
}

function maxHighPriorWindow(high: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

function highVolumeNodeBarHigh(
  vol: number[],
  high: number[],
  low: number[],
  i: number,
  lookback: number
): number | null {
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
  return Number.isFinite(H!) ? H! : null;
}

function emptySymState(): DownsideSymbolState {
  return {
    signalBarLow: null,
    signalBarOpenSec: null,
  };
}

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

type EvalOut = {
  symbol: string;
  weakMsg?: string;
  bearMsg?: string;
  trendMsg?: string;
  next: DownsideSymbolState;
};

export type ReversalRiskDebugSkip = {
  kind: "skip";
  reason: string;
  i15?: number;
  i1?: number;
  min15Need?: number;
};

export type ReversalRiskDebugOk = {
  kind: "ok";
  swingLb: number;
  swingEx: number;
  volP: number;
  volMult: number;
  vahLb: number;
  longVahOn: boolean;
  i15: number;
  i1: number;
  bar15OpenSec: number;
  bar1hOpenSec: number;
  ohlcv15: { o: number; h: number; l: number; c: number; v: number };
  volSma: number;
  volOk: boolean;
  priorMaxHighSwing: number;
  classicSwing: boolean;
  vahH: number | null;
  vahCross: boolean;
  priorHighShortLb: number;
  priorHighShort: number;
  newLocalHigh: boolean;
  snowballTrigger: boolean;
  weakTrigger: boolean;
  range15: number;
  upperWick: number;
  wickRatio: number;
  weakWickMin: number;
  wickOk: boolean;
  weakDedupeBlocked: boolean;
  weakWouldNotify: boolean;
  avgBody: number;
  avgVol: number;
  isRed1h: boolean;
  bodyBear: number;
  vol1h: number;
  bearDedupeBlocked: boolean;
  bearWouldNotify: boolean;
  ema20Now: number;
  ema20Prev: number;
  crossEma: boolean;
  signalBarLowForBreak: number | null;
  signalBarOpenSecForBreak: number | null;
  breakSig: boolean;
  blockRepeatBreakBelowSameSignal: boolean;
  alreadyTrendThisBar: boolean;
  trendWouldNotify: boolean;
};

export type ReversalRiskDebugSnapshot = ReversalRiskDebugSkip | ReversalRiskDebugOk;

type EvalWithSnapshot = { out: EvalOut; snap: ReversalRiskDebugSnapshot };

function evalSymbolWithSnapshot(
  symbol: string,
  st: DownsideSymbolState,
  pack15: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
  pack1h: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
): EvalWithSnapshot {
  const next: DownsideSymbolState = { ...st };
  const out: EvalOut = { symbol, next };

  const { open: o15, high: h15, low: l15, close: c15, volume: v15, timeSec: t15 } = pack15;
  const { open: o1, low: l1, close: c1, volume: v1, timeSec: t1 } = pack1h;

  const n15 = c15.length;
  const n1 = c1.length;
  const i15 = n15 - 2;
  const i1 = n1 - 2;
  if (i15 < 2 || i1 < 2) {
    return {
      out,
      snap: { kind: "skip", reason: "แท่งปิด (15m/1h) ไม่พอสำหรับดัชนี i15/i1", i15, i1 },
    };
  }

  const swingLb = snowballSwingLookbackBars();
  const swingEx = snowballSwingExcludeRecentBars();
  const volP = snowballVolSmaPeriod();
  const volMult = snowballVolMultiplier();
  const vahLb = snowballLongVahLookbackBars();
  const longVahOn = envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_BREAK", true);

  const min15 = swingLb + swingEx + 5;
  if (i15 < min15 || i1 < 21) {
    return {
      out,
      snap: {
        kind: "skip",
        reason: "ประวัติ 15m ไม่พอสำหรับ swing lookback + exclude",
        i15,
        i1,
        min15Need: min15,
      },
    };
  }

  const volSma15 = smaLine(v15, volP);
  const vs = volSma15[i15];
  const volOk = Number.isFinite(vs) && v15[i15]! > (vs as number) * volMult;

  const priorMaxHigh = maxHighPriorWindow(h15, i15, swingLb, swingEx);
  const classicSwing = Number.isFinite(priorMaxHigh) && c15[i15]! > priorMaxHigh;

  let vahH: number | null = null;
  let vahCross = false;
  if (longVahOn && i15 >= 1) {
    const vah = highVolumeNodeBarHigh(v15, h15, l15, i15, vahLb);
    if (vah != null && Number.isFinite(vah)) {
      vahH = vah;
      vahCross = c15[i15]! > vahH && c15[i15 - 1]! <= vahH;
    }
  }

  const priorHighShortLb = Math.min(24, swingLb);
  const priorHighShort = maxHighPriorWindow(h15, i15, priorHighShortLb, 0);
  const newLocalHigh = Number.isFinite(priorHighShort) && h15[i15]! > priorHighShort;

  const snowballTrigger = volOk && (classicSwing || vahCross);
  const weakTrigger = snowballTrigger || newLocalHigh;

  const range15 = h15[i15]! - l15[i15]!;
  const eps = Math.max(1e-12, Math.abs(h15[i15]!) * 1e-10);
  const upperWick = h15[i15]! - Math.max(o15[i15]!, c15[i15]!);
  const wickRatio = range15 > eps ? upperWick / range15 : 0;
  const wickMin = weakWickMinRatio();
  const wickOk = wickRatio >= wickMin;
  const bar15Open = t15[i15]!;
  const weakDedupeBlocked = st.lastWeakDemand15mOpenSec === bar15Open;
  const weakWouldNotify = weakTrigger && wickOk && !weakDedupeBlocked;

  if (weakTrigger && wickOk && next.lastWeakDemand15mOpenSec !== bar15Open) {
    const wickPct = (wickRatio * 100).toFixed(1);
    out.weakMsg = `⚠️ [Reversal Risk] ${symbol}: ระวังหัวปัก! ไส้บนยาว ${wickPct}% แรงซื้อสู้แรงขายไม่ได้`;
    next.lastWeakDemand15mOpenSec = bar15Open;
    next.signalBarLow = l15[i15]!;
    next.signalBarOpenSec = bar15Open;
    next.trendBrokenForSignalOpenSec = null;
  }

  let sumBody = 0;
  let sumVol = 0;
  let cnt = 0;
  for (let j = i1 - 20; j <= i1 - 1; j++) {
    if (j < 0) continue;
    sumBody += Math.abs(c1[j]! - o1[j]!);
    sumVol += v1[j]!;
    cnt++;
  }
  if (cnt < 20) {
    return {
      out,
      snap: { kind: "skip", reason: "คำนวณค่าเฉลี่ย body/vol 1h ไม่ครบ 20 แท่ง", i1 },
    };
  }
  const avgBody = sumBody / cnt;
  const avgVol = sumVol / cnt;
  const isRed = c1[i1]! < o1[i1]!;
  const bodyBear = o1[i1]! - c1[i1]!;
  const bar1hOpen = t1[i1]!;
  const bearDedupeBlocked = st.lastBearVol1hOpenSec === bar1hOpen;
  const bearWouldNotify = isRed && bodyBear > avgBody && v1[i1]! > avgVol && !bearDedupeBlocked;

  if (isRed && bodyBear > avgBody && v1[i1]! > avgVol && next.lastBearVol1hOpenSec !== bar1hOpen) {
    out.bearMsg = `🚨 [Bearish Vol] ${symbol}: เจอแท่งแดงยาวพร้อม Vol หนาใน 1hr! แรงขายคุมตลาดชัดเจน`;
    next.lastBearVol1hOpenSec = bar1hOpen;
    next.signalBarLow = l1[i1]!;
    next.signalBarOpenSec = bar1hOpen;
    next.trendBrokenForSignalOpenSec = null;
  }

  const ema1 = emaLine(c1, 20);
  const eNow = ema1[i1];
  const ePrev = ema1[i1 - 1];
  const crossEma =
    Number.isFinite(eNow) &&
    Number.isFinite(ePrev) &&
    c1[i1]! < (eNow as number) &&
    c1[i1 - 1]! >= (ePrev as number);

  const slip = next.signalBarLow;
  const sop = next.signalBarOpenSec;
  let breakSig = false;
  if (slip != null && Number.isFinite(slip) && sop != null) {
    breakSig = c1[i1]! < slip && c1[i1 - 1]! >= slip;
  }

  const blockRepeatBreakBelowSameSignal = Boolean(
    breakSig && sop != null && st.trendBrokenForSignalOpenSec != null && st.trendBrokenForSignalOpenSec === sop,
  );

  const alreadyTrendThisBar = next.lastTrendBroken1hOpenSec === bar1hOpen;
  const trendWouldNotify =
    !alreadyTrendThisBar && !blockRepeatBreakBelowSameSignal && (crossEma || breakSig);

  if (!alreadyTrendThisBar && !blockRepeatBreakBelowSameSignal && (crossEma || breakSig)) {
    out.trendMsg = `🛑 [Trend Broken] ${symbol}: หลุดแนวรับสำคัญ (EMA20/Signal Low) เสียทรงขาขึ้นแล้ว`;
    next.lastTrendBroken1hOpenSec = bar1hOpen;
    if (breakSig && sop != null) {
      next.trendBrokenForSignalOpenSec = sop;
    }
  }

  const snapOk: ReversalRiskDebugOk = {
    kind: "ok",
    swingLb,
    swingEx,
    volP,
    volMult,
    vahLb,
    longVahOn,
    i15,
    i1,
    bar15OpenSec: bar15Open,
    bar1hOpenSec: bar1hOpen,
    ohlcv15: { o: o15[i15]!, h: h15[i15]!, l: l15[i15]!, c: c15[i15]!, v: v15[i15]! },
    volSma: vs as number,
    volOk,
    priorMaxHighSwing: priorMaxHigh,
    classicSwing,
    vahH,
    vahCross,
    priorHighShortLb,
    priorHighShort,
    newLocalHigh,
    snowballTrigger,
    weakTrigger,
    range15,
    upperWick,
    wickRatio,
    weakWickMin: wickMin,
    wickOk,
    weakDedupeBlocked,
    weakWouldNotify,
    avgBody,
    avgVol,
    isRed1h: isRed,
    bodyBear,
    vol1h: v1[i1]!,
    bearDedupeBlocked,
    bearWouldNotify,
    ema20Now: eNow as number,
    ema20Prev: ePrev as number,
    crossEma,
    signalBarLowForBreak: slip,
    signalBarOpenSecForBreak: sop,
    breakSig,
    blockRepeatBreakBelowSameSignal,
    alreadyTrendThisBar,
    trendWouldNotify,
  };

  return { out, snap: snapOk };
}

function evalSymbol(
  symbol: string,
  st: DownsideSymbolState,
  pack15: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
  pack1h: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
): EvalOut {
  return evalSymbolWithSnapshot(symbol, st, pack15, pack1h).out;
}

function normalizeBinanceUsdtSymbol(sym: string): string {
  const s = sym.trim().toUpperCase().replace(/^@/, "");
  if (!s) return "";
  if (s.endsWith("USDT")) return s;
  return `${s}USDT`;
}

function fmtNum(n: number, d: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

const DEBUG_MAX_LEN = 3800;

/**
 * Admin debug — รายละเอียดเงื่อนไข Reversal Risk / Bearish Vol / Trend Broken (Binance USDT-M)
 */
export async function formatDownsideReversalRiskDebugMessage(rawSymbol: string): Promise<string> {
  const lines: string[] = [];
  const symbol = normalizeBinanceUsdtSymbol(rawSymbol);
  lines.push("⚠️ Downside / Reversal Risk — debug (Binance USDM)");
  lines.push(`UTC: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("— env —");
  const drOn =
    process.env.DOWNSIDE_REVERSAL_ALERTS_ENABLED?.trim().toLowerCase() === "1" ||
    process.env.DOWNSIDE_REVERSAL_ALERTS_ENABLED?.trim().toLowerCase() === "true" ||
    process.env.DOWNSIDE_REVERSAL_ALERTS_ENABLED?.trim().toLowerCase() === "on" ||
    process.env.DOWNSIDE_REVERSAL_ALERTS_ENABLED?.trim().toLowerCase() === "yes";
  lines.push(`DOWNSIDE_REVERSAL_ALERTS_ENABLED: ${drOn ? "on" : "off"}`);
  lines.push(`BINANCE_INDICATOR_FAPI_ENABLED: ${isBinanceIndicatorFapiEnabled() ? "on" : "off"}`);
  lines.push(`Telegram public (Spark system group): ${telegramSparkSystemGroupConfigured() ? "configured" : "missing"}`);
  lines.push("");

  if (!symbol) {
    lines.push("สัญลักษณ์ว่าง");
    let out = lines.join("\n");
    if (out.length > DEBUG_MAX_LEN) out = `${out.slice(0, DEBUG_MAX_LEN - 20)}\n…(truncated)`;
    return out;
  }

  lines.push(`— symbol ${symbol} —`);
  let st: DownsideSymbolState;
  try {
    const state = await loadDownsideReversalAlertState();
    st = state[symbol] ?? emptySymState();
    lines.push(
      `state: lastWeak15mOpenSec=${st.lastWeakDemand15mOpenSec ?? "—"} · lastBear1hOpenSec=${st.lastBearVol1hOpenSec ?? "—"} · lastTrendBroken1hOpenSec=${st.lastTrendBroken1hOpenSec ?? "—"}`,
    );
    lines.push(
      `signalBarLow=${st.signalBarLow ?? "—"} · signalBarOpenSec=${st.signalBarOpenSec ?? "—"} · trendBrokenForSignalOpenSec=${st.trendBrokenForSignalOpenSec ?? "—"}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lines.push(`โหลด state ไม่สำเร็จ: ${msg.slice(0, 200)} — ใช้ state ว่าง`);
    st = emptySymState();
  }

  const [pack15, pack1h] = await Promise.all([
    fetchBinanceUsdmKlines(symbol, "15m", downsideReversal15mFetchLimit()),
    fetchBinanceUsdmKlines(symbol, "1h", 48),
  ]);
  lines.push("");
  if (!pack15 || !pack1h) {
    lines.push("klines: null (API / สัญญา / FAPI ปิด)");
    let out = lines.join("\n");
    if (out.length > DEBUG_MAX_LEN) out = `${out.slice(0, DEBUG_MAX_LEN - 20)}\n…(truncated)`;
    return out;
  }

  const { out, snap } = evalSymbolWithSnapshot(symbol, st, pack15, pack1h);
  lines.push("— evaluation (แท่งปิดล่าสุด: 15m i=n-2, 1h i=n-2) —");
  if (snap.kind === "skip") {
    lines.push(`skip: ${snap.reason}`);
    if (snap.i15 != null) lines.push(`i15=${snap.i15}`);
    if (snap.i1 != null) lines.push(`i1=${snap.i1}`);
    if (snap.min15Need != null) lines.push(`ต้องการ i15 >= ${snap.min15Need}`);
  } else {
    const s = snap;
    lines.push(`15m แท่งปิด: O H L C V = ${fmtNum(s.ohlcv15.o, 8)} ${fmtNum(s.ohlcv15.h, 8)} ${fmtNum(s.ohlcv15.l, 8)} ${fmtNum(s.ohlcv15.c, 8)} ${fmtNum(s.ohlcv15.v, 2)}`);
    lines.push(`bar15 open(sec)=${s.bar15OpenSec} · bar1h open(sec)=${s.bar1hOpenSec}`);
    lines.push("");
    lines.push("[Reversal Risk] 15m");
    lines.push(`vol vs SMA(${s.volP})×${s.volMult}: volOk=${s.volOk} (vol=${fmtNum(s.ohlcv15.v, 2)} vs thr=${fmtNum(s.volSma * s.volMult, 2)}, sma=${fmtNum(s.volSma, 2)})`);
    lines.push(`classicSwing (close > priorMaxHigh, lb=${s.swingLb}, ex=${s.swingEx}): ${s.classicSwing} · priorMaxHigh=${fmtNum(s.priorMaxHighSwing, 8)}`);
    lines.push(
      `VAH cross (INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_BREAK): longVahOn=${s.longVahOn} · vahH=${s.vahH != null ? fmtNum(s.vahH, 8) : "—"} · vahCross=${s.vahCross} (lookback bars=${s.vahLb})`,
    );
    lines.push(
      `newLocalHigh (high > prior max, lb=${s.priorHighShortLb}): ${s.newLocalHigh} · priorHighShort=${fmtNum(s.priorHighShort, 8)}`,
    );
    lines.push(`snowballTrigger = volOk && (classicSwing || vahCross): ${s.snowballTrigger}`);
    lines.push(`weakTrigger = snowballTrigger || newLocalHigh: ${s.weakTrigger}`);
    lines.push(
      `upper wick ratio ${(s.wickRatio * 100).toFixed(2)}% (min ${(s.weakWickMin * 100).toFixed(0)}% DOWNSIDE_REVERSAL_WEAK_WICK_MIN_RATIO): wickOk=${s.wickOk}`,
    );
    lines.push(`weakDedupe (state เคยยิงแท่ง open เดียวกัน): ${s.weakDedupeBlocked}`);
    lines.push(`→ weakWouldNotify: ${s.weakWouldNotify}`);
    lines.push("");
    lines.push("[Bearish Vol] 1h");
    lines.push(`isRed: ${s.isRed1h} · bodyBear=${fmtNum(s.bodyBear, 8)} vs avgBody=${fmtNum(s.avgBody, 8)}`);
    lines.push(`vol1h=${fmtNum(s.vol1h, 2)} vs avgVol=${fmtNum(s.avgVol, 2)}`);
    lines.push(`bearDedupe: ${s.bearDedupeBlocked} · → bearWouldNotify: ${s.bearWouldNotify}`);
    lines.push("");
    lines.push("[Trend Broken] 1h");
    lines.push(`EMA20: prev=${fmtNum(s.ema20Prev, 8)} now=${fmtNum(s.ema20Now, 8)} · crossEma (close ข้ามลง): ${s.crossEma}`);
    lines.push(`signal low (จาก state หลัง weak/bear): ${s.signalBarLowForBreak ?? "—"} · openSec=${s.signalBarOpenSecForBreak ?? "—"}`);
    lines.push(`breakSig (close ข้ามลง signal low): ${s.breakSig}`);
    lines.push(`blockRepeatBreakBelowSameSignal: ${s.blockRepeatBreakBelowSameSignal} · alreadyTrendThisBar: ${s.alreadyTrendThisBar}`);
    lines.push(`→ trendWouldNotify: ${s.trendWouldNotify}`);
  }

  lines.push("");
  lines.push("— messages (ตาม eval เดียวกับ cron; state ใน RAM หลังรอบนี้ — debug ไม่บันทึก KV) —");
  if (out.weakMsg) lines.push(out.weakMsg);
  if (out.bearMsg) lines.push(out.bearMsg);
  if (out.trendMsg) lines.push(out.trendMsg);
  if (!out.weakMsg && !out.bearMsg && !out.trendMsg) lines.push("(ไม่มีข้อความในครั้งนี้)");

  let outStr = lines.join("\n");
  if (outStr.length > DEBUG_MAX_LEN) outStr = `${outStr.slice(0, DEBUG_MAX_LEN - 20)}\n…(truncated)`;
  return outStr;
}

/**
 * แจ้งเตือน downside / reversal บน Binance USDT-M ทุกสัญญา (Alert เท่านั้น) → Telegram public group
 * เปิดด้วย DOWNSIDE_REVERSAL_ALERTS_ENABLED=1 และ BINANCE_INDICATOR_FAPI_ENABLED=1
 */
export async function runDownsideReversalAlertTick(): Promise<number> {
  if (!isDownsideReversalAlertsEnabled()) return 0;
  if (!isBinanceIndicatorFapiEnabled()) return 0;
  if (!telegramSparkSystemGroupConfigured()) return 0;

  resetBinanceIndicatorFapi451LogDedupe();

  let symbols = await fetchAllBinanceUsdmLinearSymbols();
  if (symbols.length === 0) return 0;

  const cap = maxSymbolsScan();
  if (cap > 0 && symbols.length > cap) {
    symbols = symbols.slice(0, cap);
  }

  let state = await loadDownsideReversalAlertState();
  const concurrency = scanConcurrency();
  const alertCap = maxAlertsPerRun();

  const results = await mapPoolConcurrent(symbols, concurrency, async (symbol) => {
    const st = state[symbol] ?? emptySymState();
    const [pack15, pack1h] = await Promise.all([
      fetchBinanceUsdmKlines(symbol, "15m", downsideReversal15mFetchLimit()),
      fetchBinanceUsdmKlines(symbol, "1h", 48),
    ]);
    if (!pack15 || !pack1h) return { symbol, evals: null as EvalOut | null };
    return { symbol, evals: evalSymbol(symbol, st, pack15, pack1h) };
  });

  for (const row of results) {
    if (!row.evals) continue;
    state = { ...state, [row.symbol]: row.evals.next };
  }

  let notified = 0;
  const threadOverride = downsideReversalTechnicalThreadOverride();
  const technicalSendOpts = threadOverride != null ? { messageThreadId: threadOverride } : undefined;
  for (const row of results) {
    if (!row.evals) continue;
    const { weakMsg, bearMsg, trendMsg } = row.evals;
    const msgs = [weakMsg, bearMsg, trendMsg].filter(Boolean) as string[];
    for (const msg of msgs) {
      if (notified >= alertCap) break;
      try {
        await sendTechnicalPublicBroadcastMessage(msg, technicalSendOpts);
        notified++;
      } catch (e) {
        console.error("[downsideReversalAlertTick] telegram", row.symbol, e);
      }
    }
    if (notified >= alertCap) break;
  }

  try {
    await saveDownsideReversalAlertState(state);
  } catch (e) {
    console.error("[downsideReversalAlertTick] save state", e);
  }

  if (notified > 0) {
    console.info(`[downsideReversalAlertTick] sent ${notified} alert(s), scanned ${symbols.length} symbols`);
  }
  return notified;
}
