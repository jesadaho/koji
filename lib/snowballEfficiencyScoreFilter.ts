/** ตัวกรอง Efficiency Score — Snowball stats (R% 2แท่ง ÷ Vol×SMA) */

import {
  snowballStatsEfficiencyScore,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";

export type SnowballEfficiencyScoreFilter =
  | "all"
  | "ge1"
  | "ge2"
  | "ge3"
  | "ge5"
  | "ge8"
  | "has"
  | "none";

const EFFICIENCY_MIN: Record<Exclude<SnowballEfficiencyScoreFilter, "all" | "has" | "none">, number> = {
  ge1: 1,
  ge2: 2,
  ge3: 3,
  ge5: 5,
  ge8: 8,
};

export const SNOWBALL_EFFICIENCY_SCORE_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballEfficiencyScoreFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "ge1", label: "≥ 1" },
  { value: "ge2", label: "≥ 2" },
  { value: "ge3", label: "≥ 3" },
  { value: "ge5", label: "≥ 5" },
  { value: "ge8", label: "≥ 8" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballEfficiencyScoreFilterLabel(filter: SnowballEfficiencyScoreFilter): string {
  return SNOWBALL_EFFICIENCY_SCORE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballEfficiencyScoreFilterTitle(filter: SnowballEfficiencyScoreFilter): string {
  if (filter === "all") return "ไม่กรอง Efficiency Score";
  if (filter === "has") return "มีค่า Efficiency Score (R% 2แท่ง ÷ Vol×SMA)";
  if (filter === "none") return "ไม่มีค่า Efficiency Score";
  return `Efficiency Score ${snowballEfficiencyScoreFilterLabel(filter)}`;
}

export function snowballStatsRowMatchesEfficiencyScoreFilter(
  row: Pick<SnowballStatsRow, "barRangePct2Sum" | "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf">,
  filter: SnowballEfficiencyScoreFilter,
): boolean {
  if (filter === "all") return true;
  const score = snowballStatsEfficiencyScore(row);
  const has = score != null && Number.isFinite(score);
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  return score >= EFFICIENCY_MIN[filter];
}
