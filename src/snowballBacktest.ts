import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import {
  binanceIndicatorTfDurationSec,
  fetchBinanceUsdmKlinesPaginated,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
  sliceKlinePackThrough,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import { countGreenDaysBeforeSignalBar, fetchGreenDaysBeforeSignalBar } from "./greenDayStreak";
import { snowballBinanceTf } from "./publicIndicatorFeed";
import {
  applySnowballBacktestFiredKey,
  detectSnowballAtClosedBar,
  type SnowballBacktestFeedState,
  type SnowballDetectHit,
} from "./snowballBacktestDetect";
import { simulateSnowballStatsFollowUp } from "./snowballBacktestFollowUp";
import { fetchSnowballAlertMarketContextAt } from "./snowballMarketContext";
import { buildSnowballStatsRow } from "./snowballStatsRowBuild";
import { snowballStatsSignalDedupeKey, type AppendSnowballStatsInput } from "./snowballStatsStore";

const WARMUP_BARS = 250;
const MAX_SIGNALS = 500;
const MAX_RANGE_MS = 60 * 24 * 3600 * 1000;
const MAX_SYMBOLS_CAP = 20;
const SYMBOL_CONCURRENCY = 4;
const FOLLOW_UP_EXTRA_MS = 49 * 3600 * 1000;

export type RunSnowballBacktestOpts = {
  startMs: number;
  endMs: number;
  symbols?: string[];
  topAlts?: number;
  maxSymbols?: number;
};

export type SnowballBacktestResult = {
  rows: SnowballStatsRow[];
  signalCount: number;
  symbols: string[];
  startMs: number;
  endMs: number;
  truncated: boolean;
};

function closedBarIndicesInRange(
  timeSec: number[],
  barDurSec: number,
  startMs: number,
  endMs: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < timeSec.length; i++) {
    const barCloseMs = (timeSec[i]! + barDurSec) * 1000;
    if (barCloseMs >= startMs && barCloseMs <= endMs) out.push(i);
  }
  return out;
}

async function resolveBacktestUniverse(opts: RunSnowballBacktestOpts): Promise<string[]> {
  const maxSym = Math.min(Math.max(1, opts.maxSymbols ?? MAX_SYMBOLS_CAP), MAX_SYMBOLS_CAP);
  if (opts.symbols?.length) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of opts.symbols) {
      const s = raw.trim().toUpperCase();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= maxSym) break;
    }
    return out;
  }

  const topN = Math.max(0, opts.topAlts ?? 10);
  const top = topN > 0 ? await fetchTopUsdmUsdtSymbolsByQuoteVolume(topN) : [];
  const seen = new Set<string>(["BTCUSDT", "ETHUSDT"]);
  const out = ["BTCUSDT", "ETHUSDT"];
  for (const s of top) {
    if (out.length >= maxSym) break;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, maxSym);
}

function mktCtxToStatsFields(ctx: Awaited<ReturnType<typeof fetchSnowballAlertMarketContextAt>>) {
  return {
    btcPsar4hTrend: ctx.btcPsar4hTrend,
    btcPsar4hClose: ctx.btcPsar4hClose,
    btcPsar1hTrend: ctx.btcPsar1hTrend,
    btcPsar1hClose: ctx.btcPsar1hClose,
    quoteVol24hUsdt: ctx.quoteVol24hUsdt,
    marketCapUsd: ctx.marketCapUsd,
    fundingRate: ctx.fundingRate,
    atrPct14d: ctx.atrPct14d,
    ema4hSlopePct7d: ctx.ema4hSlopePct7d,
    ema1dSlopePct7d: ctx.ema1dSlopePct7d,
    btcEma4hSlopePct7d: ctx.btcEma4hSlopePct7d,
    btcEma1dSlopePct7d: ctx.btcEma1dSlopePct7d,
    psar4hTrend: ctx.psar4hTrend,
    psar4hDistPct: ctx.psar4hDistPct,
  };
}

async function processHit(
  symbol: string,
  hit: SnowballDetectHit,
  barCloseMs: number,
  pack15mFollowUp: BinanceKlinePack,
  pack1d: BinanceKlinePack | null,
  snowTf: "4h",
): Promise<SnowballStatsRow> {
  const alertedAtMs = barCloseMs;
  const alertedAtIso = new Date(alertedAtMs).toISOString();
  const mktCtx = await fetchSnowballAlertMarketContextAt(symbol, alertedAtMs);
  const greenDays =
    pack1d != null
      ? countGreenDaysBeforeSignalBar(pack1d, hit.signalBarOpenSec, snowTf)
      : await fetchGreenDaysBeforeSignalBar(symbol, hit.signalBarOpenSec, snowTf);

  const appendInput: AppendSnowballStatsInput = {
    symbol,
    alertedAtIso,
    alertedAtMs,
    greenDaysBeforeSignal: greenDays,
    ...hit.statsInput,
    ...mktCtxToStatsFields(mktCtx),
  };

  const row = buildSnowballStatsRow(appendInput);
  row.source = "backtest";
  const followUpSlice = sliceKlinePackThrough(
    pack15mFollowUp,
    "15m",
    Math.floor(alertedAtMs / 1000) + FOLLOW_UP_EXTRA_MS / 1000,
  );
  simulateSnowballStatsFollowUp(row, followUpSlice);
  return row;
}

async function backtestSymbol(
  symbol: string,
  startMs: number,
  endMs: number,
  snowTf: "4h",
  barDurSec: number,
  fetchStartMs: number,
  fetchEndMs: number,
  onRow: (row: SnowballStatsRow) => boolean,
): Promise<void> {
  const [pack4hFull, pack1hFull, pack15mFull, pack1d] = await Promise.all([
    fetchBinanceUsdmKlinesPaginated(symbol, snowTf, fetchStartMs, fetchEndMs),
    fetchBinanceUsdmKlinesPaginated(symbol, "1h", fetchStartMs, fetchEndMs),
    fetchBinanceUsdmKlinesPaginated(symbol, "15m", fetchStartMs, fetchEndMs),
    fetchBinanceUsdmKlinesPaginated(symbol, "1d", fetchStartMs - 90 * 86400 * 1000, fetchEndMs),
  ]);

  if (!pack4hFull?.timeSec?.length || pack4hFull.close.length < 3) return;

  const state: SnowballBacktestFeedState = {
    lastFiredBarSec: {},
    lastAlertPrice: {},
  };

  const barIndices = closedBarIndicesInRange(pack4hFull.timeSec, barDurSec, startMs, endMs);
  for (const iClosed of barIndices) {
    const barCloseSec = pack4hFull.timeSec[iClosed]! + barDurSec;
    const barCloseMs = barCloseSec * 1000;

    const pack4h = sliceKlinePackThrough(pack4hFull, snowTf, barCloseSec);
    const pack1h = pack1hFull ? sliceKlinePackThrough(pack1hFull, "1h", barCloseSec) : null;
    const pack15mMom = pack15mFull
      ? sliceKlinePackThrough(pack15mFull, "15m", barCloseSec)
      : null;

    const mktCtx = await fetchSnowballAlertMarketContextAt(symbol, barCloseMs);
    const iSigEstimate = Math.max(0, iClosed - 1);
    const signalBarOpenSecEst = pack4hFull.timeSec[iSigEstimate] ?? 0;
    const greenDays =
      pack1d != null && signalBarOpenSecEst > 0
        ? countGreenDaysBeforeSignalBar(pack1d, signalBarOpenSecEst, snowTf)
        : null;

    const { long, bear } = detectSnowballAtClosedBar({
      symbol,
      iClosed: pack4h.close.length - 1,
      pack4h,
      pack1h,
      pack15mMomentum: pack15mMom,
      state,
      trendGradeInput: {
        ema4hSlopePct7d: mktCtx.ema4hSlopePct7d,
        ema1dSlopePct7d: mktCtx.ema1dSlopePct7d,
        btcEma4hSlopePct7d: mktCtx.btcEma4hSlopePct7d,
        greenDaysBeforeSignal: greenDays,
      },
    });

    for (const hit of [long, bear]) {
      if (!hit) continue;
      const row = await processHit(
        symbol,
        hit,
        barCloseMs,
        pack15mFull ?? { open: [], high: [], low: [], close: [], volume: [], timeSec: [] },
        pack1d,
        snowTf,
      );
      // Walk แท่งเดียวต่อรอบ — อัปเดต state ทุก hit (รวม Grade F) เพื่อให้ wave gate ถัดไปถูกต้อง
      applySnowballBacktestFiredKey(state, hit.feedKey, hit.signalBarOpenSec, hit.entryPrice);
      const stop = !onRow(row);
      if (stop) return;
    }
  }
}

/**
 * Walk 4h closed bars, detect Snowball LONG/BEAR, build stats rows + 48h follow-up simulation.
 */
export async function runSnowballBacktest(opts: RunSnowballBacktestOpts): Promise<SnowballBacktestResult> {
  const startMs = Math.floor(opts.startMs);
  const endMs = Math.floor(opts.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("runSnowballBacktest: invalid startMs/endMs");
  }
  if (endMs - startMs > MAX_RANGE_MS) {
    throw new Error("runSnowballBacktest: range exceeds 60 days");
  }
  if (!isBinanceIndicatorFapiEnabled()) {
    throw new Error("runSnowballBacktest: Binance FAPI disabled");
  }

  const snowTf = snowballBinanceTf();
  if (snowTf !== "4h") {
    throw new Error("runSnowballBacktest: only 4h master TF supported");
  }

  const barDurSec = binanceIndicatorTfDurationSec(snowTf);
  const warmupMs = WARMUP_BARS * barDurSec * 1000;
  const fetchStartMs = startMs - warmupMs;
  const fetchEndMs = endMs + FOLLOW_UP_EXTRA_MS;

  const symbols = await resolveBacktestUniverse(opts);
  const rows: SnowballStatsRow[] = [];
  const seenSignalKeys = new Set<string>();
  let truncated = false;

  const onRow = (row: SnowballStatsRow): boolean => {
    const key = snowballStatsSignalDedupeKey(row);
    if (seenSignalKeys.has(key)) return true;
    seenSignalKeys.add(key);
    rows.push(row);
    if (rows.length >= MAX_SIGNALS) {
      truncated = true;
      return false;
    }
    return true;
  };

  for (let i = 0; i < symbols.length; i += SYMBOL_CONCURRENCY) {
    if (truncated) break;
    const chunk = symbols.slice(i, i + SYMBOL_CONCURRENCY);
    await Promise.all(
      chunk.map((sym) =>
        backtestSymbol(sym, startMs, endMs, snowTf, barDurSec, fetchStartMs, fetchEndMs, onRow),
      ),
    );
  }

  return {
    rows,
    signalCount: rows.length,
    symbols,
    startMs,
    endMs,
    truncated,
  };
}
