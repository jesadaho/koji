import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";

const HOUR_SEC = 3600;

/** คืน entry ที่ใช้แสดง/follow-up — รองรับแถวเก่าที่มีแค่ mark/ema */
export function resolveAutoOpenEntryPrice(row: AutoOpenOrderLogRow): number | undefined {
  if (typeof row.entryPrice === "number" && Number.isFinite(row.entryPrice) && row.entryPrice > 0) {
    return row.entryPrice;
  }
  if (row.outcome !== "success" && row.outcome !== "failed") return undefined;
  if (row.source === "reversal") {
    if (row.orderKind === "limit" && typeof row.ema50_15m === "number" && row.ema50_15m > 0) {
      return row.ema50_15m;
    }
    if (typeof row.markPrice === "number" && row.markPrice > 0) return row.markPrice;
  }
  if (typeof row.markPrice === "number" && row.markPrice > 0) return row.markPrice;
  return undefined;
}

/** เติม entryPrice จาก mark/ema สำหรับแถวเก่าหรือ failed ที่ยังไม่ได้บันทึก */
export function backfillAutoOpenEntryPrice(row: AutoOpenOrderLogRow): boolean {
  if (typeof row.entryPrice === "number" && row.entryPrice > 0) return false;
  const resolved = resolveAutoOpenEntryPrice(row);
  if (resolved == null) return false;
  row.entryPrice = resolved;
  return true;
}

export function autoOpenFollowUpEligible(row: AutoOpenOrderLogRow): boolean {
  if (row.outcome !== "success" && row.outcome !== "failed") return false;
  if (row.side !== "long" && row.side !== "short") return false;
  const entry = resolveAutoOpenEntryPrice(row);
  return typeof entry === "number" && Number.isFinite(entry) && entry > 0;
}

export function autoOpenFollowUpAnchorSec(row: AutoOpenOrderLogRow): number {
  return Math.floor(row.atMs / 1000);
}

export function autoOpenHorizonDue(
  row: AutoOpenOrderLogRow,
  horizonHours: number,
  nowMs = Date.now(),
): boolean {
  const ac = autoOpenFollowUpAnchorSec(row);
  return nowMs / 1000 >= ac + horizonHours * HOUR_SEC;
}

export function pctVsEntrySide(
  side: "long" | "short",
  entry: number,
  price: number,
): number {
  if (side === "long") return ((price - entry) / entry) * 100;
  return ((entry - price) / entry) * 100;
}

/** ปิดแท่ง 15m ล่าสุดที่ปิดไม่เกิน horizonEndSec และไม่เกิน now */
export function pickAutoOpenHorizonClose(
  timeSec: number[],
  close: number[],
  klineGranSec: number,
  iFirst: number,
  iLast: number,
  nowSec: number,
  horizonEndSec: number,
  entry: number,
  side: "long" | "short",
): { price: number; pct: number } | null {
  const limitSec = Math.min(horizonEndSec, nowSec);
  let best = -1;
  for (let i = iFirst; i <= iLast; i++) {
    const barClose = timeSec[i]! + klineGranSec;
    if (barClose <= limitSec) best = i;
  }
  if (best < 0) return null;
  const price = close[best]!;
  return { price, pct: pctVsEntrySide(side, entry, price) };
}

export function autoOpenNeedsFollowUp(
  row: AutoOpenOrderLogRow,
  nowSec: number,
): boolean {
  backfillAutoOpenEntryPrice(row);
  if (!autoOpenFollowUpEligible(row)) return false;
  const ac = autoOpenFollowUpAnchorSec(row);
  if (nowSec < ac) return false;
  return (
    (row.pct4h == null && nowSec >= ac + 4 * HOUR_SEC) ||
    (row.pct12h == null && nowSec >= ac + 12 * HOUR_SEC) ||
    (row.pct24h == null && nowSec >= ac + 24 * HOUR_SEC) ||
    (row.pct48h == null && nowSec >= ac + 48 * HOUR_SEC)
  );
}
