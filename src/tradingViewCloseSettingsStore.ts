import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import type { ReversalAutoTradeEntryMode } from "../lib/reversalAutoTradeEntry.js";
import type { SnowballAutoTradeEntryMode } from "../lib/snowballAutoTradeEntry.js";

export type { ReversalAutoTradeEntryMode, SnowballAutoTradeEntryMode };

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

export type SnowballAutoTradeAlertSide = "long" | "bear";

export type SnowballAutoTradeGradeKey =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D"
  | "F";

/** ค่าใน map = ทิศที่เปิด · ไม่มี key = ปิดเกรดนั้น */
export type SnowballAutoTradeGradeRulesMap = Partial<
  Record<SnowballAutoTradeGradeKey, "long" | "short">
>;

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
  /** @deprecated ใช้ rulesLong/rulesBear — เก็บไว้ migrate */
  snowballAutoTradeDirection?: SnowballAutoTradeDirection;
  /** สัญญาณ Snowball LONG — เกรด matrix → long | short */
  snowballAutoTradeRulesLong?: SnowballAutoTradeGradeRulesMap;
  /** สัญญาณ Snowball BEAR (SUPER ฯลฯ) */
  snowballAutoTradeRulesBear?: SnowballAutoTradeGradeRulesMap;
  /** สัญญาณ LONG + Quality Signal (EMA4h > 15% · เขียว ≤ 3 วัน) → เปิด Long ทุกเกรด (ข้าม matrix) */
  snowballAutoTradeGreen2DaysLongAllGrades?: boolean;
  /** สัญญาณที่ตรง ✨ Quality Signal → Long */
  snowballAutoTradeQualitySignalLongEnabled?: boolean;
  /** @deprecated ใช้ snowballAutoTradeQualitySignalLongEnabled */
  snowballAutoTradeQualitySignalGateEnabled?: boolean;
  /** สัญญาณ LONG ที่ตรง ✨ Quality Short Signal → เปิด Short บน MEXC แทน Long */
  snowballAutoTradeQualityShortSignalShortEnabled?: boolean;
  /** วันอาทิตย์ (เวลาไทย) — Snowball ทุกสัญญาณ → Short */
  snowballAutoTradeSundayAllShortEnabled?: boolean;
  /**
   * จุดอ้างอิง auto-open (log / Quick TP fallback / Telegram) = EMA20 แท่ง 1h ปิดล่าสุด
   * — ยังเปิด market ที่ MEXC ทันที (ไม่รอราคาแตะ EMA)
   */
  snowballAutoTradeReferenceEma20_1hEnabled?: boolean;
  /** hybrid_ema = ราคา > EMA 1h → Market, ≤ EMA → Limit · market = Market ตลอด (default) */
  snowballAutoTradeEntryMode?: SnowballAutoTradeEntryMode;
  /** EMA period บน TF 1h สำหรับ hybrid entry (default 20) */
  snowballAutoTradeEntryEmaPeriod?: number;
  snowballAutoTradeMarginUsdt?: number;
  snowballAutoTradeLeverage?: number;
  /** @deprecated ใช้ TP/SL strategy — เก็บไว้สำหรับ active เก่า */
  snowballAutoTradeQuickTpEnabled?: boolean;
  snowballAutoTradeQuickTpRoiPct?: number;
  snowballAutoTradeQuickTpMaxHours?: number;
  /**
   * Snowball TP/SL (cron หลังเปิด Market) — เหมือน Reversal แต่รองรับ LONG และ SHORT
   * default: TP1 10% · partial 50% · TP2 25% · maxHold 48h
   */
  snowballAutoTradeTpSlEnabled?: boolean;
  snowballAutoTradeTp1PricePct?: number;
  snowballAutoTradeTp1PartialPct?: number;
  snowballAutoTradeTp2PricePct?: number;
  snowballAutoTradeMaxHoldHours?: number;
  /** ครบจังหวะ 1 แล้วยังแดง → ถือต่ออีก maxHoldHours ชม. */
  snowballAutoTradeHoldExtendIfRedEnabled?: boolean;
  /** ROI % ถึงค่านี้ → ตั้ง SL บังทุน (default 10) */
  snowballAutoTradeSlArmRoiPct?: number;
  /** SL ห่างจาก entry เป็น % ราคาสวน — LONG ลง / SHORT ขึ้น (0 = @entry) */
  snowballAutoTradeSlEntryOffsetPct?: number;

  /** แจ้งเตือน trailing % ของเหรียญใน open positions (cron ~5 นาที) */
  portfolioTrailingAlertEnabled?: boolean;
  portfolioTrailingStepPct?: number;

  /** Reversal auto-open Short บน MEXC — ทำงานหลัง Reversal alert ส่งสำเร็จ */
  reversalAutoTradeEnabled?: boolean;
  reversalAutoTradeMarginUsdt?: number;
  reversalAutoTradeLeverage?: number;

  /**
   * Reversal TP/SL strategy (ทำงานบน cron tick หลังเปิด Market):
   * - TP1 PricePct% drop → ปิด TP1 PartialPct% ของ holdVol + ตั้ง MEXC plan SL @ entry
   * - TP2 PricePct% drop → ปิดทั้งหมด + cancel SL plan
   * - ครบ MaxHoldHours ชม. → ปิดทั้งหมด (force) + cancel SL plan
   * default: TP1 10% · partial 50% · TP2 25% · maxHold 48h
   */
  reversalAutoTradeTpSlEnabled?: boolean;
  reversalAutoTradeTp1PricePct?: number;
  reversalAutoTradeTp1PartialPct?: number;
  reversalAutoTradeTp2PricePct?: number;
  reversalAutoTradeMaxHoldHours?: number;
  /** ครบจังหวะ 1 แล้วยังแดง → ถือต่ออีก maxHoldHours ชม. */
  reversalAutoTradeHoldExtendIfRedEnabled?: boolean;
  reversalAutoTradeSlArmRoiPct?: number;
  reversalAutoTradeSlEntryOffsetPct?: number;
  /** @deprecated ใช้ gateQualitySignal */
  reversalAutoTradeGateBodyWick80?: boolean;
  /** @deprecated ใช้ gateQualitySignal */
  reversalAutoTradeGateLenRank315?: boolean;
  /** Quality Signal: Short — classic/EMA4H band · Long 1H — EMA4H <−3% */
  reversalAutoTradeGateQualitySignal?: boolean;
  /** วันเสาร์ (เวลาไทย) — auto-open ทุกสัญญาณ Reversal (ข้าม Quality Signal gate) */
  reversalAutoTradeSaturdayAllSignalsEnabled?: boolean;
  /** สัญญาณ Reversal Long → เปิด SHORT บน MEXC (fade) */
  reversalAutoTradeLongSignalShortEnabled?: boolean;
  /** Long → SHORT: ปรับ leverage ตาม ATR%14D (ดู REVERSAL_LONG_DYNAMIC_LEVERAGE_CRITERIA_TH) */
  reversalAutoTradeLongDynamicLeverageEnabled?: boolean;
  /** @deprecated ใช้ shortEntry — เก็บ sync กับ short สำหรับ client เก่า */
  reversalAutoTradeEntryMode?: ReversalAutoTradeEntryMode;
  /** @deprecated ใช้ shortEntry */
  reversalAutoTradeEntryEmaPeriod?: number;
  /** hybrid_ema = ราคา > EMA → Market, ≤ EMA → Limit · market = Market ตลอด */
  reversalAutoTradeShortEntryMode?: ReversalAutoTradeEntryMode;
  reversalAutoTradeShortEntryEmaPeriod?: number;
  reversalAutoTradeLongEntryMode?: ReversalAutoTradeEntryMode;
  reversalAutoTradeLongEntryEmaPeriod?: number;
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
  snowballAutoTradeRulesLong?: SnowballAutoTradeGradeRulesMap | null;
  snowballAutoTradeRulesBear?: SnowballAutoTradeGradeRulesMap | null;
  snowballAutoTradeGreen2DaysLongAllGrades?: boolean;
  snowballAutoTradeQualitySignalLongEnabled?: boolean;
  snowballAutoTradeQualityShortSignalShortEnabled?: boolean;
  snowballAutoTradeSundayAllShortEnabled?: boolean;
  snowballAutoTradeReferenceEma20_1hEnabled?: boolean;
  snowballAutoTradeEntryMode?: SnowballAutoTradeEntryMode | null;
  snowballAutoTradeEntryEmaPeriod?: number | null;
  snowballAutoTradeMarginUsdt?: number | null;
  snowballAutoTradeLeverage?: number | null;
  snowballAutoTradeQuickTpEnabled?: boolean;
  snowballAutoTradeQuickTpRoiPct?: number | null;
  snowballAutoTradeQuickTpMaxHours?: number | null;
  snowballAutoTradeTpSlEnabled?: boolean;
  snowballAutoTradeTp1PricePct?: number | null;
  snowballAutoTradeTp1PartialPct?: number | null;
  snowballAutoTradeTp2PricePct?: number | null;
  snowballAutoTradeMaxHoldHours?: number | null;
  snowballAutoTradeHoldExtendIfRedEnabled?: boolean;
  snowballAutoTradeSlArmRoiPct?: number | null;
  snowballAutoTradeSlEntryOffsetPct?: number | null;

  portfolioTrailingAlertEnabled?: boolean;
  portfolioTrailingStepPct?: number | null;

  reversalAutoTradeEnabled?: boolean;
  reversalAutoTradeMarginUsdt?: number | null;
  reversalAutoTradeLeverage?: number | null;
  reversalAutoTradeTpSlEnabled?: boolean;
  reversalAutoTradeTp1PricePct?: number | null;
  reversalAutoTradeTp1PartialPct?: number | null;
  reversalAutoTradeTp2PricePct?: number | null;
  reversalAutoTradeMaxHoldHours?: number | null;
  reversalAutoTradeHoldExtendIfRedEnabled?: boolean;
  reversalAutoTradeSlArmRoiPct?: number | null;
  reversalAutoTradeSlEntryOffsetPct?: number | null;
  reversalAutoTradeGateBodyWick80?: boolean;
  reversalAutoTradeGateLenRank315?: boolean;
  reversalAutoTradeGateQualitySignal?: boolean;
  reversalAutoTradeSaturdayAllSignalsEnabled?: boolean;
  reversalAutoTradeLongSignalShortEnabled?: boolean;
  reversalAutoTradeLongDynamicLeverageEnabled?: boolean;
  reversalAutoTradeEntryMode?: ReversalAutoTradeEntryMode | null;
  reversalAutoTradeEntryEmaPeriod?: number | null;
  reversalAutoTradeShortEntryMode?: ReversalAutoTradeEntryMode | null;
  reversalAutoTradeShortEntryEmaPeriod?: number | null;
  reversalAutoTradeLongEntryMode?: ReversalAutoTradeEntryMode | null;
  reversalAutoTradeLongEntryEmaPeriod?: number | null;
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
    input.snowballAutoTradeRulesLong !== undefined ||
    input.snowballAutoTradeRulesBear !== undefined ||
    input.snowballAutoTradeGreen2DaysLongAllGrades !== undefined ||
    input.snowballAutoTradeQualitySignalLongEnabled !== undefined ||
    input.snowballAutoTradeQualityShortSignalShortEnabled !== undefined ||
    input.snowballAutoTradeSundayAllShortEnabled !== undefined ||
    input.snowballAutoTradeReferenceEma20_1hEnabled !== undefined ||
    input.snowballAutoTradeEntryMode !== undefined ||
    input.snowballAutoTradeEntryEmaPeriod !== undefined ||
    input.snowballAutoTradeMarginUsdt !== undefined ||
    input.snowballAutoTradeLeverage !== undefined ||
    input.snowballAutoTradeQuickTpEnabled !== undefined ||
    input.snowballAutoTradeQuickTpRoiPct !== undefined ||
    input.snowballAutoTradeQuickTpMaxHours !== undefined ||
    input.snowballAutoTradeTpSlEnabled !== undefined ||
    input.snowballAutoTradeTp1PricePct !== undefined ||
    input.snowballAutoTradeTp1PartialPct !== undefined ||
    input.snowballAutoTradeTp2PricePct !== undefined ||
    input.snowballAutoTradeMaxHoldHours !== undefined ||
    input.snowballAutoTradeHoldExtendIfRedEnabled !== undefined ||
    input.snowballAutoTradeSlArmRoiPct !== undefined ||
    input.snowballAutoTradeSlEntryOffsetPct !== undefined;

  const touchedPortfolioTrailingPatch =
    input.portfolioTrailingAlertEnabled !== undefined ||
    input.portfolioTrailingStepPct !== undefined;

  const touchedReversalPatch =
    input.reversalAutoTradeEnabled !== undefined ||
    input.reversalAutoTradeMarginUsdt !== undefined ||
    input.reversalAutoTradeLeverage !== undefined ||
    input.reversalAutoTradeTpSlEnabled !== undefined ||
    input.reversalAutoTradeTp1PricePct !== undefined ||
    input.reversalAutoTradeTp1PartialPct !== undefined ||
    input.reversalAutoTradeTp2PricePct !== undefined ||
    input.reversalAutoTradeMaxHoldHours !== undefined ||
    input.reversalAutoTradeHoldExtendIfRedEnabled !== undefined ||
    input.reversalAutoTradeSlArmRoiPct !== undefined ||
    input.reversalAutoTradeSlEntryOffsetPct !== undefined ||
    input.reversalAutoTradeGateBodyWick80 !== undefined ||
    input.reversalAutoTradeGateLenRank315 !== undefined ||
    input.reversalAutoTradeGateQualitySignal !== undefined ||
    input.reversalAutoTradeSaturdayAllSignalsEnabled !== undefined ||
    input.reversalAutoTradeLongSignalShortEnabled !== undefined ||
    input.reversalAutoTradeLongDynamicLeverageEnabled !== undefined ||
    input.reversalAutoTradeEntryMode !== undefined ||
    input.reversalAutoTradeEntryEmaPeriod !== undefined ||
    input.reversalAutoTradeShortEntryMode !== undefined ||
    input.reversalAutoTradeShortEntryEmaPeriod !== undefined ||
    input.reversalAutoTradeLongEntryMode !== undefined ||
    input.reversalAutoTradeLongEntryEmaPeriod !== undefined;

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

    snowballAutoTradeRulesLong:
      input.snowballAutoTradeRulesLong === null
        ? undefined
        : input.snowballAutoTradeRulesLong !== undefined
          ? input.snowballAutoTradeRulesLong
          : prev?.snowballAutoTradeRulesLong,

    snowballAutoTradeRulesBear:
      input.snowballAutoTradeRulesBear === null
        ? undefined
        : input.snowballAutoTradeRulesBear !== undefined
          ? input.snowballAutoTradeRulesBear
          : prev?.snowballAutoTradeRulesBear,

    snowballAutoTradeGreen2DaysLongAllGrades:
      input.snowballAutoTradeGreen2DaysLongAllGrades !== undefined
        ? input.snowballAutoTradeGreen2DaysLongAllGrades
        : prev?.snowballAutoTradeGreen2DaysLongAllGrades ?? false,

    snowballAutoTradeQualitySignalLongEnabled:
      input.snowballAutoTradeQualitySignalLongEnabled !== undefined
        ? input.snowballAutoTradeQualitySignalLongEnabled
        : prev?.snowballAutoTradeQualitySignalLongEnabled ??
          prev?.snowballAutoTradeQualitySignalGateEnabled ??
          false,

    snowballAutoTradeQualityShortSignalShortEnabled:
      input.snowballAutoTradeQualityShortSignalShortEnabled !== undefined
        ? input.snowballAutoTradeQualityShortSignalShortEnabled
        : prev?.snowballAutoTradeQualityShortSignalShortEnabled ?? false,

    snowballAutoTradeSundayAllShortEnabled:
      input.snowballAutoTradeSundayAllShortEnabled !== undefined
        ? input.snowballAutoTradeSundayAllShortEnabled
        : prev?.snowballAutoTradeSundayAllShortEnabled ?? false,

    snowballAutoTradeReferenceEma20_1hEnabled:
      input.snowballAutoTradeReferenceEma20_1hEnabled !== undefined
        ? input.snowballAutoTradeReferenceEma20_1hEnabled
        : prev?.snowballAutoTradeReferenceEma20_1hEnabled ?? false,

    snowballAutoTradeEntryMode:
      input.snowballAutoTradeEntryMode === null
        ? undefined
        : input.snowballAutoTradeEntryMode !== undefined
          ? input.snowballAutoTradeEntryMode
          : prev?.snowballAutoTradeEntryMode ?? "market",

    snowballAutoTradeEntryEmaPeriod:
      input.snowballAutoTradeEntryEmaPeriod === null
        ? undefined
        : input.snowballAutoTradeEntryEmaPeriod !== undefined
          ? input.snowballAutoTradeEntryEmaPeriod
          : prev?.snowballAutoTradeEntryEmaPeriod ?? 20,

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

    snowballAutoTradeTpSlEnabled:
      input.snowballAutoTradeTpSlEnabled !== undefined
        ? input.snowballAutoTradeTpSlEnabled
        : prev?.snowballAutoTradeTpSlEnabled ?? true,

    snowballAutoTradeTp1PricePct:
      input.snowballAutoTradeTp1PricePct === null
        ? undefined
        : input.snowballAutoTradeTp1PricePct !== undefined
          ? input.snowballAutoTradeTp1PricePct
          : prev?.snowballAutoTradeTp1PricePct,

    snowballAutoTradeTp1PartialPct:
      input.snowballAutoTradeTp1PartialPct === null
        ? undefined
        : input.snowballAutoTradeTp1PartialPct !== undefined
          ? input.snowballAutoTradeTp1PartialPct
          : prev?.snowballAutoTradeTp1PartialPct,

    snowballAutoTradeTp2PricePct:
      input.snowballAutoTradeTp2PricePct === null
        ? undefined
        : input.snowballAutoTradeTp2PricePct !== undefined
          ? input.snowballAutoTradeTp2PricePct
          : prev?.snowballAutoTradeTp2PricePct,

    snowballAutoTradeMaxHoldHours:
      input.snowballAutoTradeMaxHoldHours === null
        ? undefined
        : input.snowballAutoTradeMaxHoldHours !== undefined
          ? input.snowballAutoTradeMaxHoldHours
          : prev?.snowballAutoTradeMaxHoldHours,

    snowballAutoTradeHoldExtendIfRedEnabled:
      input.snowballAutoTradeHoldExtendIfRedEnabled !== undefined
        ? input.snowballAutoTradeHoldExtendIfRedEnabled
        : prev?.snowballAutoTradeHoldExtendIfRedEnabled ?? false,

    snowballAutoTradeSlArmRoiPct:
      input.snowballAutoTradeSlArmRoiPct === null
        ? undefined
        : input.snowballAutoTradeSlArmRoiPct !== undefined
          ? input.snowballAutoTradeSlArmRoiPct
          : prev?.snowballAutoTradeSlArmRoiPct,

    snowballAutoTradeSlEntryOffsetPct:
      input.snowballAutoTradeSlEntryOffsetPct === null
        ? undefined
        : input.snowballAutoTradeSlEntryOffsetPct !== undefined
          ? input.snowballAutoTradeSlEntryOffsetPct
          : prev?.snowballAutoTradeSlEntryOffsetPct,

    portfolioTrailingAlertEnabled:
      input.portfolioTrailingAlertEnabled !== undefined
        ? input.portfolioTrailingAlertEnabled
        : prev?.portfolioTrailingAlertEnabled ?? false,

    portfolioTrailingStepPct:
      input.portfolioTrailingStepPct === null
        ? undefined
        : input.portfolioTrailingStepPct !== undefined
          ? input.portfolioTrailingStepPct
          : prev?.portfolioTrailingStepPct,

    reversalAutoTradeEnabled:
      input.reversalAutoTradeEnabled !== undefined
        ? input.reversalAutoTradeEnabled
        : prev?.reversalAutoTradeEnabled ?? false,

    reversalAutoTradeMarginUsdt:
      input.reversalAutoTradeMarginUsdt === null
        ? undefined
        : input.reversalAutoTradeMarginUsdt !== undefined
          ? input.reversalAutoTradeMarginUsdt
          : prev?.reversalAutoTradeMarginUsdt,

    reversalAutoTradeLeverage:
      input.reversalAutoTradeLeverage === null
        ? undefined
        : input.reversalAutoTradeLeverage !== undefined
          ? input.reversalAutoTradeLeverage
          : prev?.reversalAutoTradeLeverage,

    reversalAutoTradeTpSlEnabled:
      input.reversalAutoTradeTpSlEnabled !== undefined
        ? input.reversalAutoTradeTpSlEnabled
        : prev?.reversalAutoTradeTpSlEnabled ?? true,

    reversalAutoTradeTp1PricePct:
      input.reversalAutoTradeTp1PricePct === null
        ? undefined
        : input.reversalAutoTradeTp1PricePct !== undefined
          ? input.reversalAutoTradeTp1PricePct
          : prev?.reversalAutoTradeTp1PricePct,

    reversalAutoTradeTp1PartialPct:
      input.reversalAutoTradeTp1PartialPct === null
        ? undefined
        : input.reversalAutoTradeTp1PartialPct !== undefined
          ? input.reversalAutoTradeTp1PartialPct
          : prev?.reversalAutoTradeTp1PartialPct,

    reversalAutoTradeTp2PricePct:
      input.reversalAutoTradeTp2PricePct === null
        ? undefined
        : input.reversalAutoTradeTp2PricePct !== undefined
          ? input.reversalAutoTradeTp2PricePct
          : prev?.reversalAutoTradeTp2PricePct,

    reversalAutoTradeMaxHoldHours:
      input.reversalAutoTradeMaxHoldHours === null
        ? undefined
        : input.reversalAutoTradeMaxHoldHours !== undefined
          ? input.reversalAutoTradeMaxHoldHours
          : prev?.reversalAutoTradeMaxHoldHours,

    reversalAutoTradeHoldExtendIfRedEnabled:
      input.reversalAutoTradeHoldExtendIfRedEnabled !== undefined
        ? input.reversalAutoTradeHoldExtendIfRedEnabled
        : prev?.reversalAutoTradeHoldExtendIfRedEnabled ?? false,

    reversalAutoTradeSlArmRoiPct:
      input.reversalAutoTradeSlArmRoiPct === null
        ? undefined
        : input.reversalAutoTradeSlArmRoiPct !== undefined
          ? input.reversalAutoTradeSlArmRoiPct
          : prev?.reversalAutoTradeSlArmRoiPct,

    reversalAutoTradeSlEntryOffsetPct:
      input.reversalAutoTradeSlEntryOffsetPct === null
        ? undefined
        : input.reversalAutoTradeSlEntryOffsetPct !== undefined
          ? input.reversalAutoTradeSlEntryOffsetPct
          : prev?.reversalAutoTradeSlEntryOffsetPct,

    reversalAutoTradeGateBodyWick80:
      input.reversalAutoTradeGateBodyWick80 !== undefined
        ? input.reversalAutoTradeGateBodyWick80
        : prev?.reversalAutoTradeGateBodyWick80 ?? true,

    reversalAutoTradeGateLenRank315:
      input.reversalAutoTradeGateLenRank315 !== undefined
        ? input.reversalAutoTradeGateLenRank315
        : prev?.reversalAutoTradeGateLenRank315 ?? true,

    reversalAutoTradeGateQualitySignal:
      input.reversalAutoTradeGateQualitySignal !== undefined
        ? input.reversalAutoTradeGateQualitySignal
        : prev?.reversalAutoTradeGateQualitySignal ??
          (prev?.reversalAutoTradeGateBodyWick80 !== false ||
            prev?.reversalAutoTradeGateLenRank315 !== false),

    reversalAutoTradeSaturdayAllSignalsEnabled:
      input.reversalAutoTradeSaturdayAllSignalsEnabled !== undefined
        ? input.reversalAutoTradeSaturdayAllSignalsEnabled
        : prev?.reversalAutoTradeSaturdayAllSignalsEnabled ?? false,

    reversalAutoTradeLongSignalShortEnabled:
      input.reversalAutoTradeLongSignalShortEnabled !== undefined
        ? input.reversalAutoTradeLongSignalShortEnabled
        : prev?.reversalAutoTradeLongSignalShortEnabled ?? false,

    reversalAutoTradeLongDynamicLeverageEnabled:
      input.reversalAutoTradeLongDynamicLeverageEnabled !== undefined
        ? input.reversalAutoTradeLongDynamicLeverageEnabled
        : prev?.reversalAutoTradeLongDynamicLeverageEnabled ?? false,

    reversalAutoTradeShortEntryMode:
      input.reversalAutoTradeShortEntryMode === null
        ? undefined
        : input.reversalAutoTradeShortEntryMode !== undefined
          ? input.reversalAutoTradeShortEntryMode
          : input.reversalAutoTradeEntryMode === null
            ? undefined
            : input.reversalAutoTradeEntryMode !== undefined
              ? input.reversalAutoTradeEntryMode
              : prev?.reversalAutoTradeShortEntryMode ??
                prev?.reversalAutoTradeEntryMode ??
                "hybrid_ema",

    reversalAutoTradeShortEntryEmaPeriod:
      input.reversalAutoTradeShortEntryEmaPeriod === null
        ? undefined
        : input.reversalAutoTradeShortEntryEmaPeriod !== undefined
          ? input.reversalAutoTradeShortEntryEmaPeriod
          : input.reversalAutoTradeEntryEmaPeriod === null
            ? undefined
            : input.reversalAutoTradeEntryEmaPeriod !== undefined
              ? input.reversalAutoTradeEntryEmaPeriod
              : prev?.reversalAutoTradeShortEntryEmaPeriod ??
                prev?.reversalAutoTradeEntryEmaPeriod ??
                20,

    reversalAutoTradeLongEntryMode:
      input.reversalAutoTradeLongEntryMode === null
        ? undefined
        : input.reversalAutoTradeLongEntryMode !== undefined
          ? input.reversalAutoTradeLongEntryMode
          : prev?.reversalAutoTradeLongEntryMode ??
            prev?.reversalAutoTradeEntryMode ??
            "hybrid_ema",

    reversalAutoTradeLongEntryEmaPeriod:
      input.reversalAutoTradeLongEntryEmaPeriod === null
        ? undefined
        : input.reversalAutoTradeLongEntryEmaPeriod !== undefined
          ? input.reversalAutoTradeLongEntryEmaPeriod
          : prev?.reversalAutoTradeLongEntryEmaPeriod ??
            prev?.reversalAutoTradeEntryEmaPeriod ??
            20,

    reversalAutoTradeEntryMode:
      input.reversalAutoTradeShortEntryMode === null
        ? input.reversalAutoTradeEntryMode === null
          ? undefined
          : input.reversalAutoTradeEntryMode !== undefined
            ? input.reversalAutoTradeEntryMode
            : prev?.reversalAutoTradeEntryMode ?? "hybrid_ema"
        : input.reversalAutoTradeShortEntryMode !== undefined
          ? input.reversalAutoTradeShortEntryMode
          : input.reversalAutoTradeEntryMode === null
            ? undefined
            : input.reversalAutoTradeEntryMode !== undefined
              ? input.reversalAutoTradeEntryMode
              : prev?.reversalAutoTradeShortEntryMode ??
                prev?.reversalAutoTradeEntryMode ??
                "hybrid_ema",

    reversalAutoTradeEntryEmaPeriod:
      input.reversalAutoTradeShortEntryEmaPeriod === null
        ? input.reversalAutoTradeEntryEmaPeriod === null
          ? undefined
          : input.reversalAutoTradeEntryEmaPeriod !== undefined
            ? input.reversalAutoTradeEntryEmaPeriod
            : prev?.reversalAutoTradeEntryEmaPeriod ?? 20
        : input.reversalAutoTradeShortEntryEmaPeriod !== undefined
          ? input.reversalAutoTradeShortEntryEmaPeriod
          : input.reversalAutoTradeEntryEmaPeriod === null
            ? undefined
            : input.reversalAutoTradeEntryEmaPeriod !== undefined
              ? input.reversalAutoTradeEntryEmaPeriod
              : prev?.reversalAutoTradeShortEntryEmaPeriod ??
                prev?.reversalAutoTradeEntryEmaPeriod ??
                20,
  };

  void touchedSnowballPatch;
  void touchedPortfolioTrailingPatch;
  void touchedReversalPatch;
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
