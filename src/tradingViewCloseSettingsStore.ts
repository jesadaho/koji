import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import type { ReversalStatsPlaySide } from "../lib/reversalMatrixFilters.js";
import type { ReversalAutoTradeEntryMode } from "../lib/reversalAutoTradeEntry.js";
import type { SnowballAutoTradeEntryMode } from "../lib/snowballAutoTradeEntry.js";
import { snowballAutoTradeGradeKeyFromMigratedRawKey } from "./snowballAutoTradeGradeRules";

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

export type SnowballAutoTradeGradeKey = "S" | "A" | "B" | "C" | "D" | "F";

/** ค่าใน map = ทิศที่เปิด · ไม่มี key = ปิดเกรดนั้น */
export type SnowballAutoTradeGradeRulesMap = Partial<
  Record<SnowballAutoTradeGradeKey, "long" | "short">
>;

function migrateSnowballAutoTradeGradeRulesMap(
  rules: SnowballAutoTradeGradeRulesMap | undefined,
): SnowballAutoTradeGradeRulesMap | undefined {
  if (!rules || typeof rules !== "object") return rules;
  const out: SnowballAutoTradeGradeRulesMap = {};
  for (const [rawKey, side] of Object.entries(rules)) {
    if (side !== "long" && side !== "short") continue;
    const key = snowballAutoTradeGradeKeyFromMigratedRawKey(rawKey);
    if (!key) continue;
    if (out[key] == null) out[key] = side;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function migrateTradingViewMexcUserSettings(
  row: TradingViewMexcUserSettings,
): TradingViewMexcUserSettings {
  const rulesLong = migrateSnowballAutoTradeGradeRulesMap(row.snowballAutoTradeRulesLong);
  const rulesBear = migrateSnowballAutoTradeGradeRulesMap(row.snowballAutoTradeRulesBear);
  if (rulesLong === row.snowballAutoTradeRulesLong && rulesBear === row.snowballAutoTradeRulesBear) {
    return row;
  }
  return {
    ...row,
    ...(rulesLong !== row.snowballAutoTradeRulesLong ? { snowballAutoTradeRulesLong: rulesLong } : {}),
    ...(rulesBear !== row.snowballAutoTradeRulesBear ? { snowballAutoTradeRulesBear: rulesBear } : {}),
  };
}

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
  /** สัญญาณ LONG + Quality Signal (EMA4h > 10% · Funding > −0.10%) → เปิด Long ทุกเกรด (ข้าม matrix) */
  snowballAutoTradeGreen2DaysLongAllGrades?: boolean;
  /** เกรดที่เปิด ✨ Quality Signal → Long — ว่าง = ปิด */
  snowballAutoTradeQualitySignalLongGrades?: SnowballAutoTradeGradeKey[];
  /** สัญญาณที่ตรง ✨ Quality Signal → Long — sync จาก grades (legacy boolean) */
  snowballAutoTradeQualitySignalLongEnabled?: boolean;
  /** @deprecated ใช้ snowballAutoTradeQualitySignalLongEnabled */
  snowballAutoTradeQualitySignalGateEnabled?: boolean;
  /** @deprecated ใช้ snowballAutoTradeGradeFFadeShortEnabled */
  snowballAutoTradeQualityShortSignalShortEnabled?: boolean;
  /** Snowball LONG + เกรด F → fade SHORT */
  snowballAutoTradeGradeFFadeShortEnabled?: boolean;
  /** Snowball SHORT (BEAR) → เปิด Short */
  snowballAutoTradeShortSignalShortEnabled?: boolean;
  /** วันอาทิตย์ (เวลาไทย) — Snowball ทุกสัญญาณ → Short */
  snowballAutoTradeSundayAllShortEnabled?: boolean;
  /** Snowball LONG — ปรับ margin ตาม BTC slope + PSAR 4h คู่สัญญาณ (Perfect x3 / Caution 1x / Penalty 0.5x) */
  snowballAutoTradeLongDynamicBoostEnabled?: boolean;
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
  /** ครบจังหวะ 1 แล้วยังแดง → ถือต่ออีก N ชม. (default = จังหวะ 1) */
  snowballAutoTradeHoldExtendIfRedEnabled?: boolean;
  snowballAutoTradeHoldExtendRedHours?: number;
  /** ROI % ถึงค่านี้ → ตั้ง SL บังทุน (default 10) */
  snowballAutoTradeSlArmRoiPct?: number;
  /** SL ห่างจาก entry เป็น % ราคาสวน — LONG ลง / SHORT ขึ้น (0 = @entry) */
  snowballAutoTradeSlEntryOffsetPct?: number;
  /** ครบ 24 ชม. หลังเปิดแล้วยังเขียว → ตั้ง SL @entry (default เปิด) */
  snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled?: boolean;
  /**
   * ✨ Quality Short Signal → Short — TP/SL แยกจากแผน Snowball หลัก (default เหมือนกัน)
   */
  snowballAutoTradeQualityShortTpSlEnabled?: boolean;
  snowballAutoTradeQualityShortTp1PricePct?: number;
  snowballAutoTradeQualityShortTp1PartialPct?: number;
  snowballAutoTradeQualityShortTp2PricePct?: number;
  snowballAutoTradeQualityShortMaxHoldHours?: number;
  snowballAutoTradeQualityShortHoldExtendIfRedEnabled?: boolean;
  snowballAutoTradeQualityShortHoldExtendRedHours?: number;
  snowballAutoTradeQualityShortSlArmRoiPct?: number;
  snowballAutoTradeQualityShortSlEntryOffsetPct?: number;
  snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled?: boolean;

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
  /** ครบจังหวะ 1 แล้วยังแดง → ถือต่ออีก N ชม. (default = จังหวะ 1) */
  reversalAutoTradeHoldExtendIfRedEnabled?: boolean;
  reversalAutoTradeHoldExtendRedHours?: number;
  reversalAutoTradeSlArmRoiPct?: number;
  reversalAutoTradeSlEntryOffsetPct?: number;
  reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled?: boolean;
  /** กฎปิด @12h: ROI<0 + EMA4H>0 — default เปิด */
  reversalAutoTradeTp12hCloseEnabled?: boolean;
  /** Long (Market LONG / ทิศแนะนำ 🟢) — ว่าง = fallback ค่า Short */
  reversalAutoTradeLongTpSlEnabled?: boolean;
  reversalAutoTradeLongTp1PricePct?: number;
  reversalAutoTradeLongTp1PartialPct?: number;
  reversalAutoTradeLongTp2PricePct?: number;
  reversalAutoTradeLongMaxHoldHours?: number;
  reversalAutoTradeLongHoldExtendIfRedEnabled?: boolean;
  reversalAutoTradeLongHoldExtendRedHours?: number;
  reversalAutoTradeLongSlArmRoiPct?: number;
  reversalAutoTradeLongSlEntryOffsetPct?: number;
  reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled?: boolean;
  reversalAutoTradeLongTp12hCloseEnabled?: boolean;
  /** ทิศที่เล่นในตาราง Reversal Short 1H — @deprecated ใช้ playShort/playLong */
  reversalStatsPlaySide?: ReversalStatsPlaySide;
  /** เล่น Short ตามสัญญาณ — default เปิด */
  reversalStatsPlayShortEnabled?: boolean;
  /** เล่น Long ทิศแนะนำ 🟢 — default ปิด */
  reversalStatsPlayLongEnabled?: boolean;
  /** @deprecated ใช้ gateQualitySignal */
  reversalAutoTradeGateBodyWick80?: boolean;
  /** @deprecated ใช้ gateQualitySignal */
  reversalAutoTradeGateLenRank315?: boolean;
  /** Quality Signal: Short — classic/EMA4H band · Long 1H — BTC∠ / ATR%14D */
  reversalAutoTradeGateQualitySignal?: boolean;
  /** วันเสาร์ (เวลาไทย) — auto-open ทุกสัญญาณ Reversal (ข้าม Quality Signal gate) */
  reversalAutoTradeSaturdayAllSignalsEnabled?: boolean;
  /** สัญญาณ Reversal Long → เปิด SHORT บน MEXC (fade) */
  reversalAutoTradeLongSignalShortEnabled?: boolean;
  /** Long → SHORT: ปรับ leverage ตาม ATR%14D (ดู REVERSAL_LONG_DYNAMIC_LEVERAGE_CRITERIA_TH) */
  reversalAutoTradeLongDynamicLeverageEnabled?: boolean;
  /** สัญญาณ Short → SHORT: ปรับ leverage ตาม Trend Gain + EMA20∠4h */
  reversalAutoTradeShortDynamicLeverageEnabled?: boolean;
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
  snowballAutoTradeQualitySignalLongGrades?: SnowballAutoTradeGradeKey[] | null;
  snowballAutoTradeQualitySignalLongEnabled?: boolean;
  snowballAutoTradeQualityShortSignalShortEnabled?: boolean;
  snowballAutoTradeGradeFFadeShortEnabled?: boolean;
  snowballAutoTradeShortSignalShortEnabled?: boolean;
  snowballAutoTradeSundayAllShortEnabled?: boolean;
  snowballAutoTradeLongDynamicBoostEnabled?: boolean;
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
  snowballAutoTradeHoldExtendRedHours?: number | null;
  snowballAutoTradeSlArmRoiPct?: number | null;
  snowballAutoTradeSlEntryOffsetPct?: number | null;
  snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled?: boolean;
  snowballAutoTradeQualityShortTpSlEnabled?: boolean;
  snowballAutoTradeQualityShortTp1PricePct?: number | null;
  snowballAutoTradeQualityShortTp1PartialPct?: number | null;
  snowballAutoTradeQualityShortTp2PricePct?: number | null;
  snowballAutoTradeQualityShortMaxHoldHours?: number | null;
  snowballAutoTradeQualityShortHoldExtendIfRedEnabled?: boolean;
  snowballAutoTradeQualityShortHoldExtendRedHours?: number | null;
  snowballAutoTradeQualityShortSlArmRoiPct?: number | null;
  snowballAutoTradeQualityShortSlEntryOffsetPct?: number | null;
  snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled?: boolean;

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
  reversalAutoTradeHoldExtendRedHours?: number | null;
  reversalAutoTradeSlArmRoiPct?: number | null;
  reversalAutoTradeSlEntryOffsetPct?: number | null;
  reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled?: boolean;
  /** กฎปิด @12h: ROI<0 + EMA4H>0 — default เปิด */
  reversalAutoTradeTp12hCloseEnabled?: boolean;
  reversalAutoTradeLongTpSlEnabled?: boolean;
  reversalAutoTradeLongTp1PricePct?: number | null;
  reversalAutoTradeLongTp1PartialPct?: number | null;
  reversalAutoTradeLongTp2PricePct?: number | null;
  reversalAutoTradeLongMaxHoldHours?: number | null;
  reversalAutoTradeLongHoldExtendIfRedEnabled?: boolean;
  reversalAutoTradeLongHoldExtendRedHours?: number | null;
  reversalAutoTradeLongSlArmRoiPct?: number | null;
  reversalAutoTradeLongSlEntryOffsetPct?: number | null;
  reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled?: boolean;
  reversalAutoTradeLongTp12hCloseEnabled?: boolean;
  reversalStatsPlaySide?: ReversalStatsPlaySide | null;
  reversalStatsPlayShortEnabled?: boolean | null;
  reversalStatsPlayLongEnabled?: boolean | null;
  reversalAutoTradeGateBodyWick80?: boolean;
  reversalAutoTradeGateLenRank315?: boolean;
  reversalAutoTradeGateQualitySignal?: boolean;
  reversalAutoTradeSaturdayAllSignalsEnabled?: boolean;
  reversalAutoTradeLongSignalShortEnabled?: boolean;
  reversalAutoTradeLongDynamicLeverageEnabled?: boolean;
  reversalAutoTradeShortDynamicLeverageEnabled?: boolean;
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
    input.snowballAutoTradeQualitySignalLongGrades !== undefined ||
    input.snowballAutoTradeQualitySignalLongEnabled !== undefined ||
    input.snowballAutoTradeQualityShortSignalShortEnabled !== undefined ||
    input.snowballAutoTradeGradeFFadeShortEnabled !== undefined ||
    input.snowballAutoTradeShortSignalShortEnabled !== undefined ||
    input.snowballAutoTradeSundayAllShortEnabled !== undefined ||
    input.snowballAutoTradeLongDynamicBoostEnabled !== undefined ||
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
    input.snowballAutoTradeHoldExtendRedHours !== undefined ||
    input.snowballAutoTradeSlArmRoiPct !== undefined ||
    input.snowballAutoTradeSlEntryOffsetPct !== undefined ||
    input.snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled !== undefined ||
    input.snowballAutoTradeQualityShortTpSlEnabled !== undefined ||
    input.snowballAutoTradeQualityShortTp1PricePct !== undefined ||
    input.snowballAutoTradeQualityShortTp1PartialPct !== undefined ||
    input.snowballAutoTradeQualityShortTp2PricePct !== undefined ||
    input.snowballAutoTradeQualityShortMaxHoldHours !== undefined ||
    input.snowballAutoTradeQualityShortHoldExtendIfRedEnabled !== undefined ||
    input.snowballAutoTradeQualityShortHoldExtendRedHours !== undefined ||
    input.snowballAutoTradeQualityShortSlArmRoiPct !== undefined ||
    input.snowballAutoTradeQualityShortSlEntryOffsetPct !== undefined ||
    input.snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled !== undefined;

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
    input.reversalAutoTradeHoldExtendRedHours !== undefined ||
    input.reversalAutoTradeSlArmRoiPct !== undefined ||
    input.reversalAutoTradeSlEntryOffsetPct !== undefined ||
    input.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled !== undefined ||
    input.reversalAutoTradeTp12hCloseEnabled !== undefined ||
    input.reversalAutoTradeLongTpSlEnabled !== undefined ||
    input.reversalAutoTradeLongTp1PricePct !== undefined ||
    input.reversalAutoTradeLongTp1PartialPct !== undefined ||
    input.reversalAutoTradeLongTp2PricePct !== undefined ||
    input.reversalAutoTradeLongMaxHoldHours !== undefined ||
    input.reversalAutoTradeLongHoldExtendIfRedEnabled !== undefined ||
    input.reversalAutoTradeLongHoldExtendRedHours !== undefined ||
    input.reversalAutoTradeLongSlArmRoiPct !== undefined ||
    input.reversalAutoTradeLongSlEntryOffsetPct !== undefined ||
    input.reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled !== undefined ||
    input.reversalAutoTradeLongTp12hCloseEnabled !== undefined ||
    input.reversalStatsPlaySide !== undefined ||
    input.reversalStatsPlayShortEnabled !== undefined ||
    input.reversalStatsPlayLongEnabled !== undefined ||
    input.reversalAutoTradeGateBodyWick80 !== undefined ||
    input.reversalAutoTradeGateLenRank315 !== undefined ||
    input.reversalAutoTradeGateQualitySignal !== undefined ||
    input.reversalAutoTradeSaturdayAllSignalsEnabled !== undefined ||
    input.reversalAutoTradeLongSignalShortEnabled !== undefined ||
    input.reversalAutoTradeLongDynamicLeverageEnabled !== undefined ||
    input.reversalAutoTradeShortDynamicLeverageEnabled !== undefined ||
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

    snowballAutoTradeQualitySignalLongGrades:
      input.snowballAutoTradeQualitySignalLongGrades === null
        ? undefined
        : input.snowballAutoTradeQualitySignalLongGrades !== undefined
          ? input.snowballAutoTradeQualitySignalLongGrades
          : prev?.snowballAutoTradeQualitySignalLongGrades,

    snowballAutoTradeQualitySignalLongEnabled:
      input.snowballAutoTradeQualitySignalLongGrades !== undefined
        ? (input.snowballAutoTradeQualitySignalLongGrades?.length ?? 0) > 0
        : input.snowballAutoTradeQualitySignalLongEnabled !== undefined
          ? input.snowballAutoTradeQualitySignalLongEnabled
          : prev?.snowballAutoTradeQualitySignalLongEnabled ??
            prev?.snowballAutoTradeQualitySignalGateEnabled ??
            false,

    snowballAutoTradeQualityShortSignalShortEnabled:
      input.snowballAutoTradeQualityShortSignalShortEnabled !== undefined
        ? input.snowballAutoTradeQualityShortSignalShortEnabled
        : input.snowballAutoTradeGradeFFadeShortEnabled !== undefined
          ? input.snowballAutoTradeGradeFFadeShortEnabled
          : prev?.snowballAutoTradeGradeFFadeShortEnabled ??
            prev?.snowballAutoTradeQualityShortSignalShortEnabled ??
            false,

    snowballAutoTradeGradeFFadeShortEnabled:
      input.snowballAutoTradeGradeFFadeShortEnabled !== undefined
        ? input.snowballAutoTradeGradeFFadeShortEnabled
        : input.snowballAutoTradeQualityShortSignalShortEnabled !== undefined
          ? input.snowballAutoTradeQualityShortSignalShortEnabled
          : prev?.snowballAutoTradeGradeFFadeShortEnabled ??
            prev?.snowballAutoTradeQualityShortSignalShortEnabled ??
            false,

    snowballAutoTradeShortSignalShortEnabled:
      input.snowballAutoTradeShortSignalShortEnabled !== undefined
        ? input.snowballAutoTradeShortSignalShortEnabled
        : prev?.snowballAutoTradeShortSignalShortEnabled ?? false,

    snowballAutoTradeSundayAllShortEnabled:
      input.snowballAutoTradeSundayAllShortEnabled !== undefined
        ? input.snowballAutoTradeSundayAllShortEnabled
        : prev?.snowballAutoTradeSundayAllShortEnabled ?? false,

    snowballAutoTradeLongDynamicBoostEnabled:
      input.snowballAutoTradeLongDynamicBoostEnabled !== undefined
        ? input.snowballAutoTradeLongDynamicBoostEnabled
        : prev?.snowballAutoTradeLongDynamicBoostEnabled ?? false,

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

    snowballAutoTradeHoldExtendRedHours:
      input.snowballAutoTradeHoldExtendRedHours === null
        ? undefined
        : input.snowballAutoTradeHoldExtendRedHours !== undefined
          ? input.snowballAutoTradeHoldExtendRedHours
          : prev?.snowballAutoTradeHoldExtendRedHours,

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

    snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled:
      input.snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled !== undefined
        ? input.snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled
        : prev?.snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled,

    snowballAutoTradeQualityShortTpSlEnabled:
      input.snowballAutoTradeQualityShortTpSlEnabled !== undefined
        ? input.snowballAutoTradeQualityShortTpSlEnabled
        : prev?.snowballAutoTradeQualityShortTpSlEnabled ?? true,

    snowballAutoTradeQualityShortTp1PricePct:
      input.snowballAutoTradeQualityShortTp1PricePct === null
        ? undefined
        : input.snowballAutoTradeQualityShortTp1PricePct !== undefined
          ? input.snowballAutoTradeQualityShortTp1PricePct
          : prev?.snowballAutoTradeQualityShortTp1PricePct,

    snowballAutoTradeQualityShortTp1PartialPct:
      input.snowballAutoTradeQualityShortTp1PartialPct === null
        ? undefined
        : input.snowballAutoTradeQualityShortTp1PartialPct !== undefined
          ? input.snowballAutoTradeQualityShortTp1PartialPct
          : prev?.snowballAutoTradeQualityShortTp1PartialPct,

    snowballAutoTradeQualityShortTp2PricePct:
      input.snowballAutoTradeQualityShortTp2PricePct === null
        ? undefined
        : input.snowballAutoTradeQualityShortTp2PricePct !== undefined
          ? input.snowballAutoTradeQualityShortTp2PricePct
          : prev?.snowballAutoTradeQualityShortTp2PricePct,

    snowballAutoTradeQualityShortMaxHoldHours:
      input.snowballAutoTradeQualityShortMaxHoldHours === null
        ? undefined
        : input.snowballAutoTradeQualityShortMaxHoldHours !== undefined
          ? input.snowballAutoTradeQualityShortMaxHoldHours
          : prev?.snowballAutoTradeQualityShortMaxHoldHours,

    snowballAutoTradeQualityShortHoldExtendIfRedEnabled:
      input.snowballAutoTradeQualityShortHoldExtendIfRedEnabled !== undefined
        ? input.snowballAutoTradeQualityShortHoldExtendIfRedEnabled
        : prev?.snowballAutoTradeQualityShortHoldExtendIfRedEnabled ?? false,

    snowballAutoTradeQualityShortHoldExtendRedHours:
      input.snowballAutoTradeQualityShortHoldExtendRedHours === null
        ? undefined
        : input.snowballAutoTradeQualityShortHoldExtendRedHours !== undefined
          ? input.snowballAutoTradeQualityShortHoldExtendRedHours
          : prev?.snowballAutoTradeQualityShortHoldExtendRedHours,

    snowballAutoTradeQualityShortSlArmRoiPct:
      input.snowballAutoTradeQualityShortSlArmRoiPct === null
        ? undefined
        : input.snowballAutoTradeQualityShortSlArmRoiPct !== undefined
          ? input.snowballAutoTradeQualityShortSlArmRoiPct
          : prev?.snowballAutoTradeQualityShortSlArmRoiPct,

    snowballAutoTradeQualityShortSlEntryOffsetPct:
      input.snowballAutoTradeQualityShortSlEntryOffsetPct === null
        ? undefined
        : input.snowballAutoTradeQualityShortSlEntryOffsetPct !== undefined
          ? input.snowballAutoTradeQualityShortSlEntryOffsetPct
          : prev?.snowballAutoTradeQualityShortSlEntryOffsetPct,

    snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled:
      input.snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled !== undefined
        ? input.snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled
        : prev?.snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled,

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

    reversalAutoTradeHoldExtendRedHours:
      input.reversalAutoTradeHoldExtendRedHours === null
        ? undefined
        : input.reversalAutoTradeHoldExtendRedHours !== undefined
          ? input.reversalAutoTradeHoldExtendRedHours
          : prev?.reversalAutoTradeHoldExtendRedHours,

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

    reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled:
      input.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled !== undefined
        ? input.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled
        : prev?.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled,

    reversalAutoTradeTp12hCloseEnabled:
      input.reversalAutoTradeTp12hCloseEnabled !== undefined
        ? input.reversalAutoTradeTp12hCloseEnabled
        : prev?.reversalAutoTradeTp12hCloseEnabled,

    reversalAutoTradeLongTpSlEnabled:
      input.reversalAutoTradeLongTpSlEnabled !== undefined
        ? input.reversalAutoTradeLongTpSlEnabled
        : prev?.reversalAutoTradeLongTpSlEnabled,

    reversalAutoTradeLongTp1PricePct:
      input.reversalAutoTradeLongTp1PricePct === null
        ? undefined
        : input.reversalAutoTradeLongTp1PricePct !== undefined
          ? input.reversalAutoTradeLongTp1PricePct
          : prev?.reversalAutoTradeLongTp1PricePct,

    reversalAutoTradeLongTp1PartialPct:
      input.reversalAutoTradeLongTp1PartialPct === null
        ? undefined
        : input.reversalAutoTradeLongTp1PartialPct !== undefined
          ? input.reversalAutoTradeLongTp1PartialPct
          : prev?.reversalAutoTradeLongTp1PartialPct,

    reversalAutoTradeLongTp2PricePct:
      input.reversalAutoTradeLongTp2PricePct === null
        ? undefined
        : input.reversalAutoTradeLongTp2PricePct !== undefined
          ? input.reversalAutoTradeLongTp2PricePct
          : prev?.reversalAutoTradeLongTp2PricePct,

    reversalAutoTradeLongMaxHoldHours:
      input.reversalAutoTradeLongMaxHoldHours === null
        ? undefined
        : input.reversalAutoTradeLongMaxHoldHours !== undefined
          ? input.reversalAutoTradeLongMaxHoldHours
          : prev?.reversalAutoTradeLongMaxHoldHours,

    reversalAutoTradeLongHoldExtendIfRedEnabled:
      input.reversalAutoTradeLongHoldExtendIfRedEnabled !== undefined
        ? input.reversalAutoTradeLongHoldExtendIfRedEnabled
        : prev?.reversalAutoTradeLongHoldExtendIfRedEnabled,

    reversalAutoTradeLongHoldExtendRedHours:
      input.reversalAutoTradeLongHoldExtendRedHours === null
        ? undefined
        : input.reversalAutoTradeLongHoldExtendRedHours !== undefined
          ? input.reversalAutoTradeLongHoldExtendRedHours
          : prev?.reversalAutoTradeLongHoldExtendRedHours,

    reversalAutoTradeLongSlArmRoiPct:
      input.reversalAutoTradeLongSlArmRoiPct === null
        ? undefined
        : input.reversalAutoTradeLongSlArmRoiPct !== undefined
          ? input.reversalAutoTradeLongSlArmRoiPct
          : prev?.reversalAutoTradeLongSlArmRoiPct,

    reversalAutoTradeLongSlEntryOffsetPct:
      input.reversalAutoTradeLongSlEntryOffsetPct === null
        ? undefined
        : input.reversalAutoTradeLongSlEntryOffsetPct !== undefined
          ? input.reversalAutoTradeLongSlEntryOffsetPct
          : prev?.reversalAutoTradeLongSlEntryOffsetPct,

    reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled:
      input.reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled !== undefined
        ? input.reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled
        : prev?.reversalAutoTradeLongSlAtEntryAfter24hIfGreenEnabled,

    reversalAutoTradeLongTp12hCloseEnabled:
      input.reversalAutoTradeLongTp12hCloseEnabled !== undefined
        ? input.reversalAutoTradeLongTp12hCloseEnabled
        : prev?.reversalAutoTradeLongTp12hCloseEnabled,

    reversalStatsPlaySide:
      input.reversalStatsPlaySide === null
        ? undefined
        : input.reversalStatsPlaySide !== undefined
          ? input.reversalStatsPlaySide
          : prev?.reversalStatsPlaySide,

    reversalStatsPlayShortEnabled:
      input.reversalStatsPlayShortEnabled === null
        ? undefined
        : input.reversalStatsPlayShortEnabled !== undefined
          ? input.reversalStatsPlayShortEnabled
          : prev?.reversalStatsPlayShortEnabled ??
            (prev?.reversalStatsPlaySide === "long" ? false : true),

    reversalStatsPlayLongEnabled:
      input.reversalStatsPlayLongEnabled === null
        ? undefined
        : input.reversalStatsPlayLongEnabled !== undefined
          ? input.reversalStatsPlayLongEnabled
          : prev?.reversalStatsPlayLongEnabled ??
            (prev?.reversalStatsPlaySide === "long" ? true : false),

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

    reversalAutoTradeShortDynamicLeverageEnabled:
      input.reversalAutoTradeShortDynamicLeverageEnabled !== undefined
        ? input.reversalAutoTradeShortDynamicLeverageEnabled
        : prev?.reversalAutoTradeShortDynamicLeverageEnabled ?? false,

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
            "market",

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
  const out: Record<string, TradingViewMexcUserSettings> = {};
  for (const [userId, row] of Object.entries(m)) {
    out[userId] = migrateTradingViewMexcUserSettings(row);
  }
  return out;
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
