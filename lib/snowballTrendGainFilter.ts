/** ตัวกรอง Trend Gain % — Snowball stats */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import {
  SNOWBALL_TREND_GRADE_D_TREND_GAIN_MAX_PCT,
  SNOWBALL_TREND_GRADE_D_TREND_GAIN_MIN_PCT,
  SNOWBALL_TREND_GRADE_S_TREND_GAIN_MIN_EXCLUSIVE,
} from "@/src/snowballTrendGrade";

export type SnowballTrendGainFilter =
  | "all"
  | "gain5_20"
  | "gain20_50"
  | "gt50"
  | "ge20"
  | "ge30"
  | "ge50"
  | "lt20"
  | "lt10"
  | "lt50"
  | "has"
  | "none";

const TREND_GAIN_GE: Record<Extract<SnowballTrendGainFilter, `ge${string}`>, number> = {
  ge20: 20,
  ge30: 30,
  ge50: 50,
};

const TREND_GAIN_LT: Record<Extract<SnowballTrendGainFilter, `lt${string}`>, number> = {
  lt10: 10,
  lt20: 20,
  lt50: 50,
};

export const SNOWBALL_TREND_GAIN_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballTrendGainFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "gain5_20", label: "5–20%" },
  {
    value: "gain20_50",
    label: `${SNOWBALL_TREND_GRADE_D_TREND_GAIN_MIN_PCT}–${SNOWBALL_TREND_GRADE_D_TREND_GAIN_MAX_PCT}%`,
  },
  {
    value: "gt50",
    label: `> ${SNOWBALL_TREND_GRADE_S_TREND_GAIN_MIN_EXCLUSIVE}%`,
  },
  { value: "ge20", label: "≥ 20%" },
  { value: "ge30", label: "≥ 30%" },
  { value: "ge50", label: "≥ 50%" },
  { value: "lt20", label: "< 20%" },
  { value: "lt10", label: "< 10%" },
  { value: "lt50", label: "< 50%" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballTrendGainFilterLabel(filter: SnowballTrendGainFilter): string {
  return SNOWBALL_TREND_GAIN_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballTrendGainFilterTitle(filter: SnowballTrendGainFilter): string {
  if (filter === "all") return "ไม่กรอง Trend Gain";
  if (filter === "has") return "มีค่า Trend Gain %";
  if (filter === "none") return "ไม่มีค่า Trend Gain %";
  if (filter === "gain5_20") return "Trend Gain 5–20% (Reversal Quality Long 1H)";
  if (filter === "gain20_50") {
    return `Trend Gain ${SNOWBALL_TREND_GRADE_D_TREND_GAIN_MIN_PCT}–${SNOWBALL_TREND_GRADE_D_TREND_GAIN_MAX_PCT}% (เกรด D)`;
  }
  if (filter === "gt50") {
    return `Trend Gain > ${SNOWBALL_TREND_GRADE_S_TREND_GAIN_MIN_EXCLUSIVE}% (เกรด S/B — S ต้อง Weekend ด้วย)`;
  }
  return `Trend Gain ${snowballTrendGainFilterLabel(filter)}`;
}

export function snowballStatsRowMatchesTrendGainFilter(
  row: Pick<SnowballStatsRow, "trendGainPct">,
  filter: SnowballTrendGainFilter,
): boolean {
  if (filter === "all") return true;
  const raw = row.trendGainPct;
  const has = raw != null && Number.isFinite(raw);
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  if (filter === "gain5_20") return raw >= 5 && raw <= 20;
  if (filter === "gain20_50") {
    return (
      raw >= SNOWBALL_TREND_GRADE_D_TREND_GAIN_MIN_PCT &&
      raw <= SNOWBALL_TREND_GRADE_D_TREND_GAIN_MAX_PCT
    );
  }
  if (filter === "gt50") return raw > SNOWBALL_TREND_GRADE_S_TREND_GAIN_MIN_EXCLUSIVE;
  if (filter in TREND_GAIN_GE) {
    return raw >= TREND_GAIN_GE[filter as keyof typeof TREND_GAIN_GE];
  }
  if (filter in TREND_GAIN_LT) {
    return raw < TREND_GAIN_LT[filter as keyof typeof TREND_GAIN_LT];
  }
  return false;
}
