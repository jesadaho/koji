import {
  fetchAllBinanceUsdmLinearSymbols,
  fetchBinanceUsdmKlines,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
} from "./binanceIndicatorKline";
import { sendPublicReversalFeedToSparkGroup } from "./alertNotify";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import {
  loadCandleReversalAlertState,
  saveCandleReversalAlertState,
  type CandleReversalSymbolState,
} from "./candleReversalAlertStateStore";
import {
  appendCandleReversalStatsRow,
  isCandleReversalStatsEnabled,
} from "./candleReversalStatsStore";
import {
  buildCandleReversal1dAlertMessage,
  DEFAULT_CANDLE_REVERSAL_1D_ENV,
  evalCandleReversal1dClosedBar,
  evalInvertedDoji1d,
  evalMarubozu1d,
  type CandleReversal1dDetectEnv,
  type CandleReversal1dSignal,
} from "./candleReversal1dDetect";

function isCandleReversal1dAlertsEnabled(): boolean {
  const raw = process.env.CANDLE_REVERSAL_1D_ALERTS_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function scanConcurrency(): number {
  const n = Number(process.env.CANDLE_REVERSAL_SCAN_CONCURRENCY?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 32 ? Math.floor(n) : 8;
}

/** 0 = ทุกสัญญา · ไม่ตั้ง env = top alts ตาม CANDLE_REVERSAL_TOP_ALTS */
function maxSymbolsScan(): number {
  const raw = process.env.CANDLE_REVERSAL_MAX_SYMBOLS?.trim();
  if (!raw) return topAltsUniverse();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return topAltsUniverse();
  return Math.floor(n);
}

function topAltsUniverse(): number {
  const n = Number(process.env.CANDLE_REVERSAL_TOP_ALTS?.trim());
  if (Number.isFinite(n) && n >= 10 && n <= 500) return Math.floor(n);
  return 120;
}

function maxAlertsPerRun(): number {
  const n = Number(process.env.CANDLE_REVERSAL_MAX_ALERTS_PER_RUN?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 100 ? Math.floor(n) : 30;
}

function klineFetchLimit(): number {
  const need = DEFAULT_CANDLE_REVERSAL_1D_ENV.hh200Lookback + DEFAULT_CANDLE_REVERSAL_1D_ENV.hh200ExcludeRecent + 30;
  return Math.min(500, Math.max(220, need));
}

function marubozuAfterDojiWindowDays(): number {
  const n = Number(process.env.CANDLE_REVERSAL_MARUBOZU_AFTER_DOJI_DAYS?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 14 ? Math.floor(n) : 5;
}

function detectEnvFromProcess(): CandleReversal1dDetectEnv {
  const env = { ...DEFAULT_CANDLE_REVERSAL_1D_ENV };
  const wick = Number(process.env.CANDLE_REVERSAL_WICK_MIN_RATIO?.trim());
  if (Number.isFinite(wick) && wick > 0.5 && wick < 0.9) env.wickMinRatio = wick;
  const bodyMax = Number(process.env.CANDLE_REVERSAL_BODY_MAX_RATIO?.trim());
  if (Number.isFinite(bodyMax) && bodyMax > 0.05 && bodyMax < 0.35) env.bodyMaxRatio = bodyMax;
  const tailLb = Number(process.env.CANDLE_REVERSAL_HIGHEST_TAIL_LOOKBACK?.trim());
  if (Number.isFinite(tailLb) && tailLb >= 10 && tailLb <= 120) env.highestTailLookback = Math.floor(tailLb);
  const mbLb = Number(process.env.CANDLE_REVERSAL_MARUBOZU_BODY_LOOKBACK?.trim());
  if (Number.isFinite(mbLb) && mbLb >= 5 && mbLb <= 40) env.marubozuBodyLookback = Math.floor(mbLb);
  return env;
}

function emptySymState(): CandleReversalSymbolState {
  return {
    lastInvertedDoji1dOpenSec: null,
    lastMarubozu1dOpenSec: null,
    lastInvertedDojiAlertedAtMs: null,
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

async function resolveScanSymbols(): Promise<string[]> {
  const cap = maxSymbolsScan();
  if (cap === 0) return fetchAllBinanceUsdmLinearSymbols();
  return fetchTopUsdmUsdtSymbolsByQuoteVolume(cap);
}

type EvalRow = {
  symbol: string;
  signal: CandleReversal1dSignal | null;
  msg: string | null;
  next: CandleReversalSymbolState;
};

function evalSymbol(
  symbol: string,
  st: CandleReversalSymbolState,
  pack: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
  env: CandleReversal1dDetectEnv,
  nowMs: number,
): EvalRow {
  const next: CandleReversalSymbolState = { ...st };
  const n = pack.close.length;
  const i = n - 2;
  if (i < env.hh200Lookback + env.hh200ExcludeRecent + 3) {
    return { symbol, signal: null, msg: null, next };
  }

  const barOpen = pack.timeSec[i]!;
  const dojiWindowMs = marubozuAfterDojiWindowDays() * 24 * 3600 * 1000;
  const hadRecentDoji =
    st.lastInvertedDojiAlertedAtMs != null &&
    nowMs - st.lastInvertedDojiAlertedAtMs <= dojiWindowMs;

  let sig: CandleReversal1dSignal | null = null;

  const marubozu = evalMarubozu1d(pack, i, env, hadRecentDoji);
  if (marubozu && next.lastMarubozu1dOpenSec !== barOpen) {
    sig = marubozu;
    next.lastMarubozu1dOpenSec = barOpen;
  } else {
    const doji = evalInvertedDoji1d(pack, i, env);
    if (doji && next.lastInvertedDoji1dOpenSec !== barOpen) {
      sig = doji;
      next.lastInvertedDoji1dOpenSec = barOpen;
      next.lastInvertedDojiAlertedAtMs = nowMs;
    }
  }

  if (!sig) {
    return { symbol, signal: null, msg: null, next };
  }

  return {
    symbol,
    signal: sig,
    msg: buildCandleReversal1dAlertMessage(symbol, sig),
    next,
  };
}

/**
 * สแกนแท่ง Day ปิดล่าสุด — โดจิกลับหัว + แท่งแดงทุบ (Binance USDT-M) → Telegram topic reversal
 */
export async function runCandleReversal1dAlertTick(nowMs = Date.now()): Promise<number> {
  if (!isCandleReversal1dAlertsEnabled()) return 0;
  if (!isBinanceIndicatorFapiEnabled()) return 0;
  if (!telegramSparkSystemGroupConfigured()) return 0;

  resetBinanceIndicatorFapi451LogDedupe();

  const symbols = await resolveScanSymbols();
  if (symbols.length === 0) return 0;

  let state = await loadCandleReversalAlertState();
  const env = detectEnvFromProcess();
  const limit = klineFetchLimit();
  const concurrency = scanConcurrency();
  const alertCap = maxAlertsPerRun();

  const results = await mapPoolConcurrent(symbols, concurrency, async (symbol) => {
    const st = state[symbol] ?? emptySymState();
    const pack = await fetchBinanceUsdmKlines(symbol, "1d", limit);
    if (!pack) return { symbol, evals: null as EvalRow | null };
    return { symbol, evals: evalSymbol(symbol, st, pack, env, nowMs) };
  });

  for (const row of results) {
    if (!row.evals) continue;
    state = { ...state, [row.symbol]: row.evals.next };
  }

  let notified = 0;
  for (const row of results) {
    if (!row.evals?.msg || !row.evals.signal) continue;
    if (notified >= alertCap) break;
    try {
      const ok = await sendPublicReversalFeedToSparkGroup(row.evals.msg);
      if (ok && isCandleReversalStatsEnabled()) {
        const sig = row.evals.signal;
        await appendCandleReversalStatsRow({
          symbol: row.symbol,
          model: sig.model,
          alertedAtIso: new Date(nowMs).toISOString(),
          alertedAtMs: nowMs,
          signalBarOpenSec: sig.barOpenSec,
          entryPrice: sig.c,
          retestPrice: sig.retestPrice,
          slPrice: sig.slPrice,
          wickRatioPct: sig.model === "inverted_doji" ? sig.wickRatio * 100 : null,
          bodyPct: sig.bodyRatio * 100,
          afterInvertedDoji: sig.afterInvertedDoji,
        });
      }
      if (ok) notified++;
    } catch (e) {
      console.error("[candleReversal1dAlertTick] telegram", row.symbol, e);
    }
  }

  try {
    await saveCandleReversalAlertState(state);
  } catch (e) {
    console.error("[candleReversal1dAlertTick] save state", e);
  }

  if (notified > 0) {
    console.info(`[candleReversal1dAlertTick] sent ${notified} alert(s), scanned ${symbols.length} symbols`);
  }
  return notified;
}

/** Admin debug — ประเมินแท่ง Day ปิดล่าสุดของสัญลักษณ์เดียว */
export async function formatCandleReversal1dDebugMessage(rawSymbol: string): Promise<string> {
  const symbol = rawSymbol.trim().toUpperCase().replace(/^@/, "");
  const sym = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  const lines: string[] = [];
  lines.push("🎯 Candle Reversal 1D — debug (Binance USDM)");
  lines.push(`UTC: ${new Date().toISOString()}`);
  lines.push(`CANDLE_REVERSAL_1D_ALERTS_ENABLED: ${isCandleReversal1dAlertsEnabled() ? "on" : "off"}`);
  lines.push("");

  if (!sym) {
    lines.push("สัญลักษณ์ว่าง");
    return lines.join("\n");
  }

  const pack = await fetchBinanceUsdmKlines(sym, "1d", klineFetchLimit());
  if (!pack) {
    lines.push(`${sym}: klines null`);
    return lines.join("\n");
  }

  const env = detectEnvFromProcess();
  const st = (await loadCandleReversalAlertState())[sym] ?? emptySymState();
  const sig = evalCandleReversal1dClosedBar(pack, env, {
    hadRecentInvertedDoji:
      st.lastInvertedDojiAlertedAtMs != null &&
      Date.now() - st.lastInvertedDojiAlertedAtMs <= marubozuAfterDojiWindowDays() * 86400000,
  });

  lines.push(`— ${sym} —`);
  if (!sig) {
    lines.push("ไม่ผ่านเงื่อนไขโดจิ / แท่งแดงทุบ บนแท่งปิดล่าสุด (i=n-2)");
    return lines.join("\n");
  }

  lines.push(`model: ${sig.model}`);
  lines.push(`wick ${(sig.wickRatio * 100).toFixed(1)}% · body ${(sig.bodyRatio * 100).toFixed(1)}%`);
  lines.push(`retest ${sig.retestPrice} · SL ${sig.slPrice}`);
  lines.push("");
  lines.push(buildCandleReversal1dAlertMessage(sym, sig));
  return lines.join("\n");
}

/** Admin: `debug reversal 1d SYMBOL` / `debug candle reversal BTC` */
export function parseCandleReversal1dDebugCommand(text: string): { symbol: string } | null {
  const t = text.trim();
  let m = t.match(
    /^(?:debug\s+)?(?:candle\s+)?reversal\s+1d(?:@\S+)?\s+(\S+)\s*$/i,
  );
  if (m?.[1]) return { symbol: m[1].trim() };
  m = t.match(/^(?:debug\s+)?reversal\s+alert(?:@\S+)?\s+(\S+)\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim() };
  m = t.match(/^#reversal1ddebug\s+(\S+)\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim() };
  return null;
}
