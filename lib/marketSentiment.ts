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
  /** BTC dominance percentage */
  btcDominancePct: number;
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

