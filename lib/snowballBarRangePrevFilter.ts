/** ตัวกรอง R% ก่อน (barRangePctPrev) — Snowball stats */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";

export type SnowballBarRangePrevFilter =
  | "all"
  | "r10_20"
  | "ge5"
  | "ge8"
  | "ge10"
  | "ge15"
  | "ge20"
  | "lt5"
  | "lt8"
  | "lt10"
  | "lt15"
  | "lt20"
  | "has"
  | "none";

const BAR_RANGE_PREV_GE: Record<Extract<SnowballBarRangePrevFilter, `ge${string}`>, number> = {
  ge5: 5,
  ge8: 8,
  ge10: 10,
  ge15: 15,
  ge20: 20,
};

const BAR_RANGE_PREV_LT: Record<Extract<SnowballBarRangePrevFilter, `lt${string}`>, number> = {
  lt5: 5,
  lt8: 8,
  lt10: 10,
  lt15: 15,
  lt20: 20,
};

export const SNOWBALL_BAR_RANGE_PREV_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballBarRangePrevFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "r10_20", label: "10–20%" },
  { value: "ge5", label: "≥ 5%" },
  { value: "ge8", label: "≥ 8%" },
  { value: "ge10", label: "≥ 10%" },
  { value: "ge15", label: "≥ 15%" },
  { value: "ge20", label: "≥ 20%" },
  { value: "lt5", label: "< 5%" },
  { value: "lt8", label: "< 8%" },
  { value: "lt10", label: "< 10%" },
  { value: "lt15", label: "< 15%" },
  { value: "lt20", label: "< 20%" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballBarRangePrevFilterLabel(filter: SnowballBarRangePrevFilter): string {
  return SNOWBALL_BAR_RANGE_PREV_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballBarRangePrevFilterTitle(filter: SnowballBarRangePrevFilter): string {
  if (filter === "all") return "ไม่กรอง R% ก่อน";
  if (filter === "has") return "มีค่า R% แท่งก่อนสัญญาณ";
  if (filter === "none") return "ไม่มีค่า R% แท่งก่อนสัญญาณ";
  if (filter === "r10_20") return "R% ก่อน 10–20% (แท่งก่อนสัญญาณ)";
  return `R% ก่อน ${snowballBarRangePrevFilterLabel(filter)}`;
}

export function snowballStatsRowMatchesBarRangePrevFilter(
  row: Pick<SnowballStatsRow, "barRangePctPrev">,
  filter: SnowballBarRangePrevFilter,
): boolean {
  if (filter === "all") return true;
  const raw = row.barRangePctPrev;
  const has = raw != null && Number.isFinite(raw);
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  if (filter === "r10_20") return raw >= 10 && raw <= 20;
  if (filter in BAR_RANGE_PREV_GE) {
    return raw >= BAR_RANGE_PREV_GE[filter as keyof typeof BAR_RANGE_PREV_GE];
  }
  if (filter in BAR_RANGE_PREV_LT) {
    return raw < BAR_RANGE_PREV_LT[filter as keyof typeof BAR_RANGE_PREV_LT];
  }
  return false;
}
