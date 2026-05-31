"use client";

import {
  formatStatsStrategyProfitPct,
  formatStatsStrategyProfitUsdt,
  resolveStatsStrategyDisplayPct,
  statsStrategyExitReasonShort,
  statsStrategyProfitFinalized,
  statsStrategyProfitCellTitle,
  statsStrategyProfitPnlStyle,
} from "@/lib/statsStrategyProfitClient";
import type { StatsTpSlExitReason } from "@/lib/tpSlStrategySimulate";

export function StatsStrategyProfitCell(props: {
  pct48h: number | null | undefined;
  strategyProfitPct: number | null | undefined;
  strategyExitReason?: StatsTpSlExitReason | null;
  marginUsdt?: number | null;
  leverage?: number | null;
}) {
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
        })}
      >
        —
      </span>
    );
  }
  const displayPct = resolveStatsStrategyDisplayPct(pct, props.leverage);
  const tag = statsStrategyExitReasonShort(props.strategyExitReason);
  const usdtLine = formatStatsStrategyProfitUsdt(props.marginUsdt, props.leverage, displayPct);
  const sizing = { marginUsdt: props.marginUsdt, leverage: props.leverage };
  return (
    <span
      style={statsStrategyProfitPnlStyle(displayPct)}
      title={statsStrategyProfitCellTitle(pct, props.strategyExitReason, sizing)}
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
    </span>
  );
}
