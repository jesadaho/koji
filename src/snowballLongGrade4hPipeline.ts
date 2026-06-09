/**
 * @deprecated — pipeline เก่าแทนที่ด้วย snowballTrendGrade.ts
 * เก็บ vol helpers สำหรับ checklist / diagnostic
 */

import type { TrendMomentumMetrics } from "./snowballTrendMomentumMetrics";
import type { SnowballTwoBarInlineEval } from "./snowballTwoBarInline";

/** Vol×SMA ขั้นต่ำเมื่อ Vol↗ ผ่านแต่ momentum อ่อน */
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

/** Vol↗ ผ่าน + Vol×SMA ≥ 2× แต่ยังมี momentum ไม่ครบ */
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
