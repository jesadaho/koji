/** ATR% 4H — Wilder ATR(14) บนแท่ง 4h ÷ close × 100 */

export function statsAtrPct4hLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${value.toFixed(2)}%`;
}
