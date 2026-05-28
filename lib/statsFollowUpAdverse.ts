/** Client-safe: max adverse % from entry over a follow-up kline window. */

export type StatsFollowUpSide = "long" | "short";

/**
 * Max adverse move against the position from entry through iFirst..iLast (inclusive).
 * Short: (maxHigh - entry) / entry * 100 · Long: (entry - minLow) / entry * 100
 */
export function computeFollowUpMaxAdversePct(
  high: number[],
  low: number[],
  iFirst: number,
  iLast: number,
  entry: number,
  side: StatsFollowUpSide,
): number | null {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (iLast < iFirst) return null;

  if (side === "short") {
    let maxHigh = -Infinity;
    for (let i = iFirst; i <= iLast; i++) {
      const h = high[i];
      if (h != null && Number.isFinite(h)) maxHigh = Math.max(maxHigh, h);
    }
    if (!Number.isFinite(maxHigh)) return null;
    const pct = ((maxHigh - entry) / entry) * 100;
    if (!Number.isFinite(pct) || pct < 0) return 0;
    return pct;
  }

  let minLow = Infinity;
  for (let i = iFirst; i <= iLast; i++) {
    const l = low[i];
    if (l != null && Number.isFinite(l)) minLow = Math.min(minLow, l);
  }
  if (!Number.isFinite(minLow)) return null;
  const pct = ((entry - minLow) / entry) * 100;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return pct;
}
