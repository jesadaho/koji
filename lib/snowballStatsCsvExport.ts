import {
  marketSentimentBtcDominanceLabel,
  marketSentimentFngLabel,
  marketSentimentSentimentLabel,
  marketSentimentVolChange24hLabel,
} from "@/lib/marketSentiment";
import {
  snowballStatsBarRangePctLabel,
  snowballStatsBtcPsarCombinedLabel,
  snowballStatsConfirmVolRankLabel,
  snowballStatsConfirmVolVsSmaLabel,
  snowballStatsVolVsSmaDisplay,
  snowballStatsDayOfWeekBkk,
  snowballStatsFmtHorizonPctCell,
  snowballStatsFundingRateLabel,
  snowballStatsGradeDisplayLabel,
  snowballStatsStructureTierLabel,
  snowballStatsGreenDaysLabel,
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  snowballStatsSideLabel,
  snowballStatsVolScoreLabel,
  snowballStatsVolumeCascadeLabel,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import {
  statsStrategyProfitCsvCell,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  type StatsStrategyCsvSizing,
} from "@/lib/statsStrategyProfitClient";
import { candleReversalLookbackRankCell } from "@/lib/candleReversalStatsClient";
import { candleReversalEmaSlopeCsvLabel } from "@/lib/candleReversalStatsClient";
import { statsAtrPct14dLabel } from "@/lib/statsAtrPct14d";
import { statsLenPercentileLabel } from "@/lib/statsLenPercentile";
import { buildCsv, statsCoinLabel, statsFmtBkk, statsFmtPrice } from "@/lib/statsCsv";

const HEADERS = [
  "symbol",
  "เหรียญ",
  "ทิศ",
  "Grade",
  "โครงสร้าง",
  "วัน",
  "เวลา (BKK)",
  "Entry",
  "Range",
  "Wick",
  "R% ก่อน",
  "R% สัญญาณ",
  "R% 2แท่ง",
  "BTC SAR",
  "Vol 24h",
  "Mcap",
  "ATR% 14D",
  "Funding",
  "Vol↗",
  "เขียว",
  "Vol×SMA",
  "Vol rank",
  "4h",
  "12h",
  "24h",
  "48h",
  "Max ROI",
  "Duration→MFE",
  "Max DD ก่อน",
  "Max DD หลัง",
  "Adv max",
  "SVP Hole",
  "RR",
  "F&G",
  "Sentiment",
  "BTC.D",
  "VolΔ24h",
  "กำไรกลยุทธ์ 24h",
  "กำไรกลยุทธ์ 48h",
  "ผล",
];

function snowballOutcomeLabel(o: SnowballStatsRow["outcome"]): string {
  if (o === "pending") return "Pending";
  if (o === "win_trend" || o === "win_quick_tp30") return "Win (Trend)";
  if (o === "loss") return "Loss";
  return "Flat";
}

function snowballStatsRowToCsvCells(r: SnowballStatsRow, sizing?: StatsStrategyCsvSizing): string[] {
  return [
    r.symbol,
    statsCoinLabel(r.symbol),
    snowballStatsSideLabel(r),
    snowballStatsGradeDisplayLabel(r),
    snowballStatsStructureTierLabel(r.structureTier),
    snowballStatsDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs),
    statsFmtBkk(r.alertedAtIso),
    statsFmtPrice(r.entryPrice),
    snowballStatsVolScoreLabel(r.rangeScore),
    snowballStatsVolScoreLabel(r.wickScore),
    candleReversalLookbackRankCell(r.rangeRankInLookback, r.lenLookbackBars),
    statsLenPercentileLabel(r.lenPercentilePct),
    snowballStatsBarRangePctLabel(r.barRangePctPrev),
    snowballStatsBarRangePctLabel(r.barRangePctSignal),
    snowballStatsBarRangePctLabel(r.barRangePct2Sum),
    snowballStatsBtcPsarCombinedLabel(r.btcPsar4hTrend, r.btcPsar1hTrend),
    snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt),
    snowballStatsMarketCapUsdLabel(r.marketCapUsd),
    statsAtrPct14dLabel(r.atrPct14d),
    candleReversalEmaSlopeCsvLabel(r.ema4hSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.ema1dSlopePct7d),
    snowballStatsFundingRateLabel(r.fundingRate),
    snowballStatsVolumeCascadeLabel(r.volumeCascadeYn),
    snowballStatsGreenDaysLabel(r.greenDaysBeforeSignal),
    snowballStatsConfirmVolVsSmaLabel(snowballStatsVolVsSmaDisplay(r)),
    snowballStatsConfirmVolRankLabel(r.confirmVolRank, r.confirmVolRankLb),
    snowballStatsFmtHorizonPctCell(r, 4, r.price4h, r.pct4h),
    snowballStatsFmtHorizonPctCell(r, 12, r.price12h, r.pct12h),
    snowballStatsFmtHorizonPctCell(r, 24, r.price24h, r.pct24h),
    snowballStatsFmtHorizonPctCell(r, 48, r.price48h, r.pct48h),
    r.maxRoiPct != null && Number.isFinite(r.maxRoiPct) ? `${r.maxRoiPct.toFixed(2)}%` : "",
    r.durationToMfeHours != null && Number.isFinite(r.durationToMfeHours)
      ? `${r.durationToMfeHours.toFixed(2)}h`
      : "",
    r.signalMaxDdPct != null && Number.isFinite(r.signalMaxDdPct) ? `${r.signalMaxDdPct.toFixed(2)}%` : "",
    r.maxDrawdownPct != null && Number.isFinite(r.maxDrawdownPct) ? `${r.maxDrawdownPct.toFixed(2)}%` : "",
    r.followUpMaxAdversePct != null && Number.isFinite(r.followUpMaxAdversePct)
      ? `${r.followUpMaxAdversePct.toFixed(2)}%`
      : "",
    r.svpHoleYn ?? "",
    r.resultRr ?? "",
    marketSentimentFngLabel(r.marketSentiment),
    marketSentimentSentimentLabel(r.marketSentiment),
    marketSentimentBtcDominanceLabel(r.marketSentiment),
    marketSentimentVolChange24hLabel(r.marketSentiment),
    statsStrategyProfitCsvCell(
      r.pct24h,
      r.strategyProfitPct24h,
      r.strategyExitReason24h,
      sizing,
      STATS_STRATEGY_PROFIT_HOLD_24H,
      { maxDrawdownPct: r.maxDrawdownPct, followUpMaxAdversePct: r.followUpMaxAdversePct },
    ),
    statsStrategyProfitCsvCell(
      r.pct48h,
      r.strategyProfitPct,
      r.strategyExitReason,
      sizing,
      STATS_STRATEGY_PROFIT_HOLD_48H,
      { maxDrawdownPct: r.maxDrawdownPct, followUpMaxAdversePct: r.followUpMaxAdversePct },
    ),
    snowballOutcomeLabel(r.outcome),
  ];
}

export function snowballStatsToCsv(rows: SnowballStatsRow[], sizing?: StatsStrategyCsvSizing): string {
  return buildCsv(
    HEADERS,
    rows.map((r) => snowballStatsRowToCsvCells(r, sizing)),
  );
}
