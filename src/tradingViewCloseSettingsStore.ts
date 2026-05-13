import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:trading_view_mexc_settings";
const filePath = join(process.cwd(), "data", "trading_view_mexc_settings.json");

export type SparkAutoTradeVolBandKey = "high" | "mid" | "low" | "unknown";

export type SparkAutoTradeVolBandPreset = {
  /** false = ปิดเล่น tier นี้เท่านั้น — ว่าง/true = เล่น (ถ้ามีข้อมูลครบมาร์จิ้นเลเวเรจตาม resolve) */
  enabledBand?: boolean;
  marginUsdt?: number;
  leverage?: number;
  tpPct?: number;
};

export type SparkAutoTradeDirection = "both" | "long_only" | "short_only";

/** โพซิชันที่สั่งเปิดเมื่อผ่านตัวกรอง Spike — 「ตาม Spike」ขึ้น→long / ลง→short */
export type SparkAutoTradeOrderSide = "follow_spark" | "fade_spark" | "long" | "short";

export type SparkAutoTradeByVol = Partial<Record<SparkAutoTradeVolBandKey, SparkAutoTradeVolBandPreset>>;

export type SnowballAutoTradeDirection = "both" | "long_only" | "short_only";

export type TradingViewMexcUserSettings = {
  mexcApiKey: string;
  mexcSecret: string;
  webhookToken: string;
  /** Optional label for UI */
  updatedAt: string;

  sparkAutoTradeEnabled?: boolean;
  sparkAutoTradeDirection?: SparkAutoTradeDirection;
  /** @deprecated อ่านเท่านั้น — จาก JSON เดิม; ภาพรวมใช้ sparkAutoTradeOrderSide (+ normalize จาก invert) */
  sparkAutoTradeInvertSide?: boolean;
  sparkAutoTradeOrderSide?: SparkAutoTradeOrderSide;
  /** default เมื่อ band ไม่ override */
  sparkAutoTradeMarginUsdt?: number;
  sparkAutoTradeLeverage?: number;
  /** เป้ากำไร % จากราคาประมาณการเข้า — 0 หรือไม่มี = ไม่ตั้ง TP บนคำสั่ง */
  sparkAutoTradeTpPct?: number;

  /** หลังเปิดจาก Spark สำเร็จ → ปิด position ครบประมาณ N ชม. (cron ~5 นาที) • ว่าง = ปิดฟีเจอร์ */
  sparkAutoTradeTimeStopHours?: number;

  sparkAutoTradeByVol?: SparkAutoTradeByVol;

  snowballAutoTradeEnabled?: boolean;
  snowballAutoTradeDirection?: SnowballAutoTradeDirection;
  snowballAutoTradeMarginUsdt?: number;
  snowballAutoTradeLeverage?: number;
  /** ถ้า ROI แตะ threshold ภายใน maxHours → ปิดทันที */
  snowballAutoTradeQuickTpEnabled?: boolean;
  snowballAutoTradeQuickTpRoiPct?: number;
  snowballAutoTradeQuickTpMaxHours?: number;
};

/** จากแถว DB — ฟิลด์ orderSide หรือ invert เดิม */
export function orderSideEffective(
  row: TradingViewMexcUserSettings | null | undefined
): SparkAutoTradeOrderSide {
  const o = row?.sparkAutoTradeOrderSide;
  if (o === "follow_spark" || o === "fade_spark" || o === "long" || o === "short") return o;
  if (row?.sparkAutoTradeInvertSide) return "fade_spark";
  return "follow_spark";
}

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

  /** ไม่กระทบฟิลด์ spark auto-trade (บันทึก MEXC/webhook เท่านั้น) */
  preserveSparkAutoTrade?: boolean;

  sparkAutoTradeEnabled?: boolean;
  sparkAutoTradeDirection?: SparkAutoTradeDirection;
  sparkAutoTradeOrderSide?: SparkAutoTradeOrderSide;
  /** null = ล้างค่า default margin */
  sparkAutoTradeMarginUsdt?: number | null;
  sparkAutoTradeLeverage?: number | null;
  sparkAutoTradeTpPct?: number | null;
  sparkAutoTradeTimeStopHours?: number | null;
  sparkAutoTradeByVol?: SparkAutoTradeByVol | null;

  snowballAutoTradeEnabled?: boolean;
  snowballAutoTradeDirection?: SnowballAutoTradeDirection;
  snowballAutoTradeMarginUsdt?: number | null;
  snowballAutoTradeLeverage?: number | null;
  snowballAutoTradeQuickTpEnabled?: boolean;
  snowballAutoTradeQuickTpRoiPct?: number | null;
  snowballAutoTradeQuickTpMaxHours?: number | null;
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

  const touchedSparkPatch =
    input.sparkAutoTradeEnabled !== undefined ||
    input.sparkAutoTradeDirection !== undefined ||
    input.sparkAutoTradeOrderSide !== undefined ||
    input.sparkAutoTradeMarginUsdt !== undefined ||
    input.sparkAutoTradeLeverage !== undefined ||
    input.sparkAutoTradeTpPct !== undefined ||
    input.sparkAutoTradeTimeStopHours !== undefined ||
    input.sparkAutoTradeByVol !== undefined;
  const preserveSpark = Boolean(input.preserveSparkAutoTrade) && !touchedSparkPatch;

  const touchedSnowballPatch =
    input.snowballAutoTradeEnabled !== undefined ||
    input.snowballAutoTradeDirection !== undefined ||
    input.snowballAutoTradeMarginUsdt !== undefined ||
    input.snowballAutoTradeLeverage !== undefined ||
    input.snowballAutoTradeQuickTpEnabled !== undefined ||
    input.snowballAutoTradeQuickTpRoiPct !== undefined ||
    input.snowballAutoTradeQuickTpMaxHours !== undefined;

  const mergedSparkDirection = preserveSpark
    ? prev?.sparkAutoTradeDirection ?? "both"
    : input.sparkAutoTradeDirection !== undefined
      ? input.sparkAutoTradeDirection
      : prev?.sparkAutoTradeDirection ?? "both";

  const mergedOrderSide: SparkAutoTradeOrderSide = preserveSpark
    ? orderSideEffective(prev)
    : input.sparkAutoTradeOrderSide !== undefined
      ? input.sparkAutoTradeOrderSide
      : orderSideEffective(prev);

  let mergedVol: SparkAutoTradeByVol | undefined;
  if (preserveSpark) mergedVol = prev?.sparkAutoTradeByVol;
  else if (input.sparkAutoTradeByVol !== undefined) {
    mergedVol = input.sparkAutoTradeByVol === null ? undefined : input.sparkAutoTradeByVol;
  } else {
    mergedVol = prev?.sparkAutoTradeByVol;
  }

  const row: TradingViewMexcUserSettings = {
    mexcApiKey,
    mexcSecret,
    webhookToken: token,
    updatedAt: new Date().toISOString(),

    sparkAutoTradeEnabled: preserveSpark
      ? prev?.sparkAutoTradeEnabled ?? false
      : input.sparkAutoTradeEnabled !== undefined
        ? input.sparkAutoTradeEnabled
        : prev?.sparkAutoTradeEnabled ?? false,

    sparkAutoTradeDirection: mergedSparkDirection,

    sparkAutoTradeInvertSide: preserveSpark ? prev?.sparkAutoTradeInvertSide : undefined,
    sparkAutoTradeOrderSide: mergedOrderSide,

    sparkAutoTradeMarginUsdt: preserveSpark
      ? prev?.sparkAutoTradeMarginUsdt
      : input.sparkAutoTradeMarginUsdt === null
        ? undefined
        : input.sparkAutoTradeMarginUsdt !== undefined
          ? input.sparkAutoTradeMarginUsdt
          : prev?.sparkAutoTradeMarginUsdt,

    sparkAutoTradeLeverage: preserveSpark
      ? prev?.sparkAutoTradeLeverage
      : input.sparkAutoTradeLeverage === null
        ? undefined
        : input.sparkAutoTradeLeverage !== undefined
          ? input.sparkAutoTradeLeverage
          : prev?.sparkAutoTradeLeverage,

    sparkAutoTradeTpPct: preserveSpark
      ? prev?.sparkAutoTradeTpPct
      : input.sparkAutoTradeTpPct === null
        ? undefined
        : input.sparkAutoTradeTpPct !== undefined
          ? input.sparkAutoTradeTpPct
          : prev?.sparkAutoTradeTpPct,

    sparkAutoTradeTimeStopHours: preserveSpark
      ? prev?.sparkAutoTradeTimeStopHours
      : input.sparkAutoTradeTimeStopHours === null
        ? undefined
        : input.sparkAutoTradeTimeStopHours !== undefined
          ? input.sparkAutoTradeTimeStopHours
          : prev?.sparkAutoTradeTimeStopHours,

    sparkAutoTradeByVol: mergedVol,

    snowballAutoTradeEnabled:
      input.snowballAutoTradeEnabled !== undefined
        ? input.snowballAutoTradeEnabled
        : prev?.snowballAutoTradeEnabled ?? false,

    snowballAutoTradeDirection:
      input.snowballAutoTradeDirection !== undefined
        ? input.snowballAutoTradeDirection
        : prev?.snowballAutoTradeDirection ?? "both",

    snowballAutoTradeMarginUsdt:
      input.snowballAutoTradeMarginUsdt === null
        ? undefined
        : input.snowballAutoTradeMarginUsdt !== undefined
          ? input.snowballAutoTradeMarginUsdt
          : prev?.snowballAutoTradeMarginUsdt,

    snowballAutoTradeLeverage:
      input.snowballAutoTradeLeverage === null
        ? undefined
        : input.snowballAutoTradeLeverage !== undefined
          ? input.snowballAutoTradeLeverage
          : prev?.snowballAutoTradeLeverage,

    snowballAutoTradeQuickTpEnabled:
      input.snowballAutoTradeQuickTpEnabled !== undefined
        ? input.snowballAutoTradeQuickTpEnabled
        : prev?.snowballAutoTradeQuickTpEnabled ?? false,

    snowballAutoTradeQuickTpRoiPct:
      input.snowballAutoTradeQuickTpRoiPct === null
        ? undefined
        : input.snowballAutoTradeQuickTpRoiPct !== undefined
          ? input.snowballAutoTradeQuickTpRoiPct
          : prev?.snowballAutoTradeQuickTpRoiPct,

    snowballAutoTradeQuickTpMaxHours:
      input.snowballAutoTradeQuickTpMaxHours === null
        ? undefined
        : input.snowballAutoTradeQuickTpMaxHours !== undefined
          ? input.snowballAutoTradeQuickTpMaxHours
          : prev?.snowballAutoTradeQuickTpMaxHours,
  };

  void touchedSnowballPatch;
  m[userId] = row;
  await saveMap(m);
  return row;
}

/** เฉพาะ server-side cron — map ครบมี secret */
export async function loadTradingViewMexcSettingsFullMap(): Promise<
  Record<string, TradingViewMexcUserSettings>
> {
  const m = await loadMap();
  return { ...m };
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
