/** Client-safe Snowball grade checklist (popup สถิติ) */

import {
  snowballIsGradeDPlusLong,
  snowballIsGradeF,
  snowballLongGradeDisplayLabel,
  snowballLongGradeShortLabel,
  type SnowballLongStructureTier,
} from "@/src/snowballLongBreakoutGrade";
import {
  SNOWBALL_TREND_1H_DD_LOOKBACK,
  SNOWBALL_TREND_1H_VOL_LOOKBACK,
  snowballTrendMomentumMaxDrawbackPct,
  snowballTrendMomentumMaxVolumeDrops,
} from "@/src/snowballTrendMomentumMetrics";
import type { SnowballStatsQualityTier, SnowballStatsRow } from "@/lib/snowballStatsClient";

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

function momentumOk(
  row: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "momentumDowngrade" | "momentumFailGradeF"
  >,
): boolean {
  const grade = effectiveQualityTier(row);
  if (!grade || snowballIsGradeF(grade) || row.momentumFailGradeF) return false;
  if (row.momentumDowngrade === true || snowballIsGradeDPlusLong(grade)) return false;
  return grade === "a_plus" || grade === "b_plus" || grade === "c_plus";
}

function momentumFailCriteria(
  row: Pick<SnowballStatsRow, "maxDrawback1hPct" | "volumeCascadeYn" | "qualityTier" | "alertQualityTier" | "momentumDowngrade" | "momentumFailGradeF">,
): string[] {
  if (momentumOk(row)) return [];
  const fails: string[] = [];
  const ddMax = snowballTrendMomentumMaxDrawbackPct();
  if (row.maxDrawback1hPct == null || !Number.isFinite(row.maxDrawback1hPct)) {
    fails.push(`DD 1H% — ไม่มีข้อมูล (${SNOWBALL_TREND_1H_DD_LOOKBACK} แท่ง 1H ปิด)`);
  } else if (row.maxDrawback1hPct > ddMax) {
    fails.push(
      `DD 1H% เกินเกณฑ์ (${row.maxDrawback1hPct.toFixed(2)}% > ${ddMax}% · ไส้สูงสุดใน ${SNOWBALL_TREND_1H_DD_LOOKBACK} แท่ง)`,
    );
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
    fails.push("Sustained buying pressure ไม่ผ่าน (DD 1H% + Vol↗ รวมกัน)");
  }
  return fails;
}

function confirmVolSnapshotLines(
  row: Pick<SnowballStatsRow, "confirmVolVsSma" | "confirmVolRank" | "confirmVolRankLb">,
): string[] {
  const lines: string[] = [];
  if (row.confirmVolVsSma != null && Number.isFinite(row.confirmVolVsSma)) {
    lines.push(`Vol แท่ง 1H confirm ≈ ${row.confirmVolVsSma.toFixed(2)}× SMA`);
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
    | "maxDrawback1hPct"
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
        ? `DD 1H% + Vol↗ ผ่าน`
        : row.maxDrawback1hPct != null && row.volumeCascadeYn != null
          ? `DD 1H% ${row.maxDrawback1hPct.toFixed(2)}% · Vol↗ ${row.volumeCascadeYn}`
          : "ไม่ผ่าน",
      failCriteria: mOk ? undefined : momentumFails,
    },
  ];
}

export function snowballGradeChecklistMark(status: SnowballGradeChecklistStatus): string {
  return checklistMark(status);
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
