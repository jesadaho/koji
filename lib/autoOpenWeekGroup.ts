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

export type BkkWeekGroup<T> = {
  weekKey: string;
  weekLabel: string;
  rows: T[];
};

export type AutoOpenWeekGroup = BkkWeekGroup<AutoOpenOrderLogRow>;

/** เวลาแจ้งจากแถวสถิติ (alertedAtMs / alertedAtIso) */
export function statsRowAlertedAtMs(row: {
  alertedAtMs?: number | null;
  alertedAtIso?: string;
}): number {
  if (row.alertedAtMs != null && Number.isFinite(row.alertedAtMs)) return row.alertedAtMs;
  const ms = Date.parse(row.alertedAtIso ?? "");
  return Number.isFinite(ms) ? ms : 0;
}

/** จัดกลุ่มตามสัปดาห์ (จันทร์ BKK) — เรียงสัปดาห์ใหม่ → เก่า */
export function groupRowsByBkkWeek<T>(
  rows: T[],
  atMs: (row: T) => number,
  sortRows?: (a: T, b: T) => number,
): BkkWeekGroup<T>[] {
  const weekKeys: string[] = [];
  const byWeek: Record<string, T[]> = {};
  for (const r of rows) {
    const ms = atMs(r);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const key = autoOpenBkkWeekStartKey(ms);
    const list = byWeek[key];
    if (list) {
      list.push(r);
    } else {
      byWeek[key] = [r];
      weekKeys.push(key);
    }
  }
  weekKeys.sort((a, b) => b.localeCompare(a));
  const cmp = sortRows ?? (() => 0);
  const groups: BkkWeekGroup<T>[] = [];
  for (const weekKey of weekKeys) {
    const weekRows = byWeek[weekKey]!;
    groups.push({
      weekKey,
      weekLabel: formatAutoOpenBkkWeekLabel(weekKey),
      rows: weekRows.slice().sort(cmp),
    });
  }
  return groups;
}

/** จัดกลุ่มตามสัปดาห์ (จันทร์ BKK) — เรียงสัปดาห์ใหม่ → เก่า */
export function groupAutoOpenLogsByBkkWeek(rows: AutoOpenOrderLogRow[]): AutoOpenWeekGroup[] {
  return groupRowsByBkkWeek(rows, (r) => r.atMs, (a, b) => b.atMs - a.atMs);
}
