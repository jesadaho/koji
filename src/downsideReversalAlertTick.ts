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
  if (Number.isFinite(v) && v >= 5 && v <= 120) return Math.floor(v);
  return 48;
}

function snowballSwingExcludeRecentBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 10) return Math.floor(v);
  return 2;
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

function evalSymbol(symbol: string, st: DownsideSymbolState, pack15: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>, pack1h: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>): EvalOut {
  const next: DownsideSymbolState = { ...st };
  const out: EvalOut = { symbol, next };

  const { open: o15, high: h15, low: l15, close: c15, volume: v15, timeSec: t15 } = pack15;
  const { open: o1, low: l1, close: c1, volume: v1, timeSec: t1 } = pack1h;

  const n15 = c15.length;
  const n1 = c1.length;
  const i15 = n15 - 2;
  const i1 = n1 - 2;
  if (i15 < 2 || i1 < 2) return out;

  const swingLb = snowballSwingLookbackBars();
  const swingEx = snowballSwingExcludeRecentBars();
  const volP = snowballVolSmaPeriod();
  const volMult = snowballVolMultiplier();
  const vahLb = snowballLongVahLookbackBars();
  const longVahOn = envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_BREAK", true);

  const min15 = swingLb + swingEx + 5;
  if (i15 < min15 || i1 < 21) return out;

  const volSma15 = smaLine(v15, volP);
  const vs = volSma15[i15];
  const volOk = Number.isFinite(vs) && v15[i15]! > (vs as number) * volMult;

  const priorMaxHigh = maxHighPriorWindow(h15, i15, swingLb, swingEx);
  const classicSwing = Number.isFinite(priorMaxHigh) && c15[i15]! > priorMaxHigh;

  let vahCross = false;
  if (longVahOn && i15 >= 1) {
    const vahH = highVolumeNodeBarHigh(v15, h15, l15, i15, vahLb);
    if (vahH != null && Number.isFinite(vahH)) {
      vahCross = c15[i15]! > vahH && c15[i15 - 1]! <= vahH;
    }
  }

  const priorHighShort = maxHighPriorWindow(h15, i15, Math.min(24, swingLb), 0);
  const newLocalHigh = Number.isFinite(priorHighShort) && h15[i15]! > priorHighShort;

  const snowballTrigger = volOk && (classicSwing || vahCross);
  const weakTrigger = snowballTrigger || newLocalHigh;

  const range15 = h15[i15]! - l15[i15]!;
  const eps = Math.max(1e-12, Math.abs(h15[i15]!) * 1e-10);
  const upperWick = h15[i15]! - Math.max(o15[i15]!, c15[i15]!);
  const wickRatio = range15 > eps ? upperWick / range15 : 0;
  const wickOk = wickRatio >= weakWickMinRatio();
  const bar15Open = t15[i15]!;

  if (weakTrigger && wickOk && next.lastWeakDemand15mOpenSec !== bar15Open) {
    const wickPct = (wickRatio * 100).toFixed(1);
    out.weakMsg = `⚠️ [Reversal Risk] ${symbol}: ระวังหัวปัก! ไส้บนยาว ${wickPct}% แรงซื้อสู้แรงขายไม่ได้`;
    next.lastWeakDemand15mOpenSec = bar15Open;
    next.signalBarLow = l15[i15]!;
    next.signalBarOpenSec = bar15Open;
    next.trendBrokenForSignalOpenSec = null;
  }

  const iPrevBear = i1 - 1;
  if (iPrevBear < 1) return out;

  let sumBody = 0;
  let sumVol = 0;
  let cnt = 0;
  for (let j = i1 - 20; j <= i1 - 1; j++) {
    if (j < 0) continue;
    sumBody += Math.abs(c1[j]! - o1[j]!);
    sumVol += v1[j]!;
    cnt++;
  }
  if (cnt < 20) return out;
  const avgBody = sumBody / cnt;
  const avgVol = sumVol / cnt;
  const isRed = c1[i1]! < o1[i1]!;
  const bodyBear = o1[i1]! - c1[i1]!;
  const bar1hOpen = t1[i1]!;

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

  const blockRepeatBreakBelowSameSignal =
    Boolean(breakSig && sop != null && st.trendBrokenForSignalOpenSec != null && st.trendBrokenForSignalOpenSec === sop);

  const alreadyTrendThisBar = next.lastTrendBroken1hOpenSec === bar1hOpen;

  if (!alreadyTrendThisBar && !blockRepeatBreakBelowSameSignal && (crossEma || breakSig)) {
    out.trendMsg = `🛑 [Trend Broken] ${symbol}: หลุดแนวรับสำคัญ (EMA20/Signal Low) เสียทรงขาขึ้นแล้ว`;
    next.lastTrendBroken1hOpenSec = bar1hOpen;
    if (breakSig && sop != null) {
      next.trendBrokenForSignalOpenSec = sop;
    }
  }

  return out;
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
      fetchBinanceUsdmKlines(symbol, "15m", 96),
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
