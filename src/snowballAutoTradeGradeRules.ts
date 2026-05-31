import type { SnowballDisplayGrade } from "./snowballLongGradeMatrix";
import type {
  SnowballAutoTradeAlertSide,
  SnowballAutoTradeDirection,
  SnowballAutoTradeGradeKey,
  SnowballAutoTradeGradeRulesMap,
  TradingViewMexcUserSettings,
} from "./tradingViewCloseSettingsStore";
import type { SnowballAutoTradeSide } from "./snowballAutoTradeStateStore";
import { snowballMatchesQualitySignal } from "@/lib/snowballMatrixFilters";

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

/** Default rules จากพฤติกรรม server เดิม (ก่อนมี per-grade config) */
export function defaultSnowballAutoTradeRulesLong(): SnowballAutoTradeGradeRulesMap {
  return {
    "A+": "long",
    C: "short",
    "C+": "short",
    "C-": "short",
  };
}

export function defaultSnowballAutoTradeRulesBear(): SnowballAutoTradeGradeRulesMap {
  return { "A+": "short" };
}

export function migrateSnowballAutoTradeRulesFromDirection(
  direction: SnowballAutoTradeDirection | undefined,
): {
  rulesLong?: SnowballAutoTradeGradeRulesMap;
  rulesBear?: SnowballAutoTradeGradeRulesMap;
} {
  const d = direction ?? "both";
  if (d === "long_only") return { rulesLong: defaultSnowballAutoTradeRulesLong() };
  if (d === "short_only") return { rulesBear: defaultSnowballAutoTradeRulesBear() };
  return {
    rulesLong: defaultSnowballAutoTradeRulesLong(),
    rulesBear: defaultSnowballAutoTradeRulesBear(),
  };
}

export function hasSnowballAutoTradeGradeRulesConfigured(
  row: Pick<TradingViewMexcUserSettings, "snowballAutoTradeRulesLong" | "snowballAutoTradeRulesBear">,
): boolean {
  const longKeys = row.snowballAutoTradeRulesLong && Object.keys(row.snowballAutoTradeRulesLong).length > 0;
  const bearKeys = row.snowballAutoTradeRulesBear && Object.keys(row.snowballAutoTradeRulesBear).length > 0;
  return Boolean(longKeys || bearKeys);
}

/** Rules ที่ใช้จริง — migrate จาก direction เก่าถ้ายังไม่มี map */
export function effectiveSnowballAutoTradeRules(
  row: TradingViewMexcUserSettings,
): { rulesLong: SnowballAutoTradeGradeRulesMap; rulesBear: SnowballAutoTradeGradeRulesMap } {
  if (hasSnowballAutoTradeGradeRulesConfigured(row)) {
    return {
      rulesLong: { ...row.snowballAutoTradeRulesLong },
      rulesBear: { ...row.snowballAutoTradeRulesBear },
    };
  }
  const migrated = migrateSnowballAutoTradeRulesFromDirection(row.snowballAutoTradeDirection);
  return {
    rulesLong: migrated.rulesLong ?? {},
    rulesBear: migrated.rulesBear ?? {},
  };
}

export function sanitizeSnowballAutoTradeGradeRulesMap(
  raw: unknown,
): SnowballAutoTradeGradeRulesMap | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: SnowballAutoTradeGradeRulesMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSnowballAutoTradeGradeKey(k)) continue;
    if (v === "long" || v === "short") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type SnowballAutoTradeAlertGradeInput = {
  displayGrade?: SnowballDisplayGrade | null;
  qualityTier?: "a_plus" | "b_plus" | "c_plus" | "d_plus" | "f_plus" | null;
  momentumFailGradeF?: boolean | null;
  momentumDowngrade?: boolean | null;
};

/** แปลงสัญญาณ → คีย์เกรด matrix สำหรับเทียบ rules */
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
  /** matrix rules มีแค่ D (ไม่มี D+) — d_plus ทุกแบบใช้แถว D */
  if (tier === "d_plus") return "D";
  if (tier === "f_plus") return "F";
  return null;
}

export function resolveSnowballAutoOpenSideForUser(
  cfg: TradingViewMexcUserSettings,
  alertSide: SnowballAutoTradeAlertSide,
  gradeKey: SnowballAutoTradeGradeKey | null,
  greenDaysBeforeSignal?: number | null,
  fundingRate?: number | null,
): SnowballAutoTradeSide | null {
  if (
    alertSide === "long" &&
    cfg.snowballAutoTradeGreen2DaysLongAllGrades === true &&
    snowballMatchesQualitySignal({ greenDaysBeforeSignal, fundingRate })
  ) {
    return "long";
  }
  if (!gradeKey) return null;
  const { rulesLong, rulesBear } = effectiveSnowballAutoTradeRules(cfg);
  const map = alertSide === "bear" ? rulesBear : rulesLong;
  const side = map[gradeKey];
  return side === "long" || side === "short" ? side : null;
}

