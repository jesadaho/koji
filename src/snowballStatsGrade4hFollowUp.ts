import {
  snowballStatsIsGradeFMomentumFailRow,
  snowballStatsIsLongConfirmFailRow,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import { fetchBinanceUsdmKlines } from "./binanceIndicatorKline";
import {
  containing4hBarOpenSec,
  evaluateSnowballGradeCShortFade,
} from "./snowballGradeCShortFade";
import {
  gradeFromSnowballTwoClosedBars,
  type SnowballLongBreakoutGrade,
} from "./snowballLongBreakoutGrade";

const SEC_4H = 4 * 3600;
const SEC_1H = 3600;

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}

function snowballSwingLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 400) return Math.floor(v);
  return 48;
}

function snowballSwingGradeLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_GRADE_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 400) return Math.floor(v);
  return 200;
}

function snowballSwingExcludeRecentBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS);
  if (Number.isFinite(v) && v >= 0 && v <= 10) return Math.floor(v);
  return 3;
}

function snowballLongVahBreakEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_BREAK", true);
}

function snowballLongVahLookbackBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 120) return Math.floor(v);
  return 20;
}

function signalBarDurationSec(row: SnowballStatsRow): number {
  const tf = row.signalBarTf ?? "15m";
  if (tf === "4h") return SEC_4H;
  if (tf === "1h") return SEC_1H;
  return 900;
}

export function anchorCloseSec(row: SnowballStatsRow): number {
  return row.signalBarOpenSec + signalBarDurationSec(row);
}

export function snowballStatsGrade4hFollowUpEnabled(): boolean {
  const raw = process.env.SNOWBALL_STATS_GRADE_4H_FOLLOWUP_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return true;
}

export function snowballStatsAlertQualityTier(row: SnowballStatsRow) {
  return row.alertQualityTier ?? row.qualityTier;
}

function inferAlertSideLong(row: SnowballStatsRow): boolean {
  if (row.alertSide === "long") return true;
  if (row.alertSide === "bear") return false;
  if (row.side === "short" && row.triggerKind !== "swing_ll") return true;
  return row.side === "long";
}

/**
 * หลังครบ 4 ชม. จาก anchor — อ่าน 2 แท่ง 4h ปิดล่าสุด ณ T+4h แล้วตัดเกรดใหม่ (สถิติเท่านั้น)
 * Master TF = 4h · alertQualityTier = เกรดตอนแจ้ง
 */
export async function applySnowballStatsGrade4hFollowUp(
  row: SnowballStatsRow,
  nowSec: number,
  pack4hCache: Map<string, BinanceKlinePack | null>,
): Promise<boolean> {
  if (!snowballStatsGrade4hFollowUpEnabled()) return false;
  if (row.qualityTier4hAdjusted) return false;

  const ac = anchorCloseSec(row);
  const asOfSec = ac + SEC_4H;
  if (nowSec < asOfSec) return false;

  if (!inferAlertSideLong(row)) return false;
  if (snowballStatsIsGradeFMomentumFailRow(row)) return false;

  const sym = row.symbol.trim().toUpperCase();
  let pack4h = pack4hCache.get(sym);
  if (pack4h === undefined) {
    try {
      pack4h = await fetchBinanceUsdmKlines(sym, "4h", 120);
    } catch (e) {
      console.error("[snowballStatsGrade4h] fetch 4h", sym, e);
      pack4h = null;
    }
    pack4hCache.set(sym, pack4h);
  }
  if (!pack4h) return false;

  const swingLb = snowballSwingLookbackBars();
  const swingEx = snowballSwingExcludeRecentBars();
  const graded = gradeFromSnowballTwoClosedBars(
    pack4h,
    "4h",
    asOfSec,
    swingLb,
    swingEx,
    snowballSwingGradeLookbackBars(),
    snowballLongVahLookbackBars(),
    snowballLongVahBreakEnabled(),
  );
  if (!graded) return false;

  let newGrade: SnowballLongBreakoutGrade = graded.grade;

  const alertTier = snowballStatsAlertQualityTier(row) as SnowballLongBreakoutGrade | undefined;
  if (!row.alertQualityTier) {
    row.alertQualityTier =
      alertTier === "a_plus" ||
      alertTier === "b_plus" ||
      alertTier === "c_plus" ||
      alertTier === "d_plus" ||
      alertTier === "f_plus"
        ? alertTier
        : row.qualityTier ?? newGrade;
  }

  if (snowballStatsIsLongConfirmFailRow(row)) {
    let pack1h = pack4hCache.get(`${sym}|1h`);
    if (pack1h === undefined) {
      try {
        pack1h = await fetchBinanceUsdmKlines(sym, "1h", 120);
      } catch (e) {
        console.error("[snowballStatsGrade4h] fetch 1h fade", sym, e);
        pack1h = null;
      }
      pack4hCache.set(`${sym}|1h`, pack1h);
    }
    if (pack1h) {
      const fade = evaluateSnowballGradeCShortFade(pack1h, row.signalBarOpenSec, {
        fourHourOpenSec: containing4hBarOpenSec(asOfSec),
        asOfSec,
      });
      if (fade.ok) newGrade = "c_plus";
    }
  }

  if (row.qualityTier === newGrade) return false;

  row.qualityTier = newGrade;
  row.qualityTier4hAdjusted = true;
  return true;
}
