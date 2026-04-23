import { createHmac, timingSafeEqual } from "node:crypto";

/** คีย์ใน stores — ใช้ร่วมกับข้อมูลที่เคยเป็น LINE userId */
export function tgUserIdToStoreKey(telegramUserId: number): string {
  if (!Number.isFinite(telegramUserId) || telegramUserId <= 0) {
    throw new Error("telegram user id ไม่ถูกต้อง");
  }
  return `tg:${Math.floor(telegramUserId)}`;
}

/** `tg:123…` → chat_id สำหรับส่ง DM (ตัวเลขสตริง) — ไม่ใช่รูปแบบนี้ได้ null */
export function tgStoreKeyToTelegramDmChatId(userId: string): string | null {
  const m = userId.trim().match(/^tg:(\d{1,20})$/);
  return m ? m[1]! : null;
}

/** `tg:123` → `123` สำหรับส่ง DM (sendMessage chat_id) — ไม่ใช่รูปแบบนี้ → null */
export function tgStoreKeyToTelegramUserIdString(userId: string): string | null {
  const m = userId.trim().match(/^tg:(\d{1,20})$/);
  return m ? m[1]! : null;
}

export type TmaAuthResult =
  | { ok: true; userId: string; telegramUserId: number }
  | { ok: false; status: number; error: string };

const DEFAULT_MAX_AGE_SEC = 86400;

function botToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return t || null;
}

function maxAuthAgeSec(): number {
  const v = Number(process.env.TELEGRAM_TMA_AUTH_MAX_AGE_SEC);
  if (Number.isFinite(v) && v >= 60 && v <= 604800) return Math.floor(v);
  return DEFAULT_MAX_AGE_SEC;
}

/**
 * ตรวจ initData จาก Telegram.WebApp.initData ตาม
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
export function verifyTelegramInitData(initData: string): { telegramUserId: number } | null {
  const token = botToken();
  if (!token) return null;

  const trimmed = initData.trim();
  if (!trimmed) return null;

  const params = new URLSearchParams(trimmed);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;

  const entries = Array.from(params.entries()).filter(([k]) => k !== "hash");
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest();

  let hashBuf: Buffer;
  try {
    hashBuf = Buffer.from(hash, "hex");
  } catch {
    return null;
  }
  if (hashBuf.length !== computed.length) return null;
  if (!timingSafeEqual(computed, hashBuf)) return null;

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > maxAuthAgeSec()) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  let user: { id?: number };
  try {
    user = JSON.parse(userJson) as { id?: number };
  } catch {
    return null;
  }
  const id = user.id;
  if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return null;

  return { telegramUserId: id };
}

/**
 * Authorization: tma <initData>
 * หรือ Bearer tma <initData>
 */
export async function authenticateTmaRequest(authHeader: string | null): Promise<TmaAuthResult> {
  if (!botToken()) {
    return {
      ok: false,
      status: 503,
      error: "ตั้ง TELEGRAM_BOT_TOKEN ในเซิร์ฟเวอร์ก่อน (ใช้ยืนยัน Telegram Mini App)",
    };
  }

  if (!authHeader?.trim()) {
    return { ok: false, status: 401, error: "ต้องล็อกอิน Telegram (ส่ง initData)" };
  }

  let raw = authHeader.trim();
  if (raw.toLowerCase().startsWith("bearer ")) {
    raw = raw.slice(7).trim();
  }

  if (!raw.toLowerCase().startsWith("tma ")) {
    return { ok: false, status: 401, error: "ใช้ Authorization: tma <initData>" };
  }

  const initData = raw.slice(4).trim();
  if (!initData) {
    return { ok: false, status: 401, error: "initData ว่าง" };
  }

  const verified = verifyTelegramInitData(initData);
  if (!verified) {
    return { ok: false, status: 401, error: "initData ไม่ผ่านการยืนยันหรือหมดอายุ" };
  }

  return {
    ok: true,
    userId: tgUserIdToStoreKey(verified.telegramUserId),
    telegramUserId: verified.telegramUserId,
  };
}
