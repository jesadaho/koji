import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

export type ReversalTradFiFilter = "all" | "crypto" | "stock";

export const REVERSAL_TRADFI_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalTradFiFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "crypto", label: "Crypto" },
  { value: "stock", label: "Stock / TradFi" },
];

export function reversalStatsRowIsTradFi(
  row: Pick<CandleReversalStatsRow, "isTradFi">,
): boolean {
  return row.isTradFi === true;
}

export function reversalTradFiFilterLabel(filter: ReversalTradFiFilter): string {
  return REVERSAL_TRADFI_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalTradFiFilterTitle(filter: ReversalTradFiFilter): string {
  if (filter === "all") return "ทั้งหมด — crypto perp และ stock/TradFi perp";
  if (filter === "crypto") {
    return "Crypto perp เท่านั้น — ไม่รวม TradFi/stock (Binance underlying ≠ COIN)";
  }
  return "Stock / TradFi perp เท่านั้น — ตรงกับแจ้งเตือน ⏭️ Auto-open skip TradFi/stock";
}

export function reversalTradFiFilterDetail(filter: ReversalTradFiFilter): string | null {
  if (filter === "all") return null;
  if (filter === "stock") {
    return "TradFi/stock perp บน Binance — auto-open ข้าม · แถวเก่าก่อนมีฟิลด์ isTradFi อาจยังไม่แสดงจน backfill";
  }
  return "Crypto USDT-M perp — รวมแถวที่ยังไม่ backfill isTradFi (ถือเป็น crypto)";
}

export function reversalStatsRowMatchesTradFiFilter(
  row: Pick<CandleReversalStatsRow, "isTradFi">,
  filter: ReversalTradFiFilter,
): boolean {
  if (filter === "all") return true;
  const isStock = reversalStatsRowIsTradFi(row);
  return filter === "stock" ? isStock : !isStock;
}
