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

      /** เปอร์เซ็นต์ของ circulating (เช่น 1.2 = 1.2%) */
      let pctCirc: number | undefined;
      const rawPct =
        o.pct_circulating ?? o.pct_of_supply ?? o.percent_circulating ?? o.unlock_pct_supply ?? o.pct_supply;
      if (typeof rawPct === "number" && Number.isFinite(rawPct)) {
        pctCirc = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;
      } else if (typeof rawPct === "string") {
        const n = parseFloat(rawPct.replace(/%/g, "").trim());
        if (Number.isFinite(n)) pctCirc = n > 0 && n <= 1 ? n * 100 : n;
      }

      const id = `unlock:${project}:${sym}:${startsAtUtc}`;
      const titleBase = amt ? `${project} (${sym}) — unlock ~${amt}` : `${project} (${sym}) — unlock`;
      const title = pctCirc != null ? `${titleBase} (~${pctCirc.toFixed(2)}% circ.)` : titleBase;

      out.push({
        id,
        source: "Token unlocks",
        title,
        startsAtUtc,
        category: "unlock",
        forecast: amt,
        importance: pctCirc != null && pctCirc >= 1 ? "high" : undefined,
        meta:
          pctCirc != null
            ? { pctCirculating: pctCirc, eventSubtype: "unlock" }
            : { eventSubtype: "unlock" },
      });
    }

    out.sort((a, b) => a.startsAtUtc - b.startsAtUtc);
    return out;
  } catch (e) {
    console.warn("[tokenUnlocksFetch]", e);
    return [];
  }
}
