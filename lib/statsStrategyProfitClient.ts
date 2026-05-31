import type { CSSProperties } from "react";
import {
  DEFAULT_STATS_TPSL_PLAN,
  statsTpSlPlanSummary,
  type StatsTpSlExitReason,
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
  if (reason === "tp2_full") return "TP2";
  if (reason === "tp1_tp2") return "TP1+TP2";
  if (reason === "tp1_be") return "TP1+BE";
  if (reason === "tp1_48h") return "TP1+48h";
  if (reason === "tp1_only") return "TP1";
  if (reason === "time_48h") return "48h";
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
  const parts = [
    base + marginNote,
    tag ? `ออก: ${tag}` : "",
    formatStatsStrategyProfitPct(displayPct) + cappedNote,
    usdt,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** P/L USDT จาก margin × leverage × % ราคา (เทียบ auto-open history) — ขาดทุนไม่เกิน margin */
export function strategyProfitUsdtFromMargin(
  marginUsdt: number,
  leverage: number,
  profitPct: number,
): number {
  const pct = capStrategyProfitPctForLeverage(profitPct, leverage);
  const usdt = marginUsdt * leverage * (pct / 100);
  return Math.max(usdt, -marginUsdt);
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
  const sign = usdt >= 0 ? "+" : "";
  return `${sign}${usdt.toFixed(2)} USDT`;
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
