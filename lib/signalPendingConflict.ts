/** ตรวจเหรียญที่มี Snowball + Reversal pending พร้อมกัน (client-safe) */

export type PendingStrategy = "snowball" | "reversal";

export type PendingConflictSets = {
  snowballPending: ReadonlySet<string>;
  reversalPending: ReadonlySet<string>;
};

/** คีย์เหรียญ — รองรับ LABUSDT, LAB_USDT */
export function pendingConflictSymbolKey(symbol: string): string {
  let s = symbol.trim().toUpperCase();
  if (!s) return "";
  if (s.endsWith("_USDT")) s = s.slice(0, -5);
  else if (s.endsWith("USDT") && s.length > 4) s = s.slice(0, -4);
  return s.replace(/_/g, "");
}

export function hasDualPendingConflict(sets: PendingConflictSets, symbol: string): boolean {
  const k = pendingConflictSymbolKey(symbol);
  if (!k) return false;
  return sets.snowballPending.has(k) && sets.reversalPending.has(k);
}

/** ชื่อฝั่งตรงข้ามเมื่อทั้งสอง pending — null ถ้าไม่ conflict */
export function pendingConflictWithLabel(
  sets: PendingConflictSets,
  symbol: string,
  self: PendingStrategy,
): string | null {
  if (!hasDualPendingConflict(sets, symbol)) return null;
  return self === "snowball" ? "Reversal" : "Snowball";
}

/** ค่าที่บันทึกใน store ก่อน · fallback คำนวณจาก pending สด (แถวเก่า) */
export function resolveRowConflictWith(
  row: { conflictWith?: string | null; symbol: string },
  sets: PendingConflictSets,
  self: PendingStrategy,
): string | null {
  const stored = row.conflictWith?.trim();
  if (stored) return stored;
  return pendingConflictWithLabel(sets, row.symbol, self);
}

export function pendingConflictBadgeText(conflictWith: string | null | undefined): string | null {
  if (!conflictWith?.trim()) return null;
  return `⚠ conflict w/ ${conflictWith.trim()}`;
}

/** แถวที่ Snowball + Reversal pending พร้อมกัน (มี conflict badge) */
export function rowHasPendingConflict(row: { conflictWith?: string | null }): boolean {
  return Boolean(row.conflictWith?.trim());
}

export function excludePendingConflictRows<T extends { conflictWith?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((r) => !rowHasPendingConflict(r));
}
