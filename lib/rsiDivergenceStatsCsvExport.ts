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
  "ผล",
  "F&G",
  "Sentiment",
  "BTC.D",
  "VolΔ24h",
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
  const ms = r.marketSentiment ?? null;
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
    rsiDivergenceOutcomeLabel(r.outcome),
    ms ? String(ms.fngValue) : "",
    ms ? ms.sentiment : "",
    ms && Number.isFinite(ms.btcDominancePct) ? `${ms.btcDominancePct.toFixed(1)}%` : "",
    ms && ms.volumeChangePct24hApprox != null && Number.isFinite(ms.volumeChangePct24hApprox)
      ? `${ms.volumeChangePct24hApprox >= 0 ? "+" : ""}${ms.volumeChangePct24hApprox.toFixed(1)}%`
      : "",
  ];
}

export function rsiDivergenceStatsToCsv(rows: RsiDivergenceStatsRow[]): string {
  return buildCsv(
    HEADERS,
    rows.map((r) => rsiDivergenceStatsRowToCsvCells(r)),
  );
}
