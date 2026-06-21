import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import { autoOpenBkkWeekStartKey } from "@/lib/autoOpenWeekGroup";

export type ReversalStatsWeeklyAlertSlice = Pick<
  CandleReversalStatsRow,
  "symbol" | "signalBarTf" | "tradeSide" | "alertedAtMs" | "entryPrice"
>;

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** คีย์จัดกลุ่ม — symbol + TF + ทิศ */
export function reversalStatsWeeklyAlertGroupKey(
  row: Pick<CandleReversalStatsRow, "symbol" | "signalBarTf" | "tradeSide">,
): string {
  const sym = normalizeSymbol(row.symbol);
  const tf = row.signalBarTf === "1h" ? "1h" : "1d";
  const side = row.tradeSide === "long" ? "long" : "short";
  return `${sym}:${tf}:${side}`;
}

export function reversalStatsPriceDiffFromPrevAlertPct(
  entryPrice: number,
  prevEntryPrice: number | null | undefined,
): number | null {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (prevEntryPrice == null || !Number.isFinite(prevEntryPrice) || prevEntryPrice <= 0) return null;
  return ((entryPrice - prevEntryPrice) / prevEntryPrice) * 100;
}

/** คำนวณ # ในรอบสัปดาห์ (BKK) + diff entry จากครั้งก่อน (symbol+TF+side) */
export function computeReversalStatsWeeklyAlertFields(
  priorRows: readonly CandleReversalStatsRow[],
  input: ReversalStatsWeeklyAlertSlice,
): {
  weeklyAlertNo: number;
  priceDiffFromPrevAlertPct: number | null;
} {
  const groupKey = reversalStatsWeeklyAlertGroupKey(input);
  const weekKey = autoOpenBkkWeekStartKey(input.alertedAtMs);
  const prior = priorRows
    .filter((r) => reversalStatsWeeklyAlertGroupKey(r) === groupKey && r.alertedAtMs < input.alertedAtMs)
    .sort((a, b) => a.alertedAtMs - b.alertedAtMs);
  const priorSameWeek = prior.filter(
    (r) => autoOpenBkkWeekStartKey(r.alertedAtMs) === weekKey,
  );
  const prev = prior.length > 0 ? prior[prior.length - 1]! : null;
  return {
    weeklyAlertNo: priorSameWeek.length + 1,
    priceDiffFromPrevAlertPct: reversalStatsPriceDiffFromPrevAlertPct(
      input.entryPrice,
      prev?.entryPrice,
    ),
  };
}

export function reversalStatsWeeklyAlertNoLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 1) return "—";
  return String(Math.floor(n));
}

export function reversalStatsPriceDiffFromPrevLabel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** Backfill ทุกแถวจากประวัติ — เรียง alertedAtMs เก่า → ใหม่ */
export function backfillReversalStatsWeeklyAlertFields(rows: CandleReversalStatsRow[]): number {
  const sorted = [...rows].sort((a, b) => a.alertedAtMs - b.alertedAtMs);
  let dirty = 0;
  const built: CandleReversalStatsRow[] = [];
  for (const row of sorted) {
    const computed = computeReversalStatsWeeklyAlertFields(built, row);
    const weeklyChanged = row.weeklyAlertNo !== computed.weeklyAlertNo;
    const a = row.priceDiffFromPrevAlertPct;
    const b = computed.priceDiffFromPrevAlertPct;
    const diffChanged =
      (a == null) !== (b == null) ||
      (a != null && b != null && Math.abs(a - b) > 1e-6);
    if (weeklyChanged || diffChanged) {
      row.weeklyAlertNo = computed.weeklyAlertNo;
      row.priceDiffFromPrevAlertPct = computed.priceDiffFromPrevAlertPct;
      dirty += 1;
    }
    built.push(row);
  }
  return dirty;
}
