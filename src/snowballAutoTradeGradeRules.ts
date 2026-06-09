import type { SnowballTrendGradeDisplay } from "./snowballTrendGrade";
import type { SnowballAutoTradeGradeKey } from "./tradingViewCloseSettingsStore";
import {
  migrateSnowballAutoTradeGradeKey,
  snowballTrendGradeToDisplay,
  type SnowballTrendGrade,
} from "./snowballTrendGrade";

export const SNOWBALL_AUTO_TRADE_GRADE_KEYS: readonly SnowballAutoTradeGradeKey[] = [
  "S",
  "A",
  "B",
  "C",
  "F",
] as const;

const GRADE_KEY_SET = new Set<string>(SNOWBALL_AUTO_TRADE_GRADE_KEYS);

export function isSnowballAutoTradeGradeKey(k: string): k is SnowballAutoTradeGradeKey {
  return GRADE_KEY_SET.has(k);
}

export type SnowballAutoTradeAlertGradeInput = {
  displayGrade?: SnowballTrendGradeDisplay | null;
  qualityTier?: SnowballTrendGrade | null;
  momentumFailGradeF?: boolean | null;
  momentumDowngrade?: boolean | null;
};

/** แปลงสัญญาณ → คีย์เกรด (ใช้บันทึกประวัติ auto-open เท่านั้น) */
export function snowballAutoTradeGradeKeyFromAlert(
  input: SnowballAutoTradeAlertGradeInput,
): SnowballAutoTradeGradeKey | null {
  const dg = input.displayGrade;
  if (dg && isSnowballAutoTradeGradeKey(dg)) return dg;
  if (input.momentumFailGradeF) return "F";
  if (input.qualityTier) return snowballTrendGradeToDisplay(input.qualityTier);
  return null;
}

/** migrate legacy grade key จาก settings เก่า */
export function normalizeSnowballAutoTradeGradeKey(key: string): SnowballAutoTradeGradeKey | null {
  return migrateSnowballAutoTradeGradeKey(key);
}
