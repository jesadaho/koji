import type {
  SnowballAutoTradeGradeKey,
  TradingViewMexcUserSettings,
} from "./tradingViewCloseSettingsStore";

export const SNOWBALL_QUALITY_SIGNAL_LONG_GRADE_OPTIONS: SnowballAutoTradeGradeKey[] = [
  "S",
  "A",
  "B",
  "C",
  "D",
  "F",
];

function isSnowballAutoTradeGradeKey(v: unknown): v is SnowballAutoTradeGradeKey {
  return (
    v === "S" ||
    v === "A" ||
    v === "B" ||
    v === "C" ||
    v === "D" ||
    v === "F"
  );
}

/** เกรดที่เปิด Quality Signal → Long — ว่าง = ปิดฟีเจอร์ */
export function resolveSnowballQualitySignalLongGrades(
  row: TradingViewMexcUserSettings,
): SnowballAutoTradeGradeKey[] {
  const raw = row.snowballAutoTradeQualitySignalLongGrades;
  if (Array.isArray(raw) && raw.length > 0) {
    const valid = new Set(SNOWBALL_QUALITY_SIGNAL_LONG_GRADE_OPTIONS);
    const out: SnowballAutoTradeGradeKey[] = [];
    for (const g of raw) {
      if (isSnowballAutoTradeGradeKey(g) && valid.has(g) && !out.includes(g)) {
        out.push(g);
      }
    }
    return out;
  }
  if (
    row.snowballAutoTradeQualitySignalLongEnabled === true ||
    row.snowballAutoTradeQualitySignalGateEnabled === true
  ) {
    return [...SNOWBALL_QUALITY_SIGNAL_LONG_GRADE_OPTIONS];
  }
  return [];
}

export function snowballQualitySignalLongFeatureEnabled(
  row: TradingViewMexcUserSettings,
): boolean {
  return resolveSnowballQualitySignalLongGrades(row).length > 0;
}

export function snowballQualitySignalLongGradeAllowed(
  row: TradingViewMexcUserSettings,
  gradeKey: SnowballAutoTradeGradeKey | null,
): boolean {
  if (gradeKey == null) return false;
  return resolveSnowballQualitySignalLongGrades(row).includes(gradeKey);
}
