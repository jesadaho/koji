import type { UnifiedEvent } from "./upcomingEventsTypes";

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

/** ขั้นต่ำ % ของ circulating supply สำหรับ unlock (ค่าเริ่ม 1) */
export function unlockMinPctSupply(): number {
  const v = Number(process.env.UPCOMING_UNLOCK_MIN_PCT_SUPPLY);
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

/** ถ้า API ไม่ส่ง % — ไม่แสดง unlock (ปิดสแปม) ยกเว้นเปิด flag นี้ */
export function unlockAllowUnknownPct(): boolean {
  return envFlagOn("UPCOMING_UNLOCK_ALLOW_UNKNOWN_PCT", false);
}

/**
 * Macro สหรัฐฯ ตัวตึง: CPI / PPI / PCE, FOMC / ดอกเบี้ย Fed, NFP
 */
export function isHighImpactUsMacro(e: UnifiedEvent): boolean {
  if (e.category !== "macro") return false;
  const t = e.title;
  const matchesKeyword =
    /\b(CPI|Consumer Price Index|Core CPI|PPI|Producer Price|Core PPI|PCE|Core PCE|Personal Consumption)\b/i.test(
      t
    ) ||
    /\b(FOMC|Federal Funds|Fed(?:eral)?\s+(?:Interest\s+)?Rate|Interest Rate Decision|FOMC Statement|FOMC Minutes|FOMC Meeting)\b/i.test(
      t
    ) ||
    /\b(NFP|Non[- ]?Farm|Nonfarm Payrolls|Employment Situation)\b/i.test(t);
  if (!matchesKeyword) return false;
  const c = (e.country ?? "").toUpperCase();
  if (!c) return true;
  return c === "US" || c === "USA" || c.includes("UNITED STATES");
}

/** Token unlock — เฉพาะเมื่อรู้ % ของ supply และ ≥ เกณฑ์ (หรือเปิด allow unknown) */
export function isHighImpactUnlock(e: UnifiedEvent): boolean {
  if (e.category !== "unlock") return false;
  const pct = e.meta?.pctCirculating;
  if (pct != null && Number.isFinite(pct)) return pct >= unlockMinPctSupply();
  return unlockAllowUnknownPct();
}

/** Network upgrade / listing / delisting จากแหล่งที่คัดแล้ว */
export function isCryptoInfraEvent(e: UnifiedEvent): boolean {
  return e.category === "crypto_infra";
}

/** ใช้กับ snapshot / digest / หน้าเว็บ — เฉพาะ high-impact ตามนโยบาย */
export function applyEventFeedFilter(events: UnifiedEvent[]): UnifiedEvent[] {
  return events.filter((e) => {
    if (e.category === "macro") return isHighImpactUsMacro(e);
    if (e.category === "unlock") return isHighImpactUnlock(e);
    if (e.category === "crypto_infra") return isCryptoInfraEvent(e);
    return false;
  });
}
