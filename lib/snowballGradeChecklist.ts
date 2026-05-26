/** Client-safe Snowball grade checklist (popup สถิติ) */

import {
  snowballIsGradeDPlusLong,
  snowballIsGradeF,
  snowballLongGradeDisplayLabel,
  snowballLongGradeShortLabel,
  type SnowballLongStructureTier,
} from "@/src/snowballLongBreakoutGrade";
import {
  SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C,
  snowballVolSmaMeetsGradeCMin,
} from "@/src/snowballLongGrade4hPipeline";
import {
  SNOWBALL_TREND_15M_DD_LOOKBACK,
  SNOWBALL_TREND_1H_VOL_LOOKBACK,
  snowballTrendMomentumMaxDrawbackPct,
  snowballTrendMomentumMaxVolumeDrops,
} from "@/src/snowballTrendMomentumMetrics";
import {
  snowballStatsActionPlanLabel,
  snowballStatsDerivedDisplayGrade,
  snowballStatsVolVsSmaDisplay,
  type SnowballStatsQualityTier,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";

function effectiveQualityTier(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier">,
): SnowballStatsQualityTier | undefined {
  return row.qualityTier ?? row.alertQualityTier;
}

/** ค่าเริ่มต้นสอดคล้อง INDICATOR_PUBLIC_SNOWBALL_VOL_MULT / VOL_NEAR_MISS_MULT */
export const SNOWBALL_STATS_VOL_STRICT_MULT = 2.5;
export const SNOWBALL_STATS_VOL_NEAR_MISS_MULT = 2.0;

export type SnowballGradeChecklistStatus = "pass" | "fail" | "unknown";

export type SnowballGradeChecklistItem = {
  id: "structure" | "confirm" | "vol_strict" | "vol_near_miss" | "momentum";
  title: string;
  status: SnowballGradeChecklistStatus;
  detail: string;
  /** เกณฑ์ที่ไม่ผ่าน (เมื่อ status = fail) */
  failCriteria?: string[];
};

function checklistMark(status: SnowballGradeChecklistStatus): string {
  if (status === "pass") return "✅";
  if (status === "fail") return "❌";
  return "—";
}

function structureTierHint(tier: SnowballLongStructureTier): string {
  if (tier === "a_plus") return "HH48+HH200+VAH";
  if (tier === "b_plus") return "VAH only";
  return "HH48 (C)";
}

function isStructureTier(tier: string | undefined): tier is SnowballLongStructureTier {
  return tier === "a_plus" || tier === "b_plus" || tier === "c_plus";
}

/** confirmGateSteps บันทึกครบและทุกขั้น ok */
export function snowballStatsConfirmGateStepsAllPass(
  row: Pick<SnowballStatsRow, "confirmGateSteps">,
): boolean {
  const steps = row.confirmGateSteps;
  return Array.isArray(steps) && steps.length > 0 && steps.every((s) => s.ok === true);
}

/**
 * ป้ายเก่า breakout1hConfirmFail — ไม่ใช้เมื่อ Master 4h หรือ snapshot gate ผ่านครบ
 * (ใช้ร่วม checklist + migration API)
 */
export function snowballStatsLegacyBreakout1hConfirmFailIgnored(
  row: Pick<SnowballStatsRow, "breakout1hConfirmFail" | "signalBarTf" | "confirmGateSteps">,
): boolean {
  if (row.breakout1hConfirmFail !== true) return false;
  return row.signalBarTf === "4h" || snowballStatsConfirmGateStepsAllPass(row);
}

/** ผ่านหัวข้อ 1H Confirm / two-bar ตาม snapshot หน้างาน (ไม่สะท้อนเกรด F จาก momentum) */
export function snowballStatsConfirmOk(
  row: Pick<
    SnowballStatsRow,
    | "qualityTier"
    | "alertQualityTier"
    | "breakout1hConfirmFail"
    | "momentumFailGradeF"
    | "confirmGateSteps"
    | "signalBarTf"
  >,
): boolean {
  if (snowballStatsConfirmGateStepsAllPass(row)) return true;

  if (row.signalBarTf === "4h") {
    const steps = row.confirmGateSteps;
    if (steps?.length) return false;
    return true;
  }

  if (snowballStatsLegacyBreakout1hConfirmFailIgnored(row)) return true;

  const grade = effectiveQualityTier(row);
  if (!grade || snowballIsGradeF(grade) || row.momentumFailGradeF) return false;
  if (row.breakout1hConfirmFail === true) return false;
  return true;
}

function confirmOk(
  row: Pick<
    SnowballStatsRow,
    | "qualityTier"
    | "alertQualityTier"
    | "breakout1hConfirmFail"
    | "momentumFailGradeF"
    | "confirmGateSteps"
    | "signalBarTf"
  >,
): boolean {
  const grade = effectiveQualityTier(row);
  if (!grade || snowballIsGradeF(grade) || row.momentumFailGradeF) return false;
  return snowballStatsConfirmOk(row);
}

/** Vol↗ ผ่าน แต่ momentum ไม่ครบ / Vol×SMA ไม่ผ่าน → เกรดสุดทธิ C */
function isVolCascadePassPartialMomentumC(
  row: Pick<
    SnowballStatsRow,
    | "qualityTier"
    | "alertQualityTier"
    | "momentumDowngrade"
    | "momentumFailGradeF"
    | "volumeCascadeYn"
    | "signalVolVsSma"
    | "volStrictOk"
    | "volMultAtAlert"
  >,
): boolean {
  const grade = effectiveQualityTier(row);
  if (grade !== "c_plus" || row.volumeCascadeYn !== "Y") return false;
  if (!snowballVolSmaMeetsGradeCMin(row.signalVolVsSma)) return false;
  const strictMult =
    row.volMultAtAlert != null && Number.isFinite(row.volMultAtAlert) && row.volMultAtAlert > 0
      ? row.volMultAtAlert
      : SNOWBALL_STATS_VOL_STRICT_MULT;
  const volStrictFail =
    row.volStrictOk === false ||
    (row.volStrictOk == null &&
      row.signalVolVsSma != null &&
      Number.isFinite(row.signalVolVsSma) &&
      row.signalVolVsSma < strictMult);
  return volStrictFail || row.momentumDowngrade === true || row.momentumFailGradeF === true;
}

function momentumOk(
  row: Pick<
    SnowballStatsRow,
    | "qualityTier"
    | "alertQualityTier"
    | "momentumDowngrade"
    | "momentumFailGradeF"
    | "volumeCascadeYn"
    | "signalVolVsSma"
    | "volStrictOk"
    | "volMultAtAlert"
  >,
): boolean {
  const grade = effectiveQualityTier(row);
  if (!grade || snowballIsGradeF(grade) || row.momentumFailGradeF) return false;
  if (row.momentumDowngrade === true || snowballIsGradeDPlusLong(grade)) return false;
  if (isVolCascadePassPartialMomentumC(row)) return false;
  return grade === "a_plus" || grade === "b_plus" || grade === "c_plus";
}

function momentumFailCriteria(
  row: Pick<
    SnowballStatsRow,
    | "volumeCascadeYn"
    | "qualityTier"
    | "alertQualityTier"
    | "momentumDowngrade"
    | "momentumFailGradeF"
    | "signalVolVsSma"
    | "volStrictOk"
    | "volMultAtAlert"
  >,
): string[] {
  if (momentumOk(row)) return [];
  const fails: string[] = [];
  if (isVolCascadePassPartialMomentumC(row)) {
    fails.push(
      `Vol↗ ผ่าน + Vol×SMA ≥${SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C}× — เกรดสุทธิ C (โครงสร้างสูงกว่าได้)`,
    );
  }
  if (row.momentumFailGradeF) {
    fails.push("Momentum ไม่ผ่าน (2+ รายการ)");
  } else if (row.momentumDowngrade) {
    fails.push("Momentum ลดเกรด (1 รายการ)");
  }
  const maxDrops = snowballTrendMomentumMaxVolumeDrops();
  if (row.volumeCascadeYn == null) {
    fails.push(`Vol↗ — ไม่มีข้อมูล (${SNOWBALL_TREND_1H_VOL_LOOKBACK} แท่ง 1H)`);
  } else if (row.volumeCascadeYn !== "Y") {
    fails.push(
      `Vol↗ ไม่ผ่าน (volume cascade · ยอม vol ไม่ยกฐานได้ ≤${maxDrops} ครั้งใน ${SNOWBALL_TREND_1H_VOL_LOOKBACK} แท่ง)`,
    );
  }
  const strictMult =
    row.volMultAtAlert != null && Number.isFinite(row.volMultAtAlert) && row.volMultAtAlert > 0
      ? row.volMultAtAlert
      : SNOWBALL_STATS_VOL_STRICT_MULT;
  if (row.volStrictOk === false) {
    fails.push(`Vol แท่งสัญญาณไม่ถึง ≥${strictMult}× SMA`);
  } else if (row.volStrictOk == null && row.signalVolVsSma != null && row.signalVolVsSma < strictMult) {
    fails.push(`Vol แท่งสัญญาณ ${row.signalVolVsSma.toFixed(2)}× < ${strictMult}× SMA`);
  }
  if (fails.length === 0) {
    fails.push("Sustained buying pressure ไม่ผ่าน (Vol↗ / Vol×SMA)");
  }
  return fails;
}

function confirmVolSnapshotLines(
  row: Pick<
    SnowballStatsRow,
    "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf" | "confirmVolRank" | "confirmVolRankLb"
  >,
): string[] {
  const lines: string[] = [];
  const volDisplay = snowballStatsVolVsSmaDisplay(row);
  if (volDisplay != null) {
    const tf = row.signalBarTf ?? "15m";
    lines.push(
      tf === "4h"
        ? `Vol แท่งสัญญาณ 4H ≈ ${volDisplay.toFixed(2)}× SMA`
        : `Vol แท่ง 1H confirm ≈ ${volDisplay.toFixed(2)}× SMA`,
    );
  }
  if (row.confirmVolRank != null && Number.isFinite(row.confirmVolRank)) {
    const lb = row.confirmVolRankLb ?? 48;
    lines.push(`อันดับ vol 1H = ${row.confirmVolRank} ใน ${lb} แท่ง`);
  }
  return lines;
}

function confirmFailCriteria(
  row: Pick<
    SnowballStatsRow,
    | "qualityTier"
    | "alertQualityTier"
    | "breakout1hConfirmFail"
    | "momentumFailGradeF"
    | "confirmGateSteps"
    | "signalBarTf"
    | "confirmVolVsSma"
    | "confirmVolRank"
    | "confirmVolRankLb"
  >,
): string[] {
  if (confirmOk(row)) return [];

  const failedFromSteps =
    row.confirmGateSteps
      ?.filter((s) => !s.ok)
      .map((s) => (s.detail ? `${s.label}: ${s.detail}` : s.label)) ?? [];
  if (failedFromSteps.length > 0) return failedFromSteps;

  const fails: string[] = [];
  const grade = effectiveQualityTier(row);

  if (row.breakout1hConfirmFail && !snowballStatsLegacyBreakout1hConfirmFailIgnored(row)) {
    fails.push("1H confirm ไม่ผ่าน (breakout1hConfirmFail — แถวเก่า)");
  } else if (snowballIsGradeF(grade) || row.momentumFailGradeF) {
    fails.push("เกรด F (Long): momentum และ/หรือ 1H confirm ไม่ผ่านตอนแจ้งเตือน");
  } else {
    const tf = row.signalBarTf ?? "15m";
    fails.push(
      tf === "4h"
        ? "two-bar inline confirm ไม่ผ่าน (ไม่มีรายละเอียดขั้น)"
        : "Breakout 1H confirm ไม่ผ่าน (ไม่มีรายละเอียดขั้น)",
    );
  }

  fails.push(...confirmVolSnapshotLines(row));

  if (fails.length === 0) {
    fails.push("1H confirm ไม่ผ่าน (ไม่มีข้อมูลขั้น)");
  }
  return fails;
}

function confirmFailDetail(
  row: Pick<
    SnowballStatsRow,
    | "qualityTier"
    | "alertQualityTier"
    | "breakout1hConfirmFail"
    | "momentumFailGradeF"
    | "confirmGateSteps"
    | "signalBarTf"
    | "confirmVolVsSma"
    | "confirmVolRank"
    | "confirmVolRankLb"
  >,
  confirmFails: string[],
): string {
  if (confirmFails.length > 0) {
    const first = confirmFails[0]!;
    return first.length > 120 ? `${first.slice(0, 117)}…` : first;
  }
  return "ไม่ผ่าน";
}

function resolveVolStrict(
  row: Pick<SnowballStatsRow, "signalVolVsSma" | "volStrictOk">,
  strictMult: number,
): SnowballGradeChecklistStatus {
  if (row.volStrictOk === true) return "pass";
  if (row.volStrictOk === false) return "fail";
  const r = row.signalVolVsSma;
  if (r == null || !Number.isFinite(r)) return "unknown";
  return r >= strictMult ? "pass" : "fail";
}

function resolveVolNearMiss(
  row: Pick<SnowballStatsRow, "signalVolVsSma" | "volStrictOk" | "volNearMissOnly">,
  strictMult: number,
  nearMult: number,
): SnowballGradeChecklistStatus {
  if (row.volNearMissOnly === true) return "pass";
  if (row.volNearMissOnly === false) {
    if (row.volStrictOk === true) return "fail";
    const r = row.signalVolVsSma;
    if (r != null && Number.isFinite(r) && r > nearMult && r < strictMult) return "fail";
    return "fail";
  }
  const r = row.signalVolVsSma;
  if (r == null || !Number.isFinite(r)) return "unknown";
  if (r >= strictMult) return "fail";
  if (r > nearMult) return "pass";
  return "fail";
}

function mainTfLabel(tf: SnowballStatsRow["signalBarTf"]): string {
  if (tf === "4h") return "4H";
  if (tf === "1h") return "1H";
  if (tf === "15m") return "15m";
  return "Main TF";
}

/** Checklist LONG — โครงสร้าง · confirm · vol strict · vol near-miss · momentum */
export function snowballStatsGradeChecklist(
  row: Pick<
    SnowballStatsRow,
    | "alertSide"
    | "triggerKind"
    | "signalBarTf"
    | "structureTier"
    | "qualityTier"
    | "alertQualityTier"
    | "momentumDowngrade"
    | "momentumFailGradeF"
    | "breakout1hConfirmFail"
    | "signalVolVsSma"
    | "volStrictOk"
    | "volNearMissOnly"
    | "volMultAtAlert"
    | "volNearMultAtAlert"
    | "confirmGateSteps"
    | "confirmVolVsSma"
    | "confirmVolRank"
    | "confirmVolRankLb"
    | "volumeCascadeYn"
  >,
): SnowballGradeChecklistItem[] {
  const side = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
  if (side === "bear") {
    const grade = effectiveQualityTier(row);
    return [
      {
        id: "structure",
        title: "Double Barrier SHORT",
        status: grade ? "pass" : "unknown",
        detail: grade ? `เกรด ${snowballLongGradeShortLabel(grade)}` : "—",
      },
    ];
  }

  const strictMult =
    row.volMultAtAlert != null && Number.isFinite(row.volMultAtAlert) && row.volMultAtAlert > 0
      ? row.volMultAtAlert
      : SNOWBALL_STATS_VOL_STRICT_MULT;
  const nearMult =
    row.volNearMultAtAlert != null && Number.isFinite(row.volNearMultAtAlert) && row.volNearMultAtAlert > 0
      ? row.volNearMultAtAlert
      : SNOWBALL_STATS_VOL_NEAR_MISS_MULT;

  const struct =
    row.structureTier && isStructureTier(row.structureTier) ? row.structureTier : null;
  const tfLabel = mainTfLabel(row.signalBarTf ?? "15m");
  const cOk = confirmOk(row);
  const mOk = momentumOk(row);
  const volStrict = resolveVolStrict(row, strictMult);
  const volNear = resolveVolNearMiss(row, strictMult, nearMult);

  const volRatioStr =
    row.signalVolVsSma != null && Number.isFinite(row.signalVolVsSma)
      ? `${row.signalVolVsSma.toFixed(2)}×`
      : "—";

  const confirmFails = confirmFailCriteria(row);
  const momentumFails = momentumFailCriteria(row);

  return [
    {
      id: "structure",
      title: `โครงสร้างหลัก (${tfLabel} / Main TF)`,
      status: struct ? "pass" : "unknown",
      detail: struct
        ? `${snowballLongGradeShortLabel(struct)} · ${structureTierHint(struct)}`
        : "แถวเก่า — ไม่บันทึก structureTier",
    },
    {
      id: "confirm",
      title: "เงื่อนไขฝั่งหน้างานล่าสุด (1H Confirm)",
      status: cOk ? "pass" : "fail",
      detail: cOk
        ? row.signalBarTf === "4h"
          ? snowballStatsConfirmGateStepsAllPass(row)
            ? "two-bar inline ผ่านครบ"
            : "two-bar inline (4H)"
          : snowballStatsConfirmGateStepsAllPass(row)
            ? "Breakout 1H ผ่านครบ"
            : "Breakout 1H ผ่าน"
        : confirmFailDetail(row, confirmFails),
      failCriteria: cOk ? undefined : confirmFails.length > 0 ? confirmFails : ["1H confirm ไม่ผ่าน"],
    },
    {
      id: "vol_strict",
      title: `Vol×SMA ≥${strictMult}×`,
      status: volStrict,
      detail: `Vol แท่งสัญญาณ ${volRatioStr} (เกณฑ์ ≥${strictMult}×)`,
      failCriteria:
        volStrict === "fail"
          ? [`Vol แท่งสัญญาณ ${volRatioStr} ไม่ถึง ≥${strictMult}× SMA`]
          : undefined,
    },
    {
      id: "vol_near_miss",
      title: `Vol ไม่ถึง ${strictMult}× แต่ยืนเหนือ ${nearMult}×`,
      status: volNear,
      detail: `Vol แท่งสัญญาณ ${volRatioStr} (ช่วง ${nearMult}–${strictMult}×)`,
      failCriteria:
        volNear === "fail"
          ? [
              `Vol แท่งสัญญาณ ${volRatioStr} ไม่อยู่ในช่วง near-miss (${nearMult}×–${strictMult}×)`,
            ]
          : undefined,
    },
    {
      id: "momentum",
      title: "Momentum 1H (sustained)",
      status: mOk ? "pass" : "fail",
      detail: mOk
        ? `Vol↗ ผ่าน · Vol×SMA ผ่าน`
        : row.volumeCascadeYn != null
          ? `Vol↗ ${row.volumeCascadeYn}${row.momentumDowngrade ? " · ลดเกรด" : ""}${row.momentumFailGradeF ? " · F-path" : ""}`
          : "ไม่ผ่าน",
      failCriteria: mOk ? undefined : momentumFails,
    },
  ];
}

export function snowballGradeChecklistMark(status: SnowballGradeChecklistStatus): string {
  return checklistMark(status);
}

function coinSlash(symbol: string): string {
  const u = symbol.toUpperCase();
  const base = u.endsWith("USDT") ? u.slice(0, -4) : u;
  return `${base}/USDT`;
}

function stageLineMark(ok: boolean): string {
  return ok ? "✓" : "❌";
}

type StagedPopupRow = Pick<
  SnowballStatsRow,
  | "symbol"
  | "alertSide"
  | "triggerKind"
  | "signalBarTf"
  | "structureTier"
  | "swing200Ok"
  | "qualityTier"
  | "alertQualityTier"
  | "momentumFailGradeF"
  | "breakout1hConfirmFail"
  | "signalVolVsSma"
  | "volStrictOk"
  | "volMultAtAlert"
  | "confirmGateSteps"
  | "volumeCascadeYn"
  | "signalMaxDdPct"
  | "momentumDowngrade"
  | "momentumFailGradeF"
  | "qualityTier4hAdjusted"
  | "alertedAtIso"
  | "structureCeiling"
  | "momentumFailCount"
  | "gradeNotch"
  | "displayGrade"
  | "actionPlan"
  | "maxRoiPct"
  | "durationToMfeHours"
  | "maxDrawdownPct"
  | "outcome"
>;

function snowballStatsOutcomeLabel(o: SnowballStatsRow["outcome"]): string {
  if (o === "win_trend") return "Win (Trend)";
  if (o === "win_quick_tp30") return "Win (Quick TP30)";
  if (o === "loss") return "Loss";
  if (o === "flat") return "Flat";
  return "Pending";
}

/**
 * Popup สถิติ Snowball 4h LONG — รูปแบบ 3 ด่าน (จาก snapshot ตอนแจ้ง ไม่ต้องรอสัญญาณใหม่)
 * คืน null ถ้าไม่ใช่ 4h LONG → ใช้ checklist แบบเดิม
 */
export function snowballStatsStagedPopupText(row: StagedPopupRow): string | null {
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
  // HH200 ผ่านหรือไม่ — ใช้ค่าจริงถ้ามี ไม่งั้นอนุมานจาก structureTier
  // a_plus = HH48+HH200+VAH ครบ → HH200 ✓
  // c_plus = HH48 หรือ VAH อย่างเดียว (swing200→swing48 มีเสมอ) → HH200 ✗
  // b_plus = สองอย่าง (ไม่รู้แน่ว่ามี HH200 ไหม) → null
  const swing200Ok: boolean | null =
    typeof row.swing200Ok === "boolean"
      ? row.swing200Ok
      : struct === "a_plus"
        ? true
        : struct === "c_plus"
          ? false
          : null;
  const stage1Pass = swing48Ok;

  const twoBarPass = snowballStatsConfirmGateStepsAllPass(row);
  const steps = row.confirmGateSteps ?? [];
  const hasTwoBarSteps = steps.length >= 3;

  const maxVolDrops = snowballTrendMomentumMaxVolumeDrops();
  const volDrops =
    row.volumeCascadeYn === "Y"
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

  const hasMatrix = row.displayGrade != null || row.structureCeiling != null;
  const volCascadeGradeC =
    !hasMatrix &&
    volCascadeOk &&
    snowballVolSmaMeetsGradeCMin(row.signalVolVsSma) &&
    failCount > 0;

  const actionPlanLabel = row.actionPlan ? snowballStatsActionPlanLabel(row.actionPlan) : null;
  let stage3Head: string;
  if (!twoBarPass) {
    stage3Head = "— (ไม่ถึง — Stage 2 ไม่ผ่าน)";
  } else if (hasMatrix && row.displayGrade) {
    const tail = actionPlanLabel ? ` · ${actionPlanLabel}` : "";
    stage3Head = `${failCount === 0 ? "PASS" : `FAIL ${failCount}/3`} (Grade ${row.displayGrade}${tail})`;
  } else if (failCount === 0) {
    stage3Head = "PASS (Status: Active)";
  } else if (volCascadeGradeC) {
    stage3Head = `PARTIAL (Status: Grade C — Vol↗+Vol×SMA≥${SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C}×)`;
  } else if (failCount === 1) {
    stage3Head = "FAIL 1 ITEM (Status: Downgrade to D+)";
  } else {
    stage3Head = `FAIL ${failCount} ITEMS (Status: Downgrade to F)`;
  }

  const grade = effectiveQualityTier(row);
  const derivedDisplay = snowballStatsDerivedDisplayGrade(row);
  const volRatioStr =
    row.signalVolVsSma != null && Number.isFinite(row.signalVolVsSma)
      ? row.signalVolVsSma.toFixed(2)
      : "—";

  const lines: string[] = [
    "==================================================",
    `❄️ SNOWBALL 4H — ${coinSlash(row.symbol)} (snapshot ตอนแจ้ง)`,
    "==================================================",
    "",
    `🟢 [STAGE 1: 4H STRUCTURE] -> ${stage1Pass ? "PASS" : "FAIL"} (Status: ${stage1Pass ? "Active" : "Blocked"})`,
    `  [${stageLineMark(swing48Ok)}] Swing HH48 Check — โครงสร้าง ${struct ? snowballLongGradeShortLabel(struct) : "—"} (${struct ? structureTierHint(struct) : "ไม่บันทึก"})`,
    `  [${swing200Ok == null ? "—" : stageLineMark(swing200Ok)}] Swing HH200 Check${
      swing200Ok === true
        ? " — โครงสร้างใหญ่ผ่าน (ช่วยดันเกรด)"
        : swing200Ok === false
          ? " — ไม่ผ่าน HH200 (ตัดเพดานเกรด)"
          : " — แถวเก่าไม่บันทึก (อนุมานจาก " + (struct ? snowballLongGradeShortLabel(struct) : "—") + " ไม่ได้)"
    }`,
    `  [${stageLineMark(vahOk)}] VAH Proxy Escape${struct === "b_plus" ? " (Grade B path)" : struct === "a_plus" ? " (A+ path)" : " — ไม่ถึง VAH (Grade C)"}`,
    `  [—] EMA Trend Check — ไม่บันทึกในแถวสถิติ (ดู debug snowball สดได้)`,
    "",
    `🔵 [STAGE 2: TWO-BAR INLINE 4H] -> ${twoBarPass ? "PASS" : "FAIL"} (Status: ${twoBarPass ? "Secure" : "BLOCK ตอนสแกนใหม่ / ไม่ผ่านตอนแจ้ง"})`,
  ];

  if (hasTwoBarSteps) {
    for (const s of steps) {
      lines.push(`  [${stageLineMark(s.ok)}] ${s.label}: ${s.detail}`);
    }
  } else {
    const confirmFails = confirmFailCriteria(row);
    const uniqueFails = confirmFails.filter((f, i, arr) => arr.indexOf(f) === i);
    for (const f of uniqueFails.slice(0, 4)) {
      lines.push(`  [❌] ${f}`);
    }
    if (uniqueFails.length === 0) {
      lines.push(`  [❌] two-bar inline — ไม่มี confirmGateSteps ในแถว (แถวเก่า)`);
    }
  }

  const ddMark = ddOk == null ? "—" : stageLineMark(ddOk);
  const ddValueStr = ddPct != null ? `${ddPct.toFixed(2)}%` : "—";
  const ddSuffix = ddOk === false ? " -> [FAILED]" : ddOk == null ? " -> [แถวเก่า ไม่บันทึก %]" : "";
  lines.push(
    "",
    `🟡 [STAGE 3: MOMENTUM & VOL 1H] -> ${stage3Head}`,
    `  [${ddMark}] Max DD 15m (${SNOWBALL_TREND_15M_DD_LOOKBACK} Bars): ${ddValueStr} (Limit <= ${ddLimit}%)${ddSuffix}`,
    `  [${stageLineMark(volCascadeOk)}] Vol Cascade ${SNOWBALL_TREND_1H_VOL_LOOKBACK}B  : ${volDrops != null ? volDrops : "—"} Times Drop  (Limit <= ${maxVolDrops} Time)${!volCascadeOk ? " -> [FAILED]" : ""}`,
    `  [${stageLineMark(volStrictOk)}] Signal Vol Spurt: ${volRatioStr}x SMA      (Limit > ${strictMult}x)${!volStrictOk ? " -> [FAILED]" : ""}`,
    "",
    "--------------------------------------------------",
    "🎯 FINAL GRADE DETERMINATION:",
  );

  if (hasMatrix && row.structureCeiling) {
    const notchStr =
      row.gradeNotch != null
        ? `${row.gradeNotch >= 0 ? "+" : ""}${row.gradeNotch}`
        : "—";
    lines.push(
      `- Stage 1 (Ceiling)   : ${row.structureCeiling}  (${stage1Pass ? "PASS" : "FAIL"})`,
      `- Stage 2 (Gatekeeper): ${twoBarPass ? "PASS" : "FAIL"}`,
      `- Stage 3 (Adjuster)  : ${!twoBarPass ? "—" : `พลาด ${failCount}/3 · notch ${notchStr}`}`,
      `- Decision Matrix     : ${row.structureCeiling} × พลาด ${failCount} → ${row.displayGrade ?? derivedDisplay ?? "—"}`,
      `- Action Plan         : ${actionPlanLabel ?? "—"}`,
      `- Result              : [ ${derivedDisplay ?? (grade ? snowballLongGradeDisplayLabel(grade) : "—")} ] ตอนแจ้ง`,
    );
  } else {
    lines.push(
      `- Stage 1: ${stage1Pass ? "PASS" : "FAIL"}`,
      `- Stage 2: ${twoBarPass ? "PASS" : "FAIL"}`,
      `- Stage 3: ${
        !twoBarPass
          ? "—"
          : failCount === 0
            ? "PASS"
            : volCascadeGradeC
              ? "Vol↗ path → C"
              : failCount === 1
                ? "Drop 1 Item"
                : `Drop ${failCount} Items`
      }`,
      `- Result: [ ${grade ? snowballLongGradeDisplayLabel(grade) : "—"} ] ตอนแจ้ง`,
    );
  }

  if (row.qualityTier4hAdjusted && row.qualityTier && row.alertQualityTier && row.qualityTier !== row.alertQualityTier) {
    lines.push(
      `- หมายเหตุ: หลัง follow-up 4h ปรับเป็น ${snowballLongGradeShortLabel(row.qualityTier)} (ตอนแจ้ง ${snowballLongGradeShortLabel(row.alertQualityTier)})`,
    );
  }

  const hasOutcome =
    row.outcome !== "pending" ||
    (row.maxRoiPct != null && Number.isFinite(row.maxRoiPct)) ||
    (row.maxDrawdownPct != null && Number.isFinite(row.maxDrawdownPct));
  if (hasOutcome) {
    const roiStr =
      row.maxRoiPct != null && Number.isFinite(row.maxRoiPct)
        ? `${row.maxRoiPct >= 0 ? "+" : ""}${row.maxRoiPct.toFixed(2)}%`
        : "—";
    const mfeStr =
      row.durationToMfeHours != null && Number.isFinite(row.durationToMfeHours)
        ? `${row.durationToMfeHours.toFixed(1)}h`
        : "—";
    const ddPostStr =
      row.maxDrawdownPct != null && Number.isFinite(row.maxDrawdownPct)
        ? `${row.maxDrawdownPct.toFixed(2)}%`
        : "—";
    lines.push(
      "",
      "--------------------------------------------------",
      "📊 OUTCOME (หลังแจ้ง):",
      `- Outcome   : ${snowballStatsOutcomeLabel(row.outcome)}`,
      `- Max ROI   : ${roiStr} (MFE ${mfeStr})`,
      `- Max DD    : ${ddPostStr} (DD หลังเข้า — ตัดเทียบ entry)`,
    );
  }

  lines.push(
    "",
    "📎 แถวนี้ = snapshot ตอนส่ง Telegram · สำหรับค่าสดบนกราฟใช้คำสั่ง debug snowball <SYMBOL>",
    "==================================================",
  );

  return lines.join("\n");
}

export function snowballStatsGradeChecklistFooter(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "qualityTier4hAdjusted">,
): string[] {
  const grade = effectiveQualityTier(row);
  const lines: string[] = [];
  if (grade) {
    lines.push(
      `เกรดสุทธิที่แจ้ง: ${snowballLongGradeDisplayLabel(grade)} [${snowballLongGradeShortLabel(grade)}]`,
    );
    if (snowballIsGradeDPlusLong(grade)) {
      lines.push("auto-open: ไม่สั่ง (Grade D+)");
    } else if (snowballIsGradeF(grade)) {
      lines.push("auto-open: ไม่สั่ง (Grade F)");
    }
  }
  const alertAt = row.alertQualityTier ?? grade;
  if (
    row.qualityTier4hAdjusted &&
    row.qualityTier &&
    alertAt &&
    row.qualityTier !== alertAt
  ) {
    lines.push(
      `หลังปรับ 4h: ${snowballLongGradeShortLabel(row.qualityTier)} (ตอนแจ้ง ${snowballLongGradeShortLabel(alertAt)})`,
    );
  }
  return lines;
}
