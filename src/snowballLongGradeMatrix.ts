/**
 * Snowball LONG 4h — Base Grade + Offset (3-Stage Matrix)
 *
 * Stage 1 (Structure) = "ceiling" — กำหนดเกรดสูงสุดที่เป็นไปได้ (A / B / C)
 * Stage 2 (Two-bar inline) = "gatekeeper" — ไม่ผ่าน = BLOCK (จัดการนอกไฟล์นี้)
 * Stage 3 (Momentum 3 ข้อ) = "adjuster" — notch ลงจาก ceiling ตามจำนวนพลาด
 *
 * พลาด 0 → ceiling + (เช่น A+ / B+ / C+)  · Full
 * พลาด 1 → ceiling     (A / B / C)        · Standard
 * พลาด 2 → ceiling -   (A- / B- / C-)     · Light (0.5×)
 * พลาด 3 → D                                · Monitor (no auto-open)
 */

import type { SnowballLongBreakoutGrade, SnowballLongStructureTier } from "./snowballLongBreakoutGrade";

export type SnowballStructureCeiling = "A" | "B" | "C";

export type SnowballActionPlan = "full" | "standard" | "light" | "monitor";

export type SnowballDisplayGrade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D";

export type SnowballGradeMatrixInput = {
  /** โครงสร้าง 4H */
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
  /** Stage 3 — แต่ละข้อใน momentum 3 ข้อ */
  ddOk: boolean;
  volCascadeOk: boolean;
  volStrictOk: boolean;
};

export type SnowballGradeMatrixResult = {
  ceiling: SnowballStructureCeiling;
  /** จำนวนข้อ Stage 3 ที่พลาด (0–3) */
  failCount: 0 | 1 | 2 | 3;
  /** notch จาก ceiling: +1 / 0 / -1 / drop-to-D */
  notch: 1 | 0 | -1 | -2;
  displayGrade: SnowballDisplayGrade;
  actionPlan: SnowballActionPlan;
  /** เกรดที่จะเก็บลง DB / stats (enum เดิม) */
  qualityTier: SnowballLongBreakoutGrade;
  /** alias เทียบ tier โครงสร้างเดิม (a_plus/b_plus/c_plus) */
  structureTier: SnowballLongStructureTier;
  failedItems: ("dd" | "vol_cascade" | "vol_strict")[];
};

/** ceiling Stage 1 (มาตรฐาน) — A = HH48+HH200+VAH · B = อย่างน้อย 1 อย่าง · C = ผ่าน main gate (swing48 || vah) ที่เหลือ */
export function classifySnowballStructureCeiling(input: {
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
}): SnowballStructureCeiling {
  const { swing48, swing200, vahOk } = input;
  if (swing48 && swing200 && vahOk) return "A";
  if ((swing48 && vahOk) || (swing200 && vahOk) || (swing48 && swing200)) return "B";
  return "C";
}

/** map ceiling tier → SnowballLongStructureTier เดิม (เพื่อ stats / footnote ที่ยังใช้ enum นี้) */
export function ceilingToStructureTier(ceiling: SnowballStructureCeiling): SnowballLongStructureTier {
  if (ceiling === "A") return "a_plus";
  if (ceiling === "B") return "b_plus";
  return "c_plus";
}

function countFails(input: Pick<SnowballGradeMatrixInput, "ddOk" | "volCascadeOk" | "volStrictOk">): {
  failCount: 0 | 1 | 2 | 3;
  failedItems: SnowballGradeMatrixResult["failedItems"];
} {
  const failedItems: SnowballGradeMatrixResult["failedItems"] = [];
  if (!input.ddOk) failedItems.push("dd");
  if (!input.volCascadeOk) failedItems.push("vol_cascade");
  if (!input.volStrictOk) failedItems.push("vol_strict");
  return { failCount: failedItems.length as 0 | 1 | 2 | 3, failedItems };
}

function notchFromFailCount(failCount: 0 | 1 | 2 | 3): 1 | 0 | -1 | -2 {
  if (failCount === 0) return 1;
  if (failCount === 1) return 0;
  if (failCount === 2) return -1;
  return -2;
}

function displayFromCeilingNotch(
  ceiling: SnowballStructureCeiling,
  notch: 1 | 0 | -1 | -2,
): SnowballDisplayGrade {
  if (notch === -2) return "D";
  if (ceiling === "A") {
    if (notch === 1) return "A+";
    if (notch === 0) return "A";
    return "A-";
  }
  if (ceiling === "B") {
    if (notch === 1) return "B+";
    if (notch === 0) return "B";
    return "B-";
  }
  if (notch === 1) return "C+";
  if (notch === 0) return "C";
  return "C-";
}

/** map display → enum เดิมสำหรับเก็บ DB / colored cell ในตาราง */
export function displayGradeToQualityTier(display: SnowballDisplayGrade): SnowballLongBreakoutGrade {
  switch (display) {
    case "A+":
    case "A":
      return "a_plus";
    case "A-":
    case "B+":
    case "B":
      return "b_plus";
    case "B-":
    case "C+":
    case "C":
      return "c_plus";
    case "C-":
    case "D":
      return "d_plus";
  }
}

function actionPlanFromNotch(notch: 1 | 0 | -1 | -2): SnowballActionPlan {
  if (notch === 1) return "full";
  if (notch === 0) return "standard";
  if (notch === -1) return "light";
  return "monitor";
}

/** marginScale ต่อ action plan — override ได้ผ่าน env */
export function snowballActionPlanMarginScale(plan: SnowballActionPlan): number {
  const envKey =
    plan === "full"
      ? "INDICATOR_PUBLIC_SNOWBALL_ACTION_FULL_MARGIN_SCALE"
      : plan === "standard"
        ? "INDICATOR_PUBLIC_SNOWBALL_ACTION_STANDARD_MARGIN_SCALE"
        : plan === "light"
          ? "INDICATOR_PUBLIC_SNOWBALL_ACTION_LIGHT_MARGIN_SCALE"
          : "INDICATOR_PUBLIC_SNOWBALL_ACTION_MONITOR_MARGIN_SCALE";
  const v = Number(process.env[envKey]?.trim());
  if (Number.isFinite(v) && v >= 0 && v <= 2) return v;
  if (plan === "full") return 1.0;
  if (plan === "standard") return 1.0;
  if (plan === "light") return 0.5;
  return 0;
}

/** เปิด auto-open สำหรับ Action plan ตัวไหน (env knob) */
export function snowballActionPlanAutoOpenEnabled(plan: SnowballActionPlan): boolean {
  if (plan === "monitor") {
    const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_MONITOR_AUTO_OPEN?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }
  if (plan === "light") {
    const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_LIGHT_AUTO_OPEN?.trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
    return true;
  }
  return true;
}

export function resolveSnowballLong4hGradeMatrix(input: SnowballGradeMatrixInput): SnowballGradeMatrixResult {
  const ceiling = classifySnowballStructureCeiling(input);
  const { failCount, failedItems } = countFails(input);
  const notch = notchFromFailCount(failCount);
  const displayGrade = displayFromCeilingNotch(ceiling, notch);
  const qualityTier = displayGradeToQualityTier(displayGrade);
  const actionPlan = actionPlanFromNotch(notch);
  return {
    ceiling,
    failCount,
    notch,
    displayGrade,
    actionPlan,
    qualityTier,
    structureTier: ceilingToStructureTier(ceiling),
    failedItems,
  };
}

export function snowballActionPlanLabel(plan: SnowballActionPlan): string {
  if (plan === "full") return "Full (1.0×)";
  if (plan === "standard") return "Standard (1.0×)";
  if (plan === "light") return "Light (0.5×)";
  return "Monitor (no auto-open)";
}
