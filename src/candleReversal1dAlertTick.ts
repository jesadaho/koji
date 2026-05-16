import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
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
  loadCandleReversalAlertStateWithMeta,
  saveCandleReversalAlertStateWithMeta,
  type CandleReversalAlertState,
  type CandleReversalAlertStateLoaded,
  type CandleReversalSymbolState,
} from "./candleReversalAlertStateStore";
import {
  candleReversalScanSummaryMaxAgeMs,
  emptyCandleReversalTfScanSummaryStats,
  formatCandleReversalScanSummaryMessage,
  isCandleReversalScanSummaryToChatEnabled,
  pushReversalScanErr,
  pushReversalScanSymList,
  type CandleReversalTfScanSummaryStats,
} from "./candleReversalScanSummary";
import {
  appendCandleReversalStatsRow,
  isCandleReversalStatsEnabled,
} from "./candleReversalStatsStore";
import {
  buildCandleReversalAlertMessage,
  DEFAULT_CANDLE_REVERSAL_1D_ENV,
  DEFAULT_CANDLE_REVERSAL_1H_ENV,
  evalCandleReversalClosedBar,
  evalInvertedDoji1d,
  evalInvertedDoji1h,
  evalLongestRedBody1h,
  evalMarubozu1d,
  type CandleReversal1dDetectEnv,
  type CandleReversal1hDetectEnv,
  type CandleReversalModel,
  type CandleReversalSignal,
  type CandleReversalTf,
} from "./candleReversalDetect";
import { snowballVolatilitySnapshotAt } from "./snowballVolatilityMetrics";

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return defaultOn;
}

export function isCandleReversal1dAlertsEnabled(): boolean {
  return envFlagOn("CANDLE_REVERSAL_1D_ALERTS_ENABLED", true);
}

export function isCandleReversal1hAlertsEnabled(): boolean {
  if (process.env.CANDLE_REVERSAL_1H_ALERTS_ENABLED?.trim()) {
    return envFlagOn("CANDLE_REVERSAL_1H_ALERTS_ENABLED", true);
  }
  return isCandleReversal1dAlertsEnabled();
}

function scanConcurrency(): number {
  const n = Number(process.env.CANDLE_REVERSAL_SCAN_CONCURRENCY?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 32 ? Math.floor(n) : 8;
}

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

function klineFetchLimit(tf: CandleReversalTf): number {
  if (tf === "1h") {
    const lb = detectEnv1h().longestRedBodyLookback;
    return Math.min(500, Math.max(130, lb + 110));
  }
  const need = DEFAULT_CANDLE_REVERSAL_1D_ENV.hh200Lookback + DEFAULT_CANDLE_REVERSAL_1D_ENV.hh200ExcludeRecent + 30;
  return Math.min(500, Math.max(110, need));
}

function marubozuAfterDojiWindowMs(tf: CandleReversalTf): number {
  if (tf === "1h") {
    const n = Number(process.env.CANDLE_REVERSAL_1H_MARUBOZU_AFTER_DOJI_HOURS?.trim());
    const h = Number.isFinite(n) && n >= 1 && n <= 72 ? n : 12;
    return h * 3600 * 1000;
  }
  const n = Number(process.env.CANDLE_REVERSAL_MARUBOZU_AFTER_DOJI_DAYS?.trim());
  const d = Number.isFinite(n) && n >= 1 && n <= 14 ? n : 5;
  return d * 24 * 3600 * 1000;
}

function detectEnv1d(): CandleReversal1dDetectEnv {
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

function detectEnv1h(): CandleReversal1hDetectEnv {
  const env = { ...DEFAULT_CANDLE_REVERSAL_1H_ENV };
  const wick = Number(process.env.CANDLE_REVERSAL_1H_WICK_MIN_RATIO?.trim());
  if (Number.isFinite(wick) && wick > 0.5 && wick < 0.9) env.wickMinRatio = wick;
  const bodyMax = Number(process.env.CANDLE_REVERSAL_1H_BODY_MAX_RATIO?.trim());
  if (Number.isFinite(bodyMax) && bodyMax > 0.05 && bodyMax < 0.35) env.bodyMaxRatio = bodyMax;
  const hhLb = Number(process.env.CANDLE_REVERSAL_1H_HIGHEST_HIGH_LOOKBACK?.trim());
  if (Number.isFinite(hhLb) && hhLb >= 8 && hhLb <= 72) env.highestHighLookback = Math.floor(hhLb);
  const redLb = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_RED_LOOKBACK?.trim());
  if (Number.isFinite(redLb) && redLb >= 8 && redLb <= 72) env.longestRedBodyLookback = Math.floor(redLb);
  const redRatio = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_RED_MIN_RATIO?.trim());
  if (Number.isFinite(redRatio) && redRatio > 0.5 && redRatio < 1) env.longestRedBodyMinRatio = redRatio;
  return env;
}

function emptySymState(): CandleReversalSymbolState {
  return {
    lastInvertedDoji1dOpenSec: null,
    lastMarubozu1dOpenSec: null,
    lastInvertedDoji1hOpenSec: null,
    lastLongestRedBody1hOpenSec: null,
    lastInvertedDoji1dAlertedAtMs: null,
    lastInvertedDoji1hAlertedAtMs: null,
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
  signal: CandleReversalSignal | null;
  msg: string | null;
  next: CandleReversalSymbolState;
  rangeScore: number | null;
  wickScore: number | null;
  diag: {
    closedBarOpenSec: number | null;
    skippedBars: boolean;
    invertedDojiPass: boolean;
    marubozuPass: boolean;
    longestRedPass: boolean;
    deduped: boolean;
    dedupedModel: CandleReversalModel | null;
  };
};

function evalSymbolTf(
  symbol: string,
  st: CandleReversalSymbolState,
  pack: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
  tf: CandleReversalTf,
  env1d: CandleReversal1dDetectEnv,
  env1h: CandleReversal1hDetectEnv,
  nowMs: number,
): EvalRow {
  const next: CandleReversalSymbolState = { ...st };
  const n = pack.close.length;
  const i = n - 2;
  const emptyVol = { rangeScore: null as number | null, wickScore: null as number | null };
  const emptyDiag = {
    closedBarOpenSec: null as number | null,
    skippedBars: false,
    invertedDojiPass: false,
    marubozuPass: false,
    longestRedPass: false,
    deduped: false,
    dedupedModel: null as CandleReversalModel | null,
  };

  if (tf === "1d" && i < env1d.hh200Lookback + env1d.hh200ExcludeRecent + 3) {
    return {
      symbol,
      signal: null,
      msg: null,
      next,
      ...emptyVol,
      diag: { ...emptyDiag, skippedBars: true },
    };
  }
  if (tf === "1h" && i < env1h.highestHighLookback + 2) {
    return {
      symbol,
      signal: null,
      msg: null,
      next,
      ...emptyVol,
      diag: { ...emptyDiag, skippedBars: true },
    };
  }

  const vol = snowballVolatilitySnapshotAt(pack.high, pack.low, pack.close, pack.open, i);
  const barOpen = pack.timeSec[i]!;
  const diag = { ...emptyDiag, closedBarOpenSec: barOpen };

  let sig: CandleReversalSignal | null = null;

  if (tf === "1h") {
    const dojiWindowMs = marubozuAfterDojiWindowMs("1h");
    const hadRecentDoji =
      st.lastInvertedDoji1hAlertedAtMs != null &&
      nowMs - st.lastInvertedDoji1hAlertedAtMs <= dojiWindowMs;

    const longest = evalLongestRedBody1h(pack, i, env1h, hadRecentDoji);
    if (longest) {
      diag.longestRedPass = true;
      if (next.lastLongestRedBody1hOpenSec === barOpen) {
        diag.deduped = true;
        diag.dedupedModel = "longest_red_body";
      } else {
        sig = longest;
        next.lastLongestRedBody1hOpenSec = barOpen;
      }
    }
    const doji = evalInvertedDoji1h(pack, i, env1h);
    if (doji) {
      diag.invertedDojiPass = true;
      if (!sig) {
        if (next.lastInvertedDoji1hOpenSec === barOpen) {
          diag.deduped = true;
          diag.dedupedModel = "inverted_doji";
        } else {
          sig = doji;
          next.lastInvertedDoji1hOpenSec = barOpen;
          next.lastInvertedDoji1hAlertedAtMs = nowMs;
        }
      }
    }
  } else {
    const dojiWindowMs = marubozuAfterDojiWindowMs("1d");
    const hadRecentDoji =
      st.lastInvertedDoji1dAlertedAtMs != null &&
      nowMs - st.lastInvertedDoji1dAlertedAtMs <= dojiWindowMs;

    const marubozu = evalMarubozu1d(pack, i, env1d, hadRecentDoji);
    if (marubozu) {
      diag.marubozuPass = true;
      if (next.lastMarubozu1dOpenSec === barOpen) {
        diag.deduped = true;
        diag.dedupedModel = "marubozu";
      } else {
        sig = marubozu;
        next.lastMarubozu1dOpenSec = barOpen;
      }
    }
    const doji = evalInvertedDoji1d(pack, i, env1d);
    if (doji) {
      diag.invertedDojiPass = true;
      if (!sig) {
        if (next.lastInvertedDoji1dOpenSec === barOpen) {
          diag.deduped = true;
          diag.dedupedModel = "inverted_doji";
        } else {
          sig = doji;
          next.lastInvertedDoji1dOpenSec = barOpen;
          next.lastInvertedDoji1dAlertedAtMs = nowMs;
        }
      }
    }
  }

  if (!sig) {
    return {
      symbol,
      signal: null,
      msg: null,
      next,
      rangeScore: vol.rangeScore,
      wickScore: vol.wickScore,
      diag,
    };
  }

  return {
    symbol,
    signal: sig,
    msg: buildCandleReversalAlertMessage(symbol, sig),
    next,
    rangeScore: vol.rangeScore,
    wickScore: vol.wickScore,
    diag,
  };
}

function mergeDiagIntoTfStats(stats: CandleReversalTfScanSummaryStats, symbol: string, diag: EvalRow["diag"]): void {
  if (diag.closedBarOpenSec != null && stats.closedBarOpenSec == null) {
    stats.closedBarOpenSec = diag.closedBarOpenSec;
  }
  if (diag.skippedBars) {
    stats.skippedBars += 1;
    return;
  }
  if (diag.invertedDojiPass) {
    stats.invertedDojiPass += 1;
    pushReversalScanSymList(stats.invertedDojiPassSymbols, symbol);
  }
  if (diag.marubozuPass) {
    stats.marubozuPass += 1;
    pushReversalScanSymList(stats.marubozuPassSymbols, symbol);
  }
  if (diag.longestRedPass) {
    stats.longestRedPass += 1;
    pushReversalScanSymList(stats.longestRedPassSymbols, symbol);
  }
  if (diag.deduped) {
    stats.deduped += 1;
    pushReversalScanSymList(stats.dedupedSymbols, symbol);
  }
}

async function scanTimeframe(
  tf: CandleReversalTf,
  symbols: string[],
  state: CandleReversalAlertState,
  env1d: CandleReversal1dDetectEnv,
  env1h: CandleReversal1hDetectEnv,
  nowMs: number,
  concurrency: number,
): Promise<{
  state: CandleReversalAlertState;
  results: { symbol: string; evals: EvalRow | null }[];
  scanStats: CandleReversalTfScanSummaryStats;
}> {
  const interval: BinanceIndicatorTf = tf;
  const limit = klineFetchLimit(tf);
  const scanStats = emptyCandleReversalTfScanSummaryStats(tf);

  const results = await mapPoolConcurrent(symbols, concurrency, async (symbol) => {
    const st = state[symbol] ?? emptySymState();
    try {
      const pack = await fetchBinanceUsdmKlines(symbol, interval, limit);
      if (!pack) return { symbol, evals: null as EvalRow | null };
      const evals = evalSymbolTf(symbol, st, pack, tf, env1d, env1h, nowMs);
      return { symbol, evals };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { symbol, evals: null, err: `${symbol}: ${msg}` };
    }
  });

  for (const row of results) {
    if (row.err) {
      pushReversalScanErr(scanStats, row.err);
      scanStats.noPack += 1;
      continue;
    }
    if (!row.evals) {
      scanStats.noPack += 1;
      continue;
    }
    scanStats.withPack += 1;
    mergeDiagIntoTfStats(scanStats, row.symbol, row.evals.diag);
  }

  let nextState = { ...state };
  for (const row of results) {
    if (!row.evals) continue;
    nextState = { ...nextState, [row.symbol]: row.evals.next };
  }

  return { state: nextState, results, scanStats };
}

async function notifyResults(
  results: { symbol: string; evals: EvalRow | null }[],
  nowMs: number,
  alertCap: number,
  scanStats: CandleReversalTfScanSummaryStats,
): Promise<number> {
  let notified = 0;
  for (const row of results) {
    if (!row.evals?.msg || !row.evals.signal) continue;
    if (notified >= alertCap) {
      scanStats.cappedByRunLimit += 1;
      pushReversalScanSymList(scanStats.cappedByRunLimitSymbols, row.symbol);
      continue;
    }
    try {
      const ok = await sendPublicReversalFeedToSparkGroup(row.evals.msg);
      if (ok && isCandleReversalStatsEnabled()) {
        const sig = row.evals.signal;
        await appendCandleReversalStatsRow({
          symbol: row.symbol,
          model: sig.model,
          signalBarTf: sig.tf,
          alertedAtIso: new Date(nowMs).toISOString(),
          alertedAtMs: nowMs,
          signalBarOpenSec: sig.barOpenSec,
          entryPrice: sig.c,
          retestPrice: sig.retestPrice,
          slPrice: sig.slPrice,
          wickRatioPct: sig.model === "inverted_doji" ? sig.wickRatio * 100 : null,
          bodyPct: sig.bodyRatio * 100,
          rangeScore: row.evals.rangeScore,
          wickScore: row.evals.wickScore,
          afterInvertedDoji: sig.afterInvertedDoji,
        });
      }
      if (ok) {
        notified++;
        const sig = row.evals.signal;
        scanStats.sent += 1;
        scanStats.sentByModel[sig.model] += 1;
        pushReversalScanSymList(scanStats.sentSymbols, row.symbol);
      }
    } catch (e) {
      const tf = row.evals?.signal?.tf ?? "?";
      console.error("[candleReversalAlertTick] telegram", row.symbol, tf, e);
      pushReversalScanErr(scanStats, `${row.symbol} TG: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return notified;
}

async function maybeSendReversalScanSummary(opts: {
  tf: CandleReversalTf;
  nowMs: number;
  universeLen: number;
  topAltsCap: number;
  scanStats: CandleReversalTfScanSummaryStats;
  alertsSentThisTf: number;
  alertCapPerRun: number;
  loaded: CandleReversalAlertStateLoaded;
  forceResend: boolean;
}): Promise<string | undefined> {
  if (!isCandleReversalScanSummaryToChatEnabled()) return undefined;

  const { tf, nowMs, scanStats } = opts;
  const barOpen = scanStats.closedBarOpenSec;
  if (barOpen == null) return undefined;

  const barDurSec = tf === "1h" ? 3600 : 24 * 3600;
  const barCloseMs = (barOpen + barDurSec) * 1000;
  const tooOld = nowMs - barCloseMs > candleReversalScanSummaryMaxAgeMs(tf);

  const lastKey = tf === "1h" ? "lastScanSummary1hBarOpenSec" : "lastScanSummary1dBarOpenSec";
  const already = opts.loaded.meta[lastKey] === barOpen;

  if (tooOld) {
    if (!already) {
      opts.loaded.meta[lastKey] = barOpen;
    }
    return undefined;
  }

  if (already && !opts.forceResend) return undefined;

  const body = formatCandleReversalScanSummaryMessage({
    iso: new Date(nowMs).toISOString(),
    universeLen: opts.universeLen,
    topAltsCap: opts.topAltsCap,
    stats: scanStats,
    alertsSentThisTf: opts.alertsSentThisTf,
    alertCapPerRun: opts.alertCapPerRun,
  });

  try {
    const ok = await sendPublicReversalFeedToSparkGroup(body);
    console.info(`[candleReversalAlertTick] Reversal ${tf} scan summary (full text follows)\n${body}`);
    if (ok) {
      opts.loaded.meta[lastKey] = barOpen;
      return body;
    }
  } catch (e) {
    console.error("[candleReversalAlertTick] reversal scan summary to chat", tf, e);
  }
  return undefined;
}

export type CandleReversalAlertTickResult = {
  notified: number;
  /** ข้อความสรุปสแกนล่าสุด (รวม 1D+1H ถ้ามีทั้งคู่) */
  scanSummaryText?: string;
};

/** สแกน Reversal 1D + 1H (แท่งปิดล่าสุด) → Telegram topic reversal */
export async function runCandleReversalAlertTick(
  nowMs = Date.now(),
  opts?: { forceScanSummary?: boolean },
): Promise<CandleReversalAlertTickResult> {
  if (!isCandleReversal1dAlertsEnabled() && !isCandleReversal1hAlertsEnabled()) {
    return { notified: 0 };
  }
  if (!isBinanceIndicatorFapiEnabled()) return { notified: 0 };
  if (!telegramSparkSystemGroupConfigured()) return { notified: 0 };

  resetBinanceIndicatorFapi451LogDedupe();

  const symbols = await resolveScanSymbols();
  if (symbols.length === 0) return { notified: 0 };

  const loaded = await loadCandleReversalAlertStateWithMeta();
  let state = loaded.symbols;
  const env1d = detectEnv1d();
  const env1h = detectEnv1h();
  const concurrency = scanConcurrency();
  const alertCap = maxAlertsPerRun();
  const topAltsCap = maxSymbolsScan() || topAltsUniverse();
  const summaryParts: string[] = [];

  let notified = 0;

  if (isCandleReversal1dAlertsEnabled()) {
    const r1d = await scanTimeframe("1d", symbols, state, env1d, env1h, nowMs, concurrency);
    state = r1d.state;
    const n1d = await notifyResults(r1d.results, nowMs, alertCap, r1d.scanStats);
    notified += n1d;
    const sum1d = await maybeSendReversalScanSummary({
      tf: "1d",
      nowMs,
      universeLen: symbols.length,
      topAltsCap,
      scanStats: r1d.scanStats,
      alertsSentThisTf: n1d,
      alertCapPerRun: alertCap,
      loaded,
      forceResend: Boolean(opts?.forceScanSummary),
    });
    if (sum1d) summaryParts.push(sum1d);
  }

  if (isCandleReversal1hAlertsEnabled()) {
    const r1h = await scanTimeframe("1h", symbols, state, env1d, env1h, nowMs, concurrency);
    state = r1h.state;
    const n1h = await notifyResults(r1h.results, nowMs, Math.max(0, alertCap - notified), r1h.scanStats);
    notified += n1h;
    const sum1h = await maybeSendReversalScanSummary({
      tf: "1h",
      nowMs,
      universeLen: symbols.length,
      topAltsCap,
      scanStats: r1h.scanStats,
      alertsSentThisTf: n1h,
      alertCapPerRun: alertCap,
      loaded,
      forceResend: Boolean(opts?.forceScanSummary),
    });
    if (sum1h) summaryParts.push(sum1h);
  }

  loaded.symbols = state;
  try {
    await saveCandleReversalAlertStateWithMeta(loaded);
  } catch (e) {
    console.error("[candleReversalAlertTick] save state", e);
  }

  if (notified > 0) {
    console.info(`[candleReversalAlertTick] sent ${notified} alert(s), scanned ${symbols.length} symbols`);
  }

  return {
    notified,
    ...(summaryParts.length > 0 ? { scanSummaryText: summaryParts.join("\n\n") } : {}),
  };
}

/** @deprecated alias — คืนเฉพาะจำนวนแจ้งเตือน */
export async function runCandleReversal1dAlertTick(
  nowMs?: number,
  opts?: { forceScanSummary?: boolean },
): Promise<number> {
  const r = await runCandleReversalAlertTick(nowMs, opts);
  return r.notified;
}

async function formatDebugForTf(sym: string, tf: CandleReversalTf): Promise<string[]> {
  const lines: string[] = [];
  const pack = await fetchBinanceUsdmKlines(sym, tf, klineFetchLimit(tf));
  if (!pack) {
    lines.push(`${tf}: klines null`);
    return lines;
  }
  const env1d = detectEnv1d();
  const env1h = detectEnv1h();
  const st = (await loadCandleReversalAlertState())[sym] ?? emptySymState();
  const hadDoji =
    tf === "1h"
      ? st.lastInvertedDoji1hAlertedAtMs != null &&
        Date.now() - st.lastInvertedDoji1hAlertedAtMs <= marubozuAfterDojiWindowMs("1h")
      : st.lastInvertedDoji1dAlertedAtMs != null &&
        Date.now() - st.lastInvertedDoji1dAlertedAtMs <= marubozuAfterDojiWindowMs("1d");

  const sig = evalCandleReversalClosedBar(tf, pack, env1d, env1h, { hadRecentInvertedDoji: hadDoji });
  lines.push(`— ${tf} —`);
  if (!sig) {
    lines.push("ไม่ผ่านเงื่อนไขบนแท่งปิดล่าสุด (i=n-2)");
    return lines;
  }
  lines.push(`model: ${sig.model}`);
  lines.push(`wick ${(sig.wickRatio * 100).toFixed(1)}% · body ${(sig.bodyRatio * 100).toFixed(1)}%`);
  lines.push(`retest ${sig.retestPrice} · SL ${sig.slPrice}`);
  lines.push("");
  lines.push(buildCandleReversalAlertMessage(sym, sig));
  return lines;
}

export async function formatCandleReversalDebugMessage(rawSymbol: string, tf?: CandleReversalTf): Promise<string> {
  const symbol = rawSymbol.trim().toUpperCase().replace(/^@/, "");
  const sym = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  const lines: string[] = [];
  lines.push("🎯 Candle Reversal — debug (Binance USDM)");
  lines.push(`UTC: ${new Date().toISOString()}`);
  lines.push(`1D: ${isCandleReversal1dAlertsEnabled() ? "on" : "off"} · 1H: ${isCandleReversal1hAlertsEnabled() ? "on" : "off"}`);
  lines.push("");

  if (!sym) {
    lines.push("สัญลักษณ์ว่าง");
    return lines.join("\n");
  }

  if (tf === "1d" || tf === "1h") {
    lines.push(...(await formatDebugForTf(sym, tf)));
    return lines.join("\n");
  }

  lines.push(...(await formatDebugForTf(sym, "1d")));
  lines.push("");
  lines.push(...(await formatDebugForTf(sym, "1h")));
  return lines.join("\n");
}

/** @deprecated */
export const formatCandleReversal1dDebugMessage = (rawSymbol: string) =>
  formatCandleReversalDebugMessage(rawSymbol, "1d");

export function parseCandleReversalDebugCommand(text: string): { symbol: string; tf?: CandleReversalTf } | null {
  const t = text.trim();
  let m = t.match(/^(?:debug\s+)?(?:candle\s+)?reversal\s+1h(?:@\S+)?\s+(\S+)\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim(), tf: "1h" };
  m = t.match(/^(?:debug\s+)?(?:candle\s+)?reversal\s+1d(?:@\S+)?\s+(\S+)\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim(), tf: "1d" };
  m = t.match(/^(?:debug\s+)?reversal\s+alert(?:@\S+)?\s+(\S+)\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim() };
  m = t.match(/^#reversal1hdebug\s+(\S+)\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim(), tf: "1h" };
  m = t.match(/^#reversal1ddebug\s+(\S+)\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim(), tf: "1d" };
  return null;
}

/** @deprecated */
export const parseCandleReversal1dDebugCommand = (text: string) => {
  const r = parseCandleReversalDebugCommand(text);
  if (!r) return null;
  if (r.tf === "1h") return null;
  return { symbol: r.symbol };
};
