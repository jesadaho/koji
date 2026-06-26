/** Client-safe BTC.D EMA helpers for stats tables / CSV */

export function statsBtcDomEma20_4hSlopeLabel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}
