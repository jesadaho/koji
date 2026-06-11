import type { SnowballTrendGrade, SnowballTrendGradeDisplay } from "./snowballTrendGrade";
import { snowballTrendGradeToDisplay } from "./snowballTrendGrade";
import { snowballAutoTradeGradeKeyFromDisplay } from "./snowballCompositeGrade";
import type { SnowballAutoTradeGradeKey } from "./tradingViewCloseSettingsStore";

const GRADE_KEY_SET = new Set<string>(["S", "A", "B", "C", "F"]);

export function isSnowballAutoTradeGradeKey(k: string): k is SnowballAutoTradeGradeKey {
  return GRADE_KEY_SET.has(k);
}

export type SnowballAutoTradeAlertGradeInput = {
  displayGrade?: SnowballTrendGradeDisplay | null;
  qualityTier?: SnowballTrendGrade | null;
  momentumFailGradeF?: boolean | null;
  momentumDowngrade?: boolean | null;
};

/** แปลงสัญญาณ → คีย์เกรด (S/A/B/C/F) — ใช้บันทึกประวัติ auto-open เท่านั้น */
export function snowballAutoTradeGradeKeyFromAlert(
  input: SnowballAutoTradeAlertGradeInput,
): SnowballAutoTradeGradeKey | null {
  const fromDisplay = snowballAutoTradeGradeKeyFromDisplay(input.displayGrade);
  if (fromDisplay) return fromDisplay;
  if (input.momentumFailGradeF) return "F";
  if (input.qualityTier) return snowballTrendGradeToDisplay(input.qualityTier);
  return null;
}
