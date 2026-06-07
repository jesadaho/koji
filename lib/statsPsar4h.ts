/** Client-safe — PSAR 4h ของคู่สัญญาณ (ไม่ใช่ BTC) */

export type StatsPsar4hTrend = "up" | "down";

export function statsPsar4hTrendLabel(trend: StatsPsar4hTrend | null | undefined): string {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  return "—";
}

/** ระยะ signed: (close − SAR) / close × 100 — บวก = ราคาเหนือ SAR */
export function statsPsar4hDistPctLabel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function statsPsar4hDistPctCsv(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  return pct.toFixed(2);
}
