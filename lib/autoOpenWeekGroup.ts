import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";

const BKK = "Asia/Bangkok";

const BKK_WEEKDAY: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** วันที่ YYYY-MM-DD ตามปฏิทิน BKK */
export function autoOpenBkkYmd(atMs: number): string {
  return new Date(atMs).toLocaleDateString("en-CA", { timeZone: BKK });
}

/** 0=จันทร์ … 6=อาทิตย์ (BKK) */
export function autoOpenBkkWeekdayIndex(atMs: number): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: BKK, weekday: "short" }).format(
    new Date(atMs),
  );
  return BKK_WEEKDAY[w] ?? 0;
}

export function addAutoOpenBkkDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toLocaleDateString("en-CA", { timeZone: BKK });
}

/** คีย์สัปดาห์ = วันจันทร์ (BKK) YYYY-MM-DD */
export function autoOpenBkkWeekStartKey(atMs: number): string {
  const ymd = autoOpenBkkYmd(atMs);
  return addAutoOpenBkkDays(ymd, -autoOpenBkkWeekdayIndex(atMs));
}

function formatBkkShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  return new Date(t).toLocaleDateString("th-TH", {
    timeZone: BKK,
    day: "numeric",
    month: "short",
  });
}

/** ช่วงสัปดาห์จันทร์–อาทิตย์ (BKK) */
export function formatAutoOpenBkkWeekLabel(weekStartYmd: string): string {
  const end = addAutoOpenBkkDays(weekStartYmd, 6);
  return `${formatBkkShortDate(weekStartYmd)} – ${formatBkkShortDate(end)}`;
}

export type AutoOpenWeekGroup = {
  weekKey: string;
  weekLabel: string;
  rows: AutoOpenOrderLogRow[];
};

/** จัดกลุ่มตามสัปดาห์ (จันทร์ BKK) — เรียงสัปดาห์ใหม่ → เก่า */
export function groupAutoOpenLogsByBkkWeek(rows: AutoOpenOrderLogRow[]): AutoOpenWeekGroup[] {
  const map = new Map<string, AutoOpenOrderLogRow[]>();
  for (const r of rows) {
    const key = autoOpenBkkWeekStartKey(r.atMs);
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([weekKey, weekRows]) => ({
      weekKey,
      weekLabel: formatAutoOpenBkkWeekLabel(weekKey),
      rows: weekRows.sort((a, b) => b.atMs - a.atMs),
    }));
}
