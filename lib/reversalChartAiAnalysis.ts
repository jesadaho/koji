/** Client-safe types for reversal chart AI analysis (stored on stats rows). */

export const REVERSAL_CHART_AI_ANALYSIS_VERSION = 1;

export type ReversalChartAiPreferredSide = "Long" | "Short" | "Skip";

export type ReversalChartAiMarketCharacter = "Trend" | "Range" | "Distribution" | "Accumulation";

export type ReversalChartAiExpectedPath =
  | "Trend Continue"
  | "Pullback then Continue"
  | "Sideway"
  | "Reversal";

export type ReversalChartAiAnalysis = {
  preferred_side: ReversalChartAiPreferredSide;
  confidence: number;
  trend_strength: number;
  exhaustion_risk: number;
  distribution_risk: number;
  market_character: ReversalChartAiMarketCharacter;
  expected_path: ReversalChartAiExpectedPath;
  expected_max_pullback_pct: number;
  reason: string;
};

export function reversalChartAiPreferredSideLabel(
  side: ReversalChartAiPreferredSide | null | undefined,
): string {
  if (side === "Long") return "Long";
  if (side === "Short") return "Short";
  if (side === "Skip") return "Skip";
  return "—";
}

export function reversalChartAiSideCellTitle(row: {
  chartAiAnalysisError?: string | null;
  chartAiPreferredSide?: ReversalChartAiPreferredSide | null;
  chartAiReason?: string | null;
}): string {
  const err = row.chartAiAnalysisError?.trim();
  if (err) return err;
  const reason = row.chartAiReason?.trim();
  if (reason) return reason;
  return reversalChartAiPreferredSideLabel(row.chartAiPreferredSide);
}

export function reversalChartAiMarketCharacterLabel(
  v: ReversalChartAiMarketCharacter | null | undefined,
): string {
  if (v === "Trend") return "Trend";
  if (v === "Range") return "Range";
  if (v === "Distribution") return "Distribution";
  if (v === "Accumulation") return "Accumulation";
  return "—";
}

export function reversalChartAiExpectedPathLabel(
  v: ReversalChartAiExpectedPath | null | undefined,
): string {
  if (v === "Trend Continue") return "Trend Continue";
  if (v === "Pullback then Continue") return "Pullback then Continue";
  if (v === "Sideway") return "Sideway";
  if (v === "Reversal") return "Reversal";
  return "—";
}

export function reversalChartAiConfidenceLabel(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? String(Math.round(v)) : "—";
}

export function reversalChartAiScoreLabel(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? String(Math.round(v)) : "—";
}

export function reversalChartAiPullbackLabel(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? `${v.toFixed(1)}%` : "—";
}

export function reversalChartAiExpectedPathShortLabel(
  v: ReversalChartAiExpectedPath | null | undefined,
): string {
  if (v === "Trend Continue") return "Cont";
  if (v === "Pullback then Continue") return "Pb→C";
  if (v === "Sideway") return "Side";
  if (v === "Reversal") return "Rev";
  return "—";
}

export function reversalChartAiMarketCharacterShortLabel(
  v: ReversalChartAiMarketCharacter | null | undefined,
): string {
  if (v === "Trend") return "Tr";
  if (v === "Range") return "Rg";
  if (v === "Distribution") return "Dist";
  if (v === "Accumulation") return "Acc";
  return "—";
}

/** คอลัมน์ AI ในตาราง Reversal 1H (AI Why อยู่ใน tooltip ของ AI Side) */
export const REVERSAL_CHART_AI_TABLE_COLUMN_COUNT = 9;
