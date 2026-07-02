import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CandleReversalStatsApiPayload,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import { resolveMarketSentimentForStats } from "./marketSentimentSnapshotStore";
import { STATS_BTC_EMA_SLOPES_VERSION } from "./statsEmaSlope";
import {
  fetchStatsEma20MetricsPartialAtMs,
  mergeStatsEma20MetricsIntoRow,
  STATS_EMA20_DIST_VERSION,
  statsEma20MetricsComplete,
  statsEma20MetricsNeedForRow,
} from "./statsEma20Dist";
import {
  fetchStatsEma20_15mEntryAtMs,
  mergeStatsEma20_15mEntryIntoRow,
} from "./statsEma20_15mEntry";
import {
  fetchSignal24hHighDropAtSignal,
  mergeSignal24hHighDropIntoRow,
} from "./statsSignal24hHighDrop";
import { STATS_SIGNAL_BAR_SL_VERSION } from "@/lib/statsSignalBarSl";
import { STATS_PSAR_4H_VERSION } from "./statsPsar4h";
import { STATS_ATR_PCT_4H_VERSION } from "./statsAtrPct4h";
import { STATS_SIGNAL_VOL_VS_SMA24_VERSION } from "./statsSignalVolVsSmaBackfill";
import { STATS_QUOTE_VOL_24H_VERSION } from "./statsQuoteVol24h";
import { STATS_OPEN_INTEREST_VERSION } from "./statsOpenInterest";
import { STATS_BTC_DOM_EMA20_4H_VERSION } from "./statsBtcDominanceEma";
import { STATS_MARKET_CAP_VERSION } from "./statsMarketCapUsd";
import { lenPercentilePctFromRank } from "@/lib/statsLenPercentile";
import { fetchReversalAlertMarketSnapshot } from "./reversalMarketContext";
import {
  REVERSAL_OBSERVE_CRITERIA_V,
  reversalStatsRowBlocksPlayPending,
  type ReversalObserveReason,
  type ReversalStatsPlayMode,
} from "@/lib/reversalStatsPlayMode";
import {
  backfillReversalStatsWeeklyAlertFields,
  computeReversalStatsWeeklyAlertFields,
} from "@/lib/reversalStatsWeeklyAlert";
import {
  REVERSAL_CHART_AI_ANALYSIS_VERSION,
  type ReversalChartAiExpectedPath,
  type ReversalChartAiMarketCharacter,
  type ReversalChartAiPreferredSide,
} from "@/lib/reversalChartAiAnalysis";

export type { CandleReversalStatsApiPayload, CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
export { backfillReversalStatsWeeklyAlertFields } from "@/lib/reversalStatsWeeklyAlert";

const KV_KEY = "koji:candle_reversal_alert_stats";
const filePath = join(process.cwd(), "data", "candle_reversal_alert_stats.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ candle reversal stats");
  }
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '{"rows":[]}', "utf-8");
  }
}

export type CandleReversalStatsState = {
  rows: CandleReversalStatsRow[];
};

function maxRows(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_MAX_ROWS);
  if (Number.isFinite(v) && v >= 20 && v <= 2000) return Math.floor(v);
  return 2000;
}

export function isCandleReversalStatsEnabled(): boolean {
  const raw = process.env.CANDLE_REVERSAL_STATS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw === "true" || raw === "yes";
}

/** เก็บแถวสถิติ Reversal Long 1H (fade SHORT) — ค่าเริ่มปิด */
export function isCandleReversal1hLongStatsEnabled(): boolean {
  const raw = process.env.CANDLE_REVERSAL_1H_LONG_STATS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}

/** เก็บ/แสดงตารางสถิติ Reversal 1D — ค่าเริ่มปิด */
export function isCandleReversal1dStatsEnabled(): boolean {
  const raw = process.env.CANDLE_REVERSAL_1D_STATS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}

type LegacyCandleReversalRow = CandleReversalStatsRow & {
  price4h?: number | null;
  pct4h?: number | null;
  price12h?: number | null;
  pct12h?: number | null;
  price24h?: number | null;
  pct24h?: number | null;
  price48h?: number | null;
  pct48h?: number | null;
};

type LegacyCandleReversalRowV1 = LegacyCandleReversalRow & {
  signalBarTf?: CandleReversalStatsRow["signalBarTf"];
  tradeSide?: CandleReversalStatsRow["tradeSide"];
  statsPlayMode?: ReversalStatsPlayMode;
  observeReason?: ReversalObserveReason;
  observeV?: number;
  rangeScore?: number | null;
  wickScore?: number | null;
  rangeRankInLookback?: number | null;
  lowRankInLookback?: number | null;
  signalVolVsSma?: number | null;
};

function finiteRank(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v >= 1 ? Math.floor(v) : null;
}

function nullNum(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

function normalizeTradeSide(raw: string | undefined): CandleReversalStatsRow["tradeSide"] {
  return raw === "long" ? "long" : "short";
}

function normalizeStatsPlayMode(raw: string | undefined): ReversalStatsPlayMode | undefined {
  return raw === "observe" ? "observe" : undefined;
}

function normalizeObserveReason(raw: string | undefined): ReversalObserveReason | undefined {
  if (
    raw === "r_bar_range" ||
    raw === "neutral_matrix" ||
    raw === "strong_trend_matrix" ||
    raw === "instant_pump" ||
    raw === "lower_wick_long" ||
    raw === "atr14d_high"
  ) {
    return raw;
  }
  return undefined;
}

function normalizeChartAiPreferredSide(
  raw: string | undefined,
): ReversalChartAiPreferredSide | null {
  if (raw === "Long" || raw === "Short" || raw === "Skip") return raw;
  return null;
}

function normalizeChartAiMarketCharacter(
  raw: string | undefined,
): ReversalChartAiMarketCharacter | null {
  if (raw === "Trend" || raw === "Range" || raw === "Distribution" || raw === "Accumulation") {
    return raw;
  }
  return null;
}

function normalizeChartAiExpectedPath(raw: string | undefined): ReversalChartAiExpectedPath | null {
  if (
    raw === "Trend Continue" ||
    raw === "Pullback then Continue" ||
    raw === "Sideway" ||
    raw === "Reversal"
  ) {
    return raw;
  }
  return null;
}

function normalizeChartAiInt(v: number | null | undefined, min: number, max: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < min || n > max) return null;
  return n;
}

function normalizeCandleReversalStatsRow(r: LegacyCandleReversalRowV1): CandleReversalStatsRow {
  const statsPlayMode = normalizeStatsPlayMode(r.statsPlayMode);
  const observeReason = normalizeObserveReason(r.observeReason);
  const observeV =
    r.observeV != null && Number.isFinite(r.observeV) && r.observeV >= 1 ? Math.floor(r.observeV) : undefined;
  return {
    ...r,
    signalBarTf: r.signalBarTf === "1h" ? "1h" : "1d",
    tradeSide: normalizeTradeSide(r.tradeSide),
    ...(statsPlayMode ? { statsPlayMode } : {}),
    ...(observeReason ? { observeReason } : {}),
    ...(observeV != null ? { observeV } : {}),
    highRankInLookback: finiteRank(r.highRankInLookback),
    lowRankInLookback: finiteRank(r.lowRankInLookback),
    rangeRankInLookback: finiteRank(r.rangeRankInLookback),
    volRankInLookback: finiteRank(r.volRankInLookback),
    signalVolVsSma: nullNum(r.signalVolVsSma),
    signalVolVsSma24: nullNum(r.signalVolVsSma24),
    lookbackBars: finiteRank(r.lookbackBars),
    rangeScore: r.rangeScore != null && Number.isFinite(r.rangeScore) ? r.rangeScore : null,
    wickScore: r.wickScore != null && Number.isFinite(r.wickScore) ? r.wickScore : null,
    price4h: nullNum(r.price4h),
    pct4h: nullNum(r.pct4h),
    price12h: nullNum(r.price12h),
    pct12h: nullNum(r.pct12h),
    price24h: nullNum(r.price24h),
    pct24h: nullNum(r.pct24h),
    price48h: nullNum(r.price48h),
    pct48h: nullNum(r.pct48h),
    price1d: nullNum(r.price1d),
    pct1d: nullNum(r.pct1d),
    price3d: nullNum(r.price3d),
    pct3d: nullNum(r.pct3d),
    price7d: nullNum(r.price7d),
    pct7d: nullNum(r.pct7d),
    followUpMaxAdversePct: nullNum(r.followUpMaxAdversePct),
    signalBarHigh: nullNum(r.signalBarHigh),
    signalBarLow: nullNum(r.signalBarLow),
    signalBarSlHit: typeof r.signalBarSlHit === "boolean" ? r.signalBarSlHit : null,
    signalBarSlHitHours: nullNum(r.signalBarSlHitHours),
    signalBarSlV:
      r.signalBarSlV === STATS_SIGNAL_BAR_SL_VERSION ? STATS_SIGNAL_BAR_SL_VERSION : undefined,
    strategyProfitPct: nullNum(r.strategyProfitPct),
    strategyExitReason:
      typeof r.strategyExitReason === "string" && r.strategyExitReason.trim()
        ? (r.strategyExitReason.trim() as CandleReversalStatsRow["strategyExitReason"])
        : null,
    lowerWickRatioPct: nullNum(r.lowerWickRatioPct),
    dropFrom24hHighToSignalLowPct: nullNum(r.dropFrom24hHighToSignalLowPct),
    strategyProfitPct24h: nullNum(r.strategyProfitPct24h),
    strategyExitReason24h:
      typeof r.strategyExitReason24h === "string" && r.strategyExitReason24h.trim()
        ? (r.strategyExitReason24h.trim() as CandleReversalStatsRow["strategyExitReason24h"])
        : null,
    strategyProfitPctLong: nullNum(r.strategyProfitPctLong),
    strategyExitReasonLong:
      typeof r.strategyExitReasonLong === "string" && r.strategyExitReasonLong.trim()
        ? (r.strategyExitReasonLong.trim() as CandleReversalStatsRow["strategyExitReasonLong"])
        : null,
    strategyProfitPctLong24h: nullNum(r.strategyProfitPctLong24h),
    strategyExitReasonLong24h:
      typeof r.strategyExitReasonLong24h === "string" && r.strategyExitReasonLong24h.trim()
        ? (r.strategyExitReasonLong24h.trim() as CandleReversalStatsRow["strategyExitReasonLong24h"])
        : null,
    strategyProfitByPlan:
      r.strategyProfitByPlan && typeof r.strategyProfitByPlan === "object"
        ? r.strategyProfitByPlan
        : undefined,
    quoteVol24hUsdt: nullNum(r.quoteVol24hUsdt),
    marketCapUsd: nullNum(r.marketCapUsd),
    marketCapV: r.marketCapV === STATS_MARKET_CAP_VERSION ? STATS_MARKET_CAP_VERSION : undefined,
    openInterestUsdt: nullNum(r.openInterestUsdt),
    openInterestContracts: nullNum(r.openInterestContracts),
    openInterestChg24hPct: nullNum(r.openInterestChg24hPct),
    openInterestV: r.openInterestV === STATS_OPEN_INTEREST_VERSION ? STATS_OPEN_INTEREST_VERSION : undefined,
    ema1hSlopePct7d: nullNum(r.ema1hSlopePct7d),
    ema12_1hSlopePct7dAt12h: nullNum(r.ema12_1hSlopePct7dAt12h),
    ema20_15mSlopePct7dAt8h: nullNum(r.ema20_15mSlopePct7dAt8h),
    priceVsEma20_15mPctAt8h: nullNum(r.priceVsEma20_15mPctAt8h),
    ema20_15mSlopePct7dAt12h: nullNum(r.ema20_15mSlopePct7dAt12h),
    priceVsEma20_15mPctAt12h: nullNum(r.priceVsEma20_15mPctAt12h),
    ema4hSlopePct7d: nullNum(r.ema4hSlopePct7d),
    ema1dSlopePct7d: nullNum(r.ema1dSlopePct7d),
    btcEma4hSlopePct7d: nullNum(r.btcEma4hSlopePct7d),
    btcEma1dSlopePct7d: nullNum(r.btcEma1dSlopePct7d),
    priceVsEma20_1hPct: nullNum(r.priceVsEma20_1hPct),
    ema20_1hSlopePct7d: nullNum(r.ema20_1hSlopePct7d),
    priceVsEma20_4hPct: nullNum(r.priceVsEma20_4hPct),
    ema20_4hSlopePct7d: nullNum(r.ema20_4hSlopePct7d),
    btcEma20_4hSlopePct7d: nullNum(r.btcEma20_4hSlopePct7d),
    btcDomEma20_4hSlopePct7d: nullNum(r.btcDomEma20_4hSlopePct7d),
    btcDomEma20_4hV:
      r.btcDomEma20_4hV === STATS_BTC_DOM_EMA20_4H_VERSION ? STATS_BTC_DOM_EMA20_4H_VERSION : undefined,
    psar4hTrend:
      r.psar4hTrend === "up" || r.psar4hTrend === "down" ? r.psar4hTrend : null,
    psar4hDistPct: nullNum(r.psar4hDistPct),
    atrPct14d: nullNum(r.atrPct14d),
    atrPct4h: nullNum(r.atrPct4h),
    atrPct4hV: r.atrPct4hV === STATS_ATR_PCT_4H_VERSION ? STATS_ATR_PCT_4H_VERSION : undefined,
    lenPercentilePct: nullNum(r.lenPercentilePct),
    barRangePctSignal: nullNum(r.barRangePctSignal),
    weeklyAlertNo:
      r.weeklyAlertNo != null && Number.isFinite(r.weeklyAlertNo) && r.weeklyAlertNo >= 1
        ? Math.floor(r.weeklyAlertNo)
        : null,
    priceDiffFromPrevAlertPct: nullNum(r.priceDiffFromPrevAlertPct),
    isTradFi: r.isTradFi === true ? true : r.isTradFi === false ? false : null,
    isTradFiV: r.isTradFiV === 1 ? 1 : undefined,
    chartAiPreferredSide: normalizeChartAiPreferredSide(r.chartAiPreferredSide ?? undefined),
    chartAiConfidence: normalizeChartAiInt(r.chartAiConfidence, 0, 100),
    chartAiTrendStrength: normalizeChartAiInt(r.chartAiTrendStrength, 1, 10),
    chartAiExhaustionRisk: normalizeChartAiInt(r.chartAiExhaustionRisk, 1, 10),
    chartAiDistributionRisk: normalizeChartAiInt(r.chartAiDistributionRisk, 1, 10),
    chartAiMarketCharacter: normalizeChartAiMarketCharacter(r.chartAiMarketCharacter ?? undefined),
    chartAiExpectedPath: normalizeChartAiExpectedPath(r.chartAiExpectedPath ?? undefined),
    chartAiExpectedMaxPullbackPct: nullNum(r.chartAiExpectedMaxPullbackPct),
    chartAiReason:
      typeof r.chartAiReason === "string" && r.chartAiReason.trim() ? r.chartAiReason.trim() : null,
    chartAiAnalyzedAtIso:
      typeof r.chartAiAnalyzedAtIso === "string" && r.chartAiAnalyzedAtIso.trim()
        ? r.chartAiAnalyzedAtIso.trim()
        : null,
    chartAiAnalysisV:
      r.chartAiAnalysisV === REVERSAL_CHART_AI_ANALYSIS_VERSION
        ? REVERSAL_CHART_AI_ANALYSIS_VERSION
        : undefined,
    chartAiAnalysisError:
      typeof r.chartAiAnalysisError === "string" && r.chartAiAnalysisError.trim()
        ? r.chartAiAnalysisError.trim()
        : null,
  };
}

export async function loadCandleReversalStatsState(): Promise<CandleReversalStatsState> {
  const mapRows = (rows: LegacyCandleReversalRow[]) => rows.map(normalizeCandleReversalStatsRow);

  if (useCloudStorage()) {
    const data = await cloudGet<CandleReversalStatsState>(KV_KEY);
    if (data && Array.isArray(data.rows)) return { rows: mapRows(data.rows as LegacyCandleReversalRow[]) };
    return { rows: [] };
  }
  if (isVercel()) return { rows: [] };
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as CandleReversalStatsState;
    if (parsed && Array.isArray(parsed.rows)) {
      return { rows: mapRows(parsed.rows as LegacyCandleReversalRow[]) };
    }
  } catch {
    /* empty */
  }
  return { rows: [] };
}

export async function saveCandleReversalStatsState(state: CandleReversalStatsState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export type AppendCandleReversalStatsInput = {
  symbol: string;
  signalBarTf: CandleReversalStatsRow["signalBarTf"];
  tradeSide?: CandleReversalStatsRow["tradeSide"];
  model: CandleReversalStatsRow["model"];
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  entryPrice: number;
  retestPrice: number;
  slPrice: number;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
  signalBarLow?: number | null;
  signalBarHigh?: number | null;
  dropFrom24hHighToSignalLowPct?: number | null;
  bodyPct?: number | null;
  highRankInLookback?: number | null;
  lowRankInLookback?: number | null;
  rangeRankInLookback?: number | null;
  lenPercentilePct?: number | null;
  barRangePctSignal?: number | null;
  volRankInLookback?: number | null;
  signalVolVsSma?: number | null;
  signalVolVsSma24?: number | null;
  lookbackBars?: number | null;
  rangeScore?: number | null;
  wickScore?: number | null;
  afterInvertedDoji?: boolean;
  greenDaysBeforeSignal?: number | null;
  greenDaysBeforeSignalBkk?: number | null;
  swingLowOpenSec?: number | null;
  swingLowPrice?: number | null;
  ageOfTrendHours?: number | null;
  trendGainPct?: number | null;
  swingLowSource?: CandleReversalStatsRow["swingLowSource"];
  pumpCycleSwingLowV?: number;
  statsPlayMode?: ReversalStatsPlayMode;
  observeReason?: ReversalObserveReason;
  observeV?: number;
  isTradFi?: boolean | null;
};

function normalizeStatsSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function pendingReversalStatsKey(
  symbol: string,
  signalBarTf: CandleReversalStatsRow["signalBarTf"],
  tradeSide: CandleReversalStatsRow["tradeSide"] = "short",
): string {
  const side = tradeSide === "long" ? "long" : "short";
  return `${normalizeStatsSymbol(symbol)}:${signalBarTf === "1h" ? "1h" : "1d"}:${side}`;
}

/** มีแถว play pending อยู่แล้วสำหรับเหรียญ+TF+ทิศ นี้ (observe pending ไม่นับ) */
export function hasPendingCandleReversalStatsRow(
  rows: CandleReversalStatsRow[],
  symbol: string,
  signalBarTf: CandleReversalStatsRow["signalBarTf"],
  tradeSide: CandleReversalStatsRow["tradeSide"] = "short",
): boolean {
  const key = pendingReversalStatsKey(symbol, signalBarTf, tradeSide);
  return rows.some(
    (r) =>
      reversalStatsRowBlocksPlayPending(r) &&
      pendingReversalStatsKey(r.symbol, r.signalBarTf ?? "1d", r.tradeSide ?? "short") === key,
  );
}

/** คีย์ symbol:tf:side ของ play pending — ใช้กันยิง play ซ้ำระหว่างสแกน */
export function candleReversalPendingStatsKeys(rows: CandleReversalStatsRow[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (!reversalStatsRowBlocksPlayPending(r)) continue;
    keys.add(pendingReversalStatsKey(r.symbol, r.signalBarTf ?? "1d", r.tradeSide ?? "short"));
  }
  return keys;
}

/** มี pending reversal แถวใดๆ อยู่แล้วสำหรับเหรียญนี้ (ไม่สน tf/ทิศ) */
export function hasAnyPendingCandleReversalSymbol(
  rows: CandleReversalStatsRow[],
  symbol: string,
): boolean {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return false;
  for (const r of rows) {
    if (!r || r.outcome !== "pending") continue;
    const s = typeof r.symbol === "string" ? r.symbol.trim().toUpperCase() : "";
    if (s === sym) return true;
  }
  return false;
}

/**
 * ลบแถว play pending ซ้ำ — ต่อเหรียญ+TF คงแถวที่แจ้งเร็วสุด (observe ไม่ dedupe)
 */
export async function removeCandleReversalStatsDuplicatePendingRows(opts?: {
  symbol?: string;
}): Promise<{ removed: number; kept: number; scanned: number }> {
  const symbolFilter = opts?.symbol?.trim().toUpperCase() || null;
  const state = await loadCandleReversalStatsState();
  const rows = state.rows ?? [];
  const scanned = rows.length;

  const byKey = new Map<string, CandleReversalStatsRow[]>();
  for (const r of rows) {
    if (!reversalStatsRowBlocksPlayPending(r)) continue;
    const sym = normalizeStatsSymbol(r.symbol);
    if (symbolFilter && sym !== symbolFilter) continue;
    const key = pendingReversalStatsKey(sym, r.signalBarTf ?? "1d", r.tradeSide ?? "short");
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  const toDrop = new Set<string>();
  for (const arr of Array.from(byKey.values())) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => (a.alertedAtMs ?? 0) - (b.alertedAtMs ?? 0));
    for (let i = 1; i < arr.length; i++) {
      toDrop.add(arr[i]!.id);
    }
  }

  if (toDrop.size === 0) {
    return { removed: 0, kept: rows.length, scanned };
  }

  const next = rows.filter((r) => !toDrop.has(r.id));
  await saveCandleReversalStatsState({ rows: next });
  return { removed: toDrop.size, kept: next.length, scanned };
}

export async function appendCandleReversalStatsRow(
  input: AppendCandleReversalStatsInput,
): Promise<CandleReversalStatsRow | null> {
  if (!isCandleReversalStatsEnabled()) return null;

  const signalBarTf = input.signalBarTf === "1h" ? "1h" : "1d";
  const tradeSide = input.tradeSide === "long" ? "long" : "short";
  if (signalBarTf === "1d" && !isCandleReversal1dStatsEnabled()) {
    return null;
  }
  if (signalBarTf === "1h" && tradeSide === "long" && !isCandleReversal1hLongStatsEnabled()) {
    return null;
  }
  const isObserve = input.statsPlayMode === "observe";
  const state = await loadCandleReversalStatsState();

  const weeklyAlert = computeReversalStatsWeeklyAlertFields(state.rows, {
    symbol: input.symbol,
    signalBarTf,
    tradeSide,
    alertedAtMs: input.alertedAtMs,
    entryPrice: input.entryPrice,
  });

  let marketSentiment: CandleReversalStatsRow["marketSentiment"] = null;
  try {
    marketSentiment = await resolveMarketSentimentForStats(input.alertedAtMs);
  } catch {
    /* ignore */
  }

  let quoteVol24hUsdt: number | null = null;
  let marketCapUsd: number | null = null;
  let openInterestUsdt: number | null = null;
  let openInterestContracts: number | null = null;
  let openInterestChg24hPct: number | null = null;
  let ema1hSlopePct7d: CandleReversalStatsRow["ema1hSlopePct7d"] = null;
  let ema4hSlopePct7d: CandleReversalStatsRow["ema4hSlopePct7d"] = null;
  let ema1dSlopePct7d: CandleReversalStatsRow["ema1dSlopePct7d"] = null;
  let btcEma4hSlopePct7d: CandleReversalStatsRow["btcEma4hSlopePct7d"] = null;
  let btcEma1dSlopePct7d: CandleReversalStatsRow["btcEma1dSlopePct7d"] = null;
  let priceVsEma20_1hPct: CandleReversalStatsRow["priceVsEma20_1hPct"] = null;
  let ema20_1hSlopePct7d: CandleReversalStatsRow["ema20_1hSlopePct7d"] = null;
  let priceVsEma20_4hPct: CandleReversalStatsRow["priceVsEma20_4hPct"] = null;
  let ema20_4hSlopePct7d: CandleReversalStatsRow["ema20_4hSlopePct7d"] = null;
  let btcEma20_4hSlopePct7d: CandleReversalStatsRow["btcEma20_4hSlopePct7d"] = null;
  let btcDomEma20_4hSlopePct7d: CandleReversalStatsRow["btcDomEma20_4hSlopePct7d"] = null;
  let psar4hTrend: CandleReversalStatsRow["psar4hTrend"] = null;
  let psar4hDistPct: CandleReversalStatsRow["psar4hDistPct"] = null;
  let atrPct14d: number | null = null;
  let atrPct4h: number | null = null;
  try {
    const snap = await fetchReversalAlertMarketSnapshot(input.symbol, input.alertedAtMs);
    quoteVol24hUsdt =
      snap.quoteVol24hUsdt != null && Number.isFinite(snap.quoteVol24hUsdt) && snap.quoteVol24hUsdt > 0
        ? snap.quoteVol24hUsdt
        : null;
    marketCapUsd =
      snap.marketCapUsd != null && Number.isFinite(snap.marketCapUsd) && snap.marketCapUsd > 0
        ? snap.marketCapUsd
        : null;
    openInterestUsdt =
      snap.openInterestUsdt != null && Number.isFinite(snap.openInterestUsdt) && snap.openInterestUsdt > 0
        ? snap.openInterestUsdt
        : null;
    openInterestContracts =
      snap.openInterestContracts != null &&
      Number.isFinite(snap.openInterestContracts) &&
      snap.openInterestContracts > 0
        ? snap.openInterestContracts
        : null;
    openInterestChg24hPct =
      snap.openInterestChg24hPct != null && Number.isFinite(snap.openInterestChg24hPct)
        ? snap.openInterestChg24hPct
        : null;
    ema1hSlopePct7d =
      snap.ema1hSlopePct7d != null && Number.isFinite(snap.ema1hSlopePct7d) ? snap.ema1hSlopePct7d : null;
    ema4hSlopePct7d =
      snap.ema4hSlopePct7d != null && Number.isFinite(snap.ema4hSlopePct7d) ? snap.ema4hSlopePct7d : null;
    ema1dSlopePct7d =
      snap.ema1dSlopePct7d != null && Number.isFinite(snap.ema1dSlopePct7d) ? snap.ema1dSlopePct7d : null;
    btcEma4hSlopePct7d =
      snap.btcEma4hSlopePct7d != null && Number.isFinite(snap.btcEma4hSlopePct7d)
        ? snap.btcEma4hSlopePct7d
        : null;
    btcEma1dSlopePct7d =
      snap.btcEma1dSlopePct7d != null && Number.isFinite(snap.btcEma1dSlopePct7d)
        ? snap.btcEma1dSlopePct7d
        : null;
    priceVsEma20_1hPct =
      snap.priceVsEma20_1hPct != null && Number.isFinite(snap.priceVsEma20_1hPct)
        ? snap.priceVsEma20_1hPct
        : null;
    ema20_1hSlopePct7d =
      snap.ema20_1hSlopePct7d != null && Number.isFinite(snap.ema20_1hSlopePct7d)
        ? snap.ema20_1hSlopePct7d
        : null;
    priceVsEma20_4hPct =
      snap.priceVsEma20_4hPct != null && Number.isFinite(snap.priceVsEma20_4hPct)
        ? snap.priceVsEma20_4hPct
        : null;
    ema20_4hSlopePct7d =
      snap.ema20_4hSlopePct7d != null && Number.isFinite(snap.ema20_4hSlopePct7d)
        ? snap.ema20_4hSlopePct7d
        : null;
    btcEma20_4hSlopePct7d =
      snap.btcEma20_4hSlopePct7d != null && Number.isFinite(snap.btcEma20_4hSlopePct7d)
        ? snap.btcEma20_4hSlopePct7d
        : null;
    btcDomEma20_4hSlopePct7d =
      snap.btcDomEma20_4hSlopePct7d != null && Number.isFinite(snap.btcDomEma20_4hSlopePct7d)
        ? snap.btcDomEma20_4hSlopePct7d
        : null;
    psar4hTrend =
      snap.psar4hTrend === "up" || snap.psar4hTrend === "down" ? snap.psar4hTrend : null;
    psar4hDistPct =
      snap.psar4hDistPct != null && Number.isFinite(snap.psar4hDistPct) ? snap.psar4hDistPct : null;
    atrPct14d =
      snap.atrPct14d != null && Number.isFinite(snap.atrPct14d) && snap.atrPct14d > 0
        ? snap.atrPct14d
        : null;
    atrPct4h =
      snap.atrPct4h != null && Number.isFinite(snap.atrPct4h) && snap.atrPct4h > 0
        ? snap.atrPct4h
        : null;
  } catch {
    /* ignore */
  }

  const rangeScore =
    input.rangeScore != null && Number.isFinite(input.rangeScore) && input.rangeScore >= 0
      ? input.rangeScore
      : null;
  const wickScore =
    input.wickScore != null && Number.isFinite(input.wickScore) && input.wickScore >= 0
      ? input.wickScore
      : null;

  const row: CandleReversalStatsRow = {
    id: randomUUID(),
    symbol: normalizeStatsSymbol(input.symbol),
    signalBarTf,
    tradeSide,
    model: input.model,
    alertedAtIso: input.alertedAtIso,
    alertedAtMs: input.alertedAtMs,
    signalBarOpenSec: input.signalBarOpenSec,
    entryPrice: input.entryPrice,
    retestPrice: input.retestPrice,
    slPrice: input.slPrice,
    signalBarHigh:
      input.signalBarHigh != null && Number.isFinite(input.signalBarHigh) && input.signalBarHigh > 0
        ? input.signalBarHigh
        : null,
    signalBarLow:
      input.signalBarLow != null && Number.isFinite(input.signalBarLow) && input.signalBarLow > 0
        ? input.signalBarLow
        : null,
    quoteVol24hUsdt,
    quoteVol24hV: STATS_QUOTE_VOL_24H_VERSION,
    marketCapUsd,
    ...(marketCapUsd != null ? { marketCapV: STATS_MARKET_CAP_VERSION } : {}),
    openInterestUsdt,
    openInterestContracts,
    openInterestChg24hPct,
    ...(openInterestUsdt != null || openInterestContracts != null || openInterestChg24hPct != null
      ? { openInterestV: STATS_OPEN_INTEREST_VERSION }
      : {}),
    ema1hSlopePct7d,
    ema4hSlopePct7d,
    ema1dSlopePct7d,
    btcEma4hSlopePct7d,
    btcEma1dSlopePct7d,
    priceVsEma20_1hPct,
    ema20_1hSlopePct7d,
    priceVsEma20_4hPct,
    ema20_4hSlopePct7d,
    btcEma20_4hSlopePct7d,
    btcDomEma20_4hSlopePct7d,
    ...(btcDomEma20_4hSlopePct7d != null
      ? { btcDomEma20_4hV: STATS_BTC_DOM_EMA20_4H_VERSION }
      : {}),
    ...(statsEma20MetricsComplete({
      ema20_1hSlopePct7d,
      priceVsEma20_1hPct,
      ema20_4hSlopePct7d,
      priceVsEma20_4hPct,
      btcEma20_4hSlopePct7d,
    })
      ? { ema20DistV: STATS_EMA20_DIST_VERSION }
      : {}),
    btcEmaSlopesV: STATS_BTC_EMA_SLOPES_VERSION,
    psar4hTrend,
    psar4hDistPct,
    psar4hV: STATS_PSAR_4H_VERSION,
    atrPct14d,
    ...(atrPct4h != null ? { atrPct4h, atrPct4hV: STATS_ATR_PCT_4H_VERSION } : {}),
    wickRatioPct:
      input.wickRatioPct != null && Number.isFinite(input.wickRatioPct) ? input.wickRatioPct : null,
    lowerWickRatioPct:
      input.lowerWickRatioPct != null && Number.isFinite(input.lowerWickRatioPct)
        ? input.lowerWickRatioPct
        : null,
    dropFrom24hHighToSignalLowPct:
      input.dropFrom24hHighToSignalLowPct != null &&
      Number.isFinite(input.dropFrom24hHighToSignalLowPct) &&
      input.dropFrom24hHighToSignalLowPct >= 0
        ? input.dropFrom24hHighToSignalLowPct
        : null,
    bodyPct: input.bodyPct != null && Number.isFinite(input.bodyPct) ? input.bodyPct : null,
    highRankInLookback: finiteRank(input.highRankInLookback),
    lowRankInLookback: finiteRank(input.lowRankInLookback),
    rangeRankInLookback: finiteRank(input.rangeRankInLookback),
    lenPercentilePct:
      input.lenPercentilePct != null && Number.isFinite(input.lenPercentilePct)
        ? input.lenPercentilePct
        : lenPercentilePctFromRank(
            finiteRank(input.rangeRankInLookback),
            finiteRank(input.lookbackBars),
          ),
    barRangePctSignal:
      input.barRangePctSignal != null && Number.isFinite(input.barRangePctSignal) && input.barRangePctSignal >= 0
        ? input.barRangePctSignal
        : null,
    volRankInLookback: finiteRank(input.volRankInLookback),
    signalVolVsSma:
      input.signalVolVsSma != null && Number.isFinite(input.signalVolVsSma) && input.signalVolVsSma > 0
        ? input.signalVolVsSma
        : null,
    signalVolVsSma24:
      input.signalVolVsSma24 != null && Number.isFinite(input.signalVolVsSma24) && input.signalVolVsSma24 > 0
        ? input.signalVolVsSma24
        : null,
    ...(input.signalVolVsSma24 != null &&
    Number.isFinite(input.signalVolVsSma24) &&
    input.signalVolVsSma24 > 0
      ? { signalVolVsSma24V: STATS_SIGNAL_VOL_VS_SMA24_VERSION }
      : {}),
    lookbackBars: finiteRank(input.lookbackBars),
    rangeScore,
    wickScore,
    marketSentiment,
    afterInvertedDoji: Boolean(input.afterInvertedDoji),
    greenDaysBeforeSignal:
      input.greenDaysBeforeSignal != null &&
      Number.isFinite(input.greenDaysBeforeSignal) &&
      input.greenDaysBeforeSignal >= 0
        ? Math.floor(input.greenDaysBeforeSignal)
        : null,
    greenDaysBeforeSignalBkk:
      input.greenDaysBeforeSignalBkk != null &&
      Number.isFinite(input.greenDaysBeforeSignalBkk) &&
      input.greenDaysBeforeSignalBkk >= 0
        ? Math.floor(input.greenDaysBeforeSignalBkk)
        : null,
    swingLowOpenSec:
      input.swingLowOpenSec != null && Number.isFinite(input.swingLowOpenSec)
        ? input.swingLowOpenSec
        : null,
    swingLowPrice:
      input.swingLowPrice != null && Number.isFinite(input.swingLowPrice) && input.swingLowPrice > 0
        ? input.swingLowPrice
        : null,
    ageOfTrendHours:
      input.ageOfTrendHours != null && Number.isFinite(input.ageOfTrendHours) && input.ageOfTrendHours >= 0
        ? input.ageOfTrendHours
        : null,
    trendGainPct:
      input.trendGainPct != null && Number.isFinite(input.trendGainPct) ? input.trendGainPct : null,
    swingLowSource: input.swingLowSource ?? null,
    ...(input.pumpCycleSwingLowV != null ? { pumpCycleSwingLowV: input.pumpCycleSwingLowV } : {}),
    price4h: null,
    pct4h: null,
    price12h: null,
    pct12h: null,
    price24h: null,
    pct24h: null,
    price48h: null,
    pct48h: null,
    price1d: null,
    pct1d: null,
    price3d: null,
    pct3d: null,
    price7d: null,
    pct7d: null,
    maxRoiPct: null,
    durationToMfeHours: null,
    maxDrawdownPct: null,
    followUpMaxAdversePct: null,
    strategyProfitPct: null,
    strategyExitReason: null,
    strategyProfitPct24h: null,
    strategyExitReason24h: null,
    strategyProfitPctLong: null,
    strategyExitReasonLong: null,
    strategyProfitPctLong24h: null,
    strategyExitReasonLong24h: null,
    outcome: "pending",
    weeklyAlertNo: weeklyAlert.weeklyAlertNo,
    priceDiffFromPrevAlertPct: weeklyAlert.priceDiffFromPrevAlertPct,
    ...(isObserve
      ? {
          statsPlayMode: "observe" as const,
          ...(input.observeReason ? { observeReason: input.observeReason } : {}),
        }
      : {}),
    observeV: REVERSAL_OBSERVE_CRITERIA_V,
    ...(input.isTradFi === true ? { isTradFi: true } : input.isTradFi === false ? { isTradFi: false } : {}),
    ...(input.isTradFi != null ? { isTradFiV: 1 } : {}),
  };

  const ema20Incomplete = !statsEma20MetricsComplete(row);
  if (ema20Incomplete && Number.isFinite(input.alertedAtMs) && input.alertedAtMs > 0) {
    try {
      const need = statsEma20MetricsNeedForRow(row);
      const ema20 = await fetchStatsEma20MetricsPartialAtMs(input.symbol, input.alertedAtMs, need);
      mergeStatsEma20MetricsIntoRow(row, ema20);
    } catch {
      /* ignore */
    }
  }

  if (signalBarTf === "1h" && tradeSide === "short" && Number.isFinite(input.alertedAtMs) && input.alertedAtMs > 0) {
    try {
      const snap15m = await fetchStatsEma20_15mEntryAtMs(input.symbol, input.alertedAtMs, Date.now());
      mergeStatsEma20_15mEntryIntoRow(row, snap15m);
    } catch {
      /* ignore */
    }
  }

  if (tradeSide === "short" && Number.isFinite(input.signalBarOpenSec) && input.signalBarOpenSec > 0) {
    const signalLow =
      input.signalBarLow != null && Number.isFinite(input.signalBarLow) && input.signalBarLow > 0
        ? input.signalBarLow
        : null;
    if (signalLow != null && row.dropFrom24hHighToSignalLowPct == null) {
      const entryClose = input.entryPrice;
      if (Number.isFinite(entryClose) && entryClose > 0) {
        try {
          const snap24h = await fetchSignal24hHighDropAtSignal(
            input.symbol,
            input.signalBarOpenSec,
            signalBarTf,
            signalLow,
            entryClose,
          );
          mergeSignal24hHighDropIntoRow(row, snap24h);
        } catch {
          /* ignore */
        }
      }
    }
  }

  try {
    const { stampPendingConflictOnStatsAppend } = await import("./signalPendingConflictServer");
    const conflictWith = await stampPendingConflictOnStatsAppend(
      input.symbol,
      "reversal",
      input.alertedAtMs,
    );
    if (conflictWith) row.conflictWith = conflictWith;
  } catch {
    /* ignore */
  }

  state.rows.push(row);
  const max = maxRows();
  if (state.rows.length > max) {
    state.rows.splice(0, state.rows.length - max);
  }
  await saveCandleReversalStatsState(state);
  return row;
}

export type CandleReversalStatsAiAnalysisPatch = Pick<
  CandleReversalStatsRow,
  | "chartAiPreferredSide"
  | "chartAiConfidence"
  | "chartAiTrendStrength"
  | "chartAiExhaustionRisk"
  | "chartAiDistributionRisk"
  | "chartAiMarketCharacter"
  | "chartAiExpectedPath"
  | "chartAiExpectedMaxPullbackPct"
  | "chartAiReason"
  | "chartAiAnalyzedAtIso"
  | "chartAiAnalysisV"
  | "chartAiAnalysisError"
>;

export async function patchCandleReversalStatsAiAnalysis(
  rowId: string,
  patch: Partial<CandleReversalStatsAiAnalysisPatch>,
): Promise<boolean> {
  const state = await loadCandleReversalStatsState();
  const idx = state.rows.findIndex((r) => r.id === rowId);
  if (idx < 0) return false;

  const prev = state.rows[idx]!;
  const next: CandleReversalStatsRow = {
    ...prev,
    ...patch,
  };
  state.rows[idx] = normalizeCandleReversalStatsRow(next);
  await saveCandleReversalStatsState(state);
  return true;
}

const EMPTY_CANDLE_REVERSAL_STATS_STATE: CandleReversalStatsState = { rows: [] };

/** ล้างตารางสถิติ Reversal ทั้งหมด */
export async function resetCandleReversalStatsState(): Promise<void> {
  await saveCandleReversalStatsState(EMPTY_CANDLE_REVERSAL_STATS_STATE);
}
