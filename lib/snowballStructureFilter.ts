/** ตัวกรองโครงสร้าง 4H + Stage 3 — Snowball stats */

import { SNOWBALL_STATS_VOL_STRICT_MULT } from "@/lib/snowballGradeChecklist";
import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import type { SnowballLongStructureTier } from "@/src/snowballLongBreakoutGrade";

export type SnowballStructureFilter = "all" | "hh200Vah" | "s3VolSpurt";

export const SNOWBALL_STRUCTURE_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballStructureFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "hh200Vah", label: "HH200+VAH" },
  { value: "s3VolSpurt", label: "S3 Vol Spurt" },
];

function isStructureTier(tier: string | undefined): tier is SnowballLongStructureTier {
  return tier === "a_plus" || tier === "b_plus" || tier === "c_plus";
}

/** VAH ผ่าน — จาก structureTier ตอนแจ้ง */
export function snowballStatsRowVahOk(
  row: Pick<SnowballStatsRow, "structureTier">,
): boolean {
  const tier = row.structureTier;
  return tier === "a_plus" || tier === "b_plus";
}

/** HH200 ผ่าน — ใช้ swing200Ok ถ้ามี · อนุมานจาก tier แถวเก่า */
export function snowballStatsRowSwing200Ok(
  row: Pick<SnowballStatsRow, "structureTier" | "swing200Ok">,
): boolean | null {
  if (typeof row.swing200Ok === "boolean") return row.swing200Ok;
  const tier = row.structureTier;
  if (!isStructureTier(tier)) return null;
  if (tier === "a_plus") return true;
  if (tier === "c_plus") return false;
  return null;
}

/** HH200 และ VAH ผ่านคู่ */
export function snowballStatsRowHh200AndVahOk(
  row: Pick<SnowballStatsRow, "structureTier" | "swing200Ok">,
): boolean {
  return snowballStatsRowVahOk(row) && snowballStatsRowSwing200Ok(row) === true;
}

/** Stage 3 — Signal Vol Spurt ผ่าน (vol แท่งสัญญาณ ÷ SMA > strict mult) */
export function snowballStatsRowVolSpurtOk(
  row: Pick<SnowballStatsRow, "signalVolVsSma" | "volStrictOk" | "volMultAtAlert">,
): boolean {
  const strictMult =
    row.volMultAtAlert != null && Number.isFinite(row.volMultAtAlert) && row.volMultAtAlert > 0
      ? row.volMultAtAlert
      : SNOWBALL_STATS_VOL_STRICT_MULT;
  if (row.volStrictOk === true) return true;
  if (row.volStrictOk === false) return false;
  return (
    row.signalVolVsSma != null &&
    Number.isFinite(row.signalVolVsSma) &&
    row.signalVolVsSma >= strictMult
  );
}

export function snowballStructureFilterLabel(filter: SnowballStructureFilter): string {
  return SNOWBALL_STRUCTURE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballStructureFilterTitle(filter: SnowballStructureFilter): string {
  if (filter === "all") return "ไม่กรองโครงสร้าง / Stage 3";
  if (filter === "hh200Vah") {
    return "โครงสร้าง 4H: Swing HH200 และ VAH ผ่านคู่ (snapshot ตอนแจ้ง)";
  }
  return `Stage 3: Signal Vol Spurt ผ่าน (Vol แท่งสัญญาณ ÷ SMA > ${SNOWBALL_STATS_VOL_STRICT_MULT}× ณ เวลาแจ้ง)`;
}

export function snowballStatsRowMatchesStructureFilter(
  row: Pick<
    SnowballStatsRow,
    | "structureTier"
    | "swing200Ok"
    | "signalVolVsSma"
    | "volStrictOk"
    | "volMultAtAlert"
    | "signalBarTf"
    | "alertSide"
    | "triggerKind"
  >,
  filter: SnowballStructureFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "hh200Vah") return snowballStatsRowHh200AndVahOk(row);
  if (filter === "s3VolSpurt") return snowballStatsRowVolSpurtOk(row);
  return true;
}
