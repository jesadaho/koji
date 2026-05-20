import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import { fetchBinanceUsdmKlines } from "./binanceIndicatorKline";
import {
  containing4hBarOpenSec,
  evaluateSnowballGradeCShortFade,
} from "./snowballGradeCShortFade";

const SEC_4H = 4 * 3600;
const SEC_1H = 3600;

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

/** เกรดตอนแจ้ง (แถวเก่าไม่มี = ใช้ qualityTier ปัจจุบัน) */
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
 * หลังครบ 4 ชม. จาก anchor — ปรับ qualityTier สำหรับสถิติเท่านั้น (ไม่แตะ side / alertSide)
 * ปัจจุบัน: D (1H confirm fail) → C เมื่อ gate fade แบบ Grade C ผ่านในกรอบ 4h ณ T+4h
 */
export async function applySnowballStatsGrade4hFollowUp(
  row: SnowballStatsRow,
  nowSec: number,
  pack1hCache: Map<string, BinanceKlinePack | null>,
): Promise<boolean> {
  if (!snowballStatsGrade4hFollowUpEnabled()) return false;
  if (row.qualityTier4hAdjusted) return false;

  const ac = anchorCloseSec(row);
  if (nowSec < ac + SEC_4H) return false;

  const alertTier = snowballStatsAlertQualityTier(row);
  if (alertTier !== "d_plus") return false;
  if (!inferAlertSideLong(row)) return false;

  const sym = row.symbol.trim().toUpperCase();
  let pack = pack1hCache.get(sym);
  if (pack === undefined) {
    try {
      pack = await fetchBinanceUsdmKlines(sym, "1h", 120);
    } catch (e) {
      console.error("[snowballStatsGrade4h] fetch 1h", sym, e);
      pack = null;
    }
    pack1hCache.set(sym, pack);
  }
  if (!pack) return false;

  const fourHourOpenSec = containing4hBarOpenSec(ac + SEC_4H);
  const fade = evaluateSnowballGradeCShortFade(pack, row.signalBarOpenSec, {
    fourHourOpenSec,
    asOfSec: ac + SEC_4H,
  });
  if (!fade.ok) return false;

  if (!row.alertQualityTier && row.qualityTier) {
    row.alertQualityTier = row.qualityTier;
  }
  row.qualityTier = "c_plus";
  row.qualityTier4hAdjusted = true;
  return true;
}
