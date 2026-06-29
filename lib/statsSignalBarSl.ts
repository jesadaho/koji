/** SL ที่ยอดแท่งสัญญาณ — Short: high · Long: low (ตามทิศวัดผล) */

import {
  reversalStatsMeasureSide,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { firstFollowUpKlineIndexAfterAnchorClose } from "@/lib/statsFollowUpAdverse";

export const STATS_SIGNAL_BAR_SL_VERSION = 1;

export function signalBarSlLevelForMeasureSide(
  side: "short" | "long",
  high: number | null | undefined,
  low: number | null | undefined,
): number | null {
  if (side === "short") {
    return high != null && Number.isFinite(high) && high > 0 ? high : null;
  }
  return low != null && Number.isFinite(low) && low > 0 ? low : null;
}

export function signalBarSlLevelFromRow(
  row: Pick<CandleReversalStatsRow, "signalBarHigh" | "signalBarLow" | "signalBarTf" | "tradeSide">,
): number | null {
  const side = reversalStatsMeasureSide(row);
  return signalBarSlLevelForMeasureSide(side, row.signalBarHigh, row.signalBarLow);
}

export type SignalBarSlHitResult = {
  hit: boolean;
  hitHours: number | null;
};

/** ตรวจว่าราคาแตะ SL ที่ยอดแท่งสัญญาณในช่วง follow-up (หลังปิดแท่งสัญญาณ) */
export function computeSignalBarSlHit(
  high: number[],
  low: number[],
  timeSec: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  anchorCloseSec: number,
  slLevel: number,
  side: "short" | "long",
): SignalBarSlHitResult | null {
  if (!Number.isFinite(slLevel) || slLevel <= 0) return null;
  if (iLast < iFirst) return null;

  for (let i = iFirst; i <= iLast; i++) {
    const h = high[i];
    const l = low[i];
    const barOpen = timeSec[i];
    if (barOpen == null || !Number.isFinite(barOpen)) continue;
    const touched =
      side === "short"
        ? h != null && Number.isFinite(h) && h >= slLevel
        : l != null && Number.isFinite(l) && l <= slLevel;
    if (touched) {
      const hitHours = Math.max(0, (barOpen - anchorCloseSec) / 3600);
      return { hit: true, hitHours };
    }
  }
  return { hit: false, hitHours: null };
}

export function applySignalBarSlHitFromKlines(
  row: CandleReversalStatsRow,
  high: number[],
  low: number[],
  timeSec: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  anchorCloseSec: number,
): boolean {
  const side = reversalStatsMeasureSide(row);
  const slLevel = signalBarSlLevelFromRow(row);
  if (slLevel == null) return false;
  const iFollowFirst = firstFollowUpKlineIndexAfterAnchorClose(timeSec, anchorCloseSec);
  if (iFollowFirst < 0) return false;
  const start = Math.max(iFirst, iFollowFirst);
  if (iLast < start) return false;
  const result = computeSignalBarSlHit(
    high,
    low,
    timeSec,
    barDurSec,
    start,
    iLast,
    anchorCloseSec,
    slLevel,
    side,
  );
  if (!result) return false;
  row.signalBarSlHit = result.hit;
  row.signalBarSlHitHours = result.hitHours;
  row.signalBarSlV = STATS_SIGNAL_BAR_SL_VERSION;
  return true;
}

export function reversalSignalBarSlHitLabel(
  hit: boolean | null | undefined,
  hitHours: number | null | undefined,
): string {
  if (hit == null) return "—";
  if (hit) {
    return hitHours != null && Number.isFinite(hitHours) ? `โดน @${hitHours.toFixed(1)}h` : "โดน";
  }
  return "ไม่โดน";
}

export function reversalSignalBarSlHitSortOrder(hit: boolean | null | undefined): number {
  if (hit === true) return 2;
  if (hit === false) return 1;
  return 0;
}
