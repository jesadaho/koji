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
  /** Wilder ATR(100) ตอนแจ้ง — baseline ความผันผวน */
  atr100?: number | null;
  /** Max upper wick 100 แท่งก่อนสัญญาณ — เพดานไส้บน */
  maxUpperWick100?: number | null;
  /** (H−L) แท่งสัญญาณ / ATR(100) */
  rangeScore?: number | null;
  /** UpperWick แท่งสัญญาณ / MaxWick(100) */
  wickScore?: number | null;
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

/** แสดงค่า ATR / Max Wick ในตาราง (ราคา + % ของ entry ถ้ามี) */
export function snowballStatsVolMetricLabel(
  value: number | null | undefined,
  entryPrice: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  let px: string;
  if (abs >= 1000) px = value.toFixed(2);
  else if (abs >= 1) px = value.toFixed(4);
  else px = value.toFixed(6);
  if (entryPrice != null && Number.isFinite(entryPrice) && entryPrice > 0) {
    const pct = (value / entryPrice) * 100;
    return `${px} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  }
  return px;
}

/** แสดง Range / Wick score (อัตราส่วนไม่มีหน่วย) */
export function snowballStatsVolScoreLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}
