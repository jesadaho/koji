/** Snapshot 3-stage checklist Snowball 4h LONG — ใช้ popup + CSV */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import type { SnowballLongStructureTier } from "@/src/snowballLongBreakoutGrade";
import type { SnowballStatsGateStep } from "@/src/snowballStatsGateSteps";
import {
  snowballTrendMomentumMaxDrawbackPct,
  snowballTrendMomentumMaxVolumeDrops,
} from "@/src/snowballTrendMomentumMetrics";

const SNOWBALL_STATS_VOL_STRICT_MULT = 2.5;

function confirmGateStepsAllPass(row: Pick<SnowballStatsRow, "confirmGateSteps">): boolean {
  const steps = row.confirmGateSteps;
  return Array.isArray(steps) && steps.length > 0 && steps.every((s) => s.ok === true);
}

export type SnowballStatsStagedSnapshot = {
  stage1Pass: boolean;
  swing48Ok: boolean;
  swing200Ok: boolean | null;
  vahOk: boolean;
  stage2Pass: boolean;
  twoBarSteps: SnowballStatsGateStep[];
  stage3Reached: boolean;
  failCount: number;
  ddPct: number | null;
  ddOk: boolean | null;
  ddLimit: number;
  volDrops: number | null;
  volCascadeOk: boolean;
  volStrictOk: boolean;
  strictMult: number;
  signalVolVsSma: number | null;
};

type StagedSnapshotRow = Pick<
  SnowballStatsRow,
  | "alertSide"
  | "triggerKind"
  | "signalBarTf"
  | "structureTier"
  | "swing200Ok"
  | "confirmGateSteps"
  | "volumeCascadeYn"
  | "volumeDropCount"
  | "signalMaxDdPct"
  | "signalVolVsSma"
  | "volStrictOk"
  | "volMultAtAlert"
  | "momentumFailCount"
  | "momentumFailGradeF"
  | "momentumDowngrade"
>;

function isStructureTier(tier: string | undefined): tier is SnowballLongStructureTier {
  return tier === "a_plus" || tier === "b_plus" || tier === "c_plus";
}

/** คืน null ถ้าไม่ใช่ 4h LONG */
export function snowballStatsStagedSnapshot(row: StagedSnapshotRow): SnowballStatsStagedSnapshot | null {
  const side = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
  if (side !== "long" || row.signalBarTf !== "4h") return null;

  const struct =
    row.structureTier && isStructureTier(row.structureTier) ? row.structureTier : null;
  const strictMult =
    row.volMultAtAlert != null && Number.isFinite(row.volMultAtAlert) && row.volMultAtAlert > 0
      ? row.volMultAtAlert
      : SNOWBALL_STATS_VOL_STRICT_MULT;

  const swing48Ok = struct != null;
  const vahOk = struct === "a_plus" || struct === "b_plus";
  const swing200Ok: boolean | null =
    typeof row.swing200Ok === "boolean"
      ? row.swing200Ok
      : struct === "a_plus"
        ? true
        : struct === "c_plus"
          ? false
          : null;
  const stage1Pass = swing48Ok;

  const stage2Pass = confirmGateStepsAllPass(row);
  const twoBarSteps = row.confirmGateSteps ?? [];

  const maxVolDrops = snowballTrendMomentumMaxVolumeDrops();
  const volDrops =
    row.volumeDropCount != null && Number.isFinite(row.volumeDropCount) && row.volumeDropCount >= 0
      ? Math.floor(row.volumeDropCount)
      : row.volumeCascadeYn === "Y"
        ? 0
        : row.volumeCascadeYn === "N"
          ? maxVolDrops + 1
          : null;
  const volCascadeOk = row.volumeCascadeYn === "Y";
  const volStrictOk =
    row.volStrictOk === true ||
    (row.volStrictOk !== false &&
      row.signalVolVsSma != null &&
      Number.isFinite(row.signalVolVsSma) &&
      row.signalVolVsSma >= strictMult);

  const ddLimit = snowballTrendMomentumMaxDrawbackPct();
  const ddPct =
    row.signalMaxDdPct != null && Number.isFinite(row.signalMaxDdPct) && row.signalMaxDdPct >= 0
      ? row.signalMaxDdPct
      : null;
  let ddOk: boolean | null;
  if (ddPct != null) {
    ddOk = ddPct <= ddLimit;
  } else if (row.momentumFailCount != null) {
    const otherFails = (volCascadeOk ? 0 : 1) + (volStrictOk ? 0 : 1);
    ddOk = row.momentumFailCount === otherFails;
  } else {
    ddOk = null;
  }

  let failCount: number = row.momentumFailCount != null ? row.momentumFailCount : 0;
  if (row.momentumFailCount == null) {
    if (!volCascadeOk) failCount += 1;
    if (!volStrictOk) failCount += 1;
    if (ddOk === false) failCount += 1;
    if (row.momentumFailGradeF) failCount = Math.max(failCount, 2);
    else if (row.momentumDowngrade) failCount = Math.max(failCount, 1);
  }

  return {
    stage1Pass,
    swing48Ok,
    swing200Ok,
    vahOk,
    stage2Pass,
    twoBarSteps,
    stage3Reached: stage2Pass,
    failCount,
    ddPct,
    ddOk,
    ddLimit,
    volDrops,
    volCascadeOk,
    volStrictOk,
    strictMult,
    signalVolVsSma:
      row.signalVolVsSma != null && Number.isFinite(row.signalVolVsSma) ? row.signalVolVsSma : null,
  };
}
