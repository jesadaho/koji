import type { CSSProperties } from "react";
import {
  DEFAULT_STATS_TPSL_PLAN,
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

export const STATS_STRATEGY_PROFIT_COLUMN_TITLE = statsTpSlPlanSummary(DEFAULT_STATS_TPSL_PLAN);

export function statsStrategyProfitFinalized(pct48h: number | null | undefined): boolean {
  return pct48h != null && Number.isFinite(pct48h);
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
  if (reason === "tp1_48h") return "TP1+48h";
  if (reason === "tp1_only") return "TP1";
  if (reason === "time_48h") return "48h";
  return "";
}

export function statsStrategyExitReasonBreakdownLine(
  reason: StatsTpSlExitReason | null | undefined,
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
): string | null {
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
  if (reason === "tp1_be") return "หลัง TP1 ราคากลับแตะ SL ที่ entry — ส่วนที่เหลือออกเสมอ";
  if (reason === "tp1_48h") return `หลัง TP1 ถือส่วนที่เหลือจนครบ ${plan.maxHoldHours}h`;
  if (reason === "tp1_only") return `แตะ TP1 แล้วปิดครบ ${plan.tp1PartialPct}% ที่ ${plan.tp1PricePct}%`;
  if (reason === "time_48h") return `ไม่แตะ TP1/TP2 — ปิดที่ผล ${plan.maxHoldHours}h`;
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
): number {
  return capStrategyProfitPctForLeverage(profitPct, leverage);
}

export function statsStrategyProfitCellTitle(
  profitPct: number | null | undefined,
  exitReason: StatsTpSlExitReason | null | undefined,
  sizing?: { marginUsdt?: number | null; leverage?: number | null },
  plan: StatsTpSlPlan = DEFAULT_STATS_TPSL_PLAN,
): string {
  const base = STATS_STRATEGY_PROFIT_COLUMN_TITLE;
  if (profitPct == null || !Number.isFinite(profitPct)) return base;
  const tag = statsStrategyExitReasonShort(exitReason);
  const displayPct = resolveStatsStrategyDisplayPct(profitPct, sizing?.leverage);
  const usdt = formatStatsStrategyProfitUsdt(sizing?.marginUsdt, sizing?.leverage, displayPct);
  const marginNote =
    sizing?.marginUsdt != null && sizing.marginUsdt > 0 && sizing?.leverage != null && sizing.leverage > 0
      ? ` · margin ${sizing.marginUsdt}×${Math.floor(sizing.leverage)}`
      : "";
  const cappedNote =
    displayPct !== profitPct && sizing?.leverage != null && sizing.leverage > 0
      ? ` (จำกัดที่ ${formatStatsStrategyProfitPct(displayPct)} @${Math.floor(sizing.leverage)}x)`
      : "";
  const exitDetail = exitReason ? statsStrategyExitReasonDetail(exitReason, plan) : "";
  const breakdown = statsStrategyExitReasonBreakdownLine(exitReason, plan);
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

export type StatsStrategyProfitRowSlice = {
  pct48h?: number | null;
  strategyProfitPct?: number | null;
};

export type StatsStrategyProfitSummary = {
  trades: number;
  wins: number;
  losses: number;
  flats: number;
  pending: number;
  sumPct: number;
  sumWinUsd: number | null;
  sumLossUsd: number | null;
  sumUsdt: number | null;
};

export function summarizeStatsStrategyProfit(
  rows: StatsStrategyProfitRowSlice[],
  sizing?: StatsStrategyCsvSizing,
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

  for (const row of rows) {
    if (!statsStrategyProfitFinalized(row.pct48h)) {
      pending += 1;
      continue;
    }
    const raw = row.strategyProfitPct;
    if (raw == null || !Number.isFinite(raw)) {
      pending += 1;
      continue;
    }
    const displayPct = resolveStatsStrategyDisplayPct(raw, leverage);
    trades += 1;
    sumPct += displayPct;
    if (displayPct > 0) wins += 1;
    else if (displayPct < 0) losses += 1;
    else flats += 1;
    if (canUsdt) {
      const usd = strategyProfitUsdtFromMargin(margin!, leverage!, raw);
      sumUsdt += usd;
      if (usd > 0) sumWinUsd += usd;
      else if (usd < 0) sumLossUsd += usd;
      hasUsdt = true;
    }
  }

  return {
    trades,
    wins,
    losses,
    flats,
    pending,
    sumPct,
    sumWinUsd: hasUsdt ? sumWinUsd : null,
    sumLossUsd: hasUsdt ? sumLossUsd : null,
    sumUsdt: hasUsdt ? sumUsdt : null,
  };
}

export function formatStatsStrategyProfitSummaryText(
  summary: StatsStrategyProfitSummary,
): string | null {
  if (summary.trades === 0 && summary.pending === 0) return null;
  if (summary.trades === 0) {
    return summary.pending > 0 ? `กลยุทธ์: รอผล ${summary.pending} ไม้` : null;
  }
  const flatTag = summary.flats > 0 ? ` · เสมอ ${summary.flats}` : "";
  const pendingTag = summary.pending > 0 ? ` · รอผล ${summary.pending}` : "";
  const sumPart = formatStatsStrategyProfitPct(summary.sumPct);
  const winUsdTag =
    summary.sumWinUsd != null && summary.wins > 0
      ? ` (${formatStatsStrategyProfitDollarAmount(summary.sumWinUsd)})`
      : "";
  const lossUsdTag =
    summary.sumLossUsd != null && summary.losses > 0
      ? ` (${formatStatsStrategyProfitDollarAmount(summary.sumLossUsd)})`
      : "";
  const netUsdTag =
    summary.sumUsdt != null && summary.wins > 0 && summary.losses > 0
      ? ` · สุทธิ ${formatStatsStrategyProfitDollarAmount(summary.sumUsdt)}`
      : "";
  const core = `กลยุทธ์: ชนะ ${summary.wins}${winUsdTag} · แพ้ ${summary.losses}${lossUsdTag}${flatTag} · รวม ${sumPart} (${summary.trades} ไม้)${netUsdTag}`;
  return `${core}${pendingTag}`;
}

export function statsStrategyProfitCsvCell(
  pct48h: number | null | undefined,
  strategyProfitPct: number | null | undefined,
  strategyExitReason?: StatsTpSlExitReason | null,
  sizing?: { marginUsdt?: number | null; leverage?: number | null },
): string {
  if (!statsStrategyProfitFinalized(pct48h)) return "";
  if (strategyProfitPct == null || !Number.isFinite(strategyProfitPct)) return "";
  const tag = statsStrategyExitReasonShort(strategyExitReason);
  const displayPct = resolveStatsStrategyDisplayPct(strategyProfitPct, sizing?.leverage);
  const pctPart = formatStatsStrategyProfitPct(displayPct);
  const usdtPart = formatStatsStrategyProfitUsdt(
    sizing?.marginUsdt,
    sizing?.leverage,
    displayPct,
  );
  const core = tag ? `${pctPart} (${tag})` : pctPart;
  return usdtPart ? `${core} · ${usdtPart}` : core;
}
