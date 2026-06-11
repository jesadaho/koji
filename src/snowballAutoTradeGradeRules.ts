import type { SnowballTrendGrade, SnowballTrendGradeDisplay } from "./snowballTrendGrade";
import { migrateSnowballAutoTradeGradeKey, snowballTrendGradeToDisplay } from "./snowballTrendGrade";
import { snowballAutoTradeGradeKeyFromDisplay } from "./snowballCompositeGrade";
import type { SnowballAutoTradeGradeKey } from "./tradingViewCloseSettingsStore";

const GRADE_KEY_SET = new Set<string>(["S", "A", "B", "C", "F"]);

export function isSnowballAutoTradeGradeKey(k: string): k is SnowballAutoTradeGradeKey {
  return GRADE_KEY_SET.has(k);
}

/** migrate key เก่า (รวม S+/A+/…) → คีย์ auto-trade S/A/B/C/F */
export function snowballAutoTradeGradeKeyFromMigratedRawKey(
  rawKey: string,
): SnowballAutoTradeGradeKey | null {
  const display = migrateSnowballAutoTradeGradeKey(rawKey);
  const key = snowballAutoTradeGradeKeyFromDisplay(display);
  return key && isSnowballAutoTradeGradeKey(key) ? key : null;
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
  if (input.qualityTier) {
    return snowballAutoTradeGradeKeyFromDisplay(snowballTrendGradeToDisplay(input.qualityTier));
  }
  return null;
}
