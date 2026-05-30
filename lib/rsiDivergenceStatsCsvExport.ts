import {
  marketSentimentBtcDominanceLabel,
  marketSentimentFngLabel,
  marketSentimentSentimentLabel,
  marketSentimentVolChange24hLabel,
} from "@/lib/marketSentiment";
import {
  rsiDivergenceDayOfWeekBkk,
  rsiDivergenceKindLabel,
  rsiDivergenceOutcomeLabel,
  rsiDivergenceTfLabel,
  rsiDivergenceTriggerLabel,
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  type RsiDivergenceStatsRow,
} from "@/lib/rsiDivergenceStatsClient";
import {
  buildCsv,
  statsCoinLabel,
  statsFmtBkk,
  statsFmtPctCell,
  statsFmtPrice,
} from "@/lib/statsCsv";

const HEADERS = [
  "symbol",
  "เหรียญ",
  "TF",
  "ทิศ",
  "Trigger",
  "วัน",
  "เวลา (BKK)",
  "Entry",
  "Ref",
  "RSI W1",
  "RSI W2",
  "ΔRSI",
  "Strong",
  "Vol 24h",
  "MCap",
  "1d",
  "3d",
  "7d",
  "Max ROI",
  "Max DD",
  "Adv max",
  "F&G",
  "Sentiment",
  "BTC.D",
  "VolΔ24h",
  "ผล",
];

function fmtRsi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v.toFixed(1);
}

function fmtRsiDelta(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v.toFixed(2);
}

function rsiDivergenceStatsRowToCsvCells(r: RsiDivergenceStatsRow): string[] {
  return [
    r.symbol,
    statsCoinLabel(r.symbol),
    rsiDivergenceTfLabel(r.tf),
    rsiDivergenceKindLabel(r.kind),
    rsiDivergenceTriggerLabel(r.trigger),
    rsiDivergenceDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs),
    statsFmtBkk(r.alertedAtIso),
    statsFmtPrice(r.entryPrice),
    statsFmtPrice(r.refLevel),
    fmtRsi(r.rsiW1),
    fmtRsi(r.rsiW2),
    fmtRsiDelta(r.rsiDelta),
    r.strong ? "Y" : "N",
    snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt),
    snowballStatsMarketCapUsdLabel(r.marketCapUsd),
    statsFmtPctCell(r.price1d, r.pct1d),
    statsFmtPctCell(r.price3d, r.pct3d),
    statsFmtPctCell(r.price7d, r.pct7d),
    r.maxRoiPct != null && Number.isFinite(r.maxRoiPct) ? `${r.maxRoiPct.toFixed(2)}%` : "",
    r.maxDrawdownPct != null && Number.isFinite(r.maxDrawdownPct)
      ? `${r.maxDrawdownPct.toFixed(2)}%`
      : "",
    r.followUpMaxAdversePct != null && Number.isFinite(r.followUpMaxAdversePct)
      ? `${r.followUpMaxAdversePct.toFixed(2)}%`
      : "",
    marketSentimentFngLabel(r.marketSentiment),
    marketSentimentSentimentLabel(r.marketSentiment),
    marketSentimentBtcDominanceLabel(r.marketSentiment),
    marketSentimentVolChange24hLabel(r.marketSentiment),
    rsiDivergenceOutcomeLabel(r.outcome),
  ];
}

export function rsiDivergenceStatsToCsv(rows: RsiDivergenceStatsRow[]): string {
  return buildCsv(
    HEADERS,
    rows.map((r) => rsiDivergenceStatsRowToCsvCells(r)),
  );
}
