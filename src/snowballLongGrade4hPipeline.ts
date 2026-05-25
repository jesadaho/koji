import type { TrendMomentumMetrics } from "./snowballTrendMomentumMetrics";
import {
  snowballLongStructurePassesMain,
  type SnowballLongGradeResolution,
} from "./snowballLongBreakoutGrade";
import {
  resolveSnowballLong4hGradeMatrix,
  snowballActionPlanLabel,
} from "./snowballLongGradeMatrix";
import type { SnowballTwoBarInlineEval } from "./snowballTwoBarInline";

/** Vol×SMA ขั้นต่ำสำหรับเกรด C เมื่อ Vol↗ ผ่านแต่ momentum อ่อน (แยกจาก strict 2.5× สำหรับ A+/B/C เต็ม) */
export const SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C = 2;

export type SnowballLong4hPipelineInput = {
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
  twoBar: SnowballTwoBarInlineEval;
  trendMomentum: TrendMomentumMetrics | null;
  /** Vol แท่งสัญญาณ ÷ SMA */
  signalVolVsSma: number | null;
  volumeStrictOk: boolean;
};

export function snowballVolSmaMeetsGradeCMin(signalVolVsSma: number | null | undefined): boolean {
  return (
    signalVolVsSma != null &&
    Number.isFinite(signalVolVsSma) &&
    signalVolVsSma >= SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C
  );
}

/** Vol↗ ผ่าน + Vol×SMA ≥ 2× แต่ยังมี momentum ไม่ครบ → เกรด C */
export function qualifiesVolCascadeGradeC(
  volCascadeOk: boolean,
  signalVolVsSma: number | null | undefined,
  failCount: number,
): boolean {
  return failCount > 0 && volCascadeOk && snowballVolSmaMeetsGradeCMin(signalVolVsSma);
}

export function countSnowball4hMomentumFails(input: SnowballLong4hPipelineInput): {
  failCount: number;
  ddOk: boolean;
  volCascadeOk: boolean;
  volStrictOk: boolean;
} {
  const m = input.trendMomentum;
  const ddOk = Boolean(m?.isLowDrawback);
  const volCascadeOk = Boolean(m?.isVolumeCascading);
  const volStrictOk = input.volumeStrictOk;
  let failCount = 0;
  if (!ddOk) failCount += 1;
  if (!volCascadeOk) failCount += 1;
  if (!volStrictOk) failCount += 1;
  return { failCount, ddOk, volCascadeOk, volStrictOk };
}

function momentumMissParts(ddOk: boolean, volCascadeOk: boolean, volStrictOk: boolean): string {
  const parts: string[] = [];
  if (!ddOk) parts.push("Max DD");
  if (!volCascadeOk) parts.push("Vol↗");
  if (!volStrictOk) parts.push("Vol×SMA");
  return parts.length > 0 ? parts.join(" + ") : "momentum";
}

/**
 * Snowball LONG Master 4h — Base Grade + Offset
 * 1) โครงสร้าง 4H ไม่ผ่าน → BLOCK
 * 2) Two-bar inline ไม่ผ่าน → BLOCK (ไม่ส่ง TG)
 * 3) Stage 1 ceiling (A/B/C) + Stage 3 notch (พลาด 0/1/2/3) → display A+ ... D
 *
 * พลาด 0 → ceiling + (A+/B+/C+) · Full
 * พลาด 1 → ceiling      (A/B/C)  · Standard
 * พลาด 2 → ceiling -    (A-/B-/C-) · Light 0.5×
 * พลาด 3 → D · Monitor (no auto-open)
 */
export function resolveSnowballLong4hPipeline(input: SnowballLong4hPipelineInput): SnowballLongGradeResolution {
  if (!snowballLongStructurePassesMain(input.swing48, input.vahOk)) {
    return {
      kind: "block",
      reason: "structure_fail",
      detail: "โครงสร้าง 4H ไม่ผ่าน (ไม่มี Swing HH48 / VAH)",
    };
  }

  if (!input.twoBar.ok) {
    return {
      kind: "block",
      reason: "two_bar_inline_fail",
      detail: `two-bar inline ไม่ผ่าน · ${input.twoBar.detail}`,
    };
  }

  const { ddOk, volCascadeOk, volStrictOk } = countSnowball4hMomentumFails(input);
  const matrix = resolveSnowballLong4hGradeMatrix({
    swing48: input.swing48,
    swing200: input.swing200,
    vahOk: input.vahOk,
    ddOk,
    volCascadeOk,
    volStrictOk,
  });

  const miss = momentumMissParts(ddOk, volCascadeOk, volStrictOk);
  const volRatio =
    input.signalVolVsSma != null && Number.isFinite(input.signalVolVsSma)
      ? input.signalVolVsSma.toFixed(2)
      : "—";

  const footnote =
    matrix.failCount === 0
      ? `📎 Grade ${matrix.displayGrade}: โครงสร้าง ${matrix.ceiling} · two-bar ผ่าน · momentum ครบ · Vol×SMA ${volRatio}× · ${snowballActionPlanLabel(matrix.actionPlan)}`
      : `📎 Grade ${matrix.displayGrade}: โครงสร้าง ${matrix.ceiling} · two-bar ผ่าน · พลาด ${matrix.failCount} ข้อ (${miss}) · ${snowballActionPlanLabel(matrix.actionPlan)}`;

  return {
    kind: "grade",
    grade: matrix.qualityTier,
    structureTier: matrix.structureTier,
    confirm1hOk: true,
    momentumOk: matrix.failCount === 0,
    confirm1hEval: null,
    footnote,
    structureCeiling: matrix.ceiling,
    momentumFailCount: matrix.failCount,
    gradeNotch: matrix.notch,
    displayGrade: matrix.displayGrade,
    actionPlan: matrix.actionPlan,
  };
}
