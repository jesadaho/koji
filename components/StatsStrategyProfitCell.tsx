"use client";

import {
  formatStatsStrategyProfitPct,
  formatStatsStrategyProfitUsdt,
  statsStrategyExitReasonBreakdownLine,
  statsStrategyExitReasonShort,
  statsStrategyPlanAtHoldHours,
  statsStrategyProfitCellTitle,
  statsStrategyProfitFinalizedAtHorizon,
  statsStrategyProfitPnlStyle,
  statsStrategyProfitResolvedForHorizon,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  type StatsStrategyProfitHorizon,
  type StatsStrategyProfitResolveFn,
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
  maxDrawdownPct?: number | null;
  followUpMaxAdversePct?: number | null;
  resolveProfit?: StatsStrategyProfitResolveFn;
}) {
  const holdHours = props.holdHours ?? STATS_STRATEGY_PROFIT_HOLD_48H;
  const plan = statsStrategyPlanAtHoldHours(props.tpSlPlan ?? DEFAULT_STATS_TPSL_PLAN, holdHours);
  const pctHorizon = holdHours === 24 ? props.pct24h : props.pct48h;
  const profitPct = holdHours === 24 ? props.strategyProfitPct24h : props.strategyProfitPct;
  const exitReason = holdHours === 24 ? props.strategyExitReason24h : props.strategyExitReason;
  const resolveProfit = props.resolveProfit ?? statsStrategyProfitResolvedForHorizon;
  const liquidationMetrics = {
    maxDrawdownPct: props.maxDrawdownPct,
    followUpMaxAdversePct: props.followUpMaxAdversePct,
  };

  if (
    !statsStrategyProfitFinalizedAtHorizon(
      holdHours === 24
        ? { pct24h: pctHorizon, followUpMaxAdversePct: props.followUpMaxAdversePct }
        : { pct48h: pctHorizon },
      holdHours,
    )
  ) {
    return <>—</>;
  }

  const resolved = resolveProfit(
    {
      pct24h: props.pct24h,
      pct48h: props.pct48h,
      strategyProfitPct: props.strategyProfitPct,
      strategyProfitPct24h: props.strategyProfitPct24h,
      strategyExitReason: props.strategyExitReason,
      strategyExitReason24h: props.strategyExitReason24h,
      maxDrawdownPct: props.maxDrawdownPct,
      followUpMaxAdversePct: props.followUpMaxAdversePct,
    },
    holdHours,
    props.leverage,
  );

  if (!resolved) {
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

  const displayPct = resolved.profitPct;
  const displayReason = resolved.exitReason;
  const tag = statsStrategyExitReasonShort(displayReason);
  const breakdownLine = statsStrategyExitReasonBreakdownLine(displayReason, plan, displayPct);
  const usdtLine = formatStatsStrategyProfitUsdt(props.marginUsdt, props.leverage, displayPct);
  const sizing = { marginUsdt: props.marginUsdt, leverage: props.leverage };
  return (
    <span
      style={statsStrategyProfitPnlStyle(displayPct)}
      title={statsStrategyProfitCellTitle(
        profitPct,
        exitReason,
        sizing,
        plan,
        liquidationMetrics,
        holdHours,
      )}
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
