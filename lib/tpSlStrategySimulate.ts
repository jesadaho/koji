/**
 * จำลองกำไร % (เทียบ entry เต็มโน้ต) ตามกลยุทธ์ auto-open TP/SL บนแท่ง 15m
 * TP1 partial → SL @ entry → TP2 → ปิดที่ 48h
 */

export type StatsTpSlPlan = {
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  maxHoldHours: number;
};

/** ค่า default ตรง Settings / auto-open (Reversal + Snowball) */
export const DEFAULT_STATS_TPSL_PLAN: StatsTpSlPlan = {
  tp1PricePct: 10,
  tp1PartialPct: 50,
  tp2PricePct: 25,
  maxHoldHours: 48,
};

export type StatsTpSlExitReason =
  | "tp2_full"
  | "tp1_be"
  | "tp1_tp2"
  | "tp1_48h"
  | "tp1_only"
  | "time_48h";

export function statsTpSlPlanSummary(plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN): string {
  return `TP1 ${plan.tp1PricePct}%×${plan.tp1PartialPct}% · TP2 ${plan.tp2PricePct}% · SL@entry · ${plan.maxHoldHours}h`;
}

function tp1PartialFraction(plan: StatsTpSlPlan): number {
  return Math.min(0.99, Math.max(0.01, plan.tp1PartialPct / 100));
}

/** กำไร % สูงสุด (เทียบ notional เต็ม) ตาม exit path — ใช้อธิบายใน UI */
export function statsTpSlTheoreticalMaxProfitPct(
  reason: StatsTpSlExitReason,
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
): number | null {
  const f = tp1PartialFraction(plan);
  if (reason === "tp2_full") return plan.tp2PricePct;
  if (reason === "tp1_only") return f * plan.tp1PricePct;
  if (reason === "tp1_tp2") return f * plan.tp1PricePct + (1 - f) * plan.tp2PricePct;
  return null;
}

/** แยกส่วน TP1 / TP2 สำหรับ tooltip (เทียบ notional เต็ม) */
export function statsTpSlProfitLegBreakdown(
  reason: StatsTpSlExitReason,
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
): { tp1LegPct: number; tp2LegPct: number } | null {
  if (reason !== "tp1_tp2" && reason !== "tp1_only" && reason !== "tp2_full") return null;
  const f = tp1PartialFraction(plan);
  if (reason === "tp2_full") return { tp1LegPct: 0, tp2LegPct: plan.tp2PricePct };
  if (reason === "tp1_only") return { tp1LegPct: f * plan.tp1PricePct, tp2LegPct: 0 };
  return {
    tp1LegPct: f * plan.tp1PricePct,
    tp2LegPct: (1 - f) * plan.tp2PricePct,
  };
}

function favorablePctInBar(
  side: "long" | "short",
  entry: number,
  high: number,
  low: number,
): number {
  if (!(entry > 0)) return NaN;
  if (side === "long") return ((high - entry) / entry) * 100;
  return ((entry - low) / entry) * 100;
}

function breakevenSlHit(
  side: "long" | "short",
  entry: number,
  high: number,
  low: number,
): boolean {
  if (side === "long") return low <= entry;
  return high >= entry;
}

export function simulateStatsTpSlProfit(input: {
  side: "long" | "short";
  entry: number;
  high: number[];
  low: number[];
  iFirst: number;
  iLast: number;
  pctAt48h: number;
  plan?: StatsTpSlPlan;
}): { profitPct: number; exitReason: StatsTpSlExitReason } | null {
  const plan = input.plan ?? DEFAULT_STATS_TPSL_PLAN;
  const entry = input.entry;
  if (!(entry > 0) || input.iFirst < 0 || input.iLast < input.iFirst) return null;
  if (!Number.isFinite(input.pctAt48h)) return null;

  const tp1 = plan.tp1PricePct;
  const tp2 = plan.tp2PricePct;
  const partialFrac = Math.min(0.99, Math.max(0.01, plan.tp1PartialPct / 100));

  let rem = 1;
  let profit = 0;
  let tp1Done = false;
  let exitReason: StatsTpSlExitReason = "time_48h";

  for (let i = input.iFirst; i <= input.iLast; i++) {
    if (rem <= 0) break;
    const hi = input.high[i]!;
    const lo = input.low[i]!;
    const fav = favorablePctInBar(input.side, entry, hi, lo);
    if (!Number.isFinite(fav)) continue;

    if (!tp1Done) {
      if (fav >= tp2) {
        profit += rem * tp2;
        rem = 0;
        exitReason = "tp2_full";
        break;
      }
      if (fav >= tp1) {
        profit += rem * partialFrac * tp1;
        rem *= 1 - partialFrac;
        tp1Done = true;
        if (rem <= 1e-9) {
          rem = 0;
          exitReason = "tp1_only";
          break;
        }
      }
    }

    if (tp1Done && rem > 0) {
      if (breakevenSlHit(input.side, entry, hi, lo)) {
        rem = 0;
        exitReason = "tp1_be";
        break;
      }
      if (fav >= tp2) {
        profit += rem * tp2;
        rem = 0;
        exitReason = "tp1_tp2";
        break;
      }
    }
  }

  if (rem > 0) {
    profit += rem * input.pctAt48h;
    if (tp1Done) exitReason = "tp1_48h";
    else exitReason = "time_48h";
  }

  if (!Number.isFinite(profit)) return null;
  return { profitPct: profit, exitReason };
}
