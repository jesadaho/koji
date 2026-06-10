/** CSV cells สำหรับ 3-stage checklist Snowball 4h LONG (จาก snapshot ตอนแจ้ง) */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import { snowballStatsStagedSnapshot } from "@/lib/snowballStatsStagedSnapshot";
import type { SnowballStatsGateStep } from "@/src/snowballStatsGateSteps";

export const SNOWBALL_STATS_STAGED_CSV_HEADERS = [
  "S1 ผ่าน",
  "S1 HH48",
  "S1 HH200",
  "S1 VAH",
  "S2 ผ่าน",
  "S2 Pullback",
  "S2 Vol ratio",
  "S2 Low 1H",
  "S2 Doji",
  "S3 ผ่าน",
  "S3 Max DD 15m",
  "S3 Vol drops",
  "S3 Vol Spurt",
] as const;

function stagedCsvPass(ok: boolean | null | undefined): string {
  if (ok === true) return "ผ่าน";
  if (ok === false) return "ไม่ผ่าน";
  return "";
}

function findGateStep(steps: SnowballStatsGateStep[], needle: string): SnowballStatsGateStep | undefined {
  return steps.find((s) => s.label.includes(needle));
}

function gateVolRatioValue(step: SnowballStatsGateStep | undefined): string {
  if (!step) return "";
  const m = step.detail.match(/อัตราส่วน\s+([\d.]+)/);
  return m?.[1] ?? "";
}

function stage3PassLabel(snap: NonNullable<ReturnType<typeof snowballStatsStagedSnapshot>>): string {
  if (!snap.stage3Reached) return "—";
  if (snap.failCount === 0) return "PASS";
  return `FAIL ${snap.failCount}/3`;
}

function maxDdCell(snap: NonNullable<ReturnType<typeof snowballStatsStagedSnapshot>>): string {
  if (snap.ddPct == null) return "";
  const pct = `${snap.ddPct.toFixed(2)}%`;
  if (snap.ddOk === false) return `${pct} ไม่ผ่าน`;
  if (snap.ddOk === true) return pct;
  return pct;
}

function volSpurtCell(snap: NonNullable<ReturnType<typeof snowballStatsStagedSnapshot>>): string {
  if (snap.signalVolVsSma == null || !Number.isFinite(snap.signalVolVsSma)) return "";
  const x = `${snap.signalVolVsSma.toFixed(2)}x`;
  if (!snap.stage3Reached) return x;
  if (!snap.volStrictOk) return `${x} ไม่ผ่าน`;
  return x;
}

function volDropsCell(snap: NonNullable<ReturnType<typeof snowballStatsStagedSnapshot>>): string {
  if (snap.volDrops == null) return "";
  const n = String(snap.volDrops);
  if (!snap.stage3Reached) return n;
  if (!snap.volCascadeOk) return `${n} ไม่ผ่าน`;
  return n;
}

/** คืนเซลล์ตามลำดับ SNOWBALL_STATS_STAGED_CSV_HEADERS — แถวที่ไม่ใช่ 4h LONG ว่างทุกคอลัมน์ */
export function snowballStatsStagedCsvCells(row: SnowballStatsRow): string[] {
  const snap = snowballStatsStagedSnapshot(row);
  if (!snap) {
    return SNOWBALL_STATS_STAGED_CSV_HEADERS.map(() => "");
  }

  const steps = snap.twoBarSteps;
  const pullback = findGateStep(steps, "Pullback");
  const volRatio = findGateStep(steps, "Vol แท่ง confirm");
  const low1h = findGateStep(steps, "Low 1H");
  const doji = findGateStep(steps, "โดจิ");

  return [
    stagedCsvPass(snap.stage1Pass),
    stagedCsvPass(snap.swing48Ok),
    stagedCsvPass(snap.swing200Ok),
    stagedCsvPass(snap.vahOk),
    stagedCsvPass(snap.stage2Pass),
    stagedCsvPass(pullback?.ok),
    gateVolRatioValue(volRatio),
    stagedCsvPass(low1h?.ok),
    stagedCsvPass(doji?.ok),
    stage3PassLabel(snap),
    maxDdCell(snap),
    volDropsCell(snap),
    volSpurtCell(snap),
  ];
}
