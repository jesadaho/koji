import {
  marketSentimentFngLabel,
  marketSentimentSentimentLabel,
} from "@/lib/marketSentiment";
import {
  candleReversalDayOfWeekBkk,
  candleReversalEmaSlopeCsvLabel,
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
  statsStrategyProfitCsvCell,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  type StatsStrategyCsvSizing,
} from "@/lib/statsStrategyProfitClient";
import { reversalStatsStrategyProfitResolvedForHorizon } from "@/lib/reversalTpStrategy";

export type { StatsStrategyCsvSizing } from "@/lib/statsStrategyProfitClient";
import {
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
} from "@/lib/snowballStatsClient";
import { statsAtrPct14dLabel } from "@/lib/statsAtrPct14d";
import { statsLenPercentileLabel } from "@/lib/statsLenPercentile";
import {
  statsPsar4hDistPctCsv,
  statsPsar4hTrendLabel,
} from "@/lib/statsPsar4h";
import { buildCsv, statsCoinLabel, statsFmtBkk, statsFmtPctCell, statsFmtPrice } from "@/lib/statsCsv";
import {
  pumpCycleAgeHoursCsvCell,
  pumpCycleSwingLowPriceCsvCell,
  pumpCycleSwingLowSourceCsvCell,
  pumpCycleSwingLowTimeCsvCell,
  pumpCycleTrendGainCsvCell,
  pumpCycleTrendVelocityCsvCell,
} from "@/lib/pumpCycleSwingLow";

const HEADERS = [
  "symbol",
  "เหรียญ",
  "TF",
  "Side",
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
  "EMA20 1h dist %",
  "EMA4h slope 7d %",
  "EMA1d slope 7d %",
  "BTC EMA20 4h dist %",
  "BTC EMA1d slope 7d %",
  "SAR 4h",
  "SAR dist 4h %",
  "ATR% 14D",
  "Retest",
  "SL",
  "ไส้บน%",
  "ไส้ล่าง%",
  "เนื้อ%",
  "Len#",
  "Len%",
  "Vol#",
  "Vol×SMA",
  "High#",
  "Low#",
  "Range",
  "Wick",
  "H1",
  "H2",
  "H3",
  "H4",
  "Max ROI",
  "Max DD",
  "สวน max",
  "F&G",
  "Sentiment",
  "กำไรกลยุทธ์ 24h",
  "กำไรกลยุทธ์ 48h",
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
    candleReversalEmaSlopeCsvLabel(r.priceVsEma20_1hPct),
    candleReversalEmaSlopeCsvLabel(r.ema4hSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.ema1dSlopePct7d),
    candleReversalEmaSlopeCsvLabel(r.btcPriceVsEma20_4hPct),
    candleReversalEmaSlopeCsvLabel(r.btcEma1dSlopePct7d),
    statsPsar4hTrendLabel(r.psar4hTrend),
    statsPsar4hDistPctCsv(r.psar4hDistPct),
    statsAtrPct14dLabel(r.atrPct14d),
    statsFmtPrice(r.retestPrice),
    statsFmtPrice(r.slPrice),
    (r.tradeSide ?? "short") === "short"
      ? candleReversalWickRatioPctLabel(r.wickRatioPct).replace("—", "")
      : "",
    (r.tradeSide ?? "short") === "short"
      ? candleReversalWickRatioPctLabel(r.lowerWickRatioPct).replace("—", "")
      : candleReversalWickRatioPctLabel(r.wickRatioPct).replace("—", ""),
    r.bodyPct != null && Number.isFinite(r.bodyPct) ? `${r.bodyPct.toFixed(1)}%` : "",
    candleReversalLookbackRankCell(r.rangeRankInLookback, r.lookbackBars),
    statsLenPercentileLabel(r.lenPercentilePct),
    candleReversalLookbackRankCell(r.volRankInLookback, r.lookbackBars),
    candleReversalSignalVolVsSmaLabel(r.signalVolVsSma),
    candleReversalLookbackRankCell(r.highRankInLookback, r.lookbackBars),
    candleReversalLowLookbackRankCell(r.lowRankInLookback, r.lookbackBars),
    candleReversalVolScoreLabel(r.rangeScore),
    candleReversalVolScoreLabel(r.wickScore),
    h1,
    h2,
    h3,
    h4,
    r.maxRoiPct != null && Number.isFinite(r.maxRoiPct) ? `${r.maxRoiPct.toFixed(2)}%` : "",
    r.maxDrawdownPct != null && Number.isFinite(r.maxDrawdownPct) ? `${r.maxDrawdownPct.toFixed(2)}%` : "",
    r.followUpMaxAdversePct != null && Number.isFinite(r.followUpMaxAdversePct)
      ? `${r.followUpMaxAdversePct.toFixed(2)}%`
      : "",
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
