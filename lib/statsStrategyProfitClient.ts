import type { CSSProperties } from "react";
import {
  DEFAULT_STATS_TPSL_PLAN,
  statsTpSlPlanSummary,
  type StatsTpSlExitReason,
} from "@/lib/tpSlStrategySimulate";

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
): string {
  const base = STATS_STRATEGY_PROFIT_COLUMN_TITLE;
  if (profitPct == null || !Number.isFinite(profitPct)) return base;
  const tag = statsStrategyExitReasonShort(exitReason);
  return tag ? `${base} · ออก: ${tag} · ${formatStatsStrategyProfitPct(profitPct)}` : `${base} · ${formatStatsStrategyProfitPct(profitPct)}`;
}

export function statsStrategyProfitCsvCell(
  pct48h: number | null | undefined,
  strategyProfitPct: number | null | undefined,
  strategyExitReason?: StatsTpSlExitReason | null,
): string {
  if (!statsStrategyProfitFinalized(pct48h)) return "";
  if (strategyProfitPct == null || !Number.isFinite(strategyProfitPct)) return "";
  const tag = statsStrategyExitReasonShort(strategyExitReason);
  return tag
    ? `${formatStatsStrategyProfitPct(strategyProfitPct)} (${tag})`
    : formatStatsStrategyProfitPct(strategyProfitPct);
}
