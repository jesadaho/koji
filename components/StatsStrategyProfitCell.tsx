"use client";

import {
  formatStatsStrategyProfitPct,
  formatStatsStrategyProfitUsdt,
  resolveStatsStrategyDisplayPct,
  statsStrategyExitReasonBreakdownLine,
  statsStrategyExitReasonShort,
  statsStrategyPlanAtHoldHours,
  statsStrategyProfitFinalizedAtHorizon,
  statsStrategyProfitCellTitle,
  statsStrategyProfitPnlStyle,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  type StatsStrategyProfitHorizon,
} from "@/lib/statsStrategyProfitClient";
import { DEFAULT_STATS_TPSL_PLAN, type StatsTpSlExitReason, type StatsTpSlPlan } from "@/lib/tpSlStrategySimulate";

export function StatsStrategyProfitCell(props: {
  holdHours?: StatsStrategyProfitHorizon;
  pct24h?: number | null;
  pct48h?: number | null;
  strategyProfitPct?: number | null;
  strategyProfitPct24h?: number | null;
  strategyExitReason?: StatsTpSlExitReason | null;
  strategyExitReason24h?: StatsTpSlExitReason | null;
  marginUsdt?: number | null;
  leverage?: number | null;
  tpSlPlan?: StatsTpSlPlan;
}) {
  const holdHours = props.holdHours ?? STATS_STRATEGY_PROFIT_HOLD_48H;
  const plan = statsStrategyPlanAtHoldHours(props.tpSlPlan ?? DEFAULT_STATS_TPSL_PLAN, holdHours);
  const pctHorizon =
    holdHours === 24 ? props.pct24h : props.pct48h;
  const profitPct =
    holdHours === 24 ? props.strategyProfitPct24h : props.strategyProfitPct;
  const exitReason =
    holdHours === 24 ? props.strategyExitReason24h : props.strategyExitReason;

  if (!statsStrategyProfitFinalizedAtHorizon(
    holdHours === 24 ? { pct24h: pctHorizon } : { pct48h: pctHorizon },
    holdHours,
  )) {
    return <>—</>;
  }
  const pct = profitPct;
  if (pct == null || !Number.isFinite(pct)) {
    return (
      <span
        title={statsStrategyProfitCellTitle(null, exitReason, {
          marginUsdt: props.marginUsdt,
          leverage: props.leverage,
        }, plan)}
      >
        —
      </span>
    );
  }
  const displayPct = resolveStatsStrategyDisplayPct(pct, props.leverage);
  const tag = statsStrategyExitReasonShort(exitReason);
  const breakdownLine = statsStrategyExitReasonBreakdownLine(exitReason, plan);
  const usdtLine = formatStatsStrategyProfitUsdt(props.marginUsdt, props.leverage, displayPct);
  const sizing = { marginUsdt: props.marginUsdt, leverage: props.leverage };
  return (
    <span
      style={statsStrategyProfitPnlStyle(displayPct)}
      title={statsStrategyProfitCellTitle(pct, exitReason, sizing, plan)}
    >
      {formatStatsStrategyProfitPct(displayPct)}
      {usdtLine ? (
        <span style={{ display: "block", fontSize: "0.88em", fontWeight: 500, opacity: 0.88 }}>
          {usdtLine}
        </span>
      ) : null}
      {tag ? (
        <span style={{ display: "block", fontSize: "0.82em", fontWeight: 500, opacity: 0.88 }}>
          {tag}
        </span>
      ) : null}
      {breakdownLine ? (
        <span style={{ display: "block", fontSize: "0.78em", fontWeight: 500, opacity: 0.82 }}>
          {breakdownLine}
        </span>
      ) : null}
    </span>
  );
}
