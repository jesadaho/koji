import type { CSSProperties } from "react";
import { excludePendingConflictRows } from "@/lib/signalPendingConflict";
import {
  DEFAULT_STATS_TPSL_PLAN,
  simulateStatsTpSlProfit,
  statsTpSlPlanSummary,
  statsTpSlProfitLegBreakdown,
  statsTpSlTheoreticalMaxProfitPct,
  type StatsTpSlExitReason,
  type StatsTpSlPlan,
} from "@/lib/tpSlStrategySimulate";

export type StrategyProfitByPlanEntry = {
  profitPct: number;
  exitReason: StatsTpSlExitReason;
};

export type StrategyProfitByPlanMap = Partial<Record<string, StrategyProfitByPlanEntry>>;

export type StatsStrategyCsvSizing = {
  marginUsdt?: number | null;
  leverage?: number | null;
};

export { DEFAULT_STATS_TPSL_PLAN, statsTpSlPlanSummary };

export type StatsStrategyProfitHorizon = 24 | 48;

export const STATS_STRATEGY_PROFIT_HOLD_24H = 24 as const;
export const STATS_STRATEGY_PROFIT_HOLD_48H = 48 as const;

export function statsStrategyPlanAtHoldHours(
  plan: StatsTpSlPlan,
  holdHours: StatsStrategyProfitHorizon,
): StatsTpSlPlan {
  return { ...plan, maxHoldHours: holdHours };
}

export const STATS_STRATEGY_PROFIT_COLUMN_TITLE = statsTpSlPlanSummary(DEFAULT_STATS_TPSL_PLAN);

export const STATS_STRATEGY_PROFIT_COLUMN_TITLE_24H = statsTpSlPlanSummary(
  statsStrategyPlanAtHoldHours(DEFAULT_STATS_TPSL_PLAN, STATS_STRATEGY_PROFIT_HOLD_24H),
);

export const STATS_STRATEGY_PROFIT_COLUMN_TITLE_48H = STATS_STRATEGY_PROFIT_COLUMN_TITLE;

export function statsStrategyProfitFinalized(
  pct48h: number | null | undefined,
): boolean {
  return statsStrategyProfitFinalizedAtHorizon({ pct48h }, STATS_STRATEGY_PROFIT_HOLD_48H);
}

export function statsStrategyProfitFinalizedAtHorizon(
  row: { pct24h?: number | null; pct48h?: number | null },
  holdHours: StatsStrategyProfitHorizon,
): boolean {
  const pct = holdHours === STATS_STRATEGY_PROFIT_HOLD_24H ? row.pct24h : row.pct48h;
  return pct != null && Number.isFinite(pct);
}

export function statsStrategyProfitColumnTitle(
  holdHours: StatsStrategyProfitHorizon,
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
): string {
  return statsTpSlPlanSummary(statsStrategyPlanAtHoldHours(plan, holdHours));
}

/** ค่าหลังแจ้งเท่านั้น — Max DD ถึง MFE + Adv max ตลอด follow-up (ไม่รวม Max DD ก่อนสัญญาณ) */
export type StatsStrategyLiquidationMetrics = {
  /** Max DD หลังแจ้ง — drawdown ถึง MFE */
  maxDrawdownPct?: number | null;
  /** Adv max — สวนสูงสุดตลอด follow-up จาก entry */
  followUpMaxAdversePct?: number | null;
};

export function maxRowAdversePctForLiquidation(
  metrics: StatsStrategyLiquidationMetrics,
): number | null {
  const vals: number[] = [];
  for (const v of [metrics.followUpMaxAdversePct, metrics.maxDrawdownPct]) {
    if (v != null && Number.isFinite(v) && v >= 0) vals.push(v);
  }
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

export function rowExceedsIsolatedLiquidationThreshold(
  metrics: StatsStrategyLiquidationMetrics,
  leverage: number | null | undefined,
): boolean {
  if (leverage == null || !Number.isFinite(leverage) || leverage <= 0) return false;
  const adv = maxRowAdversePctForLiquidation(metrics);
  if (adv == null) return false;
  return adv > maxAdversePricePctForLeverage(leverage);
}

export function isolatedLiquidationStrategyProfitPct(leverage: number): number {
  return -maxAdversePricePctForLeverage(leverage);
}

/** หลัง TP1 (SL@entry) หรือ TP2 — ไม่ทับผลด้วย Adv max ทั้งแถว */
export function statsStrategyProfitExemptFromRowLiquidationOverride(
  exitReason: StatsTpSlExitReason | null | undefined,
): boolean {
  return (
    exitReason === "tp1_be" ||
    exitReason === "tp1_tp2" ||
    exitReason === "tp1_24h" ||
    exitReason === "tp1_48h" ||
    exitReason === "tp1_only" ||
    exitReason === "tp2_full"
  );
}

export function resolveStatsStrategyProfitOutcome(input: {
  profitPct: number;
  exitReason?: StatsTpSlExitReason | null;
  leverage?: number | null;
  liquidationMetrics?: StatsStrategyLiquidationMetrics;
}): { profitPct: number; exitReason: StatsTpSlExitReason | null | undefined } {
  const lev = input.leverage;
  if (
    !statsStrategyProfitExemptFromRowLiquidationOverride(input.exitReason) &&
    input.liquidationMetrics &&
    lev != null &&
    Number.isFinite(lev) &&
    lev > 0 &&
    rowExceedsIsolatedLiquidationThreshold(input.liquidationMetrics, lev)
  ) {
    return {
      profitPct: isolatedLiquidationStrategyProfitPct(lev),
      exitReason: "liquidated",
    };
  }
  return {
    profitPct: capStrategyProfitPctForLeverage(input.profitPct, lev),
    exitReason: input.exitReason,
  };
}

export function computeStatsStrategyProfitFromBars(input: {
  side: "long" | "short";
  entry: number;
  high: number[];
  low: number[];
  iFirst: number;
  iLast: number;
  holdHours: StatsStrategyProfitHorizon;
  pctAtHorizon: number;
  plan?: StatsTpSlPlan;
  leverage?: number | null;
  liquidationMetrics?: StatsStrategyLiquidationMetrics;
}): StrategyProfitByPlanEntry | null {
  const plan = statsStrategyPlanAtHoldHours(input.plan ?? DEFAULT_STATS_TPSL_PLAN, input.holdHours);
  const sim = simulateStatsTpSlProfit({
    side: input.side,
    entry: input.entry,
    high: input.high,
    low: input.low,
    iFirst: input.iFirst,
    iLast: input.iLast,
    pctAt48h: input.pctAtHorizon,
    plan,
    leverage: input.leverage,
  });
  if (!sim) return null;
  const resolved = resolveStatsStrategyProfitOutcome({
    profitPct: sim.profitPct,
    exitReason: sim.exitReason,
    leverage: input.leverage,
    liquidationMetrics: input.liquidationMetrics,
  });
  return { profitPct: resolved.profitPct, exitReason: resolved.exitReason ?? sim.exitReason };
}

export function statsStrategyProfitPnlStyle(pct: number): CSSProperties {
  if (pct > 0) return { color: "var(--ok, #3a8)", fontWeight: 600 };
  if (pct < 0) return { color: "var(--danger, #c44)", fontWeight: 600 };
  return { color: "inherit" };
}

export function statsStrategyExitReasonShort(reason: StatsTpSlExitReason | null | undefined): string {
  if (reason === "tp2_full") return "TP2 เต็ม";
  if (reason === "tp1_tp2") return "TP1+TP2";
  if (reason === "tp1_be") return "TP1+BE";
  if (reason === "tp1_24h") return "TP1+24h";
  if (reason === "tp1_48h") return "TP1+48h";
  if (reason === "tp1_only") return "TP1";
  if (reason === "time_24h") return "24h";
  if (reason === "time_48h") return "48h";
  if (reason === "liquidated") return "Liquidate";
  return "";
}

/** กำไรที่บันทึกตรงกับแผน TP/SL ที่แสดง (กัน breakdown คนละแผนกับตัวเลขหัวการ์ด) */
export function statsStrategyProfitConsistentWithPlan(
  exitReason: StatsTpSlExitReason | null | undefined,
  plan: StatsTpSlPlan,
  profitPct: number,
): boolean {
  if (exitReason == null || !Number.isFinite(profitPct)) return false;
  const tol = 0.11;
  const max = statsTpSlTheoreticalMaxProfitPct(exitReason, plan);
  if (max != null) return Math.abs(profitPct - max) <= tol;
  if (exitReason === "tp1_be") {
    const tp1Only = statsTpSlTheoreticalMaxProfitPct("tp1_only", plan);
    if (tp1Only != null && Math.abs(profitPct - tp1Only) <= tol) return true;
    return Math.abs(profitPct) <= tol;
  }
  return true;
}

export function statsStrategyExitReasonBreakdownLine(
  reason: StatsTpSlExitReason | null | undefined,
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
  profitPct?: number | null,
): string | null {
  if (
    profitPct != null &&
    Number.isFinite(profitPct) &&
    !statsStrategyProfitConsistentWithPlan(reason, plan, profitPct)
  ) {
    return null;
  }
  const legs = reason ? statsTpSlProfitLegBreakdown(reason, plan) : null;
  if (!legs) return null;
  if (reason === "tp1_tp2") {
    return `TP1 ${plan.tp1PartialPct}%@${plan.tp1PricePct}% + ที่เหลือปิด@${plan.tp2PricePct}% → ${formatStatsStrategyProfitPct(legs.tp1LegPct)}+${formatStatsStrategyProfitPct(legs.tp2LegPct)}`;
  }
  if (reason === "tp2_full") {
    return `TP2 ปิดทั้งหมด @${plan.tp2PricePct}% (ไม่ผ่าน TP1)`;
  }
  if (reason === "tp1_only") {
    return `TP1 ปิด ${plan.tp1PartialPct}% @${plan.tp1PricePct}%`;
  }
  return null;
}

export function statsStrategyExitReasonDetail(
  reason: StatsTpSlExitReason | null | undefined,
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
): string {
  if (reason === "tp1_tp2") {
    const max = statsTpSlTheoreticalMaxProfitPct("tp1_tp2", plan);
    const f = plan.tp1PartialPct;
    return `TP1 ปิด ${f}% ที่ราคา ${plan.tp1PricePct}% · ส่วนที่เหลือปิดทั้งหมดที่ TP2 ${plan.tp2PricePct}% — กำไรรวมสูงสุด ≈ ${max != null ? formatStatsStrategyProfitPct(max) : "—"} (ไม่ใช่ ${plan.tp1PricePct}%+${plan.tp2PricePct}% เต็ม position)`;
  }
  if (reason === "tp2_full") {
    return `ราคาแตะ TP2 ${plan.tp2PricePct}% ก่อน TP1 — ปิดทั้ง position → กำไรสูงสุด ${formatStatsStrategyProfitPct(plan.tp2PricePct)}`;
  }
  if (reason === "tp1_be") {
    return "ROI ถึงเกณฑ์ TP1 แล้ว SL@entry — ราคากลับแตะทุน ส่วนที่เหลือออกเสมอ (ไม่ต้องรอ partial TP1)";
  }
  if (reason === "tp1_24h") return `หลัง TP1 ถือส่วนที่เหลือจนครบ ${plan.maxHoldHours}h`;
  if (reason === "tp1_48h") return `หลัง TP1 ถือส่วนที่เหลือจนครบ ${plan.maxHoldHours}h`;
  if (reason === "tp1_only") return `แตะ TP1 แล้วปิดครบ ${plan.tp1PartialPct}% ที่ ${plan.tp1PricePct}%`;
  if (reason === "time_24h") return `ไม่แตะ TP1/TP2 — ปิดที่ผล ${plan.maxHoldHours}h`;
  if (reason === "time_48h") return `ไม่แตะ TP1/TP2 — ปิดที่ผล ${plan.maxHoldHours}h`;
  if (reason === "liquidated") {
    return "Max DD หลังหรือ Adv max เกินเกณฑ์ isolated (≈ 100% ÷ leverage) — ถือว่าโดน liquidate สูญ margin (ไม่ใช้กับไม้ที่ปิด TP1 แล้ว SL@entry)";
  }
  return "";
}

export function formatStatsStrategyProfitPct(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** การเคลื่อนไหวราคาขาลงสูงสุดก่อนเสีย margin ทั้งก้อน (≈ 100% / leverage) */
export function maxAdversePricePctForLeverage(leverage: number): number {
  return 100 / leverage;
}

/** จำกัด % ขาดทุนตาม leverage — เช่น 5x → ไม่ต่ำกว่า -20% ราคา */
export function capStrategyProfitPctForLeverage(
  profitPct: number,
  leverage: number | null | undefined,
): number {
  if (!Number.isFinite(profitPct) || profitPct >= 0) return profitPct;
  if (leverage == null || !Number.isFinite(leverage) || leverage <= 0) return profitPct;
  return Math.max(profitPct, -maxAdversePricePctForLeverage(leverage));
}

export function resolveStatsStrategyDisplayPct(
  profitPct: number,
  leverage: number | null | undefined,
  liquidationMetrics?: StatsStrategyLiquidationMetrics,
  exitReason?: StatsTpSlExitReason | null,
): number {
  return resolveStatsStrategyProfitOutcome({
    profitPct,
    leverage,
    liquidationMetrics,
    exitReason,
  }).profitPct;
}

export function statsStrategyProfitCellTitle(
  profitPct: number | null | undefined,
  exitReason: StatsTpSlExitReason | null | undefined,
  sizing?: { marginUsdt?: number | null; leverage?: number | null },
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
  liquidationMetrics?: StatsStrategyLiquidationMetrics,
): string {
  const base = STATS_STRATEGY_PROFIT_COLUMN_TITLE;
  if (profitPct == null || !Number.isFinite(profitPct)) return base;
  const resolved = resolveStatsStrategyProfitOutcome({
    profitPct,
    exitReason,
    leverage: sizing?.leverage,
    liquidationMetrics,
  });
  const tag = statsStrategyExitReasonShort(resolved.exitReason);
  const displayPct = resolved.profitPct;
  const usdt = formatStatsStrategyProfitUsdt(sizing?.marginUsdt, sizing?.leverage, displayPct);
  const marginNote =
    sizing?.marginUsdt != null && sizing.marginUsdt > 0 && sizing?.leverage != null && sizing.leverage > 0
      ? ` · margin ${sizing.marginUsdt}×${Math.floor(sizing.leverage)}`
      : "";
  const cappedNote =
    resolved.exitReason !== "liquidated" &&
    displayPct !== profitPct &&
    sizing?.leverage != null &&
    sizing.leverage > 0
      ? ` (จำกัดที่ ${formatStatsStrategyProfitPct(displayPct)} @${Math.floor(sizing.leverage)}x)`
      : "";
  const exitDetail = resolved.exitReason
    ? statsStrategyExitReasonDetail(resolved.exitReason, plan)
    : "";
  const breakdown = statsStrategyExitReasonBreakdownLine(resolved.exitReason, plan, displayPct);
  const parts = [
    base + marginNote,
    tag ? `ออก: ${tag}` : "",
    exitDetail,
    breakdown,
    formatStatsStrategyProfitPct(displayPct) + cappedNote,
    usdt,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** P/L $ จาก margin × leverage × % ราคา (เทียบ auto-open history) — ขาดทุนไม่เกิน margin */
export function strategyProfitUsdtFromMargin(
  marginUsdt: number,
  leverage: number,
  profitPct: number,
): number {
  const pct = capStrategyProfitPctForLeverage(profitPct, leverage);
  const usdt = marginUsdt * leverage * (pct / 100);
  return Math.max(usdt, -marginUsdt);
}

export function formatStatsStrategyProfitDollarAmount(amount: number): string {
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${amount.toFixed(2)} $`;
}

export function formatStatsStrategyProfitUsdt(
  marginUsdt: number | null | undefined,
  leverage: number | null | undefined,
  profitPct: number,
): string | null {
  if (
    marginUsdt == null ||
    leverage == null ||
    !(marginUsdt > 0) ||
    !(leverage > 0) ||
    !Number.isFinite(profitPct)
  ) {
    return null;
  }
  const displayPct = resolveStatsStrategyDisplayPct(profitPct, leverage);
  const usdt = strategyProfitUsdtFromMargin(marginUsdt, leverage, displayPct);
  return formatStatsStrategyProfitDollarAmount(usdt);
}

export type StatsStrategyProfitRowSlice = StatsStrategyLiquidationMetrics & {
  conflictWith?: string | null;
  pct24h?: number | null;
  pct48h?: number | null;
  strategyProfitPct?: number | null;
  strategyProfitPct24h?: number | null;
  strategyExitReason?: StatsTpSlExitReason | null;
  strategyExitReason24h?: StatsTpSlExitReason | null;
};

export function statsStrategyExitReasonForHorizon(
  row: Pick<StatsStrategyProfitRowSlice, "strategyExitReason" | "strategyExitReason24h">,
  holdHours: StatsStrategyProfitHorizon,
): StatsTpSlExitReason | null | undefined {
  return holdHours === STATS_STRATEGY_PROFIT_HOLD_24H
    ? row.strategyExitReason24h
    : row.strategyExitReason;
}

export function statsStrategyProfitPctForHorizon(
  row: Pick<StatsStrategyProfitRowSlice, "strategyProfitPct" | "strategyProfitPct24h">,
  holdHours: StatsStrategyProfitHorizon,
): number | null | undefined {
  return holdHours === STATS_STRATEGY_PROFIT_HOLD_24H ? row.strategyProfitPct24h : row.strategyProfitPct;
}

/** เกณฑ์ชนะ/แพ้/เสมอ — ตรง winrate ราย horizon (ไม่นับ % บวกเล็กน้อยเป็น “ชนะ”) */
export type StatsStrategyWinLossBand = {
  winMinPct: number;
  lossMaxPct: number;
};

export const STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND: StatsStrategyWinLossBand = {
  winMinPct: 3,
  lossMaxPct: -3,
};

export const STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND: StatsStrategyWinLossBand = {
  winMinPct: 2,
  lossMaxPct: -2,
};

export function classifyStatsStrategyProfitPct(
  displayPct: number,
  band: StatsStrategyWinLossBand,
): "win" | "loss" | "flat" {
  if (displayPct >= band.winMinPct) return "win";
  if (displayPct <= band.lossMaxPct) return "loss";
  return "flat";
}

export type StatsStrategyProfitSummary = {
  trades: number;
  wins: number;
  losses: number;
  flats: number;
  decisive: number;
  winratePct: number | null;
  pending: number;
  sumPct: number;
  sumWinUsd: number | null;
  sumLossUsd: number | null;
  sumUsdt: number | null;
};

export function summarizeStatsStrategyProfit(
  rows: StatsStrategyProfitRowSlice[],
  sizing?: StatsStrategyCsvSizing,
  band: StatsStrategyWinLossBand = STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
  holdHours: StatsStrategyProfitHorizon = STATS_STRATEGY_PROFIT_HOLD_48H,
): StatsStrategyProfitSummary {
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let pending = 0;
  let sumPct = 0;
  let sumUsdt = 0;
  let sumWinUsd = 0;
  let sumLossUsd = 0;
  let hasUsdt = false;
  const margin = sizing?.marginUsdt;
  const leverage = sizing?.leverage;
  const canUsdt =
    margin != null && leverage != null && margin > 0 && leverage > 0;

  for (const row of excludePendingConflictRows(rows)) {
    if (!statsStrategyProfitFinalizedAtHorizon(row, holdHours)) {
      pending += 1;
      continue;
    }
    const raw = statsStrategyProfitPctForHorizon(row, holdHours);
    if (raw == null || !Number.isFinite(raw)) {
      pending += 1;
      continue;
    }
    const displayPct = resolveStatsStrategyDisplayPct(
      raw,
      leverage,
      row,
      statsStrategyExitReasonForHorizon(row, holdHours),
    );
    trades += 1;
    sumPct += displayPct;
    const cls = classifyStatsStrategyProfitPct(displayPct, band);
    if (cls === "win") wins += 1;
    else if (cls === "loss") losses += 1;
    else flats += 1;
    if (canUsdt) {
      const usd = strategyProfitUsdtFromMargin(margin!, leverage!, displayPct);
      sumUsdt += usd;
      if (cls === "win") sumWinUsd += usd;
      else if (cls === "loss") sumLossUsd += usd;
      hasUsdt = true;
    }
  }

  const decisive = wins + losses;
  const winratePct = decisive > 0 ? (wins / decisive) * 100 : null;

  return {
    trades,
    wins,
    losses,
    flats,
    decisive,
    winratePct,
    pending,
    sumPct,
    sumWinUsd: hasUsdt && wins > 0 ? sumWinUsd : hasUsdt ? 0 : null,
    sumLossUsd: hasUsdt && losses > 0 ? sumLossUsd : hasUsdt ? 0 : null,
    sumUsdt: hasUsdt ? sumUsdt : null,
  };
}

export function formatStatsStrategyProfitSummaryText(
  summary: StatsStrategyProfitSummary,
  holdHours?: StatsStrategyProfitHorizon,
): string | null {
  if (summary.trades === 0 && summary.pending === 0) return null;
  const horizonTag =
    holdHours === STATS_STRATEGY_PROFIT_HOLD_24H
      ? "24h"
      : holdHours === STATS_STRATEGY_PROFIT_HOLD_48H
        ? "48h"
        : "";
  const prefix = horizonTag ? `กลยุทธ์ ${horizonTag}` : "กลยุทธ์";
  if (summary.trades === 0) {
    return summary.pending > 0 ? `${prefix}: รอผล ${summary.pending} ไม้` : null;
  }
  const flatTag = summary.flats > 0 ? ` · เสมอ ${summary.flats}` : "";
  const pendingTag = summary.pending > 0 ? ` · รอผล ${summary.pending}` : "";
  const sumPart = formatStatsStrategyProfitPct(summary.sumPct);
  const wrTag =
    summary.decisive > 0 && summary.winratePct != null
      ? `WR ${summary.winratePct.toFixed(1)}% (${summary.wins}/${summary.decisive}) · `
      : summary.flats > 0
        ? "WR — (0/0) · "
        : "";
  const winUsdTag =
    summary.sumWinUsd != null && summary.wins > 0
      ? ` (${formatStatsStrategyProfitDollarAmount(summary.sumWinUsd)})`
      : "";
  const lossUsdTag =
    summary.sumLossUsd != null && summary.losses > 0
      ? ` (${formatStatsStrategyProfitDollarAmount(summary.sumLossUsd)})`
      : "";
  const netUsdTag =
    summary.sumUsdt != null && (summary.wins > 0 || summary.losses > 0)
      ? ` · สุทธิ ${formatStatsStrategyProfitDollarAmount(summary.sumUsdt)}`
      : "";
  const core = `${prefix}: ${wrTag}ชนะ ${summary.wins}${winUsdTag} · แพ้ ${summary.losses}${lossUsdTag}${flatTag} · รวม ${sumPart} (${summary.trades} ไม้)${netUsdTag}`;
  return `${core}${pendingTag}`;
}

export function statsStrategyProfitCsvCell(
  pctHorizon: number | null | undefined,
  strategyProfitPct: number | null | undefined,
  strategyExitReason?: StatsTpSlExitReason | null,
  sizing?: { marginUsdt?: number | null; leverage?: number | null },
  holdHours: StatsStrategyProfitHorizon = STATS_STRATEGY_PROFIT_HOLD_48H,
  liquidationMetrics?: StatsStrategyLiquidationMetrics,
): string {
  if (!statsStrategyProfitFinalizedAtHorizon(
    holdHours === STATS_STRATEGY_PROFIT_HOLD_24H ? { pct24h: pctHorizon } : { pct48h: pctHorizon },
    holdHours,
  )) {
    return "";
  }
  if (strategyProfitPct == null || !Number.isFinite(strategyProfitPct)) return "";
  const resolved = resolveStatsStrategyProfitOutcome({
    profitPct: strategyProfitPct,
    exitReason: strategyExitReason,
    leverage: sizing?.leverage,
    liquidationMetrics,
  });
  const tag = statsStrategyExitReasonShort(resolved.exitReason);
  const displayPct = resolved.profitPct;
  const pctPart = formatStatsStrategyProfitPct(displayPct);
  const usdtPart = formatStatsStrategyProfitUsdt(
    sizing?.marginUsdt,
    sizing?.leverage,
    displayPct,
  );
  const core = tag ? `${pctPart} (${tag})` : pctPart;
  return usdtPart ? `${core} · ${usdtPart}` : core;
}
