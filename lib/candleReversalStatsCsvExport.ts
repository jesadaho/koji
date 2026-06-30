import {
  marketSentimentFngLabel,
  marketSentimentSentimentLabel,
} from "@/lib/marketSentiment";
import {
  candleReversalDayOfWeekBkk,
  candleReversalEmaSlopeCsvLabel,
  candleReversalEntryEma20_15mTouchCell,
  reversalBarRangePctSignalResolved,
  reversalDropFrom24hHighToSignalLowLabel,
  candleReversalGreenDaysLabel,
  candleReversalLookbackRankCell,
  candleReversalLowLookbackRankCell,
  candleReversalModelLabel,
  candleReversalModelShortLabel,
  candleReversalOutcomeLabel,
  candleReversalSignalBarTfLabel,
  candleReversalSignalVolVsSmaLabel,
  candleReversalTradeSideLabel,
  candleReversalVolScoreLabel,
  candleReversalWickRatioPctLabel,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import {
  formatStatsStrategyProfitPct,
  formatStatsStrategyProfitUsdt,
  statsStrategyExitReasonShort,
  statsStrategyProfitCsvCell,
  statsStrategyProfitFinalizedAtHorizon,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  type StatsStrategyCsvSizing,
  type StatsStrategyProfitHorizon,
} from "@/lib/statsStrategyProfitClient";
import {
  reversalStatsStrategyProfitLongResolvedForHorizon,
  reversalStatsStrategyProfitResolvedForHorizon,
  type ReversalLongStrategyProfitRowSlice,
} from "@/lib/reversalTpStrategy";
import { reversalRowIsSuggestedLong } from "@/lib/reversalMatrixFilters";
import { reversalStatsPlayModeLabel } from "@/lib/reversalStatsPlayMode";
import {
  reversalStatsPriceDiffFromPrevLabel,
  reversalStatsWeeklyAlertNoLabel,
} from "@/lib/reversalStatsWeeklyAlert";

export type { StatsStrategyCsvSizing } from "@/lib/statsStrategyProfitClient";
import {
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
} from "@/lib/snowballStatsClient";
import { statsOpenInterestChg24hPctLabel, statsOpenInterestUsdtLabel } from "@/lib/statsOpenInterest";
import { statsBtcDomEma20_4hSlopeLabel } from "@/lib/statsBtcDominanceEma";
import { statsAtrPct14dLabel } from "@/lib/statsAtrPct14d";
import { statsAtrPct4hLabel } from "@/lib/statsAtrPct4h";
import { statsLenPercentileLabel } from "@/lib/statsLenPercentile";
import { snowballStatsBarRangePctLabel } from "@/lib/snowballStatsClient";
import {
  statsPsar4hDistPctCsv,
  statsPsar4hTrendLabel,
} from "@/lib/statsPsar4h";
import { buildCsv, statsCoinLabel, statsFmtBkk, statsFmtPctCell, statsFmtPrice } from "@/lib/statsCsv";
import { reversalMomentumScoreLabel } from "@/lib/reversalMomentumScore";
import { reversalRiskScoreLabel } from "@/lib/reversalRiskScore";
import { reversalSignalBarSlHitLabel } from "@/lib/statsSignalBarSl";
import {
  pumpCycleAgeHoursCsvCell,
  pumpCycleSwingLowPriceCsvCell,
  pumpCycleSwingLowSourceCsvCell,
  pumpCycleSwingLowTimeCsvCell,
  pumpCycleTrendGainCsvCell,
  pumpCycleTrendVelocityCsvCell,
} from "@/lib/pumpCycleSwingLow";
import {
  reversalChartAiConfidenceLabel,
  reversalChartAiExpectedPathLabel,
  reversalChartAiMarketCharacterLabel,
  reversalChartAiPreferredSideLabel,
  reversalChartAiPullbackLabel,
  reversalChartAiScoreLabel,
} from "@/lib/reversalChartAiAnalysis";

const HEADERS = [
  "symbol",
  "เหรียญ",
  "TF",
  "Side",
  "PlayMode",
  "#/สั.",
  "Δ ครั้งก่อน",
  "โมเดล",
  "โมเดล (เต็ม)",
  "เขียว",
  "วัน",
  "เวลา (BKK)",
  "Entry",
  "Swing Low Time",
  "Swing Low Price",
  "Age of Trend (Hours)",
  "Trend Gain %",
  "Trend Velocity (%/h)",
  "Swing Low Source",
  "Vol 24h",
  "Mcap",
  "OI (USDT)",
  "OI Δ24h %",
  "Risk Score",
  "Momentum Score",
  "EMA20 1h slope 7d %",
  "EMA20 1h dist %",
  "EMA20 4h slope 7d %",
  "EMA20 4h dist %",
  "EMA20 15m slope 12h %",
  "EMA20 15m dist % (mark)",
  "EMA20 15m touch 8h",
  "EMA1d slope 7d %",
  "BTC EMA20 4h slope 7d %",
  "BTC.D EMA20 4h slope 7d %",
  "BTC EMA1d slope 7d %",
  "SAR 4h",
  "SAR dist 4h %",
  "ATR% 14D",
  "ATR% 4H",
  "Retest",
  "SL",
  "ไส้บน%",
  "ไส้ล่าง%",
  "24h→Low%",
  "เนื้อ%",
  "Len#",
  "Len%",
  "R% สัญญาณ",
  "Vol#",
  "Vol×SMA",
  "High#",
  "Low#",
  "Range",
  "Wick",
  "AI Side",
  "AI Conf",
  "AI Str",
  "AI Exh",
  "AI Dist",
  "AI Mkt",
  "AI Path",
  "AI Pull%",
  "AI Why",
  "AIv",
  "H1",
  "EMA12∠1h (12ชม.) @8h",
  "EMA12Δ1h @8h",
  "H2",
  "EMA12∠1h (12ชม.) @12h",
  "EMA12Δ1h @12h",
  "H3",
  "H4",
  "Max ROI",
  "Max DD",
  "สวน max",
  "SL ยอดแท่ง",
  "F&G",
  "Sentiment",
  "กำไรกลยุทธ์ 24h",
  "กำไรกลยุทธ์ 48h",
  "กำไร Long 24h",
  "กำไร Long 48h",
  "ผล",
];

function reversalHorizonCsvCells(r: CandleReversalStatsRow): [string, string, string, string] {
  const tf = r.signalBarTf ?? "1d";
  if (tf === "1h") {
    return [
      statsFmtPctCell(r.price4h, r.pct4h),
      statsFmtPctCell(r.price12h, r.pct12h),
      statsFmtPctCell(r.price24h, r.pct24h),
      statsFmtPctCell(r.price48h, r.pct48h),
    ];
  }
  return [
    statsFmtPctCell(r.price1d, r.pct1d),
    statsFmtPctCell(r.price3d, r.pct3d),
    statsFmtPctCell(r.price7d, r.pct7d),
    "",
  ];
}

function reversalLongStrategyProfitCsvCell(
  r: CandleReversalStatsRow,
  sizing: StatsStrategyCsvSizing | undefined,
  holdHours: StatsStrategyProfitHorizon,
): string {
  const rowSlice: ReversalLongStrategyProfitRowSlice = {
    pct24h: r.pct24h,
    pct48h: r.pct48h,
    strategyProfitPctLong24h: r.strategyProfitPctLong24h,
    strategyProfitPctLong: r.strategyProfitPctLong,
    strategyExitReasonLong24h: r.strategyExitReasonLong24h,
    strategyExitReasonLong: r.strategyExitReasonLong,
    maxDrawdownPct: r.maxDrawdownPct,
    followUpMaxAdversePct: r.followUpMaxAdversePct,
  };
  if (!statsStrategyProfitFinalizedAtHorizon(rowSlice, holdHours)) return "";
  const resolved = reversalStatsStrategyProfitLongResolvedForHorizon(
    rowSlice,
    holdHours,
    sizing?.leverage,
  );
  if (!resolved) return "";
  const tag = statsStrategyExitReasonShort(resolved.exitReason);
  const pctPart = formatStatsStrategyProfitPct(resolved.profitPct);
  const usdtPart = formatStatsStrategyProfitUsdt(
    sizing?.marginUsdt,
    sizing?.leverage,
    resolved.profitPct,
  );
  const core = tag ? `${pctPart} (${tag})` : pctPart;
  return usdtPart ? `${core} · ${usdtPart}` : core;
}

function candleReversalStatsRowToCsvCells(
  r: CandleReversalStatsRow,
  sizing?: StatsStrategyCsvSizing,
): string[] {
  const [h1, h2, h3, h4] = reversalHorizonCsvCells(r);
  return [
    r.symbol,
    statsCoinLabel(r.symbol),
    candleReversalSignalBarTfLabel(r.signalBarTf ?? "1d"),
    candleReversalTradeSideLabel(r.tradeSide ?? "short"),
    reversalStatsPlayModeLabel(r),
    reversalStatsWeeklyAlertNoLabel(r.weeklyAlertNo),
    reversalStatsPriceDiffFromPrevLabel(r.priceDiffFromPrevAlertPct),
    candleReversalModelShortLabel(r.model),
    candleReversalModelLabel(r.model),
    candleReversalGreenDaysLabel(r.greenDaysBeforeSignal),
    candleReversalDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs),
    statsFmtBkk(r.alertedAtIso),
    statsFmtPrice(r.entryPrice),
    pumpCycleSwingLowTimeCsvCell(r.swingLowOpenSec),
    pumpCycleSwingLowPriceCsvCell(r.swingLowPrice),
    pumpCycleAgeHoursCsvCell(r.ageOfTrendHours),
    pumpCycleTrendGainCsvCell(r.trendGainPct),
    pumpCycleTrendVelocityCsvCell(r.trendGainPct, r.ageOfTrendHours),
    pumpCycleSwingLowSourceCsvCell(r.swingLowSource),
    snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt),
    snowballStatsMarketCapUsdLabel(r.marketCapUsd),
    statsOpenInterestUsdtLabel(r.openInterestUsdt),
    statsOpenInterestChg24hPctLabel(r.openInterestChg24hPct),
    reversalRiskScoreLabel(r),
    reversalMomentumScoreLabel(r),
    candleReversalEmaSlopeCsvLabel(r.ema20_1hSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.priceVsEma20_1hPct),
    candleReversalEmaSlopeCsvLabel(r.ema20_4hSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.priceVsEma20_4hPct),
    candleReversalEmaSlopeCsvLabel(r.ema20_15mSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.priceVsEma20_15mPct),
    candleReversalEntryEma20_15mTouchCell(r).replace("—", ""),
    candleReversalEmaSlopeCsvLabel(r.ema1dSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.btcEma20_4hSlopePct7d),
    statsBtcDomEma20_4hSlopeLabel(r.btcDomEma20_4hSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.btcEma1dSlopePct7d),
    statsPsar4hTrendLabel(r.psar4hTrend),
    statsPsar4hDistPctCsv(r.psar4hDistPct),
    statsAtrPct14dLabel(r.atrPct14d),
    statsAtrPct4hLabel(r.atrPct4h),
    statsFmtPrice(r.retestPrice),
    statsFmtPrice(r.slPrice),
    (r.tradeSide ?? "short") === "short"
      ? candleReversalWickRatioPctLabel(r.wickRatioPct).replace("—", "")
      : "",
    (r.tradeSide ?? "short") === "short"
      ? candleReversalWickRatioPctLabel(r.lowerWickRatioPct).replace("—", "")
      : candleReversalWickRatioPctLabel(r.wickRatioPct).replace("—", ""),
    (r.tradeSide ?? "short") === "short"
      ? reversalDropFrom24hHighToSignalLowLabel(r.dropFrom24hHighToSignalLowPct).replace("—", "")
      : "",
    r.bodyPct != null && Number.isFinite(r.bodyPct) ? `${r.bodyPct.toFixed(1)}%` : "",
    candleReversalLookbackRankCell(r.rangeRankInLookback, r.lookbackBars),
    statsLenPercentileLabel(r.lenPercentilePct),
    snowballStatsBarRangePctLabel(reversalBarRangePctSignalResolved(r)),
    candleReversalLookbackRankCell(r.volRankInLookback, r.lookbackBars),
    candleReversalSignalVolVsSmaLabel(r.signalVolVsSma),
    candleReversalLookbackRankCell(r.highRankInLookback, r.lookbackBars),
    candleReversalLowLookbackRankCell(r.lowRankInLookback, r.lookbackBars),
    candleReversalVolScoreLabel(r.rangeScore),
    candleReversalVolScoreLabel(r.wickScore),
    reversalChartAiPreferredSideLabel(r.chartAiPreferredSide).replace("—", ""),
    reversalChartAiConfidenceLabel(r.chartAiConfidence).replace("—", ""),
    reversalChartAiScoreLabel(r.chartAiTrendStrength).replace("—", ""),
    reversalChartAiScoreLabel(r.chartAiExhaustionRisk).replace("—", ""),
    reversalChartAiScoreLabel(r.chartAiDistributionRisk).replace("—", ""),
    reversalChartAiMarketCharacterLabel(r.chartAiMarketCharacter).replace("—", ""),
    reversalChartAiExpectedPathLabel(r.chartAiExpectedPath).replace("—", ""),
    reversalChartAiPullbackLabel(r.chartAiExpectedMaxPullbackPct).replace("—", ""),
    r.chartAiReason ?? "",
    r.chartAiAnalysisV != null ? String(r.chartAiAnalysisV) : "",
    h1,
    (r.signalBarTf ?? "1d") === "1h" && (r.tradeSide ?? "short") === "short"
      ? candleReversalEmaSlopeCsvLabel(r.ema20_15mSlopePct7dAt8h)
      : "",
    (r.signalBarTf ?? "1d") === "1h" && (r.tradeSide ?? "short") === "short"
      ? candleReversalEmaSlopeCsvLabel(r.priceVsEma20_15mPctAt8h)
      : "",
    h2,
    (r.signalBarTf ?? "1d") === "1h" && (r.tradeSide ?? "short") === "short"
      ? candleReversalEmaSlopeCsvLabel(r.ema20_15mSlopePct7dAt12h)
      : "",
    (r.signalBarTf ?? "1d") === "1h" && (r.tradeSide ?? "short") === "short"
      ? candleReversalEmaSlopeCsvLabel(r.priceVsEma20_15mPctAt12h)
      : "",
    h3,
    h4,
    r.maxRoiPct != null && Number.isFinite(r.maxRoiPct) ? `${r.maxRoiPct.toFixed(2)}%` : "",
    r.maxDrawdownPct != null && Number.isFinite(r.maxDrawdownPct) ? `${r.maxDrawdownPct.toFixed(2)}%` : "",
    r.followUpMaxAdversePct != null && Number.isFinite(r.followUpMaxAdversePct)
      ? `${r.followUpMaxAdversePct.toFixed(2)}%`
      : "",
    reversalSignalBarSlHitLabel(r.signalBarSlHit, r.signalBarSlHitHours).replace("—", ""),
    marketSentimentFngLabel(r.marketSentiment),
    marketSentimentSentimentLabel(r.marketSentiment),
    statsStrategyProfitCsvCell(
      r.pct24h,
      r.strategyProfitPct24h,
      r.strategyExitReason24h,
      sizing,
      STATS_STRATEGY_PROFIT_HOLD_24H,
      { maxDrawdownPct: r.maxDrawdownPct, followUpMaxAdversePct: r.followUpMaxAdversePct },
      reversalStatsStrategyProfitResolvedForHorizon,
    ),
    statsStrategyProfitCsvCell(
      r.pct48h,
      r.strategyProfitPct,
      r.strategyExitReason,
      sizing,
      STATS_STRATEGY_PROFIT_HOLD_48H,
      { maxDrawdownPct: r.maxDrawdownPct, followUpMaxAdversePct: r.followUpMaxAdversePct },
      reversalStatsStrategyProfitResolvedForHorizon,
    ),
    reversalRowIsSuggestedLong(r)
      ? reversalLongStrategyProfitCsvCell(r, sizing, STATS_STRATEGY_PROFIT_HOLD_24H)
      : "",
    reversalRowIsSuggestedLong(r)
      ? reversalLongStrategyProfitCsvCell(r, sizing, STATS_STRATEGY_PROFIT_HOLD_48H)
      : "",
    candleReversalOutcomeLabel(r.outcome),
  ];
}

export function candleReversalStatsToCsv(
  rows: CandleReversalStatsRow[],
  sizing?: StatsStrategyCsvSizing,
): string {
  return buildCsv(
    HEADERS,
    rows.map((r) => candleReversalStatsRowToCsvCells(r, sizing)),
  );
}
