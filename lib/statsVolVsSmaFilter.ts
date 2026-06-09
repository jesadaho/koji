/** ตัวกรอง Vol×SMA ร่วมกัน — Snowball + Reversal stats Mini App */

export type StatsVolVsSmaFilter =
  | "all"
  | "ge1"
  | "ge15"
  | "ge2"
  | "ge25"
  | "ge3"
  | "ge4"
  | "ge5"
  | "ge6"
  | "ge8"
  | "ge10"
  | "lt1"
  | "lt15"
  | "lt2"
  | "lt25"
  | "lt3"
  | "lt4"
  | "lt5"
  | "lt6"
  | "lt8"
  | "lt10";

const VOL_VS_SMA_GE: Record<Extract<StatsVolVsSmaFilter, `ge${string}`>, number> = {
  ge1: 1,
  ge15: 1.5,
  ge2: 2,
  ge25: 2.5,
  ge3: 3,
  ge4: 4,
  ge5: 5,
  ge6: 6,
  ge8: 8,
  ge10: 10,
};

const VOL_VS_SMA_LT: Record<Extract<StatsVolVsSmaFilter, `lt${string}`>, number> = {
  lt1: 1,
  lt15: 1.5,
  lt2: 2,
  lt25: 2.5,
  lt3: 3,
  lt4: 4,
  lt5: 5,
  lt6: 6,
  lt8: 8,
  lt10: 10,
};

export const STATS_VOL_VS_SMA_FILTER_OPTIONS: ReadonlyArray<{
  value: StatsVolVsSmaFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "ge1", label: "≥ 1.0×" },
  { value: "ge15", label: "≥ 1.5×" },
  { value: "ge2", label: "≥ 2.0×" },
  { value: "ge25", label: "≥ 2.5×" },
  { value: "ge3", label: "≥ 3×" },
  { value: "ge4", label: "≥ 4×" },
  { value: "ge5", label: "≥ 5×" },
  { value: "ge6", label: "≥ 6×" },
  { value: "ge8", label: "≥ 8×" },
  { value: "ge10", label: "≥ 10×" },
  { value: "lt1", label: "< 1.0×" },
  { value: "lt15", label: "< 1.5×" },
  { value: "lt2", label: "< 2.0×" },
  { value: "lt25", label: "< 2.5×" },
  { value: "lt3", label: "< 3×" },
  { value: "lt4", label: "< 4×" },
  { value: "lt5", label: "< 5×" },
  { value: "lt6", label: "< 6×" },
  { value: "lt8", label: "< 8×" },
  { value: "lt10", label: "< 10×" },
];

export function statsVolVsSmaFilterLabel(filter: StatsVolVsSmaFilter): string {
  return STATS_VOL_VS_SMA_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function statsRowMatchesVolVsSmaFilter(
  ratio: number | null | undefined,
  filter: StatsVolVsSmaFilter,
): boolean {
  if (filter === "all") return true;
  if (ratio == null || !Number.isFinite(ratio)) return false;
  if (filter in VOL_VS_SMA_GE) {
    return ratio >= VOL_VS_SMA_GE[filter as keyof typeof VOL_VS_SMA_GE];
  }
  if (filter in VOL_VS_SMA_LT) {
    return ratio < VOL_VS_SMA_LT[filter as keyof typeof VOL_VS_SMA_LT];
  }
  return false;
}
