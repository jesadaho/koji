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
