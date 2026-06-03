/** EMA slope % — (EMA_today − EMA_N_bars_ago) / EMA_N_bars_ago × 100 */

export function emaSlopePctFromValues(emaToday: number, emaAgo: number): number | null {
  if (!Number.isFinite(emaToday) || !Number.isFinite(emaAgo) || emaAgo <= 0) return null;
  return ((emaToday - emaAgo) / emaAgo) * 100;
}

export function statsEmaSlopePctLabel(pct: number | null | undefined, digits = 2): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}
