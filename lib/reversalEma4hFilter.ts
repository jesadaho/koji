/** ตัวกรอง EMA4h slope — Reversal / Snowball stats Mini App + CSV export */

import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

export type ReversalEma4hFilter =
  | "all"
  | "lt0"
  | "lt3"
  | "lt5"
  | "gt3"
  | "gt5"
  | "gt0lt30"
  | "gt30"
  | "gt50";

export const REVERSAL_EMA4H_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalEma4hFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "lt0", label: "< 0" },
  { value: "lt3", label: "< -3" },
  { value: "lt5", label: "< -5" },
  { value: "gt3", label: "> 3" },
  { value: "gt5", label: "> 5" },
  { value: "gt0lt30", label: "> 0 < 30" },
  { value: "gt30", label: "> 30" },
  { value: "gt50", label: "> 50" },
];

const EMA4H_SLOPE_THRESHOLD: Record<
  Exclude<ReversalEma4hFilter, "all" | "gt0lt30">,
  number
> = {
  lt0: 0,
  lt3: -3,
  lt5: -5,
  gt3: 3,
  gt5: 5,
  gt30: 30,
  gt50: 50,
};

export function reversalEma4hFilterLabel(filter: ReversalEma4hFilter): string {
  return REVERSAL_EMA4H_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalEma4hFilterTitle(filter: ReversalEma4hFilter): string {
  if (filter === "all") return "ไม่กรอง EMA4h slope 7 วัน";
  if (filter === "gt0lt30") return "EMA(12) 4h slope 7 วัน > 0% และ < 30%";
  const label = reversalEma4hFilterLabel(filter);
  return `EMA(12) 4h slope 7 วัน ${label}%`;
}

export function reversalRowMatchesEma4hFilter(
  row: Pick<CandleReversalStatsRow, "ema4hSlopePct7d">,
  filter: ReversalEma4hFilter,
): boolean {
  if (filter === "all") return true;
  const pct = row.ema4hSlopePct7d;
  if (pct == null || !Number.isFinite(pct)) return false;
  if (filter === "gt0lt30") return pct > 0 && pct < 30;
  const th = EMA4H_SLOPE_THRESHOLD[filter];
  if (filter === "lt0" || filter === "lt3" || filter === "lt5") return pct < th;
  return pct > th;
}
