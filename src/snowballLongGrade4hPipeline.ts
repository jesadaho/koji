/**
 * @deprecated — pipeline เก่าแทนที่ด้วย snowballTrendGrade.ts
 * เก็บ vol helpers สำหรับ checklist / diagnostic
 */

/** Vol×SMA ขั้นต่ำเมื่อ Vol↗ ผ่านแต่ momentum อ่อน */
export const SNOWBALL_4H_VOL_SMA_MIN_FOR_GRADE_C = 2;

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
