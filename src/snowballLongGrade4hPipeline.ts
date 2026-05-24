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

export type SnowballLong4hPipelineInput = {
  swing48: boolean;
  swing200: boolean;
  vahOk: boolean;
  twoBar: SnowballTwoBarInlineEval;
  trendMomentum: TrendMomentumMetrics | null;
  volumeStrictOk: boolean;
};

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

/**
 * Snowball LONG Master 4h — เลเยอร์เดียว
 * 1) โครงสร้าง 4H ไม่ผ่าน → BLOCK
 * 2) Two-bar inline ไม่ผ่าน → F
 * 3) Momentum: 0 fail → A+/B/C · 1 fail → D+ · 2+ fail → F
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

  if (failCount >= 2) {
    const parts: string[] = [];
    if (!ddOk) parts.push("DD 1H%");
    if (!volCascadeOk) parts.push("Vol↗");
    if (!volStrictOk) parts.push("Vol×SMA");
    return {
      kind: "grade",
      grade: "f_plus",
      structureTier,
      confirm1hOk: true,
      momentumOk: false,
      confirm1hEval: null,
      footnote: `📎 ${snowballLongGradeFLabel()}: โครงสร้าง ${snowballLongGradeShortLabel(structureTier)} · two-bar ผ่าน · momentum ไม่ผ่าน ${parts.length > 0 ? `(${parts.join(" + ")})` : ""}`,
    };
  }

  if (failCount === 1) {
    const miss =
      !ddOk && !volCascadeOk
        ? "DD 1H% + Vol↗"
        : !ddOk
          ? "DD 1H%"
          : !volCascadeOk
            ? "Vol↗"
            : "Vol×SMA < เกณฑ์";
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
