/** รายการเหตุการณ์รวม — ใช้ทั้งหน้าเว็บและ cron */

export type UnifiedEventCategory = "macro" | "unlock" | "crypto_infra";

export type UnifiedEventMeta = {
  /** % ของ circulating supply ที่ปลดล็อก (ใช้กรอง unlock ≥ เกณฑ์) */
  pctCirculating?: number;
  eventSubtype?: "upgrade" | "listing" | "delisting" | "unlock";
  exchange?: string;
  network?: string;
};

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
  meta?: UnifiedEventMeta;
};

export type UpcomingEventsSnapshot = {
  fetchedAtIso: string;
  rangeFromIso: string;
  rangeToIso: string;
  events: UnifiedEvent[];
};
