import { createClient, type RedisClientType } from "redis";
import { kv } from "@vercel/kv";

/** Redis แบบ TCP (เช่น Upstash rediss://) — ถ้ามีจะใช้แทน Vercel KV REST */
export function useRedisUrl(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export function useKvRest(): boolean {
  return Boolean(process.env.KV_REST_API_URL?.trim());
}

/** มี backend ระยะไกลสำหรับเก็บ JSON (Redis หรือ KV) */
export function useCloudStorage(): boolean {
  return useRedisUrl() || useKvRest();
}

let redisClient: RedisClientType | null = null;
let redisConnecting: Promise<RedisClientType> | null = null;

async function getRedis(): Promise<RedisClientType> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error("REDIS_URL ไม่ได้ตั้ง");
  }
  if (redisClient?.isOpen) {
    return redisClient;
  }
  if (!redisConnecting) {
    redisConnecting = (async () => {
      try {
        const c = createClient({ url }) as RedisClientType;
        c.on("error", (err) => console.error("[redis]", err));
        await c.connect();
        redisClient = c;
        return c;
      } catch (e) {
        redisClient = null;
        throw e;
      } finally {
        redisConnecting = null;
      }
    })();
  }
  return redisConnecting;
}

/** อ่านค่า JSON จาก Redis (string) หรือ Vercel KV */
export async function cloudGet<T>(key: string): Promise<T | null> {
  if (useRedisUrl()) {
    const r = await getRedis();
    const raw = await r.get(key);
    if (raw == null || raw === "") return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (useKvRest()) {
    return kv.get<T>(key);
  }
  return null;
}

/** เขียน JSON — Redis ใช้ SET string; KV ใช้พฤติกรรมเดิมของ @vercel/kv */
export async function cloudSet(key: string, value: unknown): Promise<void> {
  if (useRedisUrl()) {
    const r = await getRedis();
    await r.set(key, JSON.stringify(value));
    return;
  }
  if (useKvRest()) {
    // @vercel/kv รับ object/array/primitive — เก็บเหมือนเดิมก่อนมี Redis
    await kv.set(key, value as Parameters<typeof kv.set>[1]);
    return;
  }
  throw new Error("ไม่มี cloud storage (ตั้ง REDIS_URL หรือ KV_REST_API_URL)");
}

const PCT_STEP_ALERTS_LOCK_KEY = "koji:lock:pct_step_alerts";
const PCT_STEP_ALERTS_LOCK_TTL_SEC = 120;
const SPOT_FUT_BASIS_ALERTS_LOCK_KEY = "koji:lock:spot_fut_basis_alerts";
const SPOT_FUT_BASIS_ALERTS_LOCK_TTL_SEC = 120;
const INDICATOR_PUBLIC_FEED_LOCK_KEY = "koji:lock:indicator_public_feed";
const INDICATOR_PUBLIC_FEED_LOCK_TTL_SEC = 180;

/** ล็อกก่อน read-modify-write pct step alerts (กัน race ระหว่าง cron 5 นาที vs 15 นาที) — local file ไม่ล็อก */
export async function acquirePctStepAlertsLock(): Promise<boolean> {
  if (!useCloudStorage()) return true;
  if (useRedisUrl()) {
    const r = await getRedis();
    const ok = await r.set(PCT_STEP_ALERTS_LOCK_KEY, "1", {
      EX: PCT_STEP_ALERTS_LOCK_TTL_SEC,
      NX: true,
    });
    return ok === "OK";
  }
  if (useKvRest()) {
    const res = await kv.set(PCT_STEP_ALERTS_LOCK_KEY, "1", {
      ex: PCT_STEP_ALERTS_LOCK_TTL_SEC,
      nx: true,
    });
    return res === "OK";
  }
  return true;
}

export async function releasePctStepAlertsLock(): Promise<void> {
  if (!useCloudStorage()) return;
  if (useRedisUrl()) {
    const r = await getRedis();
    await r.del(PCT_STEP_ALERTS_LOCK_KEY);
    return;
  }
  if (useKvRest()) {
    await kv.del(PCT_STEP_ALERTS_LOCK_KEY);
  }
}

/** ล็อกก่อน run spot–fut basis tick (กัน cron ซ้อนกันทำให้ทะลุ daily cap) */
export async function acquireSpotFutBasisAlertsLock(): Promise<boolean> {
  if (!useCloudStorage()) return true;
  if (useRedisUrl()) {
    const r = await getRedis();
    const ok = await r.set(SPOT_FUT_BASIS_ALERTS_LOCK_KEY, "1", {
      EX: SPOT_FUT_BASIS_ALERTS_LOCK_TTL_SEC,
      NX: true,
    });
    return ok === "OK";
  }
  if (useKvRest()) {
    const res = await kv.set(SPOT_FUT_BASIS_ALERTS_LOCK_KEY, "1", {
      ex: SPOT_FUT_BASIS_ALERTS_LOCK_TTL_SEC,
      nx: true,
    });
    return res === "OK";
  }
  return true;
}

export async function releaseSpotFutBasisAlertsLock(): Promise<void> {
  if (!useCloudStorage()) return;
  if (useRedisUrl()) {
    const r = await getRedis();
    await r.del(SPOT_FUT_BASIS_ALERTS_LOCK_KEY);
    return;
  }
  if (useKvRest()) {
    await kv.del(SPOT_FUT_BASIS_ALERTS_LOCK_KEY);
  }
}

/** ล็อกก่อน run public indicator feed (กัน cron ซ้อนกันทำให้ยิงซ้ำ เพราะ state read-modify-write) */
export async function acquireIndicatorPublicFeedLock(): Promise<boolean> {
  if (!useCloudStorage()) return true;
  if (useRedisUrl()) {
    const r = await getRedis();
    const ok = await r.set(INDICATOR_PUBLIC_FEED_LOCK_KEY, "1", {
      EX: INDICATOR_PUBLIC_FEED_LOCK_TTL_SEC,
      NX: true,
    });
    return ok === "OK";
  }
  if (useKvRest()) {
    const res = await kv.set(INDICATOR_PUBLIC_FEED_LOCK_KEY, "1", {
      ex: INDICATOR_PUBLIC_FEED_LOCK_TTL_SEC,
      nx: true,
    });
    return res === "OK";
  }
  return true;
}

export async function releaseIndicatorPublicFeedLock(): Promise<void> {
  if (!useCloudStorage()) return;
  if (useRedisUrl()) {
    const r = await getRedis();
    await r.del(INDICATOR_PUBLIC_FEED_LOCK_KEY);
    return;
  }
  if (useKvRest()) {
    await kv.del(INDICATOR_PUBLIC_FEED_LOCK_KEY);
  }
}

/** ตั้ง string พร้อม TTL (nonce / dedupe) — ต้องมี Redis หรือ KV */
export async function cloudSetStringWithTtl(key: string, value: string, ttlSec: number): Promise<void> {
  if (useRedisUrl()) {
    const r = await getRedis();
    await r.set(key, value, { EX: ttlSec });
    return;
  }
  if (useKvRest()) {
    await kv.set(key, value, { ex: ttlSec });
    return;
  }
  throw new Error("ไม่มี cloud storage (ตั้ง REDIS_URL หรือ KV_REST_API_URL)");
}

/** อ่าน string key (ไม่ parse JSON) */
export async function cloudGetString(key: string): Promise<string | null> {
  if (useRedisUrl()) {
    const r = await getRedis();
    const v = await r.get(key);
    return v ?? null;
  }
  if (useKvRest()) {
    const v = await kv.get<string>(key);
    return v ?? null;
  }
  return null;
}
