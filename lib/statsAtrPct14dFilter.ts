/** ตัวกรอง ATR% 14D — Snowball + Reversal stats Mini App */

export type StatsAtrPct14dFilter = "all" | "lt5" | "lt10" | "lt15" | "ge10";

const ATR_PCT_LT_MAX: Record<Extract<StatsAtrPct14dFilter, "lt5" | "lt10" | "lt15">, number> = {
  lt5: 5,
  lt10: 10,
  lt15: 15,
};

export const STATS_ATR_PCT14D_FILTER_OPTIONS: ReadonlyArray<{
  value: StatsAtrPct14dFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "lt5", label: "< 5%" },
  { value: "lt10", label: "< 10%" },
  { value: "lt15", label: "< 15%" },
  { value: "ge10", label: "≥ 10%" },
];

export function statsAtrPct14dFilterLabel(filter: StatsAtrPct14dFilter): string {
  return STATS_ATR_PCT14D_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function statsAtrPct14dFilterTitle(filter: StatsAtrPct14dFilter): string {
  if (filter === "all") return "ไม่กรอง ATR% 14D";
  return `ATR(14) 1d ÷ close ${statsAtrPct14dFilterLabel(filter)}`;
}

export function statsRowMatchesAtrPct14dFilter(
  atrPct14d: number | null | undefined,
  filter: StatsAtrPct14dFilter,
): boolean {
  if (filter === "all") return true;
  if (atrPct14d == null || !Number.isFinite(atrPct14d) || atrPct14d <= 0) return false;
  if (filter === "ge10") return atrPct14d >= 10;
  return atrPct14d < ATR_PCT_LT_MAX[filter];
}
