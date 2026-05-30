/** ตัวกรอง Vol×SMA ร่วมกัน — Snowball + Reversal stats Mini App */

export type StatsVolVsSmaFilter =
  | "all"
  | "ge1"
  | "ge15"
  | "ge2"
  | "ge25"
  | "ge4"
  | "ge6"
  | "ge8"
  | "ge10";

const VOL_VS_SMA_MIN: Record<Exclude<StatsVolVsSmaFilter, "all">, number> = {
  ge1: 1,
  ge15: 1.5,
  ge2: 2,
  ge25: 2.5,
  ge4: 4,
  ge6: 6,
  ge8: 8,
  ge10: 10,
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
  { value: "ge4", label: "≥ 4×" },
  { value: "ge6", label: "≥ 6×" },
  { value: "ge8", label: "≥ 8×" },
  { value: "ge10", label: "≥ 10×" },
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
  return ratio >= VOL_VS_SMA_MIN[filter];
}
