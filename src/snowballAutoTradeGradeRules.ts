import type { SnowballDisplayGrade } from "./snowballLongGradeMatrix";
import type { SnowballAutoTradeGradeKey } from "./tradingViewCloseSettingsStore";

export const SNOWBALL_AUTO_TRADE_GRADE_KEYS: readonly SnowballAutoTradeGradeKey[] = [
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D",
  "F",
] as const;

const GRADE_KEY_SET = new Set<string>(SNOWBALL_AUTO_TRADE_GRADE_KEYS);

export function isSnowballAutoTradeGradeKey(k: string): k is SnowballAutoTradeGradeKey {
  return GRADE_KEY_SET.has(k);
}

export type SnowballAutoTradeAlertGradeInput = {
  displayGrade?: SnowballDisplayGrade | null;
  qualityTier?: "a_plus" | "b_plus" | "c_plus" | "d_plus" | "f_plus" | null;
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
  const tier = input.qualityTier;
  if (tier === "a_plus") return "A+";
  if (tier === "b_plus") return "B";
  if (tier === "c_plus") return "C";
  if (tier === "d_plus") return "D";
  if (tier === "f_plus") return "F";
  return null;
}
