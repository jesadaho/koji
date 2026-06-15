/**
 * จำลองกำไร % (เทียบ entry เต็มโน้ต) ตามกลยุทธ์ auto-open TP/SL บนแท่ง 15m
 * ROI ≥ slAtEntryArmRoiPct → SL บังทุน (offset จาก entry) · TP1 partial · TP2 · maxHold
 */

import {
  breakevenSlTriggered,
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  slBreakevenRemainderLossPct,
  slAtEntryArmPctFromPlan,
  slEntryOffsetPctFromPlan,
} from "@/lib/tpSlBreakevenPlan";

export type StatsTpSlPlan = {
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  /** จังหวะ 1 — ถือ x ชม. แล้วเช็คปิด/ขยาย */
  maxHoldHours: number;
  /** ถ้าเปิด: ครบจังหวะ 1 แล้วยังแดง → ถือต่ออีก maxHoldHours ชม. */
  holdExtendIfRedEnabled?: boolean;
  /** ROI ถึงค่านี้แล้วตั้ง SL บังทุน (แยกจาก TP1 partial) */
  slAtEntryArmRoiPct?: number;
  /** % ราคาสวนจาก entry ที่วาง SL (0 = @entry) */
  slAtEntryOffsetPct?: number;
};

/** @deprecated ใช้ DEFAULT_SL_ARM_ROI_PCT จาก tpSlBreakevenPlan */
export const STATS_SL_AT_ENTRY_ARM_ROI_PCT = DEFAULT_SL_ARM_ROI_PCT;

export { DEFAULT_SL_ARM_ROI_PCT, DEFAULT_SL_ENTRY_OFFSET_PCT };

/** ค่า default ตรง Settings / auto-open (Reversal + Snowball) */
export const DEFAULT_STATS_TPSL_PLAN: StatsTpSlPlan = {
  tp1PricePct: 10,
  tp1PartialPct: 50,
  tp2PricePct: 25,
  maxHoldHours: 48,
  slAtEntryArmRoiPct: DEFAULT_SL_ARM_ROI_PCT,
  slAtEntryOffsetPct: DEFAULT_SL_ENTRY_OFFSET_PCT,
};

export type StatsTpSlExitReason =
  | "tp2_full"
  | "tp1_be"
  | "tp1_tp2"
  | "tp1_24h"
  | "tp1_48h"
  | "tp1_only"
  | "time_24h"
  | "time_48h"
  | "liquidated";

function holdTimeExitReason(plan: StatsTpSlPlan, afterTp1: boolean): StatsTpSlExitReason {
  if (afterTp1) return plan.maxHoldHours <= 24 ? "tp1_24h" : "tp1_48h";
  return plan.maxHoldHours <= 24 ? "time_24h" : "time_48h";
}

export function statsTpSlPlanSummary(plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN): string {
  const arm = slAtEntryArmPctFromPlan(plan);
  const off = slEntryOffsetPctFromPlan(plan);
  const slTag =
    off > 0 ? `ROI≥${arm}%→SL±${off}%` : `ROI≥${arm}%→SL@entry`;
  const holdTag = plan.holdExtendIfRedEnabled
    ? `${plan.maxHoldHours}h+${plan.maxHoldHours}hถ้าแดง`
    : `${plan.maxHoldHours}h`;
  return `TP1 ${plan.tp1PricePct}%×${plan.tp1PartialPct}% · ${slTag} · TP2 ${plan.tp2PricePct}% · ${holdTag}`;
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

export function favorablePctInBar(
  side: "long" | "short",
  entry: number,
  high: number,
  low: number,
): number {
  if (!(entry > 0)) return NaN;
  if (side === "long") return ((high - entry) / entry) * 100;
  return ((entry - low) / entry) * 100;
}

/** MFE สูงสุด (%) ในช่วงแท่ง iFirst..iLast — ใช้ร่วมกับ Max ROI และตรวจ TP */
export function maxFavorablePctInRange(
  side: "long" | "short",
  entry: number,
  high: number[],
  low: number[],
  iFirst: number,
  iLast: number,
): number | null {
  if (!(entry > 0) || iFirst < 0 || iLast < iFirst) return null;
  let max = -Infinity;
  for (let i = iFirst; i <= iLast; i++) {
    const fav = favorablePctInBar(side, entry, high[i]!, low[i]!);
    if (Number.isFinite(fav)) max = Math.max(max, fav);
  }
  return Number.isFinite(max) ? max : null;
}

function minFavorablePctForTpExit(
  reason: StatsTpSlExitReason,
  plan: StatsTpSlPlan,
): number | null {
  if (reason === "tp2_full" || reason === "tp1_tp2") return plan.tp2PricePct;
  if (reason === "tp1_only" || reason === "tp1_be" || reason === "tp1_24h" || reason === "tp1_48h") {
    return plan.tp1PricePct;
  }
  return null;
}

/** exit อ้าง TP แต่ Max ROI ที่บันทึกต่ำกว่าเกณฑ์ — cache กำไรกลยุทธ์ไม่น่าเชื่อถือ */
export function tpExitExceedsMaxRoi(
  exitReason: StatsTpSlExitReason,
  plan: StatsTpSlPlan,
  maxRoiPct: number | null | undefined,
): boolean {
  const need = minFavorablePctForTpExit(exitReason, plan);
  if (need == null) return false;
  if (maxRoiPct == null || !Number.isFinite(maxRoiPct)) return false;
  return maxRoiPct + 1e-6 < need;
}

/** ถ้า exit อ้าง TP แต่ MFE ในช่วงไม่ถึงเกณฑ์ — ใช้ผลถือครบแทน (กันขัดกับ Max ROI) */
function reconcileTpExitWithMaxFavorable(input: {
  side: "long" | "short";
  entry: number;
  high: number[];
  low: number[];
  iFirst: number;
  iLast: number;
  pctAt48h: number;
  plan: StatsTpSlPlan;
  profitPct: number;
  exitReason: StatsTpSlExitReason;
  tp1Done: boolean;
}): { profitPct: number; exitReason: StatsTpSlExitReason } {
  const need = minFavorablePctForTpExit(input.exitReason, input.plan);
  if (need == null) return { profitPct: input.profitPct, exitReason: input.exitReason };
  const maxFav = maxFavorablePctInRange(
    input.side,
    input.entry,
    input.high,
    input.low,
    input.iFirst,
    input.iLast,
  );
  if (maxFav == null || maxFav + 1e-6 >= need) {
    return { profitPct: input.profitPct, exitReason: input.exitReason };
  }
  return {
    profitPct: input.pctAt48h,
    exitReason: holdTimeExitReason(input.plan, input.tp1Done),
  };
}

/** การเคลื่อนไหวสวนทางจาก entry ในแท่งเดียว (%) */
export function adversePctInBar(
  side: "long" | "short",
  entry: number,
  high: number,
  low: number,
): number {
  if (!(entry > 0)) return NaN;
  if (side === "long") return ((entry - low) / entry) * 100;
  return ((high - entry) / entry) * 100;
}

function isolatedLiquidationPricePct(leverage: number): number {
  return 100 / leverage;
}

export function simulateStatsTpSlProfit(input: {
  side: "long" | "short";
  entry: number;
  high: number[];
  low: number[];
  iFirst: number;
  iLast: number;
  pctAt48h: number;
  /** % ที่จังหวะ 1 (ก่อนขยาย) — default = pctAt48h */
  pctAtPhase1?: number | null;
  /** index สุดท้ายของจังหวะ 1 บนแท่ง 15m */
  iPhase1Last?: number;
  plan?: StatsTpSlPlan;
  /** isolated margin — แตะสวน > 100/leverage% ในแท่งใดแท่งหนึ่ง = liquidate */
  leverage?: number | null;
}): { profitPct: number; exitReason: StatsTpSlExitReason } | null {
  const plan = input.plan ?? DEFAULT_STATS_TPSL_PLAN;
  const entry = input.entry;
  if (!(entry > 0) || input.iFirst < 0 || input.iLast < input.iFirst) return null;
  if (!Number.isFinite(input.pctAt48h)) return null;

  const phase1Hours = plan.maxHoldHours > 0 ? plan.maxHoldHours : 48;
  const iPhase1Last =
    typeof input.iPhase1Last === "number" && input.iPhase1Last >= input.iFirst
      ? Math.min(input.iPhase1Last, input.iLast)
      : input.iLast;
  const pctPhase1 =
    input.pctAtPhase1 != null && Number.isFinite(input.pctAtPhase1)
      ? input.pctAtPhase1
      : input.pctAt48h;
  const extendRed =
    plan.holdExtendIfRedEnabled === true &&
    iPhase1Last < input.iLast &&
    pctPhase1 < 0;

  const tp1 = plan.tp1PricePct;
  const slArm = slAtEntryArmPctFromPlan(plan);
  const slOffset = slEntryOffsetPctFromPlan(plan);
  const tp2 = plan.tp2PricePct;
  const partialFrac = Math.min(0.99, Math.max(0.01, plan.tp1PartialPct / 100));
  const liqPct =
    input.leverage != null && Number.isFinite(input.leverage) && input.leverage > 0
      ? isolatedLiquidationPricePct(input.leverage)
      : null;

  let rem = 1;
  let profit = 0;
  let tp1Done = false;
  /** ROI ถึง slArm% แล้ว — SL บังทุนที่ entry (ไม่ต้องรอ partial TP1) */
  let slAtEntryArmed = false;
  let exitReason: StatsTpSlExitReason = holdTimeExitReason(plan, false);
  let holdExtendedForRed = false;

  for (let i = input.iFirst; i <= input.iLast; i++) {
    if (rem <= 0) break;
    const hi = input.high[i]!;
    const lo = input.low[i]!;
    const beProtected = slAtEntryArmed || tp1Done;
    if (liqPct != null && !beProtected) {
      const adv = adversePctInBar(input.side, entry, hi, lo);
      if (Number.isFinite(adv) && adv > liqPct) {
        return { profitPct: -liqPct, exitReason: "liquidated" };
      }
    }
    const fav = favorablePctInBar(input.side, entry, hi, lo);
    if (!Number.isFinite(fav)) continue;

    if (!tp1Done && fav >= tp2) {
      profit += rem * tp2;
      rem = 0;
      exitReason = "tp2_full";
      break;
    }

    if (!tp1Done && fav >= tp1) {
      profit += rem * partialFrac * tp1;
      rem *= 1 - partialFrac;
      tp1Done = true;
      if (rem <= 1e-9) {
        rem = 0;
        exitReason = "tp1_only";
        break;
      }
    }

    // อย่าย้าย SL@entry ก่อนแตะ TP1 — กัน ROI ค้างระหว่าง slArm กับ tp1 แล้วโดน BE
    if ((tp1Done || fav >= tp1) && fav >= slArm) {
      slAtEntryArmed = true;
    }

    if (slAtEntryArmed && rem > 0) {
      if (breakevenSlTriggered(input.side, entry, slOffset, hi, lo)) {
        profit += rem * slBreakevenRemainderLossPct(slOffset);
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

    if (rem > 0 && i === iPhase1Last) {
      if (extendRed && !holdExtendedForRed) {
        holdExtendedForRed = true;
        continue;
      }
      const pctExit = holdExtendedForRed || iPhase1Last === input.iLast ? input.pctAt48h : pctPhase1;
      profit += rem * pctExit;
      rem = 0;
      exitReason = holdTimeExitReason(
        { ...plan, maxHoldHours: holdExtendedForRed ? phase1Hours * 2 : phase1Hours },
        tp1Done,
      );
      break;
    }
  }

  if (rem > 0) {
    profit += rem * input.pctAt48h;
    exitReason = holdTimeExitReason(
      { ...plan, maxHoldHours: holdExtendedForRed ? phase1Hours * 2 : phase1Hours },
      tp1Done,
    );
  }

  if (!Number.isFinite(profit)) return null;
  return reconcileTpExitWithMaxFavorable({
    side: input.side,
    entry,
    high: input.high,
    low: input.low,
    iFirst: input.iFirst,
    iLast: input.iLast,
    pctAt48h: input.pctAt48h,
    plan,
    profitPct: profit,
    exitReason,
    tp1Done,
  });
}
