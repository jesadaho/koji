"use client";

import {
  formatStatsStrategyProfitPct,
  formatStatsStrategyProfitUsdt,
  resolveStatsStrategyDisplayPct,
  statsStrategyExitReasonBreakdownLine,
  statsStrategyExitReasonShort,
  statsStrategyProfitFinalized,
  statsStrategyProfitCellTitle,
  statsStrategyProfitPnlStyle,
} from "@/lib/statsStrategyProfitClient";
import { DEFAULT_STATS_TPSL_PLAN, type StatsTpSlExitReason, type StatsTpSlPlan } from "@/lib/tpSlStrategySimulate";

export function StatsStrategyProfitCell(props: {
  pct48h: number | null | undefined;
  strategyProfitPct: number | null | undefined;
  strategyExitReason?: StatsTpSlExitReason | null;
  marginUsdt?: number | null;
  leverage?: number | null;
  tpSlPlan?: StatsTpSlPlan;
}) {
  const plan = props.tpSlPlan ?? DEFAULT_STATS_TPSL_PLAN;
  if (!statsStrategyProfitFinalized(props.pct48h)) {
    return <>—</>;
  }
  const pct = props.strategyProfitPct;
  if (pct == null || !Number.isFinite(pct)) {
    return (
      <span
        title={statsStrategyProfitCellTitle(null, props.strategyExitReason, {
          marginUsdt: props.marginUsdt,
          leverage: props.leverage,
        }, plan)}
      >
        —
      </span>
    );
  }
  const displayPct = resolveStatsStrategyDisplayPct(pct, props.leverage);
  const tag = statsStrategyExitReasonShort(props.strategyExitReason);
  const breakdownLine = statsStrategyExitReasonBreakdownLine(props.strategyExitReason, plan);
  const usdtLine = formatStatsStrategyProfitUsdt(props.marginUsdt, props.leverage, displayPct);
  const sizing = { marginUsdt: props.marginUsdt, leverage: props.leverage };
  return (
    <span
      style={statsStrategyProfitPnlStyle(displayPct)}
      title={statsStrategyProfitCellTitle(pct, props.strategyExitReason, sizing, plan)}
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
