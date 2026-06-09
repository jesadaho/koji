/** Len percentile — อันดับความยาวแท่ง (high−low) ในรอบ lookback แปลงเป็น % (1 = สั้นสุด · 100 = ยาวสุด) */

/** อันดับความยาวแท่งใน [start..end] — 1 = ยาวสุด */
export function statsRangeRankInWindow(
  high: number[],
  low: number[],
  start: number,
  end: number,
  i: number,
): number {
  const vi = high[i]! - low[i]!;
  const eps = Math.max(1e-12, Math.abs(vi) * 1e-10);
  let strictlyHigher = 0;
  for (let j = start; j <= end; j++) {
    if (j === i) continue;
    const vj = high[j]! - low[j]!;
    if (vj > vi + eps) strictlyHigher++;
  }
  return strictlyHigher + 1;
}

/** อันดับค่าใน [start..end] — 1 = สูงสุด */
export function statsValueRankInWindow(
  values: number[],
  start: number,
  end: number,
  i: number,
): number | null {
  const vi = values[i];
  if (vi == null || !Number.isFinite(vi) || vi <= 0) return null;
  const eps = Math.max(1e-12, Math.abs(vi) * 1e-10);
  let strictlyHigher = 0;
  for (let j = start; j <= end; j++) {
    if (j === i) continue;
    const vj = values[j];
    if (vj != null && Number.isFinite(vj) && vj > vi + eps) strictlyHigher++;
  }
  return strictlyHigher + 1;
}

/** rank 1 ใน N แท่ง → 100% (ยาวสุดในรอบ) */
export function lenPercentilePctFromRank(
  rank: number | null | undefined,
  lookbackBars: number | null | undefined,
): number | null {
  if (rank == null || lookbackBars == null || !Number.isFinite(rank) || !Number.isFinite(lookbackBars)) {
    return null;
  }
  const r = Math.floor(rank);
  const n = Math.floor(lookbackBars);
  if (r < 1 || r > n || n < 1) return null;
  return (100 * (n - r + 1)) / n;
}

export function statsLenPercentileLabel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(0)}%`;
}
