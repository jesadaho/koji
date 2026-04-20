/** รายการเหตุการณ์รวม (macro + unlock) — ใช้ทั้งหน้าเว็บและ cron */

export type UnifiedEventCategory = "macro" | "unlock";

export type UnifiedEvent = {
  id: string;
  source: string;
  title: string;
  /** Unix ms UTC */
  startsAtUtc: number;
  country?: string;
  currency?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
  category: UnifiedEventCategory;
  importance?: "high" | "medium" | "low";
};

export type UpcomingEventsSnapshot = {
  fetchedAtIso: string;
  rangeFromIso: string;
  rangeToIso: string;
  events: UnifiedEvent[];
};
