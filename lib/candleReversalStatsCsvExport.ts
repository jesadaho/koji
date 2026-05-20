import {
  candleReversalDayOfWeekBkk,
  candleReversalGreenDaysLabel,
  candleReversalLookbackRankCell,
  candleReversalModelLabel,
  candleReversalModelShortLabel,
  candleReversalOutcomeLabel,
  candleReversalSignalBarTfLabel,
  candleReversalVolScoreLabel,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { buildCsv, statsCoinLabel, statsFmtBkk, statsFmtPctCell, statsFmtPrice } from "@/lib/statsCsv";

const HEADERS = [
  "symbol",
  "เหรียญ",
  "TF",
  "โมเดล",
  "โมเดล (เต็ม)",
  "เขียว",
  "วัน",
  "เวลา (BKK)",
  "Entry",
  "Retest",
  "SL",
  "ไส้%",
  "เนื้อ%",
  "Vol#",
  "High#",
  "Range",
  "Wick",
  "H1",
  "H2",
  "H3",
  "Max ROI",
  "Max DD",
  "ผล",
];

function reversalHorizonCsvCells(r: CandleReversalStatsRow): [string, string, string] {
  const tf = r.signalBarTf ?? "1d";
  if (tf === "1h") {
    return [
      statsFmtPctCell(r.price4h, r.pct4h),
      statsFmtPctCell(r.price12h, r.pct12h),
      statsFmtPctCell(r.price24h, r.pct24h),
    ];
  }
  return [
    statsFmtPctCell(r.price1d, r.pct1d),
    statsFmtPctCell(r.price3d, r.pct3d),
    statsFmtPctCell(r.price7d, r.pct7d),
  ];
}

function candleReversalStatsRowToCsvCells(r: CandleReversalStatsRow): string[] {
  const [h1, h2, h3] = reversalHorizonCsvCells(r);
  return [
    r.symbol,
    statsCoinLabel(r.symbol),
    candleReversalSignalBarTfLabel(r.signalBarTf ?? "1d"),
    candleReversalModelShortLabel(r.model),
    candleReversalModelLabel(r.model),
    candleReversalGreenDaysLabel(r.greenDaysBeforeSignal),
    candleReversalDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs),
    statsFmtBkk(r.alertedAtIso),
    statsFmtPrice(r.entryPrice),
    statsFmtPrice(r.retestPrice),
    statsFmtPrice(r.slPrice),
    r.wickRatioPct != null && Number.isFinite(r.wickRatioPct) ? `${r.wickRatioPct.toFixed(1)}%` : "",
    r.bodyPct != null && Number.isFinite(r.bodyPct) ? `${r.bodyPct.toFixed(1)}%` : "",
    candleReversalLookbackRankCell(r.volRankInLookback, r.lookbackBars),
    candleReversalLookbackRankCell(r.highRankInLookback, r.lookbackBars),
    candleReversalVolScoreLabel(r.rangeScore),
    candleReversalVolScoreLabel(r.wickScore),
    h1,
    h2,
    h3,
    r.maxRoiPct != null && Number.isFinite(r.maxRoiPct) ? `${r.maxRoiPct.toFixed(2)}%` : "",
    r.maxDrawdownPct != null && Number.isFinite(r.maxDrawdownPct) ? `${r.maxDrawdownPct.toFixed(2)}%` : "",
    candleReversalOutcomeLabel(r.outcome),
  ];
}

export function candleReversalStatsToCsv(rows: CandleReversalStatsRow[]): string {
  return buildCsv(
    HEADERS,
    rows.map((r) => candleReversalStatsRowToCsvCells(r)),
  );
}
