/** (High − Low) / Close × 100 — ความกว้างแท่งเป็น % ราคา (R% สัญญาณ) */
export function statsBarRangePctSignal(
  high: number | null | undefined,
  low: number | null | undefined,
  close: number | null | undefined,
): number | null {
  if (high == null || low == null || close == null) return null;
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || close <= 0) {
    return null;
  }
  const span = high - low;
  if (!Number.isFinite(span) || span < 0) return null;
  return (span / close) * 100;
}

/** sync กับ candleReversalDetect env slBufferPct */
const REVERSAL_SL_BUFFER_PCT = 0.001;

export type ReversalBarRangePctRow = {
  entryPrice: number | null;
  slPrice: number | null;
  tradeSide?: "short" | "long" | null;
  bodyPct?: number | null;
  wickRatioPct?: number | null;
  lowerWickRatioPct?: number | null;
  barRangePctSignal?: number | null;
};

/** ประมาณ R% จาก entry/SL + สัดส่วนไส้/เนื้อ — ใช้ backfill แถวเก่าที่ไม่มี OHLC */
export function reversalBarRangePctSignalEstimate(row: ReversalBarRangePctRow): number | null {
  const close = row.entryPrice;
  const sl = row.slPrice;
  const bodyPct = row.bodyPct;
  const wickPct = row.wickRatioPct;
  if (
    close == null ||
    sl == null ||
    bodyPct == null ||
    wickPct == null ||
    !Number.isFinite(close) ||
    !Number.isFinite(sl) ||
    close <= 0 ||
    sl <= 0 ||
    !Number.isFinite(bodyPct) ||
    !Number.isFinite(wickPct)
  ) {
    return null;
  }

  const side = row.tradeSide === "long" ? "long" : "short";
  const buffer = REVERSAL_SL_BUFFER_PCT;

  if (side === "short") {
    const high = sl / (1 + buffer);
    const lowerWickPct =
      row.lowerWickRatioPct != null && Number.isFinite(row.lowerWickRatioPct)
        ? Math.max(0, row.lowerWickRatioPct)
        : Math.max(0, 100 - bodyPct - wickPct);
    const denom = 1 - lowerWickPct / 100;
    if (!(denom > 1e-6) || !(high > close)) return null;
    const range = (high - close) / denom;
    if (!(range > 0) || !Number.isFinite(range)) return null;
    return (range / close) * 100;
  }

  const low = sl / (1 - buffer);
  const upperWickPct = Math.max(0, 100 - bodyPct - wickPct);
  const denom = 1 - upperWickPct / 100;
  if (!(denom > 1e-6) || !(close > low)) return null;
  const range = (close - low) / denom;
  if (!(range > 0) || !Number.isFinite(range)) return null;
  return (range / close) * 100;
}

export function reversalBarRangePctSignalResolved(row: ReversalBarRangePctRow): number | null {
  if (row.barRangePctSignal != null && Number.isFinite(row.barRangePctSignal)) {
    return row.barRangePctSignal;
  }
  return reversalBarRangePctSignalEstimate(row);
}

export function backfillReversalBarRangePctSignalEstimate<T extends ReversalBarRangePctRow>(
  rows: T[],
): number {
  let updated = 0;
  for (const row of rows) {
    if (row.barRangePctSignal != null && Number.isFinite(row.barRangePctSignal)) continue;
    const est = reversalBarRangePctSignalEstimate(row);
    if (est == null) continue;
    row.barRangePctSignal = est;
    updated += 1;
  }
  return updated;
}
