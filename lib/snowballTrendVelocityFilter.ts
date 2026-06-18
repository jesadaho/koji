/** ตัวกรอง Trend Velocity (%/h) — Snowball stats */

import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";
import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import {
  SNOWBALL_TREND_GRADE_D_VELOCITY_MAX,
  SNOWBALL_TREND_GRADE_D_VELOCITY_MIN,
} from "@/src/snowballTrendGrade";

export type SnowballTrendVelocityFilter =
  | "all"
  | "vel05_15"
  | "ge05"
  | "ge10"
  | "ge15"
  | "lt05"
  | "lt15"
  | "lt20"
  | "has"
  | "none";

const TREND_VELOCITY_GE: Record<Extract<SnowballTrendVelocityFilter, `ge${string}`>, number> = {
  ge05: 0.5,
  ge10: 1.0,
  ge15: 1.5,
};

const TREND_VELOCITY_LT: Record<Extract<SnowballTrendVelocityFilter, `lt${string}`>, number> = {
  lt05: 0.5,
  lt15: 1.5,
  lt20: 2.0,
};

export const SNOWBALL_TREND_VELOCITY_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballTrendVelocityFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  {
    value: "vel05_15",
    label: `${SNOWBALL_TREND_GRADE_D_VELOCITY_MIN}–${SNOWBALL_TREND_GRADE_D_VELOCITY_MAX}%/h`,
  },
  { value: "ge05", label: "≥ 0.5%/h" },
  { value: "ge10", label: "≥ 1.0%/h" },
  { value: "ge15", label: "≥ 1.5%/h" },
  { value: "lt05", label: "< 0.5%/h" },
  { value: "lt15", label: "< 1.5%/h" },
  { value: "lt20", label: "< 2.0%/h" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballTrendVelocityFilterLabel(filter: SnowballTrendVelocityFilter): string {
  return SNOWBALL_TREND_VELOCITY_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballTrendVelocityFilterTitle(filter: SnowballTrendVelocityFilter): string {
  if (filter === "all") return "ไม่กรอง Trend Velocity";
  if (filter === "has") return "มีค่า Trend Velocity (%/h)";
  if (filter === "none") return "ไม่มีค่า Trend Velocity (%/h)";
  if (filter === "vel05_15") {
    return `Velocity ${SNOWBALL_TREND_GRADE_D_VELOCITY_MIN}–${SNOWBALL_TREND_GRADE_D_VELOCITY_MAX}%/h`;
  }
  return `Trend Velocity ${snowballTrendVelocityFilterLabel(filter)}`;
}

export function snowballStatsRowMatchesTrendVelocityFilter(
  row: Pick<SnowballStatsRow, "trendGainPct" | "ageOfTrendHours">,
  filter: SnowballTrendVelocityFilter,
): boolean {
  if (filter === "all") return true;
  const vel = computePumpCycleTrendVelocity(row.trendGainPct, row.ageOfTrendHours);
  const has = vel != null && Number.isFinite(vel);
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  if (filter === "vel05_15") {
    return vel >= SNOWBALL_TREND_GRADE_D_VELOCITY_MIN && vel <= SNOWBALL_TREND_GRADE_D_VELOCITY_MAX;
  }
  if (filter in TREND_VELOCITY_GE) {
    return vel >= TREND_VELOCITY_GE[filter as keyof typeof TREND_VELOCITY_GE];
  }
  if (filter in TREND_VELOCITY_LT) {
    return vel < TREND_VELOCITY_LT[filter as keyof typeof TREND_VELOCITY_LT];
  }
  return false;
}
