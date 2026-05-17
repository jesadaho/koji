/** Client-safe candle reversal stats types (no Node.js / Redis). */

export type CandleReversalSignalBarTf = "1d" | "1h";

export type CandleReversalModel = "inverted_doji" | "marubozu" | "longest_red_body";

export type CandleReversalOutcome = "pending" | "win" | "loss" | "flat";

export type CandleReversalStatsRow = {
  id: string;
  symbol: string;
  signalBarTf: CandleReversalSignalBarTf;
  model: CandleReversalModel;
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  entryPrice: number;
  retestPrice: number;
  slPrice: number;
  wickRatioPct: number | null;
  bodyPct: number | null;
  /** อันดับ high ในรอบ lookbackBars (1 = สูงสุด) */
  highRankInLookback: number | null;
  /** อันดับ volume ในรอบ lookbackBars (1 = สูงสุด) */
  volRankInLookback: number | null;
  lookbackBars: number | null;
  rangeScore: number | null;
  wickScore: number | null;
  afterInvertedDoji: boolean;
  price1d: number | null;
  pct1d: number | null;
  price3d: number | null;
  pct3d: number | null;
  price7d: number | null;
  pct7d: number | null;
  maxRoiPct: number | null;
  durationToMfeHours: number | null;
  maxDrawdownPct: number | null;
  outcome: CandleReversalOutcome;
};

export type CandleReversalStatsApiPayload = {
  rows: CandleReversalStatsRow[];
  /** true เมื่อ Telegram user อยู่ใน KOJI_ADMIN_IDS */
  isAdmin?: boolean;
};

export function candleReversalSignalBarTfLabel(tf: CandleReversalSignalBarTf): string {
  return tf.toUpperCase();
}

export function candleReversalModelLabel(model: CandleReversalModel): string {
  if (model === "inverted_doji") return "โดจิกลับหัว";
  if (model === "longest_red_body") return "แท่งแดงทุบยาว";
  return "แท่งแดงทุบ";
}

export function candleReversalOutcomeLabel(o: CandleReversalOutcome): string {
  if (o === "pending") return "Pending";
  if (o === "win") return "Win";
  if (o === "loss") return "Loss";
  return "Flat";
}

export function candleReversalVolScoreLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

/** อันดับในรอบ lookback — เช่น 2/24 */
export function candleReversalLookbackRankCell(
  rank: number | null | undefined,
  lookbackBars: number | null | undefined,
): string {
  if (rank == null || lookbackBars == null || !Number.isFinite(rank) || !Number.isFinite(lookbackBars)) {
    return "—";
  }
  return `${Math.floor(rank)}/${Math.floor(lookbackBars)}`;
}

export function candleReversalDayOfWeekBkk(alertedAtIso: string, alertedAtMs?: number | null): string {
  const ms =
    alertedAtMs != null && Number.isFinite(alertedAtMs)
      ? alertedAtMs
      : Date.parse(alertedAtIso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "short" });
}
