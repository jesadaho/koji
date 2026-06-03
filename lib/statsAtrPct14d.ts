/** ATR% 14D — Wilder ATR(14) บนแท่ง 1d ÷ close × 100 (เทียบความผันผวนข้ามเหรียญ) */

export function statsAtrPct14dLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${value.toFixed(2)}%`;
}
