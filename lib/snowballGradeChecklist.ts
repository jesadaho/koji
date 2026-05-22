/** Client-safe Snowball grade checklist (popup สถิติ) */

import {
  snowballIsGradeDPlusLong,
  snowballIsGradeF,
  snowballLongGradeDisplayLabel,
  snowballLongGradeShortLabel,
  type SnowballLongStructureTier,
} from "@/src/snowballLongBreakoutGrade";
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
  id: "structure" | "confirm" | "vol_strict_momentum" | "vol_near_miss";
  title: string;
  status: SnowballGradeChecklistStatus;
  detail: string;
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

function confirmOk(
  row: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumFailGradeF"
  >,
): boolean {
  const grade = effectiveQualityTier(row);
  if (!grade || snowballIsGradeF(grade) || row.momentumFailGradeF) return false;
  if (row.breakout1hConfirmFail === true) return false;
  return true;
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

/** Checklist 4 ข้อตาม matrix แจ้งเกรด LONG */
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
  const tf = row.signalBarTf ?? "15m";
  const tfLabel = mainTfLabel(tf);
  const cOk = confirmOk(row);
  const mOk = momentumOk(row);
  const volStrict = resolveVolStrict(row, strictMult);
  const volNear = resolveVolNearMiss(row, strictMult, nearMult);

  const volRatioStr =
    row.signalVolVsSma != null && Number.isFinite(row.signalVolVsSma)
      ? `${row.signalVolVsSma.toFixed(2)}×`
      : "—";

  const confirmDetail =
    tf === "4h"
      ? cOk
        ? "two-bar inline ผ่าน"
        : "two-bar inline ไม่ผ่าน"
      : cOk
        ? "Breakout 1H ผ่าน"
        : "Breakout 1H ไม่ผ่าน";

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
      detail: confirmDetail,
    },
    {
      id: "vol_strict_momentum",
      title: `Vol×SMA ≥${strictMult}× และ Momentum`,
      status:
        volStrict === "pass" && mOk
          ? "pass"
          : row.signalVolVsSma == null && row.volStrictOk == null
            ? "unknown"
            : "fail",
      detail: `Vol แท่งสัญญาณ ${volRatioStr} (เกณฑ์ ≥${strictMult}×) · Momentum 1H ${mOk ? "ผ่าน" : "ไม่ผ่าน"}`,
    },
    {
      id: "vol_near_miss",
      title: `Vol ไม่ถึง ${strictMult}× แต่ยืนเหนือ ${nearMult}×`,
      status: volNear,
      detail: `Vol แท่งสัญญาณ ${volRatioStr} (ช่วง ${nearMult}–${strictMult}×)`,
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
