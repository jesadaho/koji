import type { UnifiedEvent } from "./upcomingEventsTypes";

const MAJOR_EX = /\b(binance|coinbase|mexc|okx|bybit|kraken)\b/i;

function parseTime(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000;
  if (typeof raw === "string") {
    const p = Date.parse(raw);
    if (Number.isFinite(p)) return p;
  }
  return NaN;
}

/**
 * เหตุการณ์ crypto โครงสร้าง (upgrade / fork / listing) — GET JSON จาก CRYPTO_MARKET_EVENTS_API_URL
 * รูปแบบแนะนำ: { "data": [ { "kind": "upgrade"|"listing"|"delisting", "title", "network", "exchange", "at": ISO } ] }
 */
export async function fetchCryptoMarketEvents(from: Date, to: Date): Promise<UnifiedEvent[]> {
  const base = process.env.CRYPTO_MARKET_EVENTS_API_URL?.trim();
  if (!base) return [];

  const key = process.env.CRYPTO_MARKET_EVENTS_API_KEY?.trim();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const listingMajorOnly = process.env.CRYPTO_LISTING_MAJOR_EXCHANGES_ONLY?.trim() !== "0";

  try {
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(base, { headers });
    if (!res.ok) {
      console.warn("[cryptoMarketEventsFetch] HTTP", res.status);
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
      const kindRaw = String(o.kind ?? o.type ?? "event").toLowerCase();
      const titleStr = String(o.title ?? o.name ?? "");
      const isUpgrade =
        /upgrade|fork|shanghai|cancun|dencun|hardfork|network|mainnet/i.test(kindRaw) ||
        /\b(upgrade|hard fork|network upgrade|mainnet)\b/i.test(titleStr);
      const isListing =
        /listing|list|delist|delisting/i.test(kindRaw) || /\b(listing|delist|listed)\b/i.test(titleStr);
      if (!isUpgrade && !isListing) continue;

      const title =
        typeof o.title === "string"
          ? o.title
          : typeof o.name === "string"
            ? o.name
            : typeof o.project === "string"
              ? o.project
              : "Crypto event";
      const at = parseTime(o.at ?? o.date ?? o.time ?? o.starts_at);
      if (!Number.isFinite(at) || at < fromMs || at > toMs) continue;

      const exchange = typeof o.exchange === "string" ? o.exchange : typeof o.venue === "string" ? o.venue : "";
      if (isListing && listingMajorOnly) {
        if (!exchange || !MAJOR_EX.test(exchange)) continue;
      }

      const network = typeof o.network === "string" ? o.network : undefined;
      const id = `crypto:${kindRaw}:${title}:${at}`.replace(/\s+/g, "_");

      out.push({
        id,
        source: "Crypto market events",
        title: exchange ? `${title} @ ${exchange}` : title,
        startsAtUtc: at,
        category: "crypto_infra",
        importance: "high",
        meta: {
          eventSubtype: isListing ? (/\bdelist/i.test(kindRaw + title) ? "delisting" : "listing") : "upgrade",
          exchange: exchange || undefined,
          network,
        },
      });
    }

    out.sort((a, b) => a.startsAtUtc - b.startsAtUtc);
    return out;
  } catch (e) {
    console.warn("[cryptoMarketEventsFetch]", e);
    return [];
  }
}
