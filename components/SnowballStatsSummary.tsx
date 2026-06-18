"use client";

import { StatsWeekSplitHint } from "@/components/StatsWeekGroupUi";
import {
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
  formatStatsStrategyProfitSummaryText,
  statsStrategyProfitResolvedForHorizon,
  summarizeStatsStrategyProfit,
  type StatsStrategyProfitResolveFn,
} from "@/lib/statsStrategyProfitClient";
import type { StatsTpSlPlan } from "@/lib/tpSlStrategySimulate";
import {
  snowballHorizonWinrateSummary,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import {
  statsConflictFilterTitle,
  type StatsConflictFilter,
} from "@/lib/signalPendingConflict";
import {
  snowballMatrixFilterTitle,
  type SnowballMatrixFilter,
} from "@/lib/snowballMatrixFilters";
import {
  snowballTrendGradeFilterTitle,
  type SnowballTrendGradeFilter,
} from "@/src/snowballTrendGrade";
import { useMemo } from "react";

export const SNOWBALL_HORIZON_WR = [
  { label: "12h", pctKey: "pct12h" },
  { label: "24h", pctKey: "pct24h" },
  { label: "48h", pctKey: "pct48h" },
] as const;

type StrategySizing = {
  marginUsdt?: number | null;
  leverage?: number | null;
};

type Props = {
  scopedRows: SnowballStatsRow[];
  strategySizing: StrategySizing;
  tpSlPlan?: StatsTpSlPlan | null;
  gradeFilter: SnowballTrendGradeFilter;
  matrixFilter: SnowballMatrixFilter;
  conflictFilter: StatsConflictFilter;
  splitByWeek: boolean;
};

export function SnowballStatsSummary({
  scopedRows,
  strategySizing,
  tpSlPlan,
  gradeFilter,
  matrixFilter,
  conflictFilter,
  splitByWeek,
}: Props) {
  const resolveStrategyProfit = useMemo((): StatsStrategyProfitResolveFn | undefined => {
    if (!tpSlPlan) return undefined;
    return (row, holdHours, leverage) =>
      statsStrategyProfitResolvedForHorizon(row, holdHours, leverage, tpSlPlan);
  }, [tpSlPlan]);

  const horizonWinrateText = useMemo(
    () => snowballHorizonWinrateSummary(scopedRows, SNOWBALL_HORIZON_WR),
    [scopedRows],
  );

  const strategyProfitSummaryText48h = useMemo(
    () =>
      formatStatsStrategyProfitSummaryText(
        summarizeStatsStrategyProfit(
          scopedRows,
          strategySizing,
          STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
          STATS_STRATEGY_PROFIT_HOLD_48H,
          resolveStrategyProfit,
        ),
        STATS_STRATEGY_PROFIT_HOLD_48H,
      ),
    [scopedRows, strategySizing, resolveStrategyProfit],
  );

  const strategyProfitSummaryText24h = useMemo(
    () =>
      formatStatsStrategyProfitSummaryText(
        summarizeStatsStrategyProfit(
          scopedRows,
          strategySizing,
          STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
          STATS_STRATEGY_PROFIT_HOLD_24H,
          resolveStrategyProfit,
        ),
        STATS_STRATEGY_PROFIT_HOLD_24H,
      ),
    [scopedRows, strategySizing, resolveStrategyProfit],
  );

  return (
    <>
      {gradeFilter !== "all" ? (
        <p className="sub" style={{ marginBottom: "0.5rem" }} title={snowballTrendGradeFilterTitle(gradeFilter)}>
          {snowballTrendGradeFilterTitle(gradeFilter)}
        </p>
      ) : null}
      {matrixFilter !== "all" ? (
        <p className="sub" style={{ marginBottom: "0.5rem" }} title={snowballMatrixFilterTitle(matrixFilter)}>
          {snowballMatrixFilterTitle(matrixFilter)}
        </p>
      ) : null}
      {conflictFilter !== "all" ? (
        <p className="sub" style={{ marginBottom: "0.5rem" }} title={statsConflictFilterTitle(conflictFilter)}>
          {statsConflictFilterTitle(conflictFilter)}
        </p>
      ) : null}
      <p
        className="sub"
        title="Winrate ราย horizon — คอลัมน์ผลใช้ 48h · เกณฑ์ Win ≥ +3% · Loss ≤ -3% · WR ไม่นับ flat (decisive = wins + losses), +Nf = จำนวน flat"
        style={{ marginBottom: "0.5rem" }}
      >
        WR · {horizonWinrateText}
      </p>
      <StatsWeekSplitHint splitByWeek={splitByWeek}>
        {strategyProfitSummaryText24h || strategyProfitSummaryText48h ? (
          <div style={{ marginBottom: "0.5rem" }}>
            {strategyProfitSummaryText24h ? (
              <p
                className="sub"
                title="สรุปคอลัมน์กำไรกลยุทธ์ 24h — ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR (Win ≥ +3% · Loss ≤ −3%)"
                style={{ margin: "0 0 0.25rem", fontWeight: 600 }}
              >
                {strategyProfitSummaryText24h}
              </p>
            ) : null}
            {strategyProfitSummaryText48h ? (
              <p
                className="sub"
                title="สรุปคอลัมน์กำไรกลยุทธ์ 48h — ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR (Win ≥ +3% · Loss ≤ −3%)"
                style={{ margin: 0, fontWeight: 600 }}
              >
                {strategyProfitSummaryText48h}
              </p>
            ) : null}
          </div>
        ) : null}
      </StatsWeekSplitHint>
    </>
  );
}
