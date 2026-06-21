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
  fetchStatsEma20MetricsAtMs,
  STATS_EMA20_DIST_VERSION,
  statsEma20MetricsComplete,
} from "./statsEma20Dist";
import { STATS_PSAR_4H_VERSION } from "./statsPsar4h";
import { STATS_QUOTE_VOL_24H_VERSION } from "./statsQuoteVol24h";
import { lenPercentilePctFromRank } from "@/lib/statsLenPercentile";
import { fetchReversalAlertMarketSnapshot } from "./reversalMarketContext";

export type { CandleReversalStatsApiPayload, CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

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
  return 300;
}

export function isCandleReversalStatsEnabled(): boolean {
  const raw = process.env.CANDLE_REVERSAL_STATS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
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

function normalizeCandleReversalStatsRow(r: LegacyCandleReversalRowV1): CandleReversalStatsRow {
  return {
    ...r,
    signalBarTf: r.signalBarTf === "1h" ? "1h" : "1d",
    tradeSide: normalizeTradeSide(r.tradeSide),
    highRankInLookback: finiteRank(r.highRankInLookback),
    lowRankInLookback: finiteRank(r.lowRankInLookback),
    rangeRankInLookback: finiteRank(r.rangeRankInLookback),
    volRankInLookback: finiteRank(r.volRankInLookback),
    signalVolVsSma: nullNum(r.signalVolVsSma),
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
    strategyProfitPct: nullNum(r.strategyProfitPct),
    strategyExitReason:
      typeof r.strategyExitReason === "string" && r.strategyExitReason.trim()
        ? (r.strategyExitReason.trim() as CandleReversalStatsRow["strategyExitReason"])
        : null,
    lowerWickRatioPct: nullNum(r.lowerWickRatioPct),
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
    ema1hSlopePct7d: nullNum(r.ema1hSlopePct7d),
    ema4hSlopePct7d: nullNum(r.ema4hSlopePct7d),
    ema1dSlopePct7d: nullNum(r.ema1dSlopePct7d),
    btcEma4hSlopePct7d: nullNum(r.btcEma4hSlopePct7d),
    btcEma1dSlopePct7d: nullNum(r.btcEma1dSlopePct7d),
    priceVsEma20_1hPct: nullNum(r.priceVsEma20_1hPct),
    ema20_1hSlopePct7d: nullNum(r.ema20_1hSlopePct7d),
    btcEma20_4hSlopePct7d: nullNum(r.btcEma20_4hSlopePct7d),
    psar4hTrend:
      r.psar4hTrend === "up" || r.psar4hTrend === "down" ? r.psar4hTrend : null,
    psar4hDistPct: nullNum(r.psar4hDistPct),
    atrPct14d: nullNum(r.atrPct14d),
    lenPercentilePct: nullNum(r.lenPercentilePct),
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
  bodyPct?: number | null;
  highRankInLookback?: number | null;
  lowRankInLookback?: number | null;
  rangeRankInLookback?: number | null;
  lenPercentilePct?: number | null;
  volRankInLookback?: number | null;
  signalVolVsSma?: number | null;
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

/** มีแถว pending อยู่แล้วสำหรับเหรียญ+TF+ทิศ นี้ */
export function hasPendingCandleReversalStatsRow(
  rows: CandleReversalStatsRow[],
  symbol: string,
  signalBarTf: CandleReversalStatsRow["signalBarTf"],
  tradeSide: CandleReversalStatsRow["tradeSide"] = "short",
): boolean {
  const key = pendingReversalStatsKey(symbol, signalBarTf, tradeSide);
  return rows.some(
    (r) =>
      r.outcome === "pending" &&
      pendingReversalStatsKey(r.symbol, r.signalBarTf ?? "1d", r.tradeSide ?? "short") === key,
  );
}

/** คีย์ symbol:tf:side ของทุกแถว pending — ใช้กันยิงซ้ำระหว่างสแกน */
export function candleReversalPendingStatsKeys(rows: CandleReversalStatsRow[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.outcome !== "pending") continue;
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
 * ลบแถว pending ซ้ำ — ต่อเหรียญ+TF คงแถวที่แจ้งเร็วสุด (alertedAtMs น้อยสุด)
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
    if (r.outcome !== "pending") continue;
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
  const state = await loadCandleReversalStatsState();
  if (hasPendingCandleReversalStatsRow(state.rows, input.symbol, signalBarTf, tradeSide)) {
    return null;
  }

  let marketSentiment: CandleReversalStatsRow["marketSentiment"] = null;
  try {
    marketSentiment = await resolveMarketSentimentForStats(input.alertedAtMs);
  } catch {
    /* ignore */
  }

  let quoteVol24hUsdt: number | null = null;
  let marketCapUsd: number | null = null;
  let ema1hSlopePct7d: CandleReversalStatsRow["ema1hSlopePct7d"] = null;
  let ema4hSlopePct7d: CandleReversalStatsRow["ema4hSlopePct7d"] = null;
  let ema1dSlopePct7d: CandleReversalStatsRow["ema1dSlopePct7d"] = null;
  let btcEma4hSlopePct7d: CandleReversalStatsRow["btcEma4hSlopePct7d"] = null;
  let btcEma1dSlopePct7d: CandleReversalStatsRow["btcEma1dSlopePct7d"] = null;
  let priceVsEma20_1hPct: CandleReversalStatsRow["priceVsEma20_1hPct"] = null;
  let ema20_1hSlopePct7d: CandleReversalStatsRow["ema20_1hSlopePct7d"] = null;
  let btcEma20_4hSlopePct7d: CandleReversalStatsRow["btcEma20_4hSlopePct7d"] = null;
  let psar4hTrend: CandleReversalStatsRow["psar4hTrend"] = null;
  let psar4hDistPct: CandleReversalStatsRow["psar4hDistPct"] = null;
  let atrPct14d: number | null = null;
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
    btcEma20_4hSlopePct7d =
      snap.btcEma20_4hSlopePct7d != null && Number.isFinite(snap.btcEma20_4hSlopePct7d)
        ? snap.btcEma20_4hSlopePct7d
        : null;
    psar4hTrend =
      snap.psar4hTrend === "up" || snap.psar4hTrend === "down" ? snap.psar4hTrend : null;
    psar4hDistPct =
      snap.psar4hDistPct != null && Number.isFinite(snap.psar4hDistPct) ? snap.psar4hDistPct : null;
    atrPct14d =
      snap.atrPct14d != null && Number.isFinite(snap.atrPct14d) && snap.atrPct14d > 0
        ? snap.atrPct14d
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
    quoteVol24hUsdt,
    quoteVol24hV: STATS_QUOTE_VOL_24H_VERSION,
    marketCapUsd,
    ema1hSlopePct7d,
    ema4hSlopePct7d,
    ema1dSlopePct7d,
    btcEma4hSlopePct7d,
    btcEma1dSlopePct7d,
    priceVsEma20_1hPct,
    ema20_1hSlopePct7d,
    btcEma20_4hSlopePct7d,
    ...(ema20_1hSlopePct7d != null &&
    Number.isFinite(ema20_1hSlopePct7d) &&
    btcEma20_4hSlopePct7d != null &&
    Number.isFinite(btcEma20_4hSlopePct7d)
      ? { ema20DistV: STATS_EMA20_DIST_VERSION }
      : {}),
    btcEmaSlopesV: STATS_BTC_EMA_SLOPES_VERSION,
    psar4hTrend,
    psar4hDistPct,
    psar4hV: STATS_PSAR_4H_VERSION,
    atrPct14d,
    wickRatioPct:
      input.wickRatioPct != null && Number.isFinite(input.wickRatioPct) ? input.wickRatioPct : null,
    lowerWickRatioPct:
      input.lowerWickRatioPct != null && Number.isFinite(input.lowerWickRatioPct)
        ? input.lowerWickRatioPct
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
    volRankInLookback: finiteRank(input.volRankInLookback),
    signalVolVsSma:
      input.signalVolVsSma != null && Number.isFinite(input.signalVolVsSma) && input.signalVolVsSma > 0
        ? input.signalVolVsSma
        : null,
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
  };

  const ema20Incomplete =
    row.ema20_1hSlopePct7d == null ||
    !Number.isFinite(row.ema20_1hSlopePct7d) ||
    row.btcEma20_4hSlopePct7d == null ||
    !Number.isFinite(row.btcEma20_4hSlopePct7d);
  if (ema20Incomplete && Number.isFinite(input.alertedAtMs) && input.alertedAtMs > 0) {
    try {
      const ema20 = await fetchStatsEma20MetricsAtMs(input.symbol, input.alertedAtMs);
      if (ema20.ema20_1hSlopePct7d != null && Number.isFinite(ema20.ema20_1hSlopePct7d)) {
        row.ema20_1hSlopePct7d = ema20.ema20_1hSlopePct7d;
      }
      if (ema20.priceVsEma20_1hPct != null && Number.isFinite(ema20.priceVsEma20_1hPct)) {
        row.priceVsEma20_1hPct = ema20.priceVsEma20_1hPct;
      }
      if (ema20.btcEma20_4hSlopePct7d != null && Number.isFinite(ema20.btcEma20_4hSlopePct7d)) {
        row.btcEma20_4hSlopePct7d = ema20.btcEma20_4hSlopePct7d;
      }
      if (statsEma20MetricsComplete(row)) {
        row.ema20DistV = STATS_EMA20_DIST_VERSION;
      } else {
        delete row.ema20DistV;
      }
    } catch {
      /* ignore */
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

const EMPTY_CANDLE_REVERSAL_STATS_STATE: CandleReversalStatsState = { rows: [] };

/** ล้างตารางสถิติ Reversal ทั้งหมด */
export async function resetCandleReversalStatsState(): Promise<void> {
  await saveCandleReversalStatsState(EMPTY_CANDLE_REVERSAL_STATS_STATE);
}
