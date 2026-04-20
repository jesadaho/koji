import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import { applyEventFeedFilter } from "./eventFilters";
import { fetchCryptoMarketEvents } from "./cryptoMarketEventsFetch";
import { fetchFinnhubEconomicCalendar, finnhubCalendarConfigured } from "./finnhubEconomicCalendar";
import { fetchTokenUnlockEvents } from "./tokenUnlocksFetch";
import type { UnifiedEvent, UpcomingEventsSnapshot } from "./upcomingEventsTypes";

const SNAPSHOT_KV = "koji:upcoming_events_snapshot";
const snapshotFile = join(process.cwd(), "data", "upcoming_events_snapshot.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableSnapshot(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ KV สำหรับ upcoming events snapshot");
  }
}

async function ensureSnapshotFile(): Promise<void> {
  try {
    await readFile(snapshotFile, "utf-8");
  } catch {
    await mkdir(dirname(snapshotFile), { recursive: true });
    await writeFile(snapshotFile, "{}", "utf-8");
  }
}

/** จันทร์ UTC ของสัปดาห์ที่มีวัน d (YYYY-MM-DD) */
export function utcMondayYmdOfDate(d: Date): string {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(x.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

/** รวม macro + unlock + crypto infra แล้วกรองเฉพาะ high-impact */
export async function fetchUnifiedEventsRange(from: Date, to: Date): Promise<UnifiedEvent[]> {
  const [macro, unlocks, cryptoInfra] = await Promise.all([
    fetchFinnhubEconomicCalendar(from, to),
    fetchTokenUnlockEvents(from, to),
    fetchCryptoMarketEvents(from, to),
  ]);
  const merged = [...macro, ...unlocks, ...cryptoInfra];
  merged.sort((a, b) => a.startsAtUtc - b.startsAtUtc);
  return applyEventFeedFilter(merged);
}

/** ดึงข้อมูลสด (ใช้ใน cron / เมื่อไม่มี snapshot) */
export async function buildUpcomingEventsSnapshot(daysForward: number): Promise<UpcomingEventsSnapshot> {
  const now = new Date();
  const from = addDaysUtc(now, -1);
  const to = addDaysUtc(now, daysForward);
  const events = await fetchUnifiedEventsRange(from, to);
  return {
    fetchedAtIso: now.toISOString(),
    rangeFromIso: from.toISOString(),
    rangeToIso: to.toISOString(),
    events,
  };
}

async function loadSnapshotFromDisk(): Promise<UpcomingEventsSnapshot | null> {
  await ensureSnapshotFile();
  try {
    const raw = await readFile(snapshotFile, "utf-8");
    const p = JSON.parse(raw) as UpcomingEventsSnapshot;
    if (p && Array.isArray(p.events)) return p;
  } catch {
    /* empty */
  }
  return null;
}

export async function loadCachedSnapshot(): Promise<UpcomingEventsSnapshot | null> {
  if (useCloudStorage()) {
    return cloudGet<UpcomingEventsSnapshot>(SNAPSHOT_KV);
  }
  if (isVercel()) return null;
  return loadSnapshotFromDisk();
}

export async function saveSnapshot(snap: UpcomingEventsSnapshot): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(SNAPSHOT_KV, snap);
    return;
  }
  assertWritableSnapshot();
  await mkdir(dirname(snapshotFile), { recursive: true });
  await writeFile(snapshotFile, JSON.stringify(snap, null, 2), "utf-8");
}

const DEFAULT_DAYS = 14;

function snapshotFresh(snap: UpcomingEventsSnapshot, maxAgeMs: number): boolean {
  const t = Date.parse(snap.fetchedAtIso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxAgeMs;
}

/**
 * หน้าเว็บ — ใช้ snapshot ถ้ายังสด (ค่าเริ่ม 20 นาที) ไม่เช่นนั้นดึงสดถ้ามี Finnhub หรือ unlock URL
 */
export async function getUpcomingEventsForDisplay(): Promise<UpcomingEventsSnapshot> {
  const maxAge = Number(process.env.UPCOMING_EVENTS_CACHE_MAX_AGE_MS);
  const maxAgeMs = Number.isFinite(maxAge) && maxAge > 60_000 ? maxAge : 20 * 60 * 1000;

  const cached = await loadCachedSnapshot();
  if (cached && snapshotFresh(cached, maxAgeMs)) {
    return cached;
  }

  const days = Number(process.env.UPCOMING_EVENTS_RANGE_DAYS);
  const d = Number.isFinite(days) && days >= 1 && days <= 60 ? Math.floor(days) : DEFAULT_DAYS;

  const hasAnySource =
    finnhubCalendarConfigured() ||
    Boolean(process.env.TOKEN_UNLOCKS_API_URL?.trim()) ||
    Boolean(process.env.CRYPTO_MARKET_EVENTS_API_URL?.trim());
  if (!hasAnySource) {
    if (cached) return cached;
    return {
      fetchedAtIso: new Date().toISOString(),
      rangeFromIso: new Date().toISOString(),
      rangeToIso: new Date().toISOString(),
      events: [],
    };
  }

  return buildUpcomingEventsSnapshot(d);
}
