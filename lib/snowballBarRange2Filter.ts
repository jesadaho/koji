/** ตัวกรอง R% 2แท่ง (barRangePct2Sum) — Snowball stats */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";

export type SnowballBarRange2Filter =
  | "all"
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

const BAR_RANGE2_GE: Record<Extract<SnowballBarRange2Filter, `ge${string}`>, number> = {
  ge5: 5,
  ge8: 8,
  ge10: 10,
  ge15: 15,
  ge20: 20,
};

const BAR_RANGE2_LT: Record<Extract<SnowballBarRange2Filter, `lt${string}`>, number> = {
  lt5: 5,
  lt8: 8,
  lt10: 10,
  lt15: 15,
  lt20: 20,
};

export const SNOWBALL_BAR_RANGE2_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballBarRange2Filter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
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

export function snowballBarRange2FilterLabel(filter: SnowballBarRange2Filter): string {
  return SNOWBALL_BAR_RANGE2_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballBarRange2FilterTitle(filter: SnowballBarRange2Filter): string {
  if (filter === "all") return "ไม่กรอง R% 2แท่ง";
  if (filter === "has") return "มีค่า R% 2แท่ง (แท่งก่อน + แท่งสัญญาณ)";
  if (filter === "none") return "ไม่มีค่า R% 2แท่ง";
  return `R% 2แท่ง ${snowballBarRange2FilterLabel(filter)}`;
}

export function snowballStatsRowMatchesBarRange2Filter(
  row: Pick<SnowballStatsRow, "barRangePct2Sum">,
  filter: SnowballBarRange2Filter,
): boolean {
  if (filter === "all") return true;
  const raw = row.barRangePct2Sum;
  const has = raw != null && Number.isFinite(raw);
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  if (filter in BAR_RANGE2_GE) {
    return raw >= BAR_RANGE2_GE[filter as keyof typeof BAR_RANGE2_GE];
  }
  if (filter in BAR_RANGE2_LT) {
    return raw < BAR_RANGE2_LT[filter as keyof typeof BAR_RANGE2_LT];
  }
  return false;
}
