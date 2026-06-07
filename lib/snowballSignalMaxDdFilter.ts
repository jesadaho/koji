/** ตัวกรอง Max DD ก่อนแจ้ง (signalMaxDdPct) — Snowball stats */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";

export type SnowballSignalMaxDdFilter =
  | "all"
  | "le2"
  | "le3"
  | "le5"
  | "le10"
  | "gt5"
  | "gt10"
  | "has"
  | "none";

export const SNOWBALL_SIGNAL_MAX_DD_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballSignalMaxDdFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "le2", label: "≤ 2%" },
  { value: "le3", label: "≤ 3%" },
  { value: "le5", label: "≤ 5%" },
  { value: "le10", label: "≤ 10%" },
  { value: "gt5", label: "> 5%" },
  { value: "gt10", label: "> 10%" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballSignalMaxDdFilterLabel(filter: SnowballSignalMaxDdFilter): string {
  return SNOWBALL_SIGNAL_MAX_DD_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballSignalMaxDdFilterTitle(filter: SnowballSignalMaxDdFilter): string {
  if (filter === "all") return "ไม่กรอง Max DD ก่อนแจ้ง";
  if (filter === "has") return "มีค่า Max DD ก่อนแจ้ง (15m ย้อนหลัง 32 แท่ง)";
  if (filter === "none") return "ไม่มีค่า Max DD ก่อนแจ้ง";
  return `Max DD ก่อนแจ้ง ${snowballSignalMaxDdFilterLabel(filter)}`;
}

export function snowballStatsRowMatchesSignalMaxDdFilter(
  row: Pick<SnowballStatsRow, "signalMaxDdPct">,
  filter: SnowballSignalMaxDdFilter,
): boolean {
  if (filter === "all") return true;
  const raw = row.signalMaxDdPct;
  const has = raw != null && Number.isFinite(raw) && raw >= 0;
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  const pct = raw;
  switch (filter) {
    case "le2":
      return pct <= 2;
    case "le3":
      return pct <= 3;
    case "le5":
      return pct <= 5;
    case "le10":
      return pct <= 10;
    case "gt5":
      return pct > 5;
    case "gt10":
      return pct > 10;
    default:
      return true;
  }
}
