/** เก็บ payload สถิติใน localStorage — stale-while-revalidate ฝั่ง Mini App */

const STORAGE_PREFIX = "koji:stats:swr:";

type StatsStaleCacheEnvelope<T> = {
  v: 1;
  cachedAtMs: number;
  data: T;
};

function storageKey(scope: string): string {
  const userId =
    typeof window !== "undefined"
      ? window.Telegram?.WebApp?.initDataUnsafe?.user?.id
      : undefined;
  const userSuffix = userId != null && Number.isFinite(userId) ? String(userId) : "anon";
  return `${STORAGE_PREFIX}${scope}:${userSuffix}`;
}

export function readStatsClientStaleCache<T>(scope: string): {
  data: T;
  cachedAtMs: number;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StatsStaleCacheEnvelope<T>;
    if (parsed?.v !== 1 || parsed.data == null || !Number.isFinite(parsed.cachedAtMs)) {
      return null;
    }
    return { data: parsed.data, cachedAtMs: parsed.cachedAtMs };
  } catch {
    return null;
  }
}

export function writeStatsClientStaleCache<T>(scope: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: StatsStaleCacheEnvelope<T> = {
      v: 1,
      cachedAtMs: Date.now(),
      data,
    };
    localStorage.setItem(storageKey(scope), JSON.stringify(envelope));
  } catch {
    /* quota / private mode — ข้าม */
  }
}

export function clearStatsClientStaleCache(scope: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(scope));
  } catch {
    /* ignore */
  }
}

export function formatStatsStaleCacheAge(cachedAtMs: number, nowMs = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - cachedAtMs) / 1000));
  if (sec < 60) return "เมื่อกี้";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} ชม.ที่แล้ว`;
  const day = Math.floor(hr / 24);
  return `${day} วันที่แล้ว`;
}
