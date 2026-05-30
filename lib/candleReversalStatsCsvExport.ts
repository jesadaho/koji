import {
  candleReversalDayOfWeekBkk,
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
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { buildCsv, statsCoinLabel, statsFmtBkk, statsFmtPctCell, statsFmtPrice } from "@/lib/statsCsv";

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
  "Retest",
  "SL",
  "ไส้%",
  "เนื้อ%",
  "Len#",
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
  "ผล",
  "F&G",
  "Sentiment",
  "BTC.D",
  "VolΔ24h",
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

function candleReversalStatsRowToCsvCells(r: CandleReversalStatsRow): string[] {
  const [h1, h2, h3, h4] = reversalHorizonCsvCells(r);
  const ms = r.marketSentiment ?? null;
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
    statsFmtPrice(r.retestPrice),
    statsFmtPrice(r.slPrice),
    r.wickRatioPct != null && Number.isFinite(r.wickRatioPct) ? `${r.wickRatioPct.toFixed(1)}%` : "",
    r.bodyPct != null && Number.isFinite(r.bodyPct) ? `${r.bodyPct.toFixed(1)}%` : "",
    candleReversalLookbackRankCell(r.rangeRankInLookback, r.lookbackBars),
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
    candleReversalOutcomeLabel(r.outcome),
    ms ? String(ms.fngValue) : "",
    ms ? ms.sentiment : "",
    ms && Number.isFinite(ms.btcDominancePct) ? `${ms.btcDominancePct.toFixed(1)}%` : "",
    ms && ms.volumeChangePct24hApprox != null && Number.isFinite(ms.volumeChangePct24hApprox)
      ? `${ms.volumeChangePct24hApprox >= 0 ? "+" : ""}${ms.volumeChangePct24hApprox.toFixed(1)}%`
      : "",
  ];
}

export function candleReversalStatsToCsv(rows: CandleReversalStatsRow[]): string {
  return buildCsv(
    HEADERS,
    rows.map((r) => candleReversalStatsRowToCsvCells(r)),
  );
}
