"use client";

import {
  formatStatsStrategyProfitPct,
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
}) {
  if (!statsStrategyProfitFinalized(props.pct48h)) {
    return <>—</>;
  }
  const pct = props.strategyProfitPct;
  if (pct == null || !Number.isFinite(pct)) {
    return <span title={statsStrategyProfitCellTitle(null, props.strategyExitReason)}>—</span>;
  }
  const tag = statsStrategyExitReasonShort(props.strategyExitReason);
  return (
    <span
      style={statsStrategyProfitPnlStyle(pct)}
      title={statsStrategyProfitCellTitle(pct, props.strategyExitReason)}
    >
      {formatStatsStrategyProfitPct(pct)}
      {tag ? (
        <span style={{ display: "block", fontSize: "0.82em", fontWeight: 500, opacity: 0.88 }}>
          {tag}
        </span>
      ) : null}
    </span>
  );
}
