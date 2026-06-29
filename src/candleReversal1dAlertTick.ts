import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
import {
  buildBinanceUsdmSymbolMetaMap,
  fetchAllBinanceUsdmLinearSymbols,
  fetchBinanceUsdmKlines,
  fetchTopUsdmUsdtSymbolsByQuoteVolume,
  isBinanceIndicatorFapiEnabled,
  lookupBinanceUsdmSymbolMeta,
  resetBinanceIndicatorFapi451LogDedupe,
} from "./binanceIndicatorKline";
import { resolveMexcContractFromBinanceSymbolAsync } from "./mexcContractResolver";
import { reversalShouldSkipAutoOpenForAsset } from "./tradFiSymbolFilter";
import { sendPublicReversalFeedToSparkGroup } from "./alertNotify";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import {
  loadCandleReversalAlertState,
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
  candleReversalStatsAnchorCloseSec,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { reversalIsObserveSignal, reversalResolveObserveReason } from "@/lib/reversalStatsPlayMode";
import { statsBarRangePctSignal } from "@/lib/statsBarRangePct";
import { resolvePumpCycleSwingLowFields } from "./statsPumpCycleSwingLow";
import { formatCandleReversalTfDebugBlock } from "./candleReversalDebugFormat";
import {
  buildCandleReversalAlertMessage,
  DEFAULT_CANDLE_REVERSAL_1D_ENV,
  DEFAULT_CANDLE_REVERSAL_1H_ENV,
  candleReversalBarIndexBarsAgo,
  candleReversalLatestClosedBarIndex,
  evalCandleReversalAtBarIndex,
  evalCandleReversalClosedBar,
  evalInvertedDoji1d,
  evalInvertedDoji1h,
  evalLongestRedBody1h,
  evalLongestGreenBody1h,
  evalMarubozu1d,
  DEFAULT_CANDLE_REVERSAL_1H_LONG_ENV,
  type CandleReversal1dDetectEnv,
  type CandleReversal1hDetectEnv,
  type CandleReversal1hLongDetectEnv,
  type CandleReversalModel,
  type CandleReversalSignal,
  type CandleReversalTf,
} from "./candleReversalDetect";
import { fetchGreenDaysBeforeReversalSignal } from "./candleReversalGreenDayStreak";
import { BKK_DAY_TZ_OFFSET_SEC } from "./greenDayStreak";
import { candleReversalSignalVolVsSmaAt } from "./candleReversalSignalVolVsSma";
import { snowballVolatilitySnapshotAt } from "./snowballVolatilityMetrics";
import { fetchReversalAlertMarketSnapshot } from "./reversalMarketContext";
import { runReversalAutoTradeAfterReversalAlert } from "./reversalAutoTradeExecutor";
import { backfillReversalKlineAiAnalysis } from "./reversalKlineAiAnalysis";

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

export function isCandleReversal1hLongAlertsEnabled(): boolean {
  if (process.env.CANDLE_REVERSAL_1H_LONG_ALERTS_ENABLED?.trim()) {
    return envFlagOn("CANDLE_REVERSAL_1H_LONG_ALERTS_ENABLED", true);
  }
  return isCandleReversal1hAlertsEnabled();
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
  return 150;
}

function maxAlertsPerRun(): number {
  const n = Number(process.env.CANDLE_REVERSAL_MAX_ALERTS_PER_RUN?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 100 ? Math.floor(n) : 30;
}

function klineFetchLimit(tf: CandleReversalTf): number {
  if (tf === "1h") {
    const env1h = detectEnv1h();
    const envLong = detectEnv1hLong();
    const lb = Math.max(
      env1h.highestHighLookback,
      env1h.longestRedBodyLookback,
      env1h.emaPeriod,
      envLong.longestGreenBodyLookback,
      envLong.emaPeriod,
    );
    return Math.min(500, Math.max(220, lb + 30));
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
  if (Number.isFinite(mbLb) && mbLb >= 8 && mbLb <= 120) env.marubozuBodyLookback = Math.floor(mbLb);
  const engulf = Number(process.env.CANDLE_REVERSAL_MARUBOZU_ENGULF_MIN_RATIO?.trim());
  if (Number.isFinite(engulf) && engulf >= 0.5 && engulf <= 1) env.marubozuEngulfMinRatio = engulf;
  const volRankMax = Number(process.env.CANDLE_REVERSAL_MARUBOZU_VOL_RANK_MAX?.trim());
  if (Number.isFinite(volRankMax) && volRankMax >= 1 && volRankMax <= 5) {
    env.marubozuVolRankMax = Math.floor(volRankMax);
  }
  return env;
}

function detectEnv1h(): CandleReversal1hDetectEnv {
  const env = { ...DEFAULT_CANDLE_REVERSAL_1H_ENV };
  env.invertedDojiVolTiers = [
    { ...DEFAULT_CANDLE_REVERSAL_1H_ENV.invertedDojiVolTiers[0] },
    { ...DEFAULT_CANDLE_REVERSAL_1H_ENV.invertedDojiVolTiers[1] },
  ];
  const wick = Number(process.env.CANDLE_REVERSAL_1H_WICK_MIN_RATIO?.trim());
  if (Number.isFinite(wick) && wick > 0.5 && wick < 0.9) {
    env.wickMinRatio = wick;
    env.invertedDojiVolTiers[0].wickMinRatio = wick;
  }
  const bodyMax = Number(process.env.CANDLE_REVERSAL_1H_BODY_MAX_RATIO?.trim());
  if (Number.isFinite(bodyMax) && bodyMax > 0.05 && bodyMax < 0.35) {
    env.bodyMaxRatio = bodyMax;
    env.invertedDojiVolTiers[0].bodyMaxRatio = bodyMax;
  }
  const tierABody = Number(process.env.CANDLE_REVERSAL_1H_INVERTED_DOJI_TIER_A_BODY_MAX?.trim());
  if (Number.isFinite(tierABody) && tierABody > 0.05 && tierABody < 0.5) {
    env.invertedDojiVolTiers[0].bodyMaxRatio = tierABody;
  }
  const tierAWick = Number(process.env.CANDLE_REVERSAL_1H_INVERTED_DOJI_TIER_A_WICK_MIN?.trim());
  if (Number.isFinite(tierAWick) && tierAWick > 0.4 && tierAWick < 0.9) {
    env.invertedDojiVolTiers[0].wickMinRatio = tierAWick;
  }
  const tierAVol = Number(process.env.CANDLE_REVERSAL_1H_INVERTED_DOJI_TIER_A_VOL_MIN?.trim());
  if (Number.isFinite(tierAVol) && tierAVol > 0.5 && tierAVol < 20) {
    env.invertedDojiVolTiers[0].volVsSmaMin = tierAVol;
  }
  const tierBBody = Number(process.env.CANDLE_REVERSAL_1H_INVERTED_DOJI_TIER_B_BODY_MAX?.trim());
  if (Number.isFinite(tierBBody) && tierBBody > 0.05 && tierBBody < 0.5) {
    env.invertedDojiVolTiers[1].bodyMaxRatio = tierBBody;
  }
  const tierBWick = Number(process.env.CANDLE_REVERSAL_1H_INVERTED_DOJI_TIER_B_WICK_MIN?.trim());
  if (Number.isFinite(tierBWick) && tierBWick > 0.4 && tierBWick < 0.9) {
    env.invertedDojiVolTiers[1].wickMinRatio = tierBWick;
  }
  const tierBVol = Number(process.env.CANDLE_REVERSAL_1H_INVERTED_DOJI_TIER_B_VOL_MIN?.trim());
  if (Number.isFinite(tierBVol) && tierBVol > 0.5 && tierBVol < 20) {
    env.invertedDojiVolTiers[1].volVsSmaMin = tierBVol;
  }
  const volSmaPeriod = Number(process.env.CANDLE_REVERSAL_1H_INVERTED_DOJI_VOL_SMA_PERIOD?.trim());
  if (Number.isFinite(volSmaPeriod) && volSmaPeriod >= 3 && volSmaPeriod <= 200) {
    env.invertedDojiVolSmaPeriod = Math.floor(volSmaPeriod);
  }
  const hhLb = Number(process.env.CANDLE_REVERSAL_1H_HIGHEST_HIGH_LOOKBACK?.trim());
  if (Number.isFinite(hhLb) && hhLb >= 8 && hhLb <= 500) env.highestHighLookback = Math.floor(hhLb);
  const redLb = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_RED_LOOKBACK?.trim());
  if (Number.isFinite(redLb) && redLb >= 8 && redLb <= 500) env.longestRedBodyLookback = Math.floor(redLb);
  const redRatio = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_RED_MIN_RATIO?.trim());
  if (Number.isFinite(redRatio) && redRatio > 0.5 && redRatio < 1) env.longestRedBodyMinRatio = redRatio;
  const highRankMax = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_RED_HIGH_RANK_MAX?.trim());
  if (Number.isFinite(highRankMax) && highRankMax >= 1 && highRankMax <= 5) {
    env.longestRedBodyHighRankMax = Math.floor(highRankMax);
  }
  const highRankMaxLen1 = Number(
    process.env.CANDLE_REVERSAL_1H_LONGEST_RED_HIGH_RANK_MAX_WHEN_LEN_RANK_1?.trim(),
  );
  if (Number.isFinite(highRankMaxLen1) && highRankMaxLen1 >= 1 && highRankMaxLen1 <= 20) {
    env.longestRedBodyHighRankMaxWhenLenRank1 = Math.floor(highRankMaxLen1);
  }
  const emaAbove = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_RED_EMA_ABOVE_MAX_PCT?.trim());
  if (Number.isFinite(emaAbove) && emaAbove >= 0 && emaAbove <= 30) {
    env.longestRedBodyEmaDistAboveMaxPct = emaAbove;
  }
  const emaBelow = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_RED_EMA_BELOW_MAX_PCT?.trim());
  if (Number.isFinite(emaBelow) && emaBelow >= 0 && emaBelow <= 15) {
    env.longestRedBodyEmaDistBelowMaxPct = emaBelow;
  }
  return env;
}

function detectEnv1hLong(): CandleReversal1hLongDetectEnv {
  const env = { ...DEFAULT_CANDLE_REVERSAL_1H_LONG_ENV };
  const greenLb = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_GREEN_LOOKBACK?.trim());
  if (Number.isFinite(greenLb) && greenLb >= 8 && greenLb <= 120) {
    env.longestGreenBodyLookback = Math.floor(greenLb);
  }
  const greenRatio = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_GREEN_MIN_RATIO?.trim());
  if (Number.isFinite(greenRatio) && greenRatio > 0.5 && greenRatio < 1) {
    env.longestGreenBodyMinRatio = greenRatio;
  }
  const lowRankMax = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_GREEN_LOW_RANK_MAX?.trim());
  if (Number.isFinite(lowRankMax) && lowRankMax >= 1 && lowRankMax <= 5) {
    env.longestGreenBodyLowRankMax = Math.floor(lowRankMax);
  }
  const emaAbove = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_GREEN_EMA_ABOVE_MAX_PCT?.trim());
  if (Number.isFinite(emaAbove) && emaAbove >= 0 && emaAbove <= 30) {
    env.longestGreenBodyEmaDistAboveMaxPct = emaAbove;
  }
  const emaBelow = Number(process.env.CANDLE_REVERSAL_1H_LONGEST_GREEN_EMA_BELOW_MAX_PCT?.trim());
  if (Number.isFinite(emaBelow) && emaBelow >= 0 && emaBelow <= 30) {
    env.longestGreenBodyEmaDistBelowMaxPct = emaBelow;
  }
  return env;
}

function emptySymState(): CandleReversalSymbolState {
  return {
    lastInvertedDoji1dOpenSec: null,
    lastMarubozu1dOpenSec: null,
    lastInvertedDoji1hOpenSec: null,
    lastLongestRedBody1hOpenSec: null,
    lastLongestGreenBody1hOpenSec: null,
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
  signalVolVsSma: number | null;
  diag: {
    closedBarOpenSec: number | null;
    skippedBars: boolean;
    invertedDojiPass: boolean;
    marubozuPass: boolean;
    longestRedPass: boolean;
    longestGreenPass: boolean;
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
  const emptyVol = {
    rangeScore: null as number | null,
    wickScore: null as number | null,
    signalVolVsSma: null as number | null,
  };
  const emptyDiag = {
    closedBarOpenSec: null as number | null,
    skippedBars: false,
    invertedDojiPass: false,
    marubozuPass: false,
    longestRedPass: false,
    longestGreenPass: false,
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
  const min1hBars =
    Math.max(env1h.highestHighLookback, env1h.longestRedBodyLookback, env1h.emaPeriod) + 2;
  if (tf === "1h" && i < min1hBars) {
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
  const signalVolVsSma = candleReversalSignalVolVsSmaAt(pack, i);
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
      signalVolVsSma,
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
    signalVolVsSma,
    diag,
  };
}

function evalSymbolTfLong1h(
  symbol: string,
  st: CandleReversalSymbolState,
  pack: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
  envLong: CandleReversal1hLongDetectEnv,
): EvalRow {
  const next: CandleReversalSymbolState = { ...st };
  const n = pack.close.length;
  const i = n - 2;
  const emptyVol = {
    rangeScore: null as number | null,
    wickScore: null as number | null,
    signalVolVsSma: null as number | null,
  };
  const emptyDiag = {
    closedBarOpenSec: null as number | null,
    skippedBars: false,
    invertedDojiPass: false,
    marubozuPass: false,
    longestRedPass: false,
    longestGreenPass: false,
    deduped: false,
    dedupedModel: null as CandleReversalModel | null,
  };

  const minBars = Math.max(envLong.longestGreenBodyLookback, envLong.emaPeriod) + 2;
  if (i < minBars) {
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
  const signalVolVsSma = candleReversalSignalVolVsSmaAt(pack, i);
  const barOpen = pack.timeSec[i]!;
  const diag = { ...emptyDiag, closedBarOpenSec: barOpen };

  const green = evalLongestGreenBody1h(pack, i, envLong);
  if (green) {
    diag.longestGreenPass = true;
    if (next.lastLongestGreenBody1hOpenSec === barOpen) {
      diag.deduped = true;
      diag.dedupedModel = "longest_green_body";
      return {
        symbol,
        signal: null,
        msg: null,
        next,
        rangeScore: vol.rangeScore,
        wickScore: vol.wickScore,
        signalVolVsSma,
        diag,
      };
    }
    next.lastLongestGreenBody1hOpenSec = barOpen;
    return {
      symbol,
      signal: green,
      msg: buildCandleReversalAlertMessage(symbol, green),
      next,
      rangeScore: vol.rangeScore,
      wickScore: vol.wickScore,
      signalVolVsSma,
      diag,
    };
  }

  return {
    symbol,
    signal: null,
    msg: null,
    next,
    rangeScore: vol.rangeScore,
    wickScore: vol.wickScore,
    signalVolVsSma,
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
  if (diag.longestGreenPass) {
    stats.longestGreenPass += 1;
    pushReversalScanSymList(stats.longestGreenPassSymbols, symbol);
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
  env1hLong: CandleReversal1hLongDetectEnv,
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
  const scanLong1h = tf === "1h" && isCandleReversal1hLongAlertsEnabled();

  const poolRows = await mapPoolConcurrent(symbols, concurrency, async (symbol) => {
    const st = state[symbol] ?? emptySymState();
    try {
      const pack = await fetchBinanceUsdmKlines(symbol, interval, limit);
      if (!pack) return { symbol, shortEvals: null as EvalRow | null, longEvals: null as EvalRow | null };
      const shortEvals = evalSymbolTf(symbol, st, pack, tf, env1d, env1h, nowMs);
      const longEvals = scanLong1h ? evalSymbolTfLong1h(symbol, shortEvals.next, pack, env1hLong) : null;
      const mergedNext = {
        ...shortEvals.next,
        ...(longEvals?.next ?? {}),
      };
      return { symbol, shortEvals, longEvals, mergedNext };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { symbol, shortEvals: null, longEvals: null, err: `${symbol}: ${msg}` };
    }
  });

  const results: { symbol: string; evals: EvalRow | null }[] = [];
  for (const row of poolRows) {
    if (row.err) {
      pushReversalScanErr(scanStats, row.err);
      scanStats.noPack += 1;
      continue;
    }
    if (!row.shortEvals) {
      scanStats.noPack += 1;
      continue;
    }
    scanStats.withPack += 1;
    mergeDiagIntoTfStats(scanStats, row.symbol, row.shortEvals.diag);
    results.push({ symbol: row.symbol, evals: row.shortEvals });
    if (row.longEvals) {
      mergeDiagIntoTfStats(scanStats, row.symbol, row.longEvals.diag);
      results.push({ symbol: row.symbol, evals: row.longEvals });
    }
  }

  let nextState = { ...state };
  for (const row of poolRows) {
    if (!row.shortEvals || !row.mergedNext) continue;
    nextState = { ...nextState, [row.symbol]: row.mergedNext };
  }

  return { state: nextState, results, scanStats };
}

type NotifyResultsOutcome = {
  notified: number;
  appendedForAi: CandleReversalStatsRow[];
};

async function notifyResults(
  results: { symbol: string; evals: EvalRow | null }[],
  nowMs: number,
  alertCap: number,
  scanStats: CandleReversalTfScanSummaryStats,
): Promise<NotifyResultsOutcome> {
  let notified = 0;
  const appendedForAi: CandleReversalStatsRow[] = [];
  const assetMetaMap = await buildBinanceUsdmSymbolMetaMap();

  for (const row of results) {
    if (!row.evals?.msg || !row.evals.signal) continue;

    const sig = row.evals.signal;
    const tradeSide = sig.tradeSide ?? "short";

    const barRangePctSignal = statsBarRangePctSignal(sig.h, sig.l, sig.c);

    try {
      const [greenDaysBeforeSignal, greenDaysBeforeSignalBkk, mktSnap] = await Promise.all([
        fetchGreenDaysBeforeReversalSignal(row.symbol, sig.barOpenSec, sig.tf),
        fetchGreenDaysBeforeReversalSignal(row.symbol, sig.barOpenSec, sig.tf, {
          dayTzOffsetSec: BKK_DAY_TZ_OFFSET_SEC,
        }),
        fetchReversalAlertMarketSnapshot(row.symbol),
      ]);
      const ema4hSlopePct7d =
        mktSnap.ema4hSlopePct7d != null && Number.isFinite(mktSnap.ema4hSlopePct7d)
          ? mktSnap.ema4hSlopePct7d
          : null;
      const btcEma1dSlopePct7d =
        mktSnap.btcEma1dSlopePct7d != null && Number.isFinite(mktSnap.btcEma1dSlopePct7d)
          ? mktSnap.btcEma1dSlopePct7d
          : null;
      const btcEma4hSlopePct7d =
        mktSnap.btcEma4hSlopePct7d != null && Number.isFinite(mktSnap.btcEma4hSlopePct7d)
          ? mktSnap.btcEma4hSlopePct7d
          : null;
      const atrPct14d =
        mktSnap.atrPct14d != null && Number.isFinite(mktSnap.atrPct14d) && mktSnap.atrPct14d > 0
          ? mktSnap.atrPct14d
          : null;
      const binSym = row.symbol.trim().toUpperCase();
      const assetMeta = assetMetaMap.get(binSym) ?? null;
      const anchorCloseSec = candleReversalStatsAnchorCloseSec({
        signalBarOpenSec: sig.barOpenSec,
        signalBarTf: sig.tf,
      });
      const pumpCycleFields = await resolvePumpCycleSwingLowFields({
        symbol: row.symbol,
        signalAtSec: anchorCloseSec,
        entryPrice: sig.c,
      });

      const statsAppendInput = {
        symbol: row.symbol,
        model: sig.model,
        tradeSide,
        signalBarTf: sig.tf,
        alertedAtIso: new Date(nowMs).toISOString(),
        alertedAtMs: nowMs,
        signalBarOpenSec: sig.barOpenSec,
        entryPrice: sig.c,
        retestPrice: sig.retestPrice,
        slPrice: sig.slPrice,
        wickRatioPct: Number.isFinite(sig.wickRatio) ? sig.wickRatio * 100 : null,
        lowerWickRatioPct:
          tradeSide === "short" && sig.lowerWickRatio != null && Number.isFinite(sig.lowerWickRatio)
            ? sig.lowerWickRatio * 100
            : null,
        signalBarHigh: Number.isFinite(sig.h) && sig.h > 0 ? sig.h : null,
        signalBarLow: Number.isFinite(sig.l) && sig.l > 0 ? sig.l : null,
        bodyPct: sig.bodyRatio * 100,
        highRankInLookback: sig.highRankInLookback ?? null,
        lowRankInLookback: sig.lowRankInLookback ?? null,
        rangeRankInLookback: sig.rangeRankInLookback ?? null,
        lookbackBars: sig.lookbackBars ?? null,
        barRangePctSignal,
        volRankInLookback: sig.volRankInLookback ?? null,
        signalVolVsSma: row.evals.signalVolVsSma,
        rangeScore: row.evals.rangeScore,
        wickScore: row.evals.wickScore,
        afterInvertedDoji: sig.afterInvertedDoji,
        greenDaysBeforeSignal,
        greenDaysBeforeSignalBkk,
        isTradFi: assetMeta?.isTradFi === true,
        ...pumpCycleFields,
      } as const;

      const isObserve = reversalIsObserveSignal({
        signalBarTf: sig.tf,
        tradeSide,
        barRangePctSignal,
        ema20_1hSlopePct7d: mktSnap.ema20_1hSlopePct7d,
        trendGainPct: pumpCycleFields.trendGainPct,
        ema20_4hSlopePct7d: mktSnap.ema20_4hSlopePct7d,
        ema4hSlopePct7d: mktSnap.ema4hSlopePct7d,
        ageOfTrendHours: pumpCycleFields.ageOfTrendHours,
        signalVolVsSma: row.evals.signalVolVsSma,
        priceVsEma20_1hPct: mktSnap.priceVsEma20_1hPct,
        priceVsEma20_4hPct: mktSnap.priceVsEma20_4hPct,
        wickRatio: sig.wickRatio,
        lowerWickRatio: sig.lowerWickRatio,
      });
      const observeReason = reversalResolveObserveReason({
        signalBarTf: sig.tf,
        tradeSide,
        barRangePctSignal,
        ema20_1hSlopePct7d: mktSnap.ema20_1hSlopePct7d,
        trendGainPct: pumpCycleFields.trendGainPct,
        ema20_4hSlopePct7d: mktSnap.ema20_4hSlopePct7d,
        ema4hSlopePct7d: mktSnap.ema4hSlopePct7d,
        ageOfTrendHours: pumpCycleFields.ageOfTrendHours,
        signalVolVsSma: row.evals.signalVolVsSma,
        priceVsEma20_1hPct: mktSnap.priceVsEma20_1hPct,
        priceVsEma20_4hPct: mktSnap.priceVsEma20_4hPct,
        wickRatio: sig.wickRatio,
        lowerWickRatio: sig.lowerWickRatio,
      });

      if (isObserve) {
        if (isCandleReversalStatsEnabled()) {
          const appended = await appendCandleReversalStatsRow({
            ...statsAppendInput,
            statsPlayMode: "observe",
            observeReason,
          });
          if (appended) {
            scanStats.observeStored += 1;
            pushReversalScanSymList(scanStats.observeStoredSymbols, row.symbol);
            if (sig.tf === "1h" && tradeSide === "short") {
              appendedForAi.push(appended);
            }
          }
        }
        continue;
      }

      if (notified >= alertCap) {
        scanStats.cappedByRunLimit += 1;
        pushReversalScanSymList(scanStats.cappedByRunLimitSymbols, row.symbol);
        continue;
      }

      const [mexcContract] = await Promise.all([
        resolveMexcContractFromBinanceSymbolAsync(binSym),
      ]);
      const msg = buildCandleReversalAlertMessage(row.symbol, sig, {
        greenDaysBeforeSignal,
        rangeScore: row.evals.rangeScore,
        ema4hSlopePct7d,
        btcEma1dSlopePct7d,
        btcEma4hSlopePct7d,
        atrPct14d,
        trendGainPct: pumpCycleFields.trendGainPct,
        ageOfTrendHours: pumpCycleFields.ageOfTrendHours,
        signalVolVsSma: row.evals.signalVolVsSma,
        alertedAtMs: anchorCloseSec * 1000,
        assetMeta,
        mexcContractSymbol: mexcContract,
      });
      const ok = await sendPublicReversalFeedToSparkGroup(msg);
      if (ok && isCandleReversalStatsEnabled()) {
        const appended = await appendCandleReversalStatsRow(statsAppendInput);
        if (appended && sig.tf === "1h" && tradeSide === "short") {
          appendedForAi.push(appended);
        }
      }
      if (ok) {
        notified++;
        scanStats.sent += 1;
        scanStats.sentByModel[sig.model] = (scanStats.sentByModel[sig.model] ?? 0) + 1;
        pushReversalScanSymList(scanStats.sentSymbols, row.symbol);

        try {
          if (
            reversalShouldSkipAutoOpenForAsset({
              isTradFi: assetMeta?.isTradFi === true,
              mexcContractSymbol: mexcContract,
            })
          ) {
            continue;
          }
          await runReversalAutoTradeAfterReversalAlert({
            alertTradeSide: tradeSide,
            binanceSymbol: row.symbol,
            signalBarTf: sig.tf,
            model: sig.model,
            signalBarOpenSec: sig.barOpenSec,
            bodyRatio: sig.bodyRatio,
            wickRatio: sig.wickRatio,
            rangeScore: row.evals.rangeScore,
            rangeRankInLookback: sig.rangeRankInLookback ?? null,
            greenDaysBeforeSignal,
            ema4hSlopePct7d,
            btcEma1dSlopePct7d,
            btcEma4hSlopePct7d,
            atrPct14d,
            trendGainPct: pumpCycleFields.trendGainPct,
            ageOfTrendHours: pumpCycleFields.ageOfTrendHours,
            signalVolVsSma: row.evals.signalVolVsSma,
            barRangePctSignal,
            priceVsEma20_1hPct: mktSnap.priceVsEma20_1hPct,
            ema20_1hSlopePct7d: mktSnap.ema20_1hSlopePct7d,
            priceVsEma20_4hPct: mktSnap.priceVsEma20_4hPct,
            ema20_4hSlopePct7d: mktSnap.ema20_4hSlopePct7d,
            lowerWickRatioPct:
              tradeSide === "short" &&
              sig.lowerWickRatio != null &&
              Number.isFinite(sig.lowerWickRatio)
                ? sig.lowerWickRatio * 100
                : null,
            alertedAtMs: nowMs,
            signalClosePrice: sig.c,
          });
        } catch (e) {
          console.error("[candleReversalAlertTick] reversal autotrade", row.symbol, sig.tf, tradeSide, e);
        }
      }
    } catch (e) {
      const tf = row.evals?.signal?.tf ?? "?";
      console.error("[candleReversalAlertTick] telegram", row.symbol, tf, e);
      pushReversalScanErr(scanStats, `${row.symbol} TG: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { notified, appendedForAi };
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
  if (
    !isCandleReversal1dAlertsEnabled() &&
    !isCandleReversal1hAlertsEnabled() &&
    !isCandleReversal1hLongAlertsEnabled()
  ) {
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
  const env1hLong = detectEnv1hLong();
  const concurrency = scanConcurrency();
  const alertCap = maxAlertsPerRun();
  const topAltsCap = maxSymbolsScan() || topAltsUniverse();
  const summaryParts: string[] = [];

  let notified = 0;
  const appendedForAi: CandleReversalStatsRow[] = [];

  if (isCandleReversal1dAlertsEnabled()) {
    const r1d = await scanTimeframe("1d", symbols, state, env1d, env1h, env1hLong, nowMs, concurrency);
    state = r1d.state;
    const n1d = await notifyResults(r1d.results, nowMs, alertCap, r1d.scanStats);
    notified += n1d.notified;
    appendedForAi.push(...n1d.appendedForAi);
    const sum1d = await maybeSendReversalScanSummary({
      tf: "1d",
      nowMs,
      universeLen: symbols.length,
      topAltsCap,
      scanStats: r1d.scanStats,
      alertsSentThisTf: n1d.notified,
      alertCapPerRun: alertCap,
      loaded,
      forceResend: Boolean(opts?.forceScanSummary),
    });
    if (sum1d) summaryParts.push(sum1d);
  }

  if (isCandleReversal1hAlertsEnabled() || isCandleReversal1hLongAlertsEnabled()) {
    const r1h = await scanTimeframe("1h", symbols, state, env1d, env1h, env1hLong, nowMs, concurrency);
    state = r1h.state;
    const n1h = await notifyResults(r1h.results, nowMs, Math.max(0, alertCap - notified), r1h.scanStats);
    notified += n1h.notified;
    appendedForAi.push(...n1h.appendedForAi);
    const sum1h = await maybeSendReversalScanSummary({
      tf: "1h",
      nowMs,
      universeLen: symbols.length,
      topAltsCap,
      scanStats: r1h.scanStats,
      alertsSentThisTf: n1h.notified,
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

  if (appendedForAi.length > 0) {
    try {
      const aiRes = await backfillReversalKlineAiAnalysis(appendedForAi, {
        limit: appendedForAi.length,
      });
      if (aiRes.attempted > 0) {
        console.info(
          `[candleReversalAlertTick] kline AI ${aiRes.succeeded}/${aiRes.attempted} ok` +
            (aiRes.failed > 0 ? ` · failed ${aiRes.failed}` : "") +
            ` · ${aiRes.symbols.join(", ") || "—"}`,
        );
      }
    } catch (e) {
      console.error("[candleReversalAlertTick] kline AI after alert", e);
    }
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

function hadInvertedDojiBeforeBarIndex(
  pack: NonNullable<Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>>,
  tf: CandleReversalTf,
  barIndex: number,
  env1d: CandleReversal1dDetectEnv,
  env1h: CandleReversal1hDetectEnv,
): boolean {
  const barMs = pack.timeSec[barIndex]! * 1000;
  const windowMs = marubozuAfterDojiWindowMs(tf);
  for (let j = barIndex - 1; j >= 0; j--) {
    if (barMs - pack.timeSec[j]! * 1000 > windowMs) break;
    if (tf === "1h" && evalInvertedDoji1h(pack, j, env1h)) return true;
    if (tf === "1d" && evalInvertedDoji1d(pack, j, env1d)) return true;
  }
  return false;
}

async function formatDebugForTf(sym: string, tf: CandleReversalTf, barsAgo = 0): Promise<string[]> {
  const pack = await fetchBinanceUsdmKlines(sym, tf, klineFetchLimit(tf));
  if (!pack) {
    return [`🎯 Candle Reversal — Debug [${tf.toUpperCase()}] · ${sym}`, `❌ ดึง klines ไม่ได้`];
  }
  const env1d = detectEnv1d();
  const env1h = detectEnv1h();
  const env1hLong = detectEnv1hLong();
  const latestClosed = candleReversalLatestClosedBarIndex(pack);
  const i = candleReversalBarIndexBarsAgo(pack, barsAgo);

  const hadDojiHist = hadInvertedDojiBeforeBarIndex(pack, tf, i, env1d, env1h);
  let hadDojiLive = false;
  if (barsAgo === 0) {
    const st = (await loadCandleReversalAlertState())[sym] ?? emptySymState();
    hadDojiLive =
      tf === "1h"
        ? st.lastInvertedDoji1hAlertedAtMs != null &&
          Date.now() - st.lastInvertedDoji1hAlertedAtMs <= marubozuAfterDojiWindowMs("1h")
        : st.lastInvertedDoji1dAlertedAtMs != null &&
          Date.now() - st.lastInvertedDoji1dAlertedAtMs <= marubozuAfterDojiWindowMs("1d");
  }
  const hadDoji = barsAgo === 0 ? hadDojiLive || hadDojiHist : hadDojiHist;

  const sig = evalCandleReversalAtBarIndex(tf, pack, i, env1d, env1h, { hadRecentInvertedDoji: hadDoji });
  const inverted = tf === "1h" ? evalInvertedDoji1h(pack, i, env1h) : evalInvertedDoji1d(pack, i, env1d);
  const marubozu = tf === "1d" ? evalMarubozu1d(pack, i, env1d, hadDoji) : null;
  const longest = tf === "1h" ? evalLongestRedBody1h(pack, i, env1h, hadDoji) : null;
  const longestGreen = tf === "1h" ? evalLongestGreenBody1h(pack, i, env1hLong) : null;

  const lines = formatCandleReversalTfDebugBlock({
    sym,
    tf,
    pack,
    barIndex: i,
    barsAgo,
    latestClosed,
    hadDoji,
    env1d,
    env1h,
    env1hLong,
    alerts1dOn: isCandleReversal1dAlertsEnabled(),
    alerts1hShortOn: isCandleReversal1hAlertsEnabled(),
    alerts1hLongOn: isCandleReversal1hLongAlertsEnabled(),
    sig,
    modelPass: {
      inverted_doji: Boolean(inverted),
      marubozu: Boolean(marubozu),
      longest_red_body: Boolean(longest),
      longest_green_body: Boolean(longestGreen),
    },
  });

  if (sig) {
    const [assetMeta, mexcContract] = await Promise.all([
      lookupBinanceUsdmSymbolMeta(sym),
      resolveMexcContractFromBinanceSymbolAsync(sym),
    ]);
    lines.push("📨 ข้อความที่จะส่ง Telegram:");
    lines.push(
      buildCandleReversalAlertMessage(sym, sig, {
        assetMeta,
        mexcContractSymbol: mexcContract,
      }),
    );
  }

  return lines;
}

export type CandleReversalDebugOpts = {
  tf?: CandleReversalTf;
  /** 0 = แท่งปิดล่าสุด · 25 = ย้อนหลัง 25 แท่งจากปิดล่าสุด */
  barsAgo?: number;
};

export async function formatCandleReversalDebugMessage(
  rawSymbol: string,
  tf?: CandleReversalTf,
  opts?: Pick<CandleReversalDebugOpts, "barsAgo">,
): Promise<string> {
  const symbol = rawSymbol.trim().toUpperCase().replace(/^@/, "");
  const sym = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;
  const barsAgo = Math.max(0, Math.floor(opts?.barsAgo ?? 0));

  if (!sym) {
    return "🎯 Candle Reversal — debug\nสัญลักษณ์ว่าง";
  }

  if (tf === "1d" || tf === "1h") {
    return (await formatDebugForTf(sym, tf, barsAgo)).join("\n");
  }

  const parts = [
    ...(await formatDebugForTf(sym, "1d", barsAgo)),
    "==================================================",
    ...(await formatDebugForTf(sym, "1h", barsAgo)),
  ];
  return parts.join("\n");
}

/** @deprecated */
export const formatCandleReversal1dDebugMessage = (rawSymbol: string) =>
  formatCandleReversalDebugMessage(rawSymbol, "1d");

export type CandleReversalDebugCommand = {
  symbol: string;
  tf?: CandleReversalTf;
  barsAgo?: number;
};

function parseCandleReversalBarsAgo(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const m = raw.trim().match(/^@?(\d+)$/);
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 400) return undefined;
  return Math.floor(n);
}

export function parseCandleReversalDebugCommand(text: string): CandleReversalDebugCommand | null {
  const t = text.trim();
  let m = t.match(
    /^(?:debug\s+)?(?:candle\s+)?reversal\s+1h\s+long(?:@\S+)?\s+(\S+?)(?:\s+(@?\d+))?\s*$/i,
  );
  if (m?.[1]) {
    return { symbol: m[1].trim(), tf: "1h", barsAgo: parseCandleReversalBarsAgo(m[2]) };
  }
  m = t.match(/^(?:debug\s+)?(?:candle\s+)?reversal\s+1h(?:@\S+)?\s+(\S+?)(?:\s+(@?\d+))?\s*$/i);
  if (m?.[1]) {
    return { symbol: m[1].trim(), tf: "1h", barsAgo: parseCandleReversalBarsAgo(m[2]) };
  }
  m = t.match(/^(?:debug\s+)?(?:candle\s+)?reversal\s+1d(?:@\S+)?\s+(\S+?)(?:\s+(@?\d+))?\s*$/i);
  if (m?.[1]) {
    return { symbol: m[1].trim(), tf: "1d", barsAgo: parseCandleReversalBarsAgo(m[2]) };
  }
  m = t.match(/^(?:debug\s+)?reversal\s+alert(?:@\S+)?\s+(\S+?)(?:\s+(@?\d+))?\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim(), barsAgo: parseCandleReversalBarsAgo(m[2]) };
  m = t.match(/^#reversal1hdebug\s+(\S+?)(?:\s+(@?\d+))?\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim(), tf: "1h", barsAgo: parseCandleReversalBarsAgo(m[2]) };
  m = t.match(/^#reversal1ddebug\s+(\S+?)(?:\s+(@?\d+))?\s*$/i);
  if (m?.[1]) return { symbol: m[1].trim(), tf: "1d", barsAgo: parseCandleReversalBarsAgo(m[2]) };
  return null;
}

/** @deprecated */
export const parseCandleReversal1dDebugCommand = (text: string) => {
  const r = parseCandleReversalDebugCommand(text);
  if (!r) return null;
  if (r.tf === "1h") return null;
  return { symbol: r.symbol };
};
