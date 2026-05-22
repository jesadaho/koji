import {
  snowballStatsBarRangePctLabel,
  snowballStatsBtcPsar1hLabel,
  snowballStatsBtcPsar4hLabel,
  snowballStatsConfirmVolRankLabel,
  snowballStatsConfirmVolVsSmaLabel,
  snowballStatsDayOfWeekBkk,
  snowballStatsFmtHorizonPctCell,
  snowballStatsFundingRateLabel,
  snowballStatsGradeDisplayLabel,
  snowballStatsStructureTierLabel,
  snowballStatsGreenDaysLabel,
  snowballStatsMaxDrawback1hLabel,
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  snowballStatsSideLabel,
  snowballStatsVolScoreLabel,
  snowballStatsVolumeCascadeLabel,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import { buildCsv, statsCoinLabel, statsFmtBkk, statsFmtPctCell, statsFmtPrice } from "@/lib/statsCsv";

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
  "BTC 4h",
  "Vol 24h",
  "Funding",
  "DD 1H%",
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
  "Max DD",
  "SVP Hole",
  "RR",
  "ผล",
];

function snowballOutcomeLabel(o: SnowballStatsRow["outcome"]): string {
  if (o === "pending") return "Pending";
  if (o === "win_quick_tp30") return "Win (Quick TP30%)";
  if (o === "win_trend") return "Win (Trend)";
  if (o === "loss") return "Loss";
  return "Flat";
}

function snowballStatsRowToCsvCells(r: SnowballStatsRow): string[] {
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
    snowballStatsBarRangePctLabel(r.barRangePctPrev),
    snowballStatsBarRangePctLabel(r.barRangePctSignal),
    snowballStatsBarRangePctLabel(r.barRangePct2Sum),
    snowballStatsBtcPsar4hLabel(r.btcPsar4hTrend),
    snowballStatsBtcPsar1hLabel(r.btcPsar1hTrend),
    snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt),
    snowballStatsMarketCapUsdLabel(r.marketCapUsd),
    snowballStatsFundingRateLabel(r.fundingRate),
    snowballStatsMaxDrawback1hLabel(r.maxDrawback1hPct),
    snowballStatsVolumeCascadeLabel(r.volumeCascadeYn),
    snowballStatsGreenDaysLabel(r.greenDaysBeforeSignal),
    snowballStatsConfirmVolVsSmaLabel(r.confirmVolVsSma),
    snowballStatsConfirmVolRankLabel(r.confirmVolRank, r.confirmVolRankLb),
    statsFmtPctCell(r.price4h, r.pct4h),
    snowballStatsFmtHorizonPctCell(r, 12, r.price12h, r.pct12h),
    snowballStatsFmtHorizonPctCell(r, 24, r.price24h, r.pct24h),
    snowballStatsFmtHorizonPctCell(r, 48, r.price48h, r.pct48h),
    r.maxRoiPct != null && Number.isFinite(r.maxRoiPct) ? `${r.maxRoiPct.toFixed(2)}%` : "",
    r.durationToMfeHours != null && Number.isFinite(r.durationToMfeHours)
      ? `${r.durationToMfeHours.toFixed(2)}h`
      : "",
    r.maxDrawdownPct != null && Number.isFinite(r.maxDrawdownPct) ? `${r.maxDrawdownPct.toFixed(2)}%` : "",
    r.svpHoleYn ?? "",
    r.resultRr ?? "",
    snowballOutcomeLabel(r.outcome),
  ];
}

export function snowballStatsToCsv(rows: SnowballStatsRow[]): string {
  return buildCsv(
    HEADERS,
    rows.map((r) => snowballStatsRowToCsvCells(r)),
  );
}
