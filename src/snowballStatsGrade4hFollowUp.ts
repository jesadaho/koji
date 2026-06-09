import type { SnowballStatsRow } from "@/lib/snowballStatsClient";
import type { BinanceKlinePack } from "./binanceIndicatorKline";

const SEC_4H = 4 * 3600;
const SEC_1H = 3600;

function signalBarDurationSec(row: SnowballStatsRow): number {
  const tf = row.signalBarTf ?? "4h";
  if (tf === "4h") return SEC_4H;
  if (tf === "1h") return SEC_1H;
  return 900;
}

export function anchorCloseSec(row: SnowballStatsRow): number {
  return row.signalBarOpenSec + signalBarDurationSec(row);
}

/** @deprecated — trend grade (S/A/B/C/F) ไม่ re-grade จากโครงสร้าง 4h หลัง anchor */
export function snowballStatsGrade4hFollowUpEnabled(): boolean {
  const raw = process.env.SNOWBALL_STATS_GRADE_4H_FOLLOWUP_ENABLED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  return false;
}

export function snowballStatsAlertQualityTier(row: SnowballStatsRow) {
  return row.alertQualityTier ?? row.qualityTier;
}

/** @deprecated — คง stub ไว้ให้ stats tick import ได้; ไม่ re-grade ด้วย matrix เก่า */
export async function applySnowballStatsGrade4hFollowUp(
  _row: SnowballStatsRow,
  _nowSec: number,
  _pack4hCache: Map<string, BinanceKlinePack | null>,
): Promise<boolean> {
  return false;
}
