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

/** Reversal เกิดพร้อมหรือหลัง Snowball (alert ช้ากว่าหรือเท่ากัน) */
export function isReversalAfterPendingSnowball(
  snowballAtMs: number | null,
  reversalAtMs: number | null,
): boolean {
  return (
    snowballAtMs != null &&
    reversalAtMs != null &&
    Number.isFinite(snowballAtMs) &&
    Number.isFinite(reversalAtMs) &&
    reversalAtMs >= snowballAtMs
  );
}

/**
 * ควร conflict-close หรือไม่ — ไม่ปิด position/limit เมื่อ Reversal + Snowball conflict
 * (Reversal หลัง Snowball ยังเปิด/ถือต่อได้ · ไม่ market-close ฝั่งใดเมื่อเจอ Reversal)
 */
export function shouldDualPendingConflictClose(
  _snowballAtMs: number | null,
  _reversalAtMs: number | null,
): boolean {
  return false;
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

export function rowHasStoredConflict(row: { conflictWith?: string | null }): boolean {
  return Boolean(row.conflictWith?.trim());
}

export type StatsConflictFilter = "all" | "conflict" | "no_conflict";

export const STATS_CONFLICT_FILTER_OPTIONS: ReadonlyArray<{
  value: StatsConflictFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "conflict", label: "มี conflict" },
  { value: "no_conflict", label: "ไม่ conflict" },
];

export function statsConflictFilterLabel(filter: StatsConflictFilter): string {
  return STATS_CONFLICT_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function statsConflictFilterTitle(filter: StatsConflictFilter): string {
  switch (filter) {
    case "conflict":
      return "เฉพาะแถวที่เคย conflict กับสัญญาณฝั่งตรงข้าม (Snowball ↔ Reversal)";
    case "no_conflict":
      return "เฉพาะแถวที่ไม่มี conflict";
    default:
      return "รวมทุกแถว — ทั้งที่มีและไม่มี conflict";
  }
}

export function statsRowMatchesConflictFilter(
  row: { conflictWith?: string | null },
  filter: StatsConflictFilter,
): boolean {
  if (filter === "all") return true;
  const has = rowHasStoredConflict(row);
  return filter === "conflict" ? has : !has;
}

/** แถวสถิติ/auto-open ที่ยังรอผล horizon (ไม่รวม win/loss/flat ที่ปิดแล้ว) */
export function isStatsRowStillPending(row: {
  outcome?: string | null;
  pct48h?: number | null;
}): boolean {
  if (row.outcome === "pending") return true;
  // auto-open success — รอ follow-up 48h
  if (row.outcome === "success" && row.pct48h == null) return true;
  return false;
}

/** แถวที่ Snowball + Reversal ยัง pending พร้อมกัน — ไม่รวมใน WR/สรุป P/L */
export function rowHasPendingConflict(row: {
  conflictWith?: string | null;
  outcome?: string | null;
  pct48h?: number | null;
}): boolean {
  if (!row.conflictWith?.trim()) return false;
  return isStatsRowStillPending(row);
}

export function excludePendingConflictRows<
  T extends { conflictWith?: string | null; outcome?: string | null; pct48h?: number | null },
>(rows: readonly T[]): T[] {
  return rows.filter((r) => !rowHasPendingConflict(r));
}

export type StatsConflictIndex = {
  byBarKey: ReadonlyMap<string, string>;
  bySourceSym: ReadonlyMap<string, ReadonlyArray<{ atMs: number; conflictWith: string }>>;
};

/** ดัชนี conflict จากสถิติ Snowball/Reversal ที่ stamp ตอนแจ้ง — ใช้ backfill ประวัติ auto-open */
export function buildStatsConflictIndex(
  entries: ReadonlyArray<{
    symbol: string;
    source: PendingStrategy;
    conflictWith?: string | null;
    alertedAtMs: number;
    signalBarOpenSec?: number | null;
  }>,
): StatsConflictIndex {
  const byBarKey = new Map<string, string>();
  const bySourceSym = new Map<string, Array<{ atMs: number; conflictWith: string }>>();

  for (const e of entries) {
    const label = e.conflictWith?.trim();
    if (!label) continue;
    const sym = pendingConflictSymbolKey(e.symbol);
    if (!sym) continue;
    const barSec = e.signalBarOpenSec;
    if (barSec != null && Number.isFinite(barSec)) {
      byBarKey.set(`${sym}|${e.source}|${barSec}`, label);
    }
    const listKey = `${sym}|${e.source}`;
    const list = bySourceSym.get(listKey) ?? [];
    list.push({ atMs: e.alertedAtMs, conflictWith: label });
    bySourceSym.set(listKey, list);
  }

  for (const list of bySourceSym.values()) {
    list.sort((a, b) => a.atMs - b.atMs);
  }

  return { byBarKey, bySourceSym };
}

/** ช่วงเวลา match แถว auto-open กับสถิติเมื่อไม่มี signalBarOpenSec */
export const AUTO_OPEN_STATS_CONFLICT_MATCH_MS = 60 * 60 * 1000;

export function resolveAutoOpenLogConflictWith(
  row: {
    conflictWith?: string | null;
    source: PendingStrategy;
    binanceSymbol?: string;
    contractSymbol: string;
    atMs: number;
    signalBarOpenSec?: number | null;
  },
  sets: PendingConflictSets,
  statsIndex: StatsConflictIndex,
): string | null {
  const stored = row.conflictWith?.trim();
  if (stored) return stored;

  const sym = pendingConflictSymbolKey(row.binanceSymbol || row.contractSymbol);
  if (sym) {
    const barSec = row.signalBarOpenSec;
    if (barSec != null && Number.isFinite(barSec)) {
      const byBar = statsIndex.byBarKey.get(`${sym}|${row.source}|${barSec}`);
      if (byBar) return byBar;
    }
    const list = statsIndex.bySourceSym.get(`${sym}|${row.source}`);
    if (list?.length) {
      let best: string | null = null;
      let bestDist = Infinity;
      for (const h of list) {
        const d = Math.abs(h.atMs - row.atMs);
        if (d <= AUTO_OPEN_STATS_CONFLICT_MATCH_MS && d < bestDist) {
          bestDist = d;
          best = h.conflictWith;
        }
      }
      if (best) return best;
    }
  }

  return resolveRowConflictWith(
    { conflictWith: row.conflictWith, symbol: row.binanceSymbol || row.contractSymbol },
    sets,
    row.source,
  );
}
