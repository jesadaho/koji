/** ตัวกรอง R% สัญญาณ (barRangePctSignal) — Snowball stats */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import { SNOWBALL_TREND_GRADE_C_R_SIGNAL_MIN_EXCLUSIVE } from "@/src/snowballTrendGrade";

export type SnowballBarRangeSignalFilter =
  | "all"
  | "gt30"
  | "ge5"
  | "ge8"
  | "ge10"
  | "ge15"
  | "ge20"
  | "ge30"
  | "lt3"
  | "lt5"
  | "lt8"
  | "lt10"
  | "lt15"
  | "lt20"
  | "lt30"
  | "has"
  | "none";

const BAR_RANGE_SIGNAL_GE: Record<Extract<SnowballBarRangeSignalFilter, `ge${string}`>, number> = {
  ge5: 5,
  ge8: 8,
  ge10: 10,
  ge15: 15,
  ge20: 20,
  ge30: 30,
};

const BAR_RANGE_SIGNAL_LT: Record<Extract<SnowballBarRangeSignalFilter, `lt${string}`>, number> = {
  lt3: 3,
  lt5: 5,
  lt8: 8,
  lt10: 10,
  lt15: 15,
  lt20: 20,
  lt30: 30,
};

export const SNOWBALL_BAR_RANGE_SIGNAL_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballBarRangeSignalFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  {
    value: "gt30",
    label: `> ${SNOWBALL_TREND_GRADE_C_R_SIGNAL_MIN_EXCLUSIVE}%`,
  },
  { value: "ge5", label: "≥ 5%" },
  { value: "ge8", label: "≥ 8%" },
  { value: "ge10", label: "≥ 10%" },
  { value: "ge15", label: "≥ 15%" },
  { value: "ge20", label: "≥ 20%" },
  { value: "ge30", label: "≥ 30%" },
  { value: "lt3", label: "< 3%" },
  { value: "lt5", label: "< 5%" },
  { value: "lt8", label: "< 8%" },
  { value: "lt10", label: "< 10%" },
  { value: "lt15", label: "< 15%" },
  { value: "lt20", label: "< 20%" },
  { value: "lt30", label: "< 30%" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballBarRangeSignalFilterLabel(filter: SnowballBarRangeSignalFilter): string {
  return SNOWBALL_BAR_RANGE_SIGNAL_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballBarRangeSignalFilterTitle(filter: SnowballBarRangeSignalFilter): string {
  if (filter === "all") return "ไม่กรอง R% สัญญาณ";
  if (filter === "has") return "มีค่า R% แท่งสัญญาณ";
  if (filter === "none") return "ไม่มีค่า R% แท่งสัญญาณ";
  if (filter === "gt30") {
    return `R% สัญญาณ > ${SNOWBALL_TREND_GRADE_C_R_SIGNAL_MIN_EXCLUSIVE}% (เกรด C)`;
  }
  return `R% สัญญาณ ${snowballBarRangeSignalFilterLabel(filter)}`;
}

export function snowballStatsRowMatchesBarRangeSignalFilter(
  row: Pick<SnowballStatsRow, "barRangePctSignal">,
  filter: SnowballBarRangeSignalFilter,
): boolean {
  if (filter === "all") return true;
  const raw = row.barRangePctSignal;
  const has = raw != null && Number.isFinite(raw);
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  if (filter === "gt30") return raw > SNOWBALL_TREND_GRADE_C_R_SIGNAL_MIN_EXCLUSIVE;
  if (filter in BAR_RANGE_SIGNAL_GE) {
    return raw >= BAR_RANGE_SIGNAL_GE[filter as keyof typeof BAR_RANGE_SIGNAL_GE];
  }
  if (filter in BAR_RANGE_SIGNAL_LT) {
    return raw < BAR_RANGE_SIGNAL_LT[filter as keyof typeof BAR_RANGE_SIGNAL_LT];
  }
  return false;
}
