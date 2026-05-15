/** Client-safe Snowball stats types + Grade label (no Node.js / Redis). */

export type SnowballStatsOutcome = "pending" | "win_trend" | "win_quick_tp30" | "loss" | "flat";

export type SnowballStatsQualityTier = "a_plus" | "b_plus" | "c_plus";

export type SnowballStatsRow = {
  id: string;
  symbol: string;
  side: "long" | "short";
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  signalBarLow?: number | null;
  signalBarTf?: "15m" | "1h" | "4h";
  entryPrice: number;
  intrabar: boolean;
  triggerKind: string;
  qualityTier?: SnowballStatsQualityTier;
  svpHoleYn: "Y" | "N";
  price4h: number | null;
  pct4h: number | null;
  price12h: number | null;
  pct12h: number | null;
  price24h: number | null;
  pct24h: number | null;
  maxRoiPct: number | null;
  durationToMfeHours: number | null;
  maxDrawdownPct: number | null;
  resultRr: string | null;
  outcome: SnowballStatsOutcome;
};

export type SnowballStatsApiPayload = {
  rows: SnowballStatsRow[];
};

/** A+/B/C สำหรับตารางสถิติ (LONG = HH48/HH200/VAH · SHORT = Double Barrier) */
export function snowballStatsGradeLabel(
  side: SnowballStatsRow["side"],
  tier: SnowballStatsRow["qualityTier"] | undefined
): string {
  if (!tier) return "—";
  if (tier === "a_plus") return "A+";
  if (tier === "b_plus") return "B";
  if (tier === "c_plus") return side === "short" ? "—" : "C";
  return "—";
}
