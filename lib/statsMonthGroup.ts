import { autoOpenBkkYmd } from "@/lib/autoOpenWeekGroup";

export type StatsMonthFilter = "all" | string;

/** คีย์เดือน YYYY-MM ตามปฏิทิน BKK */
export function statsBkkMonthKey(atMs: number): string {
  return autoOpenBkkYmd(atMs).slice(0, 7);
}

/** ป้ายเดือนสำหรับ dropdown — เช่น มิ.ย. 2025 */
export function formatStatsBkkMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;
  const t = Date.UTC(y, m - 1, 1);
  return new Date(t).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    month: "short",
    year: "numeric",
  });
}

/** รายการเดือนที่มีข้อมูล — เรียงใหม่ → เก่า */
export function listStatsBkkMonthKeys<T>(rows: T[], atMs: (row: T) => number): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    const ms = atMs(r);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    keys.add(statsBkkMonthKey(ms));
  }
  return [...keys].sort((a, b) => b.localeCompare(a));
}

export function filterRowsByStatsBkkMonth<T>(
  rows: T[],
  monthFilter: StatsMonthFilter,
  atMs: (row: T) => number,
): T[] {
  if (monthFilter === "all") return rows;
  return rows.filter((r) => statsBkkMonthKey(atMs(r)) === monthFilter);
}

/** monthKeys เรียงใหม่ → เก่า: prev = เดือนเก่ากว่า, next = เดือนใหม่กว่า */
export function adjacentStatsBkkMonth(
  monthKeys: string[],
  current: string,
): { prev: string | null; next: string | null } {
  const i = monthKeys.indexOf(current);
  if (i < 0) return { prev: null, next: null };
  return {
    prev: i + 1 < monthKeys.length ? monthKeys[i + 1]! : null,
    next: i > 0 ? monthKeys[i - 1]! : null,
  };
}
