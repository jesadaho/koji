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

export function statsStrategyProfitCellTitle(
  profitPct: number | null | undefined,
  exitReason: StatsTpSlExitReason | null | undefined,
  sizing?: { marginUsdt?: number | null; leverage?: number | null },
): string {
  const base = STATS_STRATEGY_PROFIT_COLUMN_TITLE;
  if (profitPct == null || !Number.isFinite(profitPct)) return base;
  const tag = statsStrategyExitReasonShort(exitReason);
  const usdt = formatStatsStrategyProfitUsdt(sizing?.marginUsdt, sizing?.leverage, profitPct);
  const marginNote =
    sizing?.marginUsdt != null && sizing.marginUsdt > 0 && sizing?.leverage != null && sizing.leverage > 0
      ? ` · margin ${sizing.marginUsdt}×${Math.floor(sizing.leverage)}`
      : "";
  const parts = [base + marginNote, tag ? `ออก: ${tag}` : "", formatStatsStrategyProfitPct(profitPct), usdt].filter(
    Boolean,
  );
  return parts.join(" · ");
}

/** P/L USDT จาก margin × leverage × % ราคา (เทียบ auto-open history) */
export function strategyProfitUsdtFromMargin(
  marginUsdt: number,
  leverage: number,
  profitPct: number,
): number {
  return marginUsdt * leverage * (profitPct / 100);
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
  const usdt = strategyProfitUsdtFromMargin(marginUsdt, leverage, profitPct);
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
  const pctPart = formatStatsStrategyProfitPct(strategyProfitPct);
  const usdtPart = formatStatsStrategyProfitUsdt(
    sizing?.marginUsdt,
    sizing?.leverage,
    strategyProfitPct,
  );
  const core = tag ? `${pctPart} (${tag})` : pctPart;
  return usdtPart ? `${core} · ${usdtPart}` : core;
}
