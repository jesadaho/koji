import type { UnifiedEvent } from "./upcomingEventsTypes";

const FINNHUB = "https://finnhub.io/api/v1/calendar/economic";

function finnhubToken(): string | undefined {
  return process.env.FINNHUB_API_KEY?.trim() || undefined;
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseImpact(s: unknown): "high" | "medium" | "low" | undefined {
  if (typeof s !== "string") return undefined;
  const x = s.toLowerCase();
  if (x === "high" || x === "medium" || x === "low") return x;
  return undefined;
}

function fmtNum(n: unknown): string | undefined {
  if (n == null) return undefined;
  if (typeof n === "number" && Number.isFinite(n)) return String(n);
  if (typeof n === "string" && n.trim()) return n.trim();
  return undefined;
}

/**
 * ปฏิทินเศรษฐกิจ Finnhub — ต้องมี FINNHUB_API_KEY (สมัครฟรีที่ finnhub.io)
 */
export async function fetchFinnhubEconomicCalendar(from: Date, to: Date): Promise<UnifiedEvent[]> {
  const token = finnhubToken();
  if (!token) return [];

  const fromStr = toYmd(from);
  const toStr = toYmd(to);
  const url = `${FINNHUB}?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&token=${encodeURIComponent(token)}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn("[finnhubEconomicCalendar] HTTP", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = (await res.json()) as { economicCalendar?: unknown[] };
  const rows = Array.isArray(data.economicCalendar) ? data.economicCalendar : [];
  const out: UnifiedEvent[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const event = typeof r.event === "string" ? r.event : null;
    if (!event) continue;

    const timeStr = typeof r.time === "string" ? r.time : typeof r.date === "string" ? r.date : null;
    let startsAtUtc = NaN;
    if (timeStr) {
      const normalized =
        /[zZ]|[+-]\d{2}:?\d{2}$/.test(timeStr)
          ? timeStr
          : timeStr.includes("T")
            ? timeStr
            : `${timeStr.replace(" ", "T")}Z`;
      const t = Date.parse(normalized);
      if (Number.isFinite(t)) startsAtUtc = t;
    }
    if (!Number.isFinite(startsAtUtc)) continue;

    const country = typeof r.country === "string" ? r.country : undefined;
    const idBase = `${country ?? "XX"}|${event}|${timeStr ?? startsAtUtc}`;
    const id = `finnhub:${idBase.replace(/\s+/g, "_")}`;

    out.push({
      id,
      source: "Finnhub",
      title: event,
      startsAtUtc,
      country,
      currency: typeof r.currency === "string" ? r.currency : undefined,
      forecast: fmtNum(r.estimate ?? r.estimateFormatted),
      previous: fmtNum(r.prev ?? r.previous),
      actual: fmtNum(r.actual),
      category: "macro",
      importance: parseImpact(r.impact),
    });
  }

  out.sort((a, b) => a.startsAtUtc - b.startsAtUtc);
  return out;
}

export function finnhubCalendarConfigured(): boolean {
  return Boolean(finnhubToken());
}
