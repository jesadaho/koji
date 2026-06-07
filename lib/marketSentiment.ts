/** Client-safe market sentiment snapshot (no Node/Redis). */

export type MarketSentimentLabel = "Bullish" | "Neutral" | "Bearish";

export type MarketSentimentSnapshot = {
  /** ISO-8601 time when snapshot computed */
  asOfIso: string;
  /** Fear & Greed value (0–100) */
  fngValue: number;
  /** Raw classification text from source */
  fngClassification: string;
  /** Derived coarse sentiment label */
  sentiment: MarketSentimentLabel;
  /** BTC dominance percentage — null เมื่อ backfill ย้อนหลัง (มีแค่ F&G) */
  btcDominancePct: number | null;
  /** % change vs ~24h volume snapshot (approx); null if insufficient history */
  volumeChangePct24hApprox: number | null;
  /** Which backend source was used */
  source: "cmc" | "alt_coingecko";
};

export function marketSentimentFromFng(value: number): MarketSentimentLabel {
  if (!Number.isFinite(value)) return "Neutral";
  if (value >= 56) return "Bullish";
  if (value <= 44) return "Bearish";
  return "Neutral";
}

const MS_DASH = "—";

export function marketSentimentFngLabel(ms: MarketSentimentSnapshot | null | undefined): string {
  if (!ms || !Number.isFinite(ms.fngValue)) return MS_DASH;
  return String(Math.round(ms.fngValue));
}

export function marketSentimentSentimentLabel(ms: MarketSentimentSnapshot | null | undefined): string {
  return ms?.sentiment ?? MS_DASH;
}

export function marketSentimentBtcDominanceLabel(ms: MarketSentimentSnapshot | null | undefined): string {
  const v = ms?.btcDominancePct;
  if (v == null || !Number.isFinite(v) || v <= 0) return MS_DASH;
  return `${v.toFixed(1)}%`;
}

export function marketSentimentVolChange24hLabel(ms: MarketSentimentSnapshot | null | undefined): string {
  const v = ms?.volumeChangePct24hApprox;
  if (v == null || !Number.isFinite(v)) return MS_DASH;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

