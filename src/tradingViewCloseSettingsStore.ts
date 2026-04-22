import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:trading_view_mexc_settings";
const filePath = join(process.cwd(), "data", "trading_view_mexc_settings.json");

export type TradingViewMexcUserSettings = {
  mexcApiKey: string;
  mexcSecret: string;
  webhookToken: string;
  /** Optional label for UI */
  updatedAt: string;
};

type SettingsMap = Record<string, TradingViewMexcUserSettings>;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ trading view MEXC settings"
    );
  }
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}", "utf-8");
  }
}

async function loadMap(): Promise<SettingsMap> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<SettingsMap>(KV_KEY);
      if (data && typeof data === "object" && !Array.isArray(data)) return data;
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[tradingViewCloseSettingsStore] cloud get failed", e);
      throw new Error(`อ่าน trading_view_mexc_settings ไม่สำเร็จ (${hint})`);
    }
    return {};
  }
  if (isVercel()) return {};
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as SettingsMap;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveMap(map: SettingsMap): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, map);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(map, null, 2), "utf-8");
}

function newWebhookToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * คืน payload สำหรับ GET/POST client — ไม่ log ค่า secret
 */
export async function getTradingViewMexcSettings(
  userId: string
): Promise<TradingViewMexcUserSettings | null> {
  const m = await loadMap();
  const row = m[userId];
  if (!row?.webhookToken) return null;
  return { ...row };
}

/** อ่านแถวตาม userId ถ้ามี (ไม่บังคับ webhookToken) — ใช้เช็คสถานะ MEXC API */
export async function getTradingViewMexcRowOptional(
  userId: string
): Promise<TradingViewMexcUserSettings | null> {
  const m = await loadMap();
  const row = m[userId];
  return row ? { ...row } : null;
}

/** สร้างแถว+webhookToken ตั้งแต่ยังไม่เคยบันทึก (ไม่รวม MEXC key) */
export async function ensureTradingViewMexcUserRow(
  userId: string
): Promise<TradingViewMexcUserSettings> {
  const e = await getTradingViewMexcSettings(userId);
  if (e) return e;
  return saveTradingViewMexcSettings(userId, { mexcApiKey: "", mexcSecret: "" });
}

export type SaveTradingViewMexcInput = {
  mexcApiKey: string;
  mexcSecret: string;
  /** true = ลบ key/secret เดิมถ้า chain มาว่าง ไม่ update */
  clearMexcCreds?: boolean;
  /** true = สร้าง webhook token ใหม่ */
  rotateWebhookToken?: boolean;
};

/**
 * บันทึก; ไม่ update key/secret หาก string ว่าง (เก็บของเดิม) ยกเว้น clearMexcCreds
 */
export async function saveTradingViewMexcSettings(
  userId: string,
  input: SaveTradingViewMexcInput
): Promise<TradingViewMexcUserSettings> {
  const m = await loadMap();
  const prev = m[userId];
  const token =
    input.rotateWebhookToken || !prev?.webhookToken ? newWebhookToken() : prev.webhookToken;

  let mexcApiKey = prev?.mexcApiKey ?? "";
  let mexcSecret = prev?.mexcSecret ?? "";
  if (input.clearMexcCreds) {
    mexcApiKey = "";
    mexcSecret = "";
  } else {
    const k = input.mexcApiKey?.trim() ?? "";
    const s = input.mexcSecret?.trim() ?? "";
    if (k) mexcApiKey = k;
    if (s) mexcSecret = s;
  }

  const row: TradingViewMexcUserSettings = {
    mexcApiKey,
    mexcSecret,
    webhookToken: token,
    updatedAt: new Date().toISOString(),
  };
  m[userId] = row;
  await saveMap(m);
  return row;
}

/**
 * ตรวจ token จาก Webhook กับที่เก็บ
 */
export async function verifyUserWebhookToken(
  userId: string,
  token: string
): Promise<boolean> {
  if (!userId || !token) return false;
  const expected = (await getTradingViewMexcSettings(userId))?.webhookToken;
  if (!expected) return false;
  return hashEquals(token, expected);
}

function hashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    if (a === b) return true;
    return false;
  }
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
