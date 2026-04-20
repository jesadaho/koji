import type { UnifiedEvent } from "./upcomingEventsTypes";

/**
 * ดึง token unlock / vesting — รองรับ JSON จาก API ภายนอกเมื่อตั้งค่า
 * ตั้ง TOKEN_UNLOCKS_API_URL (GET) + ออปชัน TOKEN_UNLOCKS_API_KEY (ส่งเป็น Bearer)
 * รูปแบบที่รองรับ: { "data": [ { "token", "project", "unlock_time" | "date", "amount" } ] }
 * หรือ array ตรงๆ
 */
export async function fetchTokenUnlockEvents(from: Date, to: Date): Promise<UnifiedEvent[]> {
  const base = process.env.TOKEN_UNLOCKS_API_URL?.trim();
  if (!base) return [];

  const key = process.env.TOKEN_UNLOCKS_API_KEY?.trim();
  const fromMs = from.getTime();
  const toMs = to.getTime();

  try {
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(base, { headers });
    if (!res.ok) {
      console.warn("[tokenUnlocksFetch] HTTP", res.status);
      return [];
    }
    const raw = await res.json();
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: unknown[] }).data ?? [])
        : [];
    const out: UnifiedEvent[] = [];

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const sym =
        (typeof o.token === "string" && o.token) ||
        (typeof o.symbol === "string" && o.symbol) ||
        (typeof o.ticker === "string" && o.ticker) ||
        "TOKEN";
      const project = typeof o.project === "string" ? o.project : typeof o.name === "string" ? o.name : sym;
      const timeRaw =
        o.unlock_time ?? o.unlock_date ?? o.date ?? o.time ?? o.when ?? o.starts_at;
      let startsAtUtc = NaN;
      if (typeof timeRaw === "number" && Number.isFinite(timeRaw)) {
        startsAtUtc = timeRaw > 1e12 ? timeRaw : timeRaw * 1000;
      } else if (typeof timeRaw === "string") {
        const p = Date.parse(timeRaw);
        if (Number.isFinite(p)) startsAtUtc = p;
      }
      if (!Number.isFinite(startsAtUtc) || startsAtUtc < fromMs || startsAtUtc > toMs) continue;

      const amt =
        o.amount != null
          ? String(o.amount)
          : o.value_usd != null
            ? String(o.value_usd)
            : undefined;

      const id = `unlock:${project}:${sym}:${startsAtUtc}`;
      out.push({
        id,
        source: "Token unlocks",
        title: amt ? `${project} (${sym}) — unlock ~${amt}` : `${project} (${sym}) — unlock`,
        startsAtUtc,
        category: "unlock",
        forecast: amt,
      });
    }

    out.sort((a, b) => a.startsAtUtc - b.startsAtUtc);
    return out;
  } catch (e) {
    console.warn("[tokenUnlocksFetch]", e);
    return [];
  }
}
