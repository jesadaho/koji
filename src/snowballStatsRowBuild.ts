import { randomUUID } from "node:crypto";
import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import { lenPercentilePctFromRank } from "@/lib/statsLenPercentile";
import {
  STATS_BTC_EMA_SLOPES_VERSION,
  STATS_SYMBOL_EMA_SLOPES_VERSION,
} from "./statsEmaSlope";
import { STATS_PSAR_4H_VERSION } from "./statsPsar4h";
import { STATS_QUOTE_VOL_24H_VERSION } from "./statsQuoteVol24h";
import {
  computeSvpHoleYn,
  STATS_TREND_GRADE_VERSION,
  type AppendSnowballStatsInput,
} from "./snowballStatsStore";
import { SNOWBALL_TREND_1H_VOL_LOOKBACK } from "./snowballTrendMomentumMetrics";

/** Build in-memory SnowballStatsRow from append input (no persistence) */
export function buildSnowballStatsRow(input: AppendSnowballStatsInput): SnowballStatsRow {
  const atr100 =
    input.atr100 != null && Number.isFinite(input.atr100) && input.atr100 > 0 ? input.atr100 : null;
  const maxUpperWick100 =
    input.maxUpperWick100 != null && Number.isFinite(input.maxUpperWick100) && input.maxUpperWick100 >= 0
      ? input.maxUpperWick100
      : null;
  const rangeScore =
    input.rangeScore != null && Number.isFinite(input.rangeScore) && input.rangeScore >= 0
      ? input.rangeScore
      : null;
  const wickScore =
    input.wickScore != null && Number.isFinite(input.wickScore) && input.wickScore >= 0
      ? input.wickScore
      : null;
  const normBarRangePct = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v >= 0 ? v : null;
  const barRangePctPrev = normBarRangePct(input.barRangePctPrev);
  const barRangePctSignal = normBarRangePct(input.barRangePctSignal);
  const barRangePct2Sum = normBarRangePct(input.barRangePct2Sum);

  const normFiniteRatio = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v > 0 ? v : null;
  const normVolRank = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v >= 1 ? Math.round(v) : null;
  const normVolRankLb = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v >= 1 ? Math.round(v) : null;

  const confirmVolVsSma = normFiniteRatio(input.confirmVolVsSma);
  const confirmVolRank = normVolRank(input.confirmVolRank);
  const confirmVolRankLb = confirmVolRank != null ? normVolRankLb(input.confirmVolRankLb) : null;

  return {
    id: randomUUID(),
    symbol: input.symbol.trim().toUpperCase(),
    side: input.side,
    alertSide: input.alertSide,
    alertedAtIso: input.alertedAtIso,
    alertedAtMs: input.alertedAtMs,
    signalBarOpenSec: input.signalBarOpenSec,
    signalBarLow: input.signalBarLow ?? null,
    signalBarTf: input.signalBarTf ?? "15m",
    ...(input.signalBarTf === "4h" ? { horizonAnchorV2: true as const } : {}),
    entryPrice: input.entryPrice,
    intrabar: input.intrabar,
    triggerKind: input.triggerKind,
    qualityTier: input.qualityTier,
    ...(input.structureTier === "a_plus" ||
    input.structureTier === "b_plus" ||
    input.structureTier === "c_plus"
      ? { structureTier: input.structureTier }
      : {}),
    ...(typeof input.swing200Ok === "boolean" ? { swing200Ok: input.swing200Ok } : {}),
    marketSentiment: null,
    alertQualityTier: input.alertQualityTier ?? input.qualityTier,
    ...(input.breakout1hConfirmFail === true ? { breakout1hConfirmFail: true } : {}),
    momentumDowngrade: input.momentumDowngrade === true,
    momentumFailGradeF: input.momentumFailGradeF === true,
    ...(input.structureCeiling === "A" ||
    input.structureCeiling === "B" ||
    input.structureCeiling === "C"
      ? { structureCeiling: input.structureCeiling }
      : {}),
    ...(input.momentumFailCount === 0 ||
    input.momentumFailCount === 1 ||
    input.momentumFailCount === 2 ||
    input.momentumFailCount === 3
      ? { momentumFailCount: input.momentumFailCount }
      : {}),
    ...(input.gradeNotch === 1 ||
    input.gradeNotch === 0 ||
    input.gradeNotch === -1 ||
    input.gradeNotch === -2
      ? { gradeNotch: input.gradeNotch }
      : {}),
    ...(input.displayGrade ? { displayGrade: input.displayGrade } : {}),
    ...(input.actionPlan === "full" ||
    input.actionPlan === "standard" ||
    input.actionPlan === "light" ||
    input.actionPlan === "monitor"
      ? { actionPlan: input.actionPlan }
      : {}),
    atr100,
    maxUpperWick100,
    rangeScore,
    wickScore,
    barRangePctPrev,
    barRangePctSignal,
    barRangePct2Sum,
    rangeRankInLookback:
      input.rangeRankInLookback != null && Number.isFinite(input.rangeRankInLookback) && input.rangeRankInLookback >= 1
        ? Math.floor(input.rangeRankInLookback)
        : null,
    lenLookbackBars:
      input.lenLookbackBars != null && Number.isFinite(input.lenLookbackBars) && input.lenLookbackBars >= 2
        ? Math.floor(input.lenLookbackBars)
        : null,
    lenPercentilePct:
      input.lenPercentilePct != null && Number.isFinite(input.lenPercentilePct)
        ? input.lenPercentilePct
        : lenPercentilePctFromRank(
            input.rangeRankInLookback != null && Number.isFinite(input.rangeRankInLookback)
              ? Math.floor(input.rangeRankInLookback)
              : null,
            input.lenLookbackBars != null && Number.isFinite(input.lenLookbackBars)
              ? Math.floor(input.lenLookbackBars)
              : null,
          ),
    btcPsar4hTrend:
      input.btcPsar4hTrend === "up" || input.btcPsar4hTrend === "down" ? input.btcPsar4hTrend : null,
    btcPsar4hClose:
      input.btcPsar4hClose != null && Number.isFinite(input.btcPsar4hClose) && input.btcPsar4hClose > 0
        ? input.btcPsar4hClose
        : null,
    btcPsar1hTrend:
      input.btcPsar1hTrend === "up" || input.btcPsar1hTrend === "down" ? input.btcPsar1hTrend : null,
    btcPsar1hClose:
      input.btcPsar1hClose != null && Number.isFinite(input.btcPsar1hClose) && input.btcPsar1hClose > 0
        ? input.btcPsar1hClose
        : null,
    quoteVol24hUsdt:
      input.quoteVol24hUsdt != null && Number.isFinite(input.quoteVol24hUsdt) && input.quoteVol24hUsdt > 0
        ? input.quoteVol24hUsdt
        : null,
    quoteVol24hV: STATS_QUOTE_VOL_24H_VERSION,
    marketCapUsd:
      input.marketCapUsd != null && Number.isFinite(input.marketCapUsd) && input.marketCapUsd > 0
        ? input.marketCapUsd
        : null,
    fundingRate:
      input.fundingRate != null && Number.isFinite(input.fundingRate) ? input.fundingRate : null,
    atrPct14d:
      input.atrPct14d != null && Number.isFinite(input.atrPct14d) && input.atrPct14d > 0
        ? input.atrPct14d
        : null,
    ema1hSlopePct7d:
      input.ema1hSlopePct7d != null && Number.isFinite(input.ema1hSlopePct7d)
        ? input.ema1hSlopePct7d
        : null,
    ema4hSlopePct7d:
      input.ema4hSlopePct7d != null && Number.isFinite(input.ema4hSlopePct7d)
        ? input.ema4hSlopePct7d
        : null,
    ema1dSlopePct7d:
      input.ema1dSlopePct7d != null && Number.isFinite(input.ema1dSlopePct7d)
        ? input.ema1dSlopePct7d
        : null,
    btcEma4hSlopePct7d:
      input.btcEma4hSlopePct7d != null && Number.isFinite(input.btcEma4hSlopePct7d)
        ? input.btcEma4hSlopePct7d
        : null,
    btcEma1dSlopePct7d:
      input.btcEma1dSlopePct7d != null && Number.isFinite(input.btcEma1dSlopePct7d)
        ? input.btcEma1dSlopePct7d
        : null,
    psar4hTrend:
      input.psar4hTrend === "up" || input.psar4hTrend === "down" ? input.psar4hTrend : null,
    psar4hDistPct:
      input.psar4hDistPct != null && Number.isFinite(input.psar4hDistPct)
        ? input.psar4hDistPct
        : null,
    psar4hV: STATS_PSAR_4H_VERSION,
    btcEmaSlopesV: STATS_BTC_EMA_SLOPES_VERSION,
    ...((input.ema1hSlopePct7d != null && Number.isFinite(input.ema1hSlopePct7d)) ||
    (input.ema4hSlopePct7d != null && Number.isFinite(input.ema4hSlopePct7d)) ||
    (input.ema1dSlopePct7d != null && Number.isFinite(input.ema1dSlopePct7d))
      ? { symbolEmaSlopesV: STATS_SYMBOL_EMA_SLOPES_VERSION }
      : {}),
    ...(input.qualityTier ? { trendGradeV: STATS_TREND_GRADE_VERSION } : {}),
    signalVolVsSma:
      input.signalVolVsSma != null && Number.isFinite(input.signalVolVsSma) && input.signalVolVsSma > 0
        ? input.signalVolVsSma
        : input.volSma > 0 && Number.isFinite(input.vol) && input.vol > 0
          ? input.vol / input.volSma
          : null,
    volStrictOk: input.volStrictOk === true ? true : input.volStrictOk === false ? false : null,
    volNearMissOnly:
      input.volNearMissOnly === true ? true : input.volNearMissOnly === false ? false : null,
    volMultAtAlert:
      input.volMultAtAlert != null && Number.isFinite(input.volMultAtAlert) && input.volMultAtAlert > 0
        ? input.volMultAtAlert
        : null,
    volNearMultAtAlert:
      input.volNearMultAtAlert != null &&
      Number.isFinite(input.volNearMultAtAlert) &&
      input.volNearMultAtAlert > 0
        ? input.volNearMultAtAlert
        : null,
    confirmGateSteps:
      Array.isArray(input.confirmGateSteps) && input.confirmGateSteps.length > 0
        ? input.confirmGateSteps.filter(
            (s) =>
              s &&
              typeof s.label === "string" &&
              typeof s.detail === "string" &&
              (s.ok === true || s.ok === false),
          )
        : undefined,
    volumeCascadeYn:
      input.volumeCascadeYn === "Y" || input.volumeCascadeYn === "N" ? input.volumeCascadeYn : null,
    volumeDropCount:
      input.volumeDropCount != null &&
      Number.isFinite(input.volumeDropCount) &&
      input.volumeDropCount >= 0
        ? Math.floor(input.volumeDropCount)
        : null,
    signalMaxDdPct:
      input.signalMaxDdPct != null &&
      Number.isFinite(input.signalMaxDdPct) &&
      input.signalMaxDdPct >= 0
        ? input.signalMaxDdPct
        : null,
    trendMomentumVolLookback: SNOWBALL_TREND_1H_VOL_LOOKBACK,
    confirmVolVsSma,
    confirmVolRank,
    confirmVolRankLb,
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
    svpHoleYn: computeSvpHoleYn(input.vol, input.volSma),
    price4h: null,
    pct4h: null,
    price12h: null,
    pct12h: null,
    price24h: null,
    pct24h: null,
    price48h: null,
    pct48h: null,
    maxRoiPct: null,
    durationToMfeHours: null,
    maxDrawdownPct: null,
    followUpMaxAdversePct: null,
    strategyProfitPct: null,
    strategyExitReason: null,
    strategyProfitPct24h: null,
    strategyExitReason24h: null,
    resultRr: null,
    outcome: "pending",
  };
}
