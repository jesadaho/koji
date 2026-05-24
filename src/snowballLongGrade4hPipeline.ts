import type { TrendMomentumMetrics } from "./snowballTrendMomentumMetrics";
import {
  classifyLongStructureTier,
  snowballLongGradeFLabel,
  snowballLongGradePlusLabel,
  snowballLongGradeShortLabel,
  snowballLongStructurePassesMain,
  type SnowballLongGradeResolution,
  type SnowballLongStructureTier,
} from "./snowballLongBreakoutGrade";
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

function countMomentumFails(input: SnowballLong4hPipelineInput): {
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
  if (!ddOk) parts.push("DD 1H%");
  if (!volCascadeOk) parts.push("Vol↗");
  if (!volStrictOk) parts.push("Vol×SMA");
  return parts.length > 0 ? parts.join(" + ") : "momentum";
}

/**
 * Snowball LONG Master 4h — เลเยอร์เดียว
 * 1) โครงสร้าง 4H ไม่ผ่าน → BLOCK
 * 2) Two-bar inline ไม่ผ่าน → F
 * 3) Momentum ผ่านครบ → A+/B/C · Vol↗ + Vol×SMA≥2 แต่ติดอย่างอื่น (เช่น DD) → C · อื่น ๆ D+ / F
 */
export function resolveSnowballLong4hPipeline(input: SnowballLong4hPipelineInput): SnowballLongGradeResolution {
  if (!snowballLongStructurePassesMain(input.swing48, input.vahOk)) {
    return {
      kind: "block",
      reason: "structure_fail",
      detail: "โครงสร้าง 4H ไม่ผ่าน (ไม่มี Swing HH48 / VAH)",
    };
  }

  const structureTier: SnowballLongStructureTier = classifyLongStructureTier(
    input.swing48,
    input.swing200,
    input.vahOk,
  );

  if (!input.twoBar.ok) {
    return {
      kind: "grade",
      grade: "f_plus",
      structureTier,
      confirm1hOk: false,
      momentumOk: false,
      confirm1hEval: null,
      footnote: `📎 ${snowballLongGradeFLabel()}: โครงสร้าง ${snowballLongGradeShortLabel(structureTier)} · two-bar inline ไม่ผ่าน · ${input.twoBar.detail}`,
    };
  }

  const { failCount, ddOk, volCascadeOk, volStrictOk } = countMomentumFails(input);
  const momentumOk = failCount === 0;

  if (qualifiesVolCascadeGradeC(volCascadeOk, input.signalVolVsSma, failCount)) {
    const miss = momentumMissParts(ddOk, volCascadeOk, volStrictOk);
    const volRatio =
      input.signalVolVsSma != null && Number.isFinite(input.signalVolVsSma)
        ? input.signalVolVsSma.toFixed(2)
        : "—";
    return {
      kind: "grade",
      grade: "c_plus",
      structureTier,
      confirm1hOk: true,
      momentumOk: false,
      confirm1hEval: null,
      footnote: `📎 Grade C (Long): โครงสร้าง ${snowballLongGradeShortLabel(structureTier)} · two-bar ผ่าน · Vol↗ ผ่าน · Vol×SMA ${volRatio}× (≥${SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C}) · momentum อ่อน (${miss})`,
    };
  }

  if (failCount >= 2) {
    const miss = momentumMissParts(ddOk, volCascadeOk, volStrictOk);
    return {
      kind: "grade",
      grade: "f_plus",
      structureTier,
      confirm1hOk: true,
      momentumOk: false,
      confirm1hEval: null,
      footnote: `📎 ${snowballLongGradeFLabel()}: โครงสร้าง ${snowballLongGradeShortLabel(structureTier)} · two-bar ผ่าน · momentum ไม่ผ่าน (${miss})`,
    };
  }

  if (failCount === 1) {
    const miss = momentumMissParts(ddOk, volCascadeOk, volStrictOk);
    return {
      kind: "grade",
      grade: "d_plus",
      structureTier,
      confirm1hOk: true,
      momentumOk: false,
      confirm1hEval: null,
      footnote: `📎 ${snowballLongGradePlusLabel("d_plus")}: โครงสร้าง ${snowballLongGradeShortLabel(structureTier)} · two-bar ผ่าน · momentum ไม่ผ่าน (${miss})`,
    };
  }

  return {
    kind: "grade",
    grade: structureTier,
    structureTier,
    confirm1hOk: true,
    momentumOk,
    confirm1hEval: null,
  };
}
