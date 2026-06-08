import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { strategyProfitUsdtFromMargin } from "@/lib/statsStrategyProfitClient";

const HOUR_SEC = 3600;

export type AutoOpenPnlUsdtBucket = {
  trades: number;
  successTrades: number;
  failedTrades: number;
  sumUsdt: number | null;
  sumUsdtSuccess: number | null;
  sumUsdtFailed: number | null;
  sumWinUsdt: number | null;
  sumLossUsdt: number | null;
  sumWinUsdtSuccess: number | null;
  sumLossUsdtSuccess: number | null;
  sumWinUsdtFailed: number | null;
  sumLossUsdtFailed: number | null;
};

function accumulateSignedPnlWinLoss(
  acc: { sumWinUsdt: number; hasWin: boolean; sumLossUsdt: number; hasLoss: boolean },
  usd: number,
): void {
  if (usd > 0) {
    acc.sumWinUsdt += usd;
    acc.hasWin = true;
  } else if (usd < 0) {
    acc.sumLossUsdt += usd;
    acc.hasLoss = true;
  }
}

export function autoOpenContractSymbolKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function autoOpenRowMarginUsdt(row: AutoOpenOrderLogRow): number | null {
  const marginBase = row.marginUsdt;
  const scale =
    row.marginScale != null && Number.isFinite(row.marginScale) && row.marginScale > 0
      ? row.marginScale
      : 1;
  if (marginBase == null || !Number.isFinite(marginBase) || marginBase <= 0) return null;
  return marginBase * scale;
}

export function accumulateAutoOpenPnlUsdt(
  bucket: {
    trades: number;
    successTrades: number;
    failedTrades: number;
    sumUsdt: number;
    hasUsdt: boolean;
    sumUsdtSuccess: number;
    hasUsdtSuccess: boolean;
    sumUsdtFailed: number;
    hasUsdtFailed: boolean;
    sumWinUsdt: number;
    hasWin: boolean;
    sumLossUsdt: number;
    hasLoss: boolean;
    sumWinUsdtSuccess: number;
    hasWinSuccess: boolean;
    sumLossUsdtSuccess: number;
    hasLossSuccess: boolean;
    sumWinUsdtFailed: number;
    hasWinFailed: boolean;
    sumLossUsdtFailed: number;
    hasLossFailed: boolean;
  },
  row: AutoOpenOrderLogRow,
  profitPct: number,
): void {
  const margin = autoOpenRowMarginUsdt(row);
  const lev = row.leverage;
  if (margin == null || lev == null || !Number.isFinite(lev) || lev <= 0 || !Number.isFinite(profitPct)) {
    return;
  }
  const usd = strategyProfitUsdtFromMargin(margin, lev, profitPct);
  if (usd == null || !Number.isFinite(usd)) return;

  bucket.trades += 1;
  if (row.outcome === "failed") bucket.failedTrades += 1;
  else bucket.successTrades += 1;

  bucket.sumUsdt += usd;
  bucket.hasUsdt = true;
  accumulateSignedPnlWinLoss(bucket, usd);
  if (row.outcome === "failed") {
    bucket.sumUsdtFailed += usd;
    bucket.hasUsdtFailed = true;
    if (usd > 0) {
      bucket.sumWinUsdtFailed += usd;
      bucket.hasWinFailed = true;
    } else if (usd < 0) {
      bucket.sumLossUsdtFailed += usd;
      bucket.hasLossFailed = true;
    }
  } else {
    bucket.sumUsdtSuccess += usd;
    bucket.hasUsdtSuccess = true;
    if (usd > 0) {
      bucket.sumWinUsdtSuccess += usd;
      bucket.hasWinSuccess = true;
    } else if (usd < 0) {
      bucket.sumLossUsdtSuccess += usd;
      bucket.hasLossSuccess = true;
    }
  }
}

export function emptyAutoOpenPnlUsdtAccumulator() {
  return {
    trades: 0,
    successTrades: 0,
    failedTrades: 0,
    sumUsdt: 0,
    hasUsdt: false,
    sumUsdtSuccess: 0,
    hasUsdtSuccess: false,
    sumUsdtFailed: 0,
    hasUsdtFailed: false,
    sumWinUsdt: 0,
    hasWin: false,
    sumLossUsdt: 0,
    hasLoss: false,
    sumWinUsdtSuccess: 0,
    hasWinSuccess: false,
    sumLossUsdtSuccess: 0,
    hasLossSuccess: false,
    sumWinUsdtFailed: 0,
    hasWinFailed: false,
    sumLossUsdtFailed: 0,
    hasLossFailed: false,
  };
}

export function finalizeAutoOpenPnlUsdtBucket(
  acc: ReturnType<typeof emptyAutoOpenPnlUsdtAccumulator>,
): AutoOpenPnlUsdtBucket {
  return {
    trades: acc.trades,
    successTrades: acc.successTrades,
    failedTrades: acc.failedTrades,
    sumUsdt: acc.hasUsdt ? acc.sumUsdt : null,
    sumUsdtSuccess: acc.hasUsdtSuccess ? acc.sumUsdtSuccess : null,
    sumUsdtFailed: acc.hasUsdtFailed ? acc.sumUsdtFailed : null,
    sumWinUsdt: acc.hasWin ? acc.sumWinUsdt : null,
    sumLossUsdt: acc.hasLoss ? acc.sumLossUsdt : null,
    sumWinUsdtSuccess: acc.hasWinSuccess ? acc.sumWinUsdtSuccess : null,
    sumLossUsdtSuccess: acc.hasLossSuccess ? acc.sumLossUsdtSuccess : null,
    sumWinUsdtFailed: acc.hasWinFailed ? acc.sumWinUsdtFailed : null,
    sumLossUsdtFailed: acc.hasLossFailed ? acc.sumLossUsdtFailed : null,
  };
}

function reversalEma15mRef(row: AutoOpenOrderLogRow): number | undefined {
  const generic =
    typeof row.entryEma15m === "number" && row.entryEma15m > 0 ? row.entryEma15m : undefined;
  const ema25 =
    typeof row.ema25_15m === "number" && row.ema25_15m > 0 ? row.ema25_15m : undefined;
  const ema20 =
    typeof row.ema20_15m === "number" && row.ema20_15m > 0 ? row.ema20_15m : undefined;
  const ema50 =
    typeof row.ema50_15m === "number" && row.ema50_15m > 0 ? row.ema50_15m : undefined;
  return generic ?? ema25 ?? ema20 ?? ema50;
}

function reversalShortMarkPrice(row: AutoOpenOrderLogRow): number | undefined {
  return typeof row.markPrice === "number" && Number.isFinite(row.markPrice) && row.markPrice > 0
    ? row.markPrice
    : undefined;
}

/** Reversal SHORT: ราคาตลาด > EMA 15m → ใช้ Market entry (ไม่ใช่ Limit ที่ EMA) */
export function reversalShortMarketAboveEma15m(row: AutoOpenOrderLogRow): boolean {
  if (row.source !== "reversal" || row.side !== "short") return false;
  if (row.orderKind === "market") return true;
  if (row.orderKind === "limit") return false;
  if (row.reasonCode === "open_success_market") return true;
  if (row.reasonCode === "open_success_limit") return false;
  const ema = reversalEma15mRef(row);
  const mark = reversalShortMarkPrice(row);
  return ema != null && mark != null && mark > ema;
}

/** ประเภท order — รองรับแถวเก่าที่ไม่มี orderKind */
export function resolveAutoOpenOrderKind(
  row: AutoOpenOrderLogRow,
): "market" | "limit" | undefined {
  if (row.entryMode === "market") return "market";
  if (row.orderKind === "market" || row.orderKind === "limit") return row.orderKind;
  if (row.reasonCode === "open_success_limit") return "limit";
  if (row.reasonCode === "open_success_market") return "market";
  if (reversalShortMarketAboveEma15m(row)) return "market";
  if (row.source !== "reversal") return undefined;

  const ema = reversalEma15mRef(row);
  if (ema == null) return undefined;
  const entry =
    typeof row.entryPrice === "number" && Number.isFinite(row.entryPrice) && row.entryPrice > 0
      ? row.entryPrice
      : undefined;
  const mark =
    typeof row.markPrice === "number" && Number.isFinite(row.markPrice) && row.markPrice > 0
      ? row.markPrice
      : undefined;
  if (entry != null) {
    if (Math.abs(entry - ema) / ema < 0.002) return "limit";
    if (row.side === "short" && mark != null && entry > mark) return "limit";
    if (row.side === "long" && mark != null && entry < mark) return "limit";
  }
  if (mark != null && row.side === "short" && mark <= ema) return "limit";
  if (mark != null && row.side === "long" && mark >= ema) return "limit";
  return undefined;
}

/** สั่งไม่สำเร็จ — ไม่มี order จริงบน MEXC */
export function autoOpenOrderNeverPlacedOnExchange(row: AutoOpenOrderLogRow): boolean {
  return row.outcome === "failed";
}

/** Limit (สำเร็จหรือล้มเหลว) — ราคายังไม่แตะ entry → รอ fill / จำลองรอ fill */
export function autoOpenLimitPriceNotTouchedYet(
  row: AutoOpenOrderLogRow,
  markPrice: number | undefined,
): boolean {
  if (row.limitFilledAtMs != null && Number.isFinite(row.limitFilledAtMs)) return false;
  if (row.mexcActive) return false;
  if (resolveAutoOpenOrderKind(row) !== "limit") return false;
  if (row.outcome !== "success" && row.outcome !== "failed") return false;
  const entry = resolveAutoOpenEntryPrice(row);
  if (entry == null || markPrice == null || !Number.isFinite(markPrice)) return false;
  if (row.side === "short") return markPrice < entry;
  if (row.side === "long") return markPrice > entry;
  return false;
}

export function autoOpenLimitPendingFillTitle(row: AutoOpenOrderLogRow): string {
  if (row.limitFilledAtMs != null && Number.isFinite(row.limitFilledAtMs)) {
    return "Limit fill แล้วบน MEXC — ใช้ราคาเข้าเฉลี่ยใน Entry";
  }
  if (row.mexcActive) {
    return "มี position เปิดบน MEXC แล้ว (Limit fill แล้ว)";
  }
  if (row.outcome === "failed") {
    return "สั่ง Limit ไม่สำเร็จ — ราคายังไม่แตะ (จำลองรอ fill)";
  }
  return "Limit วางบน MEXC แล้ว — รอราคาแตะ order";
}

/** ล้มเหลว Market — แสดง ✕ (Limit รอแตะ = ⏳ · Limit แตะแล้ว = จำลอง fill ไม่ขึ้น ✕) */
export function autoOpenFailedShowsRejectedMarker(
  row: AutoOpenOrderLogRow,
  markPrice: number | undefined,
): boolean {
  if (row.outcome !== "failed") return false;
  if (autoOpenLimitPriceNotTouchedYet(row, markPrice)) return false;
  if (resolveAutoOpenOrderKind(row) === "limit") return false;
  return true;
}

/** กรองออกแถว Limit ⏳ ที่ราคายังไม่แตะ entry */
export function filterAutoOpenLogsExcludingLimitPending(
  rows: AutoOpenOrderLogRow[],
  markPrices: Record<string, number>,
): AutoOpenOrderLogRow[] {
  return rows.filter((row) => {
    const mark = markPrices[autoOpenContractSymbolKey(row.contractSymbol)];
    return !autoOpenLimitPriceNotTouchedYet(row, mark);
  });
}

/** คืน entry ที่ใช้แสดง/follow-up — รองรับแถวเก่าที่มีแค่ mark/ema */
export function resolveAutoOpenEntryPrice(row: AutoOpenOrderLogRow): number | undefined {
  const mark = reversalShortMarkPrice(row);
  const ema = row.source === "reversal" ? reversalEma15mRef(row) : undefined;
  const marketAboveEma = reversalShortMarketAboveEma15m(row);

  if (typeof row.entryPrice === "number" && Number.isFinite(row.entryPrice) && row.entryPrice > 0) {
    // แถวเก่าที่บันทึก entry ≈ EMA ทั้งที่ตอนเปิดเป็น Market (mark > EMA)
    if (marketAboveEma && mark != null && ema != null && Math.abs(row.entryPrice - ema) / ema < 0.003) {
      return mark;
    }
    return row.entryPrice;
  }
  if (row.outcome !== "success" && row.outcome !== "failed") return undefined;
  if (row.source === "reversal") {
    if (marketAboveEma && mark != null) return mark;
    if (resolveAutoOpenOrderKind(row) === "limit") {
      if (ema != null) return ema;
    }
    if (mark != null) return mark;
  }
  if (mark != null) return mark;
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
  const needsHorizon =
    (row.pct4h == null && nowSec >= ac + 4 * HOUR_SEC) ||
    (row.pct12h == null && nowSec >= ac + 12 * HOUR_SEC) ||
    (row.pct24h == null && nowSec >= ac + 24 * HOUR_SEC) ||
    (row.pct48h == null && nowSec >= ac + 48 * HOUR_SEC);
  const needsStrategy24h =
    nowSec >= ac + 24 * HOUR_SEC &&
    (row.pct24h == null ||
      row.strategyOutcome24h == null ||
      row.strategyPct24h == null ||
      row.strategyExitReason24h == null);
  const needsStrategy48h =
    nowSec >= ac + 48 * HOUR_SEC &&
    (row.pct48h == null ||
      row.strategyOutcome == null ||
      row.strategyPct == null ||
      row.strategyExitReason == null);
  return needsHorizon || needsStrategy24h || needsStrategy48h;
}
