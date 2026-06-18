/**
 * Helpers ให้คำสั่ง HTTP จากเว็บแอปในแชท: `/api/tma` (หลัก) และ optionally `/api/liff` เมื่อยังผูก LINE OA + LIFF.
 * พร็อกซีธุรกิจอยู่ที่ฟังก์ชัน `liff*` แม้ว่าใน production ของคุณจะเหลือ Telegram Mini App อย่างเดียว.
 */
import { config } from "./config";
import { verifyLiffIdToken } from "./liffAuth";
import { addAlert, listAlertsForUser, removeAlertById } from "./alertsStore";
import {
  addPctStepAlert,
  listPctStepAlertsForUser,
  removePctStepAlertById,
  type PctStepMode,
} from "./pctStepAlertsStore";
import {
  addContractWatch,
  listContractWatchesForUser,
  removeContractWatchById,
} from "./contractWatchStore";
import { resolveContractSymbol, BASE_TO_CONTRACT } from "./coinMap";
import { fetchSimplePrices, formatSignal } from "./cryptoService";
import {
  addSystemChangeSubscriber,
  hasSystemChangeSubscriber,
  removeSystemChangeSubscriber,
} from "./systemChangeSubscribersStore";
import { getTopUsdtSymbolsByAmount24 } from "./mexcMarkets";
import {
  addVolumeSignalAlert,
  listVolumeSignalAlertsForUser,
  MAX_VOLUME_SIGNAL_ALERTS_PER_USER,
  removeVolumeSignalAlertById,
  replaceUserVolumeSignalAlertsForTimeframe,
  type VolumeSignalTimeframe,
} from "./volumeSignalAlertsStore";
import {
  listIndicatorAlertsForUser,
  maxIndicatorAlertsPerUser,
  removeIndicatorAlertById,
  replaceUserEmaCrossAlerts,
  replaceUserRsiAlerts,
  type IndicatorTimeframe,
} from "./indicatorAlertsStore";
import { getIndicatorCooldownMsDisplay } from "./indicatorAlertWorker";
import {
  getVolumeSignalCooldownMsDisplay,
  getVolumeSignalMinAbsMomentumByTfDisplay,
  getVolumeSignalMinAbsMomentumDisplay,
  getVolumeSignalMinAbsReturnPctDisplay,
  getVolumeSignalMinVolRatioDisplay,
} from "./volumeSignalAlertTick";
import { loadSparkFollowUpState } from "./sparkFollowUpStore";
import { buildSparkStatsApiPayload, type SparkStatsApiPayload } from "./sparkFollowUpStats";
import type { SnowballStatsApiPayload } from "@/lib/snowballStatsClient";
import {
  SNOWBALL_GRADE_F_FADE_SHORT_CRITERIA,
  SNOWBALL_SHORT_SIGNAL_CRITERIA,
  SNOWBALL_QUALITY_SIGNAL_CRITERIA,
} from "@/lib/snowballMatrixFilters";
import {
  REVERSAL_QUALITY_SIGNAL_CRITERIA,
  REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA,
} from "@/lib/reversalMatrixFilters";
import {
  applySnowballStatsRowMigrations,
  deleteSnowballStatsRowById,
  loadSnowballStatsState,
  resetSnowballStatsState,
  saveSnowballStatsState,
} from "./snowballStatsStore";
import {
  correctSnowballStatsOutcomeFromPct48h,
  runSnowballStatsAdminBackfill,
  type SnowballStatsAdminBackfillResult,
} from "./snowballStatsTick";
import { isAdminTelegramUserId } from "./adminIds";
import { backfillAllStatsMarketSentiment } from "./marketSentimentSnapshotStore";
import { backfillAllStatsRowsBtcEmaSlopes } from "./statsEmaSlope";
import { backfillAllStatsRowsPsar4h } from "./statsPsar4h";
import { backfillAllStatsRowsQuoteVol24h } from "./statsQuoteVol24h";
import {
  resolveViewerStatsTpSlPlan,
  resolveViewerStatsTradeSizing,
  viewerStatsTpSlPlanSummary,
  viewerStatsTpSlPlanPayload,
} from "@/lib/statsTpSlPlanForUser";
import {
  loadCandleReversalStatsState,
  removeCandleReversalStatsDuplicatePendingRows,
  resetCandleReversalStatsState,
  saveCandleReversalStatsState,
} from "./candleReversalStatsStore";
import {
  enrichCandleReversalStatsWithViewerStrategyProfit,
  enrichSnowballStatsWithViewerStrategyProfit,
  withReversalStrategyProfitDisplayFields,
  withViewerStrategyProfitDisplayFields,
} from "./statsStrategyProfitEnrich";
import { REVERSAL_TP_STRATEGY_SUMMARY } from "@/lib/reversalTpStrategy";
import {
  correctCandleReversalStatsOutcome,
  runCandleReversalStatsFollowUpTick,
} from "./candleReversalStatsTick";
import {
  correctRsiDivergenceStatsOutcome,
  runRsiDivergenceStatsFollowUpTick,
} from "./rsiDivergenceStatsTick";
import type { CandleReversalStatsApiPayload } from "@/lib/candleReversalStatsClient";
import {
  loadRsiDivergenceStatsState,
  resetRsiDivergenceStatsState,
  saveRsiDivergenceStatsState,
} from "./rsiDivergenceStatsStore";
import type { RsiDivergenceStatsApiPayload } from "@/lib/rsiDivergenceStatsClient";
import {
  summarizeAutoOpenOrderLogs,
  type AutoOpenOrderLogApiPayload,
  type AutoOpenSource,
} from "@/lib/autoOpenOrderLogClient";
import { withAutoOpenTpStrategyDisplayFields } from "@/lib/autoOpenTpStrategy";
import { resolveTpSlPlanForUserId } from "@/lib/statsTpSlPlanForUser";
import {
  listAutoOpenOrderLogsForUser,
  deleteSkippedAutoOpenOrderLogsForUser,
  countSkippedAutoOpenOrderLogsForUser,
  loadAutoOpenOrderLogState,
} from "./autoOpenOrderLogStore";
import {
  attachAutoOpenMexcOpenPnlSnapshots,
  resolveAutoOpenMexcOpenContextForUser,
} from "./autoOpenMexcActiveForUser";
import { annotateAutoOpenRowsWithMexcActive } from "@/lib/autoOpenMexcActive";
import { collectAutoOpenContractSymbols, fetchAutoOpenMarkPrices } from "./autoOpenMarkPrices";
import {
  fetchFuturesAccountAssetList,
  parseMexcUsdtBalanceFromAssets,
  type MexcCredentials,
} from "./mexcFuturesClient";
import { loadPendingConflictSets, loadStatsConflictIndex } from "./signalPendingConflictServer";
import { resolveAutoOpenLogConflictWith, resolveRowConflictWith } from "@/lib/signalPendingConflict";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { isPctStepPresetValue, PCT_STEP_PRESET_VALUES } from "@/lib/alertPresets";
import { clearPortfolioTrailingStateForUser } from "./portfolioTrailingAlertStateStore";
import {
  ensureTradingViewMexcUserRow,
  loadTradingViewMexcSettingsFullMap,
  orderSideEffective,
  saveTradingViewMexcSettings,
  type SaveTradingViewMexcInput,
  type SparkAutoTradeByVol,
  type SparkAutoTradeOrderSide,
  type SparkAutoTradeVolBandPreset,
  type TradingViewMexcUserSettings,
} from "./tradingViewCloseSettingsStore";
import {
  sparkAutoTradeExplainSaveBlocked,
  sparkAutoTradeParamsForVolBand,
} from "./sparkAutoTradeResolve";
import type { SparkVolBand } from "./sparkTierContext";
import { newTvWebhookNonce } from "./tradingViewWebhookNonceStore";
import { isSnowballAutotradeEnabled } from "./snowballAutoTradeExecutor";
import {
  resolveSnowballQualitySignalLongGrades,
  snowballQualitySignalLongFeatureEnabled,
  SNOWBALL_QUALITY_SIGNAL_LONG_GRADE_OPTIONS,
} from "./snowballQualitySignalLongGrades";
import type { SnowballAutoTradeGradeKey } from "./tradingViewCloseSettingsStore";
import { isReversalAutotradeEnabled } from "./reversalAutoTradeExecutor";
import {
  parseReversalAutoTradeEntryEmaPeriod,
  parseReversalAutoTradeEntryMode,
  reversalEntrySettingsFromRow,
} from "@/lib/reversalAutoTradeEntry";
import {
  parseSnowballAutoTradeEntryEmaPeriod,
  parseSnowballAutoTradeEntryMode,
} from "@/lib/snowballAutoTradeEntry";
/** คำอธิบายใน Mini App — สอดคล้อง `isSnowballAutotradeEnabled` (ค่าเริ่มต้นเปิด; ตั้ง =0 เพื่อปิดเซิร์ฟ) */
const SNOWBALL_AUTO_TRADE_LIFF_NOTE_TH =
  `Snowball ในแชทเป็นคู่ Binance USDT-M แต่ auto-open สั่งเฉพาะบน MEXC — ค่าเริ่มต้น LONG → Long · BEAR → Short · entry default Market ตลอด · ตัวเลือก Hybrid EMA บน 1h (default EMA20): ราคา > EMA → Market, ≤ EMA → Limit ที่ EMA (หมดอายุ 8 ชม.) · ถ้าเปิด ✨ Quality Signal: (${SNOWBALL_QUALITY_SIGNAL_CRITERIA}) → Long · ถ้าเปิด Long → fade SHORT (เกรด F): (${SNOWBALL_GRADE_F_FADE_SHORT_CRITERIA}) · ถ้าเปิด Snowball SHORT (ทิศ Short): (${SNOWBALL_SHORT_SIGNAL_CRITERIA}) · gate แยกกัน · วันอาทิตย์ (ไทย) → Short ทุกสัญญาณ · Action Plan = Monitor ไม่เปิด · kill switch: SNOWBALL_AUTOTRADE_ENABLED=0 — 1 order/เหรียญ/วัน (BKK)`;

/** คำอธิบายใน Mini App สำหรับ Reversal auto-open — short เท่านั้น */
const REVERSAL_AUTO_TRADE_LIFF_NOTE_TH =
  `Reversal auto-open สั่ง SHORT บน MEXC หลัง Reversal alert ส่งสำเร็จ — สัญญาณ Short ตามแผน Short · ตัวเลือก Long → SHORT (fade) สำหรับ Reversal Long 1H — gate Quality Signal: Short — ${REVERSAL_QUALITY_SIGNAL_CRITERIA} · Long 1H — ${REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA} — ถ้าเปิดวันเสาร์: ทุกสัญญาณในวันเสาร์ (เวลาไทย) ข้าม gate — entry: Hybrid (EMA retest บน 15m, default EMA20) ราคา > EMA → Market, ≤ EMA → Limit ที่ EMA (หมดอายุ 8 ชม. แล้วยกเลิก+ปลดล็อกวัน) · หรือ Market ตลอด — กลยุทธ์ TP: ${REVERSAL_TP_STRATEGY_SUMMARY} · 1 order/เหรียญ/วัน (BKK) · REVERSAL_AUTOTRADE_ENABLED=0`;

export function getLiffConfig() {
  return {
    liffId: config.liffId ?? null,
    channelIdConfigured: Boolean(config.lineChannelId),
  };
}

export function getLiffMeta() {
  return {
    shortcuts: Object.keys(BASE_TO_CONTRACT).sort(),
    hint: "พิมพ์ย่อ (btc) หรือสัญญาเต็ม (BTC_USDT)",
  };
}

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export async function authenticateLiffRequest(authHeader: string | null): Promise<AuthResult> {
  if (!config.lineChannelId) {
    return {
      ok: false,
      status: 503,
      error: "ตั้งค่า LINE_CHANNEL_ID ในเซิร์ฟเวอร์ก่อน (ใช้ยืนยัน LIFF)",
    };
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "ต้องล็อกอิน LINE" };
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return { ok: false, status: 401, error: "ต้องล็อกอิน LINE" };
  }
  try {
    const { userId } = await verifyLiffIdToken(idToken, config.lineChannelId);
    return { ok: true, userId };
  } catch (e) {
    const detail = e instanceof Error && e.message ? e.message : "verify_failed";
    return {
      ok: false,
      status: 401,
      error: `โทเคนไม่ผ่านการยืนยัน: ${detail}`,
    };
  }
}

export async function liffListAlerts(userId: string) {
  const list = await listAlertsForUser(userId);
  return { alerts: list };
}

export async function liffCreateAlert(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { symbol, direction, target } = (body ?? {}) as Record<string, unknown>;
  if (direction !== "above" && direction !== "below") {
    return { status: 400, json: { error: "direction ต้องเป็น above หรือ below" } };
  }
  const t = typeof target === "number" ? target : Number(target);
  if (!Number.isFinite(t) || t <= 0) {
    return { status: 400, json: { error: "target ต้องเป็นตัวเลขบวก" } };
  }
  if (typeof symbol !== "string" || !symbol.trim()) {
    return { status: 400, json: { error: "ระบุ symbol" } };
  }
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    return { status: 400, json: { error: "ไม่รู้จักคู่นี้" } };
  }
  const dir = direction as "above" | "below";
  const row = await addAlert({
    userId,
    coinId: resolved.contractSymbol,
    symbolLabel: resolved.label,
    direction: dir,
    targetUsd: t,
  });
  return { status: 201, json: { alert: row } };
}

export async function liffDeleteAlert(
  userId: string,
  id: string
): Promise<{ status: number; json?: Record<string, unknown> }> {
  const ok = await removeAlertById(userId, id);
  if (!ok) {
    return { status: 404, json: { error: "ไม่พบการแจ้งเตือน" } };
  }
  return { status: 204 };
}

export async function liffListPctAlerts(userId: string) {
  const list = await listPctStepAlertsForUser(userId);
  return { pctAlerts: list };
}

export async function liffCreatePctAlert(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const { symbol, mode } = b;
  const stepRaw = b.stepPct ?? b.step;
  const stepPct = typeof stepRaw === "number" ? stepRaw : Number(stepRaw);
  if (!Number.isFinite(stepPct) || stepPct <= 0 || stepPct > 100) {
    return { status: 400, json: { error: "stepPct ต้องเป็นตัวเลข 0–100" } };
  }
  const m: PctStepMode = mode === "trailing" ? "trailing" : "daily_07_bkk";
  if (typeof symbol !== "string" || !symbol.trim()) {
    return { status: 400, json: { error: "ระบุ symbol" } };
  }
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    return { status: 400, json: { error: "ไม่รู้จักคู่นี้" } };
  }
  const row = await addPctStepAlert({
    userId,
    coinId: resolved.contractSymbol,
    symbolLabel: resolved.label,
    stepPct,
    mode: m,
  });
  return { status: 201, json: { pctAlert: row } };
}

export async function liffDeletePctAlert(
  userId: string,
  id: string
): Promise<{ status: number; json?: Record<string, unknown> }> {
  const ok = await removePctStepAlertById(userId, id);
  if (!ok) {
    return { status: 404, json: { error: "ไม่พบรายการแจ้งเตือนการเคลื่อนไหวราคา" } };
  }
  return { status: 204 };
}

export async function liffListContractWatches(userId: string) {
  const list = await listContractWatchesForUser(userId);
  return { watches: list };
}

export async function liffCreateContractWatch(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { symbol } = (body ?? {}) as Record<string, unknown>;
  if (typeof symbol !== "string" || !symbol.trim()) {
    return { status: 400, json: { error: "ระบุ symbol" } };
  }
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    return { status: 400, json: { error: "ไม่รู้จักคู่นี้" } };
  }
  const row = await addContractWatch({
    userId,
    coinId: resolved.contractSymbol,
    symbolLabel: resolved.label,
  });
  return { status: 201, json: { watch: row } };
}

export async function liffDeleteContractWatch(
  userId: string,
  id: string
): Promise<{ status: number; json?: Record<string, unknown> }> {
  const ok = await removeContractWatchById(userId, id);
  if (!ok) {
    return { status: 404, json: { error: "ไม่พบการติดตาม" } };
  }
  return { status: 204 };
}

export async function liffGetSystemChangeSubscription(userId: string) {
  const subscribed = await hasSystemChangeSubscriber(userId);
  return { subscribed };
}

export async function liffSetSystemChangeSubscription(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b.subscribed;
  if (typeof raw !== "boolean") {
    return { status: 400, json: { error: "subscribed ต้องเป็น true หรือ false" } };
  }
  if (raw) {
    const changed = await addSystemChangeSubscriber(userId);
    return { status: 200, json: { subscribed: true, changed } };
  }
  const changed = await removeSystemChangeSubscriber(userId);
  return { status: 200, json: { subscribed: false, changed } };
}

export async function liffPrice(symbol: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    return { status: 400, json: { error: "ไม่รู้จักคู่นี้" } };
  }
  try {
    const prices = await fetchSimplePrices([resolved.contractSymbol]);
    const quote = prices[resolved.contractSymbol];
    if (!quote) {
      return { status: 502, json: { error: "ดึงราคาไม่สำเร็จ" } };
    }
    return {
      status: 200,
      json: {
        contract: resolved.contractSymbol,
        priceUsdt: quote.usd,
        change24hPercent: quote.usd_24h_change,
        signal: formatSignal(quote.usd_24h_change),
      },
    };
  } catch {
    return { status: 502, json: { error: "MEXC ไม่พร้อม" } };
  }
}

const VOLUME_SIGNAL_TOP_N = 30;

export async function liffListVolumeSignalAlerts(userId: string) {
  const list = await listVolumeSignalAlertsForUser(userId);
  return { volumeSignalAlerts: list };
}

export async function liffGetVolumeSignalMeta() {
  try {
    const topSymbols = await getTopUsdtSymbolsByAmount24(VOLUME_SIGNAL_TOP_N);
    const minAbsMomentumByTf = getVolumeSignalMinAbsMomentumByTfDisplay();
    return {
      topSymbols,
      topN: VOLUME_SIGNAL_TOP_N,
      minVolRatio: getVolumeSignalMinVolRatioDisplay(),
      minAbsReturnPct: getVolumeSignalMinAbsReturnPctDisplay(),
      minAbsMomentum: getVolumeSignalMinAbsMomentumDisplay(),
      minAbsMomentumByTf,
      cooldownMs: getVolumeSignalCooldownMsDisplay(),
      maxAlertsPerUser: MAX_VOLUME_SIGNAL_ALERTS_PER_USER,
    };
  } catch {
    const minAbsMomentumByTf = getVolumeSignalMinAbsMomentumByTfDisplay();
    return {
      topSymbols: [] as string[],
      topN: VOLUME_SIGNAL_TOP_N,
      minVolRatio: getVolumeSignalMinVolRatioDisplay(),
      minAbsReturnPct: getVolumeSignalMinAbsReturnPctDisplay(),
      minAbsMomentum: getVolumeSignalMinAbsMomentumDisplay(),
      minAbsMomentumByTf,
      cooldownMs: getVolumeSignalCooldownMsDisplay(),
      maxAlertsPerUser: MAX_VOLUME_SIGNAL_ALERTS_PER_USER,
    };
  }
}

function parseOptionalMinVolRatio(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) throw new Error("minVolRatio ไม่ถูกต้อง");
  if (n < 1.5 || n > 50) throw new Error("minVolRatio ต้องอยู่ระหว่าง 1.5–50");
  return n;
}

function parseOptionalMinAbsReturnPct(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) throw new Error("minAbsReturnPct ไม่ถูกต้อง");
  if (n < 0 || n > 10) throw new Error("minAbsReturnPct ต้องอยู่ระหว่าง 0–10 (% ของราคาแท่ง)");
  return n;
}

export async function liffCreateVolumeSignalAlert(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const { symbol } = b;
  const tfRaw = b.timeframe ?? b.tf;
  if (typeof symbol !== "string" || !symbol.trim()) {
    return { status: 400, json: { error: "ระบุ symbol" } };
  }
  const tf = typeof tfRaw === "string" ? tfRaw.trim() : "";
  if (tf !== "1h" && tf !== "4h") {
    return { status: 400, json: { error: "timeframe ต้องเป็น 1h หรือ 4h" } };
  }
  const timeframe: VolumeSignalTimeframe = tf === "4h" ? "4h" : "1h";

  let minVolRatio: number | undefined;
  let minAbsReturnPct: number | undefined;
  try {
    minVolRatio = parseOptionalMinVolRatio(b.minVolRatio);
    minAbsReturnPct = parseOptionalMinAbsReturnPct(b.minAbsReturnPct);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "พารามิเตอร์ไม่ถูกต้อง";
    return { status: 400, json: { error: msg } };
  }

  const resolved = resolveContractSymbol(symbol);
  if (!resolved) {
    return { status: 400, json: { error: "ไม่รู้จักคู่นี้" } };
  }

  let top: string[];
  try {
    top = await getTopUsdtSymbolsByAmount24(VOLUME_SIGNAL_TOP_N);
  } catch {
    return { status: 503, json: { error: "ดึงรายชื่อสัญญา Top vol ไม่สำเร็จ" } };
  }
  if (!top.includes(resolved.contractSymbol)) {
    return {
      status: 400,
      json: {
        error: `สัญญานี้ไม่อยู่ใน Top ${VOLUME_SIGNAL_TOP_N} ตาม Vol 24h บน MEXC ตอนนี้ — เลือกจากรายการที่อนุญาต`,
      },
    };
  }

  try {
    const row = await addVolumeSignalAlert({
      userId,
      coinId: resolved.contractSymbol,
      symbolLabel: resolved.label,
      timeframe,
      ...(minVolRatio !== undefined ? { minVolRatio } : {}),
      ...(minAbsReturnPct !== undefined ? { minAbsReturnPct } : {}),
    });
    return { status: 201, json: { volumeSignalAlert: row } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
    return { status: 400, json: { error: msg } };
  }
}

/** POST sync — แทนที่รายการ volume signal ทั้งหมดใน timeframe ด้วย symbols[] (ว่าง = ลบทุกรายการใน TF นี้) */
export async function liffSyncVolumeSignalAlerts(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawSyms = b.symbols ?? b.symbolList;
  if (!Array.isArray(rawSyms)) {
    return { status: 400, json: { error: "ระบุ symbols เป็น array" } };
  }

  const tfRaw = typeof b.timeframe === "string" ? b.timeframe.trim().toLowerCase() : "1h";
  const timeframe: VolumeSignalTimeframe = tfRaw === "4h" ? "4h" : "1h";

  let minVolRatio: number | undefined;
  let minAbsReturnPct: number | undefined;
  try {
    minVolRatio = parseOptionalMinVolRatio(b.minVolRatio);
    minAbsReturnPct = parseOptionalMinAbsReturnPct(b.minAbsReturnPct);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "พารามิเตอร์ไม่ถูกต้อง";
    return { status: 400, json: { error: msg } };
  }

  let top: string[];
  try {
    top = await getTopUsdtSymbolsByAmount24(VOLUME_SIGNAL_TOP_N);
  } catch {
    return { status: 503, json: { error: "ดึงรายชื่อสัญญา Top vol ไม่สำเร็จ" } };
  }

  const resolvedSyms: { contractSymbol: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const raw of rawSyms) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const r = resolveContractSymbol(raw);
    if (!r) {
      return { status: 400, json: { error: `ไม่รู้จักคู่: ${raw}` } };
    }
    if (seen.has(r.contractSymbol)) continue;
    seen.add(r.contractSymbol);
    if (!top.includes(r.contractSymbol)) {
      return {
        status: 400,
        json: {
          error: `${r.label} ไม่อยู่ใน Top ${VOLUME_SIGNAL_TOP_N} ตาม Vol 24h — ลบออกหรือเลือกคู่อื่น`,
        },
      };
    }
    resolvedSyms.push(r);
  }

  try {
    const rows = resolvedSyms.map((r) => ({
      userId,
      coinId: r.contractSymbol,
      symbolLabel: r.label,
      timeframe,
      ...(minVolRatio !== undefined ? { minVolRatio } : {}),
      ...(minAbsReturnPct !== undefined ? { minAbsReturnPct } : {}),
    }));

    const volumeSignalAlerts = await replaceUserVolumeSignalAlertsForTimeframe(userId, timeframe, rows);
    return { status: 200, json: { volumeSignalAlerts, saved: volumeSignalAlerts.length } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
    return { status: 400, json: { error: msg } };
  }
}

export async function liffDeleteVolumeSignalAlert(
  userId: string,
  id: string
): Promise<{ status: number; json?: Record<string, unknown> }> {
  const ok = await removeVolumeSignalAlertById(userId, id);
  if (!ok) {
    return { status: 404, json: { error: "ไม่พบรายการ" } };
  }
  return { status: 204 };
}

const INDICATOR_META_TOP_N = 50;

export async function liffGetIndicatorMeta() {
  try {
    const topSymbols = await getTopUsdtSymbolsByAmount24(INDICATOR_META_TOP_N);
    return {
      timeframe: "1h" as const,
      period: 14,
      rsiTimeframes: ["1h", "4h"] as const,
      emaDefaults: { fast: 9, slow: 21 },
      emaTimeframes: ["1h", "4h"] as const,
      maxAlertsPerUser: maxIndicatorAlertsPerUser(),
      cooldownMs: getIndicatorCooldownMsDisplay(),
      topSymbols,
      topN: INDICATOR_META_TOP_N,
    };
  } catch {
    return {
      timeframe: "1h" as const,
      period: 14,
      rsiTimeframes: ["1h", "4h"] as const,
      emaDefaults: { fast: 9, slow: 21 },
      emaTimeframes: ["1h", "4h"] as const,
      maxAlertsPerUser: maxIndicatorAlertsPerUser(),
      cooldownMs: getIndicatorCooldownMsDisplay(),
      topSymbols: [] as string[],
      topN: INDICATOR_META_TOP_N,
    };
  }
}

export async function liffListIndicatorAlerts(userId: string) {
  const indicatorAlerts = await listIndicatorAlertsForUser(userId);
  return { indicatorAlerts };
}

/**
 * แทนที่ชุด RSI ต่อ timeframe (1h / 4h) ของ user ด้วยรายการ symbol + เงื่อนไขเดียว
 */
export async function liffSyncRsi1hIndicatorAlerts(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawSyms = b.symbols ?? b.symbolList;
  if (!Array.isArray(rawSyms) || rawSyms.length === 0) {
    return { status: 400, json: { error: "ระบุ symbols อย่างน้อย 1 รายการ" } };
  }

  const tfRaw = typeof b.timeframe === "string" ? b.timeframe.trim().toLowerCase() : "1h";
  const timeframe: IndicatorTimeframe = tfRaw === "4h" ? "4h" : "1h";

  const threshold = typeof b.threshold === "number" ? b.threshold : Number(b.threshold);
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 99) {
    return { status: 400, json: { error: "threshold ต้องอยู่ระหว่าง 1–99" } };
  }

  const dirRaw = typeof b.direction === "string" ? b.direction.trim().toLowerCase() : "";
  let direction: "above" | "below" | "both" | null = null;
  if (!dirRaw) {
    direction = "both";
  } else if (dirRaw === "below" || dirRaw === "under") direction = "below";
  else if (dirRaw === "above" || dirRaw === "over") direction = "above";
  else if (dirRaw === "both" || dirRaw === "any" || dirRaw === "cross" || dirRaw === "either") direction = "both";
  if (!direction) {
    return {
      status: 400,
      json: { error: "direction ต้องเป็น both (ค่าเริ่ม), above หรือ below" },
    };
  }

  const periodNum = b.period !== undefined && b.period !== null ? Number(b.period) : 14;
  if (!Number.isFinite(periodNum) || periodNum !== 14) {
    return { status: 400, json: { error: "ตอนนี้รองรับ RSI period 14 เท่านั้น" } };
  }

  const resolvedSyms: { contractSymbol: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const raw of rawSyms) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const r = resolveContractSymbol(raw);
    if (!r) {
      return { status: 400, json: { error: `ไม่รู้จักคู่: ${raw}` } };
    }
    if (seen.has(r.contractSymbol)) continue;
    seen.add(r.contractSymbol);
    resolvedSyms.push(r);
  }

  if (resolvedSyms.length === 0) {
    return { status: 400, json: { error: "ไม่มีสัญญาที่ใช้ได้" } };
  }

  try {
    const rows = resolvedSyms.map((r) => ({
      userId,
      symbol: r.contractSymbol,
      symbolLabel: r.label,
      indicatorType: "RSI" as const,
      parameters: { period: 14 },
      timeframe,
      threshold,
      direction,
    }));

    const indicatorAlerts = await replaceUserRsiAlerts(userId, timeframe, rows);
    return { status: 200, json: { indicatorAlerts, saved: indicatorAlerts.length } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
    return { status: 400, json: { error: msg } };
  }
}

export async function liffSyncEmaCrossIndicatorAlerts(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const rawSyms = b.symbols ?? b.symbolList;
  if (!Array.isArray(rawSyms) || rawSyms.length === 0) {
    return { status: 400, json: { error: "ระบุ symbols อย่างน้อย 1 รายการ" } };
  }

  const tfRaw = typeof b.timeframe === "string" ? b.timeframe.trim().toLowerCase() : "1h";
  const timeframe: IndicatorTimeframe = tfRaw === "4h" ? "4h" : "1h";

  const fast = typeof b.fast === "number" ? b.fast : Number(b.fast);
  const slow = typeof b.slow === "number" ? b.slow : Number(b.slow);
  if (!Number.isFinite(fast) || !Number.isFinite(slow) || fast < 2 || slow < 3 || fast >= slow) {
    return { status: 400, json: { error: "fast/slow ต้องเป็นตัวเลข โดย fast < slow (เช่น 9 / 21)" } };
  }
  if (slow > 200) {
    return { status: 400, json: { error: "slow สูงสุด 200" } };
  }

  const kindRaw = typeof b.crossKind === "string" ? b.crossKind.trim().toLowerCase() : "";
  let emaCrossKind: "golden" | "death" | null = null;
  if (kindRaw === "golden" || kindRaw === "bull" || kindRaw === "bullish") emaCrossKind = "golden";
  else if (kindRaw === "death" || kindRaw === "bear" || kindRaw === "bearish") emaCrossKind = "death";
  if (!emaCrossKind) {
    return { status: 400, json: { error: "crossKind ต้องเป็น golden หรือ death" } };
  }

  const resolvedSyms: { contractSymbol: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const raw of rawSyms) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const r = resolveContractSymbol(raw);
    if (!r) {
      return { status: 400, json: { error: `ไม่รู้จักคู่: ${raw}` } };
    }
    if (seen.has(r.contractSymbol)) continue;
    seen.add(r.contractSymbol);
    resolvedSyms.push(r);
  }

  if (resolvedSyms.length === 0) {
    return { status: 400, json: { error: "ไม่มีสัญญาที่ใช้ได้" } };
  }

  try {
    const rows = resolvedSyms.map((r) => ({
      userId,
      symbol: r.contractSymbol,
      symbolLabel: r.label,
      indicatorType: "EMA_CROSS" as const,
      parameters: { fast: Math.floor(fast), slow: Math.floor(slow) },
      timeframe,
      emaCrossKind,
    }));

    const indicatorAlerts = await replaceUserEmaCrossAlerts(userId, timeframe, rows);
    return { status: 200, json: { indicatorAlerts, saved: indicatorAlerts.length } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
    return { status: 400, json: { error: msg } };
  }
}

/** POST /indicator-alerts — kind: rsi (ค่าเริ่ม) | ema */
export async function liffSyncIndicatorAlerts(
  userId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = typeof b.kind === "string" ? b.kind.trim().toLowerCase() : "rsi";
  if (kind === "ema") return liffSyncEmaCrossIndicatorAlerts(userId, body);
  return liffSyncRsi1hIndicatorAlerts(userId, body);
}

export async function liffDeleteIndicatorAlert(
  userId: string,
  id: string
): Promise<{ status: number; json?: Record<string, unknown> }> {
  const ok = await removeIndicatorAlertById(userId, id);
  if (!ok) {
    return { status: 404, json: { error: "ไม่พบรายการ" } };
  }
  return { status: 204 };
}

/** สถิติ Spark (global) — ไม่มี userId แต่ต้องผ่าน auth ของหนึ่งใน `/api/liff` หรือ `/api/tma` */
export async function liffGetSparkStats(): Promise<SparkStatsApiPayload> {
  const state = await loadSparkFollowUpState();
  return buildSparkStatsApiPayload(state);
}

async function buildSnowballStatsPayload(
  rows: SnowballStatsApiPayload["rows"],
  telegramUserId: number | undefined,
): Promise<SnowballStatsApiPayload> {
  const conflictSets = await loadPendingConflictSets();
  const rowsWithConflict = rows.map((r) => ({
    ...r,
    conflictWith: resolveRowConflictWith(r, conflictSets, "snowball"),
  }));

  let viewerTpSlPlanSummary: string | undefined;
  let viewerTpSlPlan: ReturnType<typeof viewerStatsTpSlPlanPayload> | undefined;
  let viewerStrategyMarginUsdt: number | null | undefined;
  let viewerStrategyLeverage: number | null | undefined;
  let planForDisplay: Awaited<ReturnType<typeof resolveViewerStatsTpSlPlan>> | undefined;
  if (telegramUserId != null) {
    const [plan, sizing] = await Promise.all([
      resolveViewerStatsTpSlPlan(telegramUserId, "snowball"),
      resolveViewerStatsTradeSizing(telegramUserId, "snowball"),
    ]);
    planForDisplay = plan;
    viewerTpSlPlanSummary = viewerStatsTpSlPlanSummary(plan);
    viewerTpSlPlan = viewerStatsTpSlPlanPayload(plan);
    viewerStrategyMarginUsdt = sizing.marginUsdt;
    viewerStrategyLeverage = sizing.leverage;
  }
  const displayRows =
    planForDisplay != null
      ? rowsWithConflict.map((r) => withViewerStrategyProfitDisplayFields(r, planForDisplay!))
      : rowsWithConflict;
  return {
    rows: displayRows,
    ...(telegramUserId != null ? { isAdmin: isAdminTelegramUserId(telegramUserId) } : {}),
    ...(viewerTpSlPlanSummary ? { viewerTpSlPlanSummary } : {}),
    ...(viewerTpSlPlan ? { viewerTpSlPlan } : {}),
    ...(viewerStrategyMarginUsdt != null ? { viewerStrategyMarginUsdt } : {}),
    ...(viewerStrategyLeverage != null ? { viewerStrategyLeverage } : {}),
  };
}

/** สถิติ Snowball (global) — โหลดเร็ว ไม่ backfill Binance บน request (ใช้ปุ่ม Backfill) */
export async function liffGetSnowballStats(telegramUserId?: number): Promise<SnowballStatsApiPayload> {
  const st = await loadSnowballStatsState();
  const migrated = applySnowballStatsRowMigrations(st.rows);
  if (migrated > 0) await saveSnowballStatsState(st);

  const msDirty = await backfillAllStatsMarketSentiment(st.rows);
  const btcEmaDirty = await backfillAllStatsRowsBtcEmaSlopes(st.rows, { maxRowsPerPass: 25, maxPasses: 8 });
  const psar4hDirty = await backfillAllStatsRowsPsar4h(st.rows, { maxRowsPerPass: 25, maxPasses: 8 });
  const vol24hDirty = await backfillAllStatsRowsQuoteVol24h(st.rows, { maxRowsPerPass: 25, maxPasses: 8 });
  if (msDirty > 0 || btcEmaDirty > 0 || psar4hDirty > 0 || vol24hDirty > 0) await saveSnowballStatsState(st);

  // store จำกัดที่ SNOWBALL_STATS_MAX_ROWS (ดีฟอลต์ 400) — ส่งครบทุกแถว ไม่ slice ซ้ำ
  const rows = [...st.rows].sort((a, b) => b.alertedAtMs - a.alertedAtMs);
  if (telegramUserId != null) {
    const plan = await resolveViewerStatsTpSlPlan(telegramUserId, "snowball");
    const strategyDirty = await enrichSnowballStatsWithViewerStrategyProfit(rows, plan, {
      maxRows: 80,
    });
    if (strategyDirty > 0) await saveSnowballStatsState(st);
  }
  return buildSnowballStatsPayload(rows, telegramUserId);
}

export type LiffBackfillSnowballStatsResult =
  | (SnowballStatsAdminBackfillResult & { ok: true; strategyProfitEnriched: number })
  | { ok: false; status: number; error: string };

/** Admin — backfill EMA / horizon / gate / กำไรกลยุทธ์ (ดึง Binance) */
export async function liffBackfillSnowballStats(
  telegramUserId: number,
  opts?: { symbol?: string },
): Promise<LiffBackfillSnowballStatsResult> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  try {
    const backfill = await runSnowballStatsAdminBackfill({ symbol: opts?.symbol });
    if (!backfill.ok) {
      return {
        ok: false,
        status: 503,
        error: backfill.skippedReason ?? "backfill ไม่สำเร็จ",
      };
    }

    let strategyProfitEnriched = 0;
    if (!backfill.hasMore) {
      const st = await loadSnowballStatsState();
      const rows = [...st.rows].sort((a, b) => b.alertedAtMs - a.alertedAtMs).slice(0, 60);
      const plan = await resolveViewerStatsTpSlPlan(telegramUserId, "snowball");
      strategyProfitEnriched = await enrichSnowballStatsWithViewerStrategyProfit(rows, plan);
      if (strategyProfitEnriched > 0) {
        await saveSnowballStatsState(st);
      }
    }

    return { ...backfill, ok: true, strategyProfitEnriched };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function liffGetAutoOpenOrderHistory(
  userId: string,
  opts?: {
    days?: number;
    source?: AutoOpenSource;
    reversalAlertSide?: import("@/lib/autoOpenOrderLogClient").ReversalAutoOpenAlertSide;
  },
): Promise<AutoOpenOrderLogApiPayload> {
  const settingsMap = await loadTradingViewMexcSettingsFullMap();
  const { enrichAutoOpenOrderLogsTpStrategyForUser } = await import(
    "./autoOpenOrderLogTpStrategyEnrich"
  );
  await enrichAutoOpenOrderLogsTpStrategyForUser(userId, settingsMap, opts);
  const rawRows = await listAutoOpenOrderLogsForUser(userId, opts);
  const [conflictSets, statsConflictIndex] = await Promise.all([
    loadPendingConflictSets(),
    loadStatsConflictIndex(),
  ]);
  const rowsWithConflict: AutoOpenOrderLogRow[] = rawRows.map((r) => ({
    ...r,
    conflictWith: resolveAutoOpenLogConflictWith(r, conflictSets, statsConflictIndex),
  }));
  const mexcCtx = await resolveAutoOpenMexcOpenContextForUser(userId);
  const rowsActive = annotateAutoOpenRowsWithMexcActive(rowsWithConflict, mexcCtx.activeKeys);
  const rowsWithStrategy = rowsActive.map((r) => {
    const plan = resolveTpSlPlanForUserId(userId, r.source, settingsMap);
    return withAutoOpenTpStrategyDisplayFields(r, plan);
  });
  const skippedTotal = await countSkippedAutoOpenOrderLogsForUser(userId, {
    source: opts?.source,
    reversalAlertSide: opts?.reversalAlertSide,
  });
  const symbols = collectAutoOpenContractSymbols(rowsWithStrategy.map((r) => r.contractSymbol));
  const markPrices = await fetchAutoOpenMarkPrices(symbols);
  const rows = await attachAutoOpenMexcOpenPnlSnapshots(
    rowsWithStrategy,
    mexcCtx.openPositions,
    markPrices,
  );

  let mexcBalance: AutoOpenOrderLogApiPayload["mexcBalance"] = null;
  const credsRow = settingsMap[userId];
  if (credsRow?.mexcApiKey?.trim() && credsRow?.mexcSecret?.trim()) {
    const creds: MexcCredentials = {
      apiKey: credsRow.mexcApiKey.trim(),
      secret: credsRow.mexcSecret.trim(),
    };
    try {
      const assetsRes = await fetchFuturesAccountAssetList(creds);
      if (assetsRes.ok) {
        mexcBalance = parseMexcUsdtBalanceFromAssets(assetsRes.rows);
      }
    } catch {
      mexcBalance = null;
    }
  }

  return { rows, summary: summarizeAutoOpenOrderLogs(rows), skippedTotal, markPrices, mexcBalance };
}

export async function liffGetAutoOpenMarkPrices(
  contractSymbols: string[],
): Promise<{ markPrices: Record<string, number> }> {
  const markPrices = await fetchAutoOpenMarkPrices(collectAutoOpenContractSymbols(contractSymbols));
  return { markPrices };
}

export async function liffClearSkippedAutoOpenOrderLogs(
  userId: string,
  opts?: {
    source?: AutoOpenSource;
    reversalAlertSide?: import("@/lib/autoOpenOrderLogClient").ReversalAutoOpenAlertSide;
  },
): Promise<{ ok: true; removed: number }> {
  const { removed } = await deleteSkippedAutoOpenOrderLogsForUser(userId, opts);
  return { ok: true, removed };
}

export async function liffDeleteSnowballStatsRow(
  telegramUserId: number,
  rowId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  const found = await deleteSnowballStatsRowById(rowId);
  if (!found) {
    return { ok: false, status: 404, error: "ไม่พบแถวนี้ (อาจถูกลบแล้ว)" };
  }
  return { ok: true };
}

export async function liffResetSnowballStats(
  telegramUserId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  await resetSnowballStatsState();
  return { ok: true };
}

/**
 * Admin — บังคับ recompute `outcome` + `resultRr` ของทุกแถวที่มี `pct48h` แล้ว (ข้าม pending guard)
 * ใช้ค่า pct48h / maxRoiPct ที่บันทึกอยู่แล้ว (ไม่ refetch kline)
 */
export async function liffCorrectSnowballStatsOutcome(
  telegramUserId: number,
  opts?: { symbol?: string },
): Promise<
  | {
      ok: true;
      scanned: number;
      changedOutcome: number;
      changedRr: number;
    }
  | { ok: false; status: number; error: string }
> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  try {
    const r = await correctSnowballStatsOutcomeFromPct48h({ symbol: opts?.symbol });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function liffGetCandleReversalStats(
  telegramUserId?: number,
): Promise<CandleReversalStatsApiPayload> {
  const st = await loadCandleReversalStatsState();
  const msDirty = await backfillAllStatsMarketSentiment(st.rows);
  const btcEmaDirty = await backfillAllStatsRowsBtcEmaSlopes(st.rows, { maxRowsPerPass: 25, maxPasses: 8 });
  const psar4hDirty = await backfillAllStatsRowsPsar4h(st.rows, { maxRowsPerPass: 25, maxPasses: 8 });
  const vol24hDirty = await backfillAllStatsRowsQuoteVol24h(st.rows, { maxRowsPerPass: 25, maxPasses: 8 });
  if (msDirty > 0 || btcEmaDirty > 0 || psar4hDirty > 0 || vol24hDirty > 0) await saveCandleReversalStatsState(st);

  const conflictSets = await loadPendingConflictSets();
  const rows = [...st.rows]
    .sort((a, b) => b.alertedAtMs - a.alertedAtMs)
    .map((r) => ({
      ...r,
      conflictWith: resolveRowConflictWith(r, conflictSets, "reversal"),
    }));
  let viewerTpSlPlanSummary: string | undefined;
  let viewerTpSlPlan: ReturnType<typeof viewerStatsTpSlPlanPayload> | undefined;
  let viewerStrategyMarginUsdt: number | null | undefined;
  let viewerStrategyLeverage: number | null | undefined;
  let viewerStrategyLongDynamicLeverageEnabled: boolean | undefined;
  if (telegramUserId != null) {
    const [plan, sizing] = await Promise.all([
      resolveViewerStatsTpSlPlan(telegramUserId, "reversal"),
      resolveViewerStatsTradeSizing(telegramUserId, "reversal"),
    ]);
    viewerTpSlPlanSummary = REVERSAL_TP_STRATEGY_SUMMARY;
    viewerTpSlPlan = viewerStatsTpSlPlanPayload(plan);
    viewerStrategyMarginUsdt = sizing.marginUsdt;
    viewerStrategyLeverage = sizing.leverage;
    viewerStrategyLongDynamicLeverageEnabled = sizing.reversalLongDynamicLeverageEnabled === true;
    const dirty = await enrichCandleReversalStatsWithViewerStrategyProfit(rows, plan);
    if (dirty > 0) {
      await saveCandleReversalStatsState(st);
    }
    for (let i = 0; i < rows.length; i++) {
      rows[i] = withReversalStrategyProfitDisplayFields(rows[i]!);
    }
  }
  return {
    rows,
    ...(telegramUserId != null ? { isAdmin: isAdminTelegramUserId(telegramUserId) } : {}),
    ...(viewerTpSlPlanSummary ? { viewerTpSlPlanSummary } : {}),
    ...(viewerTpSlPlan ? { viewerTpSlPlan } : {}),
    ...(viewerStrategyMarginUsdt != null ? { viewerStrategyMarginUsdt } : {}),
    ...(viewerStrategyLeverage != null ? { viewerStrategyLeverage } : {}),
    ...(viewerStrategyLongDynamicLeverageEnabled
      ? { viewerStrategyLongDynamicLeverageEnabled: true }
      : {}),
  };
}

export async function liffResetCandleReversalStats(
  telegramUserId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  await resetCandleReversalStatsState();
  return { ok: true };
}

/**
 * Backfill Reversal stats: รัน follow-up tick (refetch pct ที่ Binance + auto-finalize)
 * + force-recompute outcome ทุกแถวจาก horizon pct (1H→pct24h · 1D→pct7d) โดยข้าม pending guard
 */
export async function liffBackfillCandleReversalStats(
  telegramUserId: number,
): Promise<
  | { ok: true; updated: number; scanned: number; changedOutcome: number; removedDupes: number }
  | { ok: false; status: number; error: string }
> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  try {
    const { removed: removedDupes } = await removeCandleReversalStatsDuplicatePendingRows();
    const updated = await runCandleReversalStatsFollowUpTick(Date.now(), {
      forceLong1hFadeShort: true,
    });
    const { scanned, changedOutcome } = await correctCandleReversalStatsOutcome();
    return { ok: true, updated, scanned, changedOutcome, removedDupes };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function liffGetRsiDivergenceStats(
  telegramUserId?: number,
): Promise<RsiDivergenceStatsApiPayload> {
  const st = await loadRsiDivergenceStatsState();
  const msDirty = await backfillAllStatsMarketSentiment(st.rows);
  if (msDirty > 0) await saveRsiDivergenceStatsState(st);

  const rows = [...st.rows].sort((a, b) => b.alertedAtMs - a.alertedAtMs);
  return {
    rows,
    ...(telegramUserId != null ? { isAdmin: isAdminTelegramUserId(telegramUserId) } : {}),
  };
}

export async function liffResetRsiDivergenceStats(
  telegramUserId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  await resetRsiDivergenceStatsState();
  return { ok: true };
}

/**
 * Backfill RSI Divergence stats: รัน follow-up tick (refetch horizon ที่ Binance + auto-finalize)
 * + force-recompute outcome ทุกแถวจาก horizon ตัดผล (ดีฟอลต์ pct3d) โดยข้าม pending guard
 */
export async function liffBackfillRsiDivergenceStats(
  telegramUserId: number,
): Promise<
  | { ok: true; updated: number; scanned: number; changedOutcome: number }
  | { ok: false; status: number; error: string }
> {
  if (!isAdminTelegramUserId(telegramUserId)) {
    return { ok: false, status: 403, error: "เฉพาะ admin — ตั้ง KOJI_ADMIN_IDS ในเซิร์ฟเวอร์" };
  }
  try {
    const updated = await runRsiDivergenceStatsFollowUpTick(Date.now());
    const { scanned, changedOutcome } = await correctRsiDivergenceStatsOutcome();
    return { ok: true, updated, scanned, changedOutcome };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

function publicAppBaseForTvWebhook(): { origin: string; path: string } {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const origin = raw.replace(/\/$/, "");
  // Recommended stable endpoint (supports both OPEN_POSITION and CLOSE_POSITION).
  return { origin, path: "/api/webhooks/tv" };
}

/** URL เต็มสำหรับ TradingView Webhook (เช่น https://koji-five.vercel.app/api/webhooks/tv) */
export function getTradingViewMexcWebhookCloseUrl(): string {
  const { origin, path } = publicAppBaseForTvWebhook();
  return origin ? `${origin}${path}` : path;
}

/** Alias ที่ชื่อสื่อความหมายมากกว่า (แนะนำให้ใช้) */
export function getTradingViewMexcWebhookUrl(): string {
  return getTradingViewMexcWebhookCloseUrl();
}

export function tradingViewMexcExamplePayload(userId: string, token: string): Record<string, string> {
  return {
    id: userId,
    token,
    symbol: "{{ticker}}",
    price: "{{close}}",
    cmd: "CLOSE_POSITION",
    nonce: newTvWebhookNonce(),
    remark: "Break Trendline",
  };
}

export function formatTradingViewMexcWebhookJson(userId: string, token: string): string {
  return `${JSON.stringify(tradingViewMexcExamplePayload(userId, token), null, 2)}\n`;
}

export function tradingViewMexcExampleOpenPayload(
  userId: string,
  token: string,
  side: "LONG" | "SHORT",
  marginUsdt: number,
  leverage: number
): Record<string, string | number> {
  return {
    id: userId,
    token,
    symbol: "{{ticker}}",
    price: "{{close}}",
    cmd: "OPEN_POSITION",
    side,
    marginUsdt,
    leverage,
    nonce: newTvWebhookNonce(),
    remark: "Trend signal",
  };
}

export function formatTradingViewMexcOpenWebhookJson(
  userId: string,
  token: string,
  side: "LONG" | "SHORT",
  marginUsdt: number,
  leverage: number
): string {
  return `${JSON.stringify(tradingViewMexcExampleOpenPayload(userId, token, side, marginUsdt, leverage), null, 2)}\n`;
}

/** ค่าใน GET เทียบได้กับ body.sparkAutoTrade ตอนบันทึก */
/** คีย์สอดคล้อง body.sparkAutoTrade ตอน POST */
export function tradingViewSparkAutoTradePayloadFromRow(row: TradingViewMexcUserSettings): Record<string, unknown> {
  return {
    enabled: row.sparkAutoTradeEnabled ?? false,
    direction: row.sparkAutoTradeDirection ?? "both",
    orderSide: orderSideEffective(row),
    marginUsdt: row.sparkAutoTradeMarginUsdt ?? null,
    leverage: row.sparkAutoTradeLeverage ?? null,
    tpPct: row.sparkAutoTradeTpPct ?? null,
    timeStopHours: row.sparkAutoTradeTimeStopHours ?? null,
    byVol: row.sparkAutoTradeByVol ?? null,
  };
}

export function tradingViewSnowballAutoTradePayloadFromRow(
  row: TradingViewMexcUserSettings
): Record<string, unknown> {
  return {
    enabled: row.snowballAutoTradeEnabled ?? false,
    marginUsdt: row.snowballAutoTradeMarginUsdt ?? null,
    leverage: row.snowballAutoTradeLeverage ?? null,
    tpSlEnabled: row.snowballAutoTradeTpSlEnabled ?? true,
    tp1PricePct: row.snowballAutoTradeTp1PricePct ?? null,
    tp1PartialPct: row.snowballAutoTradeTp1PartialPct ?? null,
    tp2PricePct: row.snowballAutoTradeTp2PricePct ?? null,
    maxHoldHours: row.snowballAutoTradeMaxHoldHours ?? null,
    holdExtendIfRedEnabled: row.snowballAutoTradeHoldExtendIfRedEnabled === true,
    holdExtendRedHours: row.snowballAutoTradeHoldExtendRedHours ?? null,
    slArmRoiPct: row.snowballAutoTradeSlArmRoiPct ?? null,
    slEntryOffsetPct: row.snowballAutoTradeSlEntryOffsetPct ?? null,
    slAtEntryAfter24hIfGreenEnabled:
      row.snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled !== false,
    qualitySignalLongGrades: resolveSnowballQualitySignalLongGrades(row),
    qualitySignalLongEnabled: snowballQualitySignalLongFeatureEnabled(row),
    gradeFFadeShortEnabled:
      row.snowballAutoTradeGradeFFadeShortEnabled ??
      row.snowballAutoTradeQualityShortSignalShortEnabled ??
      false,
    shortSignalShortEnabled: row.snowballAutoTradeShortSignalShortEnabled ?? false,
    qualityShortTpSlEnabled: row.snowballAutoTradeQualityShortTpSlEnabled ?? true,
    qualityShortTp1PricePct: row.snowballAutoTradeQualityShortTp1PricePct ?? null,
    qualityShortTp1PartialPct: row.snowballAutoTradeQualityShortTp1PartialPct ?? null,
    qualityShortTp2PricePct: row.snowballAutoTradeQualityShortTp2PricePct ?? null,
    qualityShortMaxHoldHours: row.snowballAutoTradeQualityShortMaxHoldHours ?? null,
    qualityShortHoldExtendIfRedEnabled:
      row.snowballAutoTradeQualityShortHoldExtendIfRedEnabled === true,
    qualityShortHoldExtendRedHours: row.snowballAutoTradeQualityShortHoldExtendRedHours ?? null,
    qualityShortSlArmRoiPct: row.snowballAutoTradeQualityShortSlArmRoiPct ?? null,
    qualityShortSlEntryOffsetPct: row.snowballAutoTradeQualityShortSlEntryOffsetPct ?? null,
    qualityShortSlAtEntryAfter24hIfGreenEnabled:
      row.snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled !== false,
    sundayAllShortEnabled: row.snowballAutoTradeSundayAllShortEnabled ?? false,
    longDynamicBoostEnabled: row.snowballAutoTradeLongDynamicBoostEnabled === true,
    referenceEma20_1hEnabled: row.snowballAutoTradeReferenceEma20_1hEnabled ?? false,
    entryMode: row.snowballAutoTradeEntryMode ?? "market",
    entryEmaPeriod: row.snowballAutoTradeEntryEmaPeriod ?? 20,
  };
}

export function tradingViewPortfolioTrailingPayloadFromRow(
  row: TradingViewMexcUserSettings
): Record<string, unknown> {
  return {
    enabled: row.portfolioTrailingAlertEnabled ?? false,
    stepPct: row.portfolioTrailingStepPct ?? null,
  };
}

export function tradingViewReversalAutoTradePayloadFromRow(
  row: TradingViewMexcUserSettings
): Record<string, unknown> {
  return {
    enabled: row.reversalAutoTradeEnabled ?? false,
    marginUsdt: row.reversalAutoTradeMarginUsdt ?? null,
    leverage: row.reversalAutoTradeLeverage ?? null,
    tpSlEnabled: row.reversalAutoTradeTpSlEnabled ?? true,
    tp1PricePct: row.reversalAutoTradeTp1PricePct ?? null,
    tp1PartialPct: row.reversalAutoTradeTp1PartialPct ?? null,
    tp2PricePct: row.reversalAutoTradeTp2PricePct ?? null,
    maxHoldHours: row.reversalAutoTradeMaxHoldHours ?? null,
    holdExtendIfRedEnabled: row.reversalAutoTradeHoldExtendIfRedEnabled === true,
    holdExtendRedHours: row.reversalAutoTradeHoldExtendRedHours ?? null,
    slArmRoiPct: row.reversalAutoTradeSlArmRoiPct ?? null,
    slEntryOffsetPct: row.reversalAutoTradeSlEntryOffsetPct ?? null,
    slAtEntryAfter24hIfGreenEnabled:
      row.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled !== false,
    gateQualitySignal: row.reversalAutoTradeGateQualitySignal !== false,
    saturdayAllSignalsEnabled: row.reversalAutoTradeSaturdayAllSignalsEnabled ?? false,
    longSignalShortEnabled: row.reversalAutoTradeLongSignalShortEnabled ?? false,
    longDynamicLeverageEnabled: row.reversalAutoTradeLongDynamicLeverageEnabled === true,
    ...(() => {
      const shortEntry = reversalEntrySettingsFromRow(row, "short");
      const longEntry = reversalEntrySettingsFromRow(row, "long");
      return {
        entryMode: shortEntry.mode,
        entryEmaPeriod: shortEntry.emaPeriod,
        shortEntryMode: shortEntry.mode,
        shortEntryEmaPeriod: shortEntry.emaPeriod,
        longEntryMode: longEntry.mode,
        longEntryEmaPeriod: longEntry.emaPeriod,
      };
    })(),
  };
}

function parsePortfolioTrailingAlertNested(
  raw: unknown
):
  | { ok: false; error: string }
  | { ok: true; patch: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret"> } {
  if (raw === undefined || raw === null) return { ok: false, error: "missing_portfolio_trailing_bundle" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "portfolio_trailing_must_object" };
  }
  const o = raw as Record<string, unknown>;

  let enabled = false;
  if (typeof o.enabled === "boolean") enabled = o.enabled;
  else if (o.enabled === "1" || o.enabled === 1 || o.enabled === "true") enabled = true;

  if (!enabled) {
    return {
      ok: true,
      patch: {
        portfolioTrailingAlertEnabled: false,
        portfolioTrailingStepPct: null,
      },
    };
  }

  const stepRaw = o.stepPct ?? o.step;
  const stepPct = typeof stepRaw === "number" ? stepRaw : Number(stepRaw);
  if (!Number.isFinite(stepPct) || !isPctStepPresetValue(stepPct)) {
    return {
      ok: false,
      error: `stepPct ต้องเป็นหนึ่งใน ${PCT_STEP_PRESET_VALUES.join(", ")}`,
    };
  }

  return {
    ok: true,
    patch: {
      portfolioTrailingAlertEnabled: true,
      portfolioTrailingStepPct: stepPct,
    },
  };
}

/** ประกอบ row แล้วรันตัว resolver เดียวกับ cron */
function mergeTradingViewRowForSparkValidation(
  prev: TradingViewMexcUserSettings,
  patch: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret">
): TradingViewMexcUserSettings {
  return {
    ...prev,
    sparkAutoTradeEnabled: patch.sparkAutoTradeEnabled ?? prev.sparkAutoTradeEnabled ?? false,
    sparkAutoTradeDirection: patch.sparkAutoTradeDirection ?? prev.sparkAutoTradeDirection ?? "both",
    sparkAutoTradeInvertSide: patch.sparkAutoTradeOrderSide !== undefined ? undefined : prev.sparkAutoTradeInvertSide,
    sparkAutoTradeOrderSide:
      patch.sparkAutoTradeOrderSide !== undefined ? patch.sparkAutoTradeOrderSide : orderSideEffective(prev),
    sparkAutoTradeMarginUsdt:
      patch.sparkAutoTradeMarginUsdt === null
        ? undefined
        : patch.sparkAutoTradeMarginUsdt !== undefined
          ? patch.sparkAutoTradeMarginUsdt
          : prev.sparkAutoTradeMarginUsdt,
    sparkAutoTradeLeverage:
      patch.sparkAutoTradeLeverage === null
        ? undefined
        : patch.sparkAutoTradeLeverage !== undefined
          ? patch.sparkAutoTradeLeverage
          : prev.sparkAutoTradeLeverage,
    sparkAutoTradeTpPct:
      patch.sparkAutoTradeTpPct === null
        ? undefined
        : patch.sparkAutoTradeTpPct !== undefined
          ? patch.sparkAutoTradeTpPct
          : prev.sparkAutoTradeTpPct,
    sparkAutoTradeTimeStopHours:
      patch.sparkAutoTradeTimeStopHours === null
        ? undefined
        : patch.sparkAutoTradeTimeStopHours !== undefined
          ? patch.sparkAutoTradeTimeStopHours
          : prev.sparkAutoTradeTimeStopHours,
    sparkAutoTradeByVol:
      patch.sparkAutoTradeByVol === null
        ? undefined
        : patch.sparkAutoTradeByVol !== undefined
          ? patch.sparkAutoTradeByVol
          : prev.sparkAutoTradeByVol,
  };
}

/** ค่ารับจาก client เทียบ `SparkAutoTradeOrderSide` — โหม่ย่อ follow/fade allowed */
function normalizeSparkOrderSideKey(raw: unknown): SparkAutoTradeOrderSide | null {
  const k =
    typeof raw === "number" && Number.isFinite(raw)
      ? String(raw).trim().toLowerCase()
      : typeof raw === "string"
        ? raw.trim().toLowerCase().replace(/-/g, "_")
        : "";
  if (k === "follow_spark" || k === "followspark" || k === "follow") return "follow_spark";
  if (k === "fade_spark" || k === "fadespark" || k === "fade") return "fade_spark";
  if (k === "long") return "long";
  if (k === "short") return "short";
  return null;
}

/** body.sparkAutoTrade จาก client — null ฟิลด์ใน byVol tier = ว่างใน tier */
function parseSparkAutoTradeNested(
  raw: unknown
): { ok: false; error: string } | { ok: true; patch: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret"> } {
  if (raw === undefined || raw === null) return { ok: false, error: "missing_spark_bundle" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "spark_must_object" };

  const o = raw as Record<string, unknown>;
  const dirRaw = typeof o.direction === "string" ? o.direction.trim().toLowerCase() : "both";

  let direction: "both" | "long_only" | "short_only" | null = null;
  if (dirRaw === "both" || dirRaw === "") direction = "both";
  else if (dirRaw === "long_only" || dirRaw === "long-only") direction = "long_only";
  else if (dirRaw === "short_only" || dirRaw === "short-only") direction = "short_only";
  else return { ok: false, error: "spark_direction_invalid" };

  let enabled = false;
  if (typeof o.enabled === "boolean") enabled = o.enabled;
  else if (o.enabled === "1" || o.enabled === 1 || o.enabled === "true") enabled = true;

  let invertSidePatch: boolean | undefined;
  if ("invertSide" in o) {
    const iv = (o as { invertSide?: unknown }).invertSide;
    if (typeof iv === "boolean") invertSidePatch = iv;
    else if (iv === 1 || iv === "1" || iv === "true") invertSidePatch = true;
    else if (iv === 0 || iv === "0" || iv === "false") invertSidePatch = false;
    else if (iv === null || iv === "") invertSidePatch = false;
    else return { ok: false, error: "spark_invert_side_invalid" };
  }

  let orderSidePatch: SparkAutoTradeOrderSide | undefined;
  if ("orderSide" in o && o.orderSide !== undefined && o.orderSide !== "") {
    const normalized = normalizeSparkOrderSideKey(o.orderSide);
    if (!normalized) return { ok: false, error: "spark_order_side_invalid" };
    orderSidePatch = normalized;
  }
  if (orderSidePatch === undefined && invertSidePatch !== undefined) {
    orderSidePatch = invertSidePatch ? "fade_spark" : "follow_spark";
  }

  const numOrEmpty = (
    key: string
  ): { v: number | null | undefined; err?: string } => {
    if (!(key in o)) return { v: undefined };
    const x = o[key];
    if (x === null || x === "" || x === undefined) return { v: null };
    const n = typeof x === "number" ? x : Number(String(x).replace(/,/g, "").trim());
    if (!Number.isFinite(n)) return { v: undefined, err: `${key}_not_number` };
    return { v: n };
  };

  const mMargin = numOrEmpty("marginUsdt");
  const mLev = numOrEmpty("leverage");
  const mTp = numOrEmpty("tpPct");
  if (mMargin.err || mLev.err || mTp.err) return { ok: false, error: "spark_numeric_invalid" };

  let byVol: SparkAutoTradeByVol | null | undefined;
  const bvRaw = o.byVol;
  if (bvRaw === null || bvRaw === "") byVol = null;
  else if (bvRaw !== undefined && (typeof bvRaw !== "object" || Array.isArray(bvRaw))) {
    return { ok: false, error: "byVol_invalid" };
  } else if (bvRaw !== undefined && typeof bvRaw === "object" && !Array.isArray(bvRaw)) {
    const allowed = new Set(["high", "mid", "low", "unknown"]);
    const out: SparkAutoTradeByVol = {};
    for (const [tier, preset] of Object.entries(bvRaw as Record<string, unknown>)) {
      const tk = tier.trim().toLowerCase();
      if (!allowed.has(tk)) continue;
      if (preset !== null && (typeof preset !== "object" || Array.isArray(preset))) continue;
      if (preset === null) continue;
      const pr = preset as Record<string, unknown>;
      let enT: boolean | undefined;
      if (typeof pr.enabledBand === "boolean") enT = pr.enabledBand;
      else if (pr.enabledBand === "0" || pr.enabledBand === 0 || pr.enabledBand === "false") enT = false;
      else if (pr.enabledBand === "1" || pr.enabledBand === 1 || pr.enabledBand === "true") enT = true;
      const nM = typeof pr.marginUsdt === "number" ? pr.marginUsdt : Number(String(pr.marginUsdt ?? "").replace(/,/g, ""));
      const nL = typeof pr.leverage === "number" ? pr.leverage : Number(String(pr.leverage ?? ""));
      const nP = typeof pr.tpPct === "number" ? pr.tpPct : Number(String(pr.tpPct ?? ""));
      const entry: SparkAutoTradeVolBandPreset = {};
      if (enT !== undefined) entry.enabledBand = enT;
      /* อย่าเก็บ 0 — ไม่งั้น ?? ใน sparkAutoTradeParamsForVolBand ไม่ fallback ไป default แถว */
      if (Number.isFinite(nM) && (nM as number) > 0) entry.marginUsdt = nM as number;
      if (Number.isFinite(nL) && (nL as number) >= 1) entry.leverage = Math.floor(nL as number);
      if (Number.isFinite(nP) && (nP as number) >= 0) entry.tpPct = nP as number;
      const hasAny = Object.keys(entry).length > 0;
      if (hasAny) out[tk as keyof SparkAutoTradeByVol] = entry;
    }
    byVol = Object.keys(out).length > 0 ? out : null;
  } else byVol = undefined;

  let sparkAutoTradeTimeStopHours: number | null | undefined;
  if ("timeStopHours" in o) {
    const x = o.timeStopHours;
    if (x === null || x === false || x === "" || x === 0 || x === "0") {
      sparkAutoTradeTimeStopHours = null;
    } else {
      const n = typeof x === "number" ? x : Number(String(x).replace(/,/g, "").trim());
      if (!Number.isFinite(n)) return { ok: false, error: "spark_time_stop_hours_invalid" };
      const h = Math.floor(n);
      if (h < 1 || h > 168) return { ok: false, error: "spark_time_stop_hours_invalid" };
      sparkAutoTradeTimeStopHours = h;
    }
  }

  const patchPart: Omit<
    SaveTradingViewMexcInput,
    "mexcApiKey" | "mexcSecret" | "clearMexcCreds" | "rotateWebhookToken"
  > = {
    sparkAutoTradeEnabled: enabled,
    sparkAutoTradeDirection: direction ?? undefined,
    ...(orderSidePatch !== undefined ? { sparkAutoTradeOrderSide: orderSidePatch } : {}),
    sparkAutoTradeMarginUsdt: mMargin.v as number | null | undefined,
    sparkAutoTradeLeverage: mLev.v as number | null | undefined,
    sparkAutoTradeTpPct: mTp.v as number | null | undefined,
    ...(sparkAutoTradeTimeStopHours !== undefined ? { sparkAutoTradeTimeStopHours } : {}),
    sparkAutoTradeByVol: byVol ?? undefined,
  };

  return { ok: true, patch: patchPart };
}

function parseSnowballAutoTradeNested(
  raw: unknown
):
  | { ok: false; error: string }
  | { ok: true; patch: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret"> } {
  if (raw === undefined || raw === null) return { ok: false, error: "missing_snowball_bundle" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "snowball_must_object" };
  const o = raw as Record<string, unknown>;

  let enabled = false;
  if (typeof o.enabled === "boolean") enabled = o.enabled;
  else if (o.enabled === "1" || o.enabled === 1 || o.enabled === "true") enabled = true;

  const numOrEmpty = (
    key: string
  ): { v: number | null | undefined; err?: string } => {
    if (!(key in o)) return { v: undefined };
    const x = o[key];
    if (x === null || x === "" || x === undefined) return { v: null };
    const n = typeof x === "number" ? x : Number(String(x).replace(/,/g, "").trim());
    if (!Number.isFinite(n)) return { v: undefined, err: `${key}_not_number` };
    return { v: n };
  };

  const mMargin = numOrEmpty("marginUsdt");
  const mLev = numOrEmpty("leverage");
  const mTp1 = numOrEmpty("tp1PricePct");
  const mTp1Partial = numOrEmpty("tp1PartialPct");
  const mTp2 = numOrEmpty("tp2PricePct");
  const mMaxH = numOrEmpty("maxHoldHours");
  const mExtH = numOrEmpty("holdExtendRedHours");
  const mSlArm = numOrEmpty("slArmRoiPct");
  const mSlOff = numOrEmpty("slEntryOffsetPct");
  const mQsTp1 = numOrEmpty("qualityShortTp1PricePct");
  const mQsTp1Partial = numOrEmpty("qualityShortTp1PartialPct");
  const mQsTp2 = numOrEmpty("qualityShortTp2PricePct");
  const mQsMaxH = numOrEmpty("qualityShortMaxHoldHours");
  const mQsExtH = numOrEmpty("qualityShortHoldExtendRedHours");
  const mQsSlArm = numOrEmpty("qualityShortSlArmRoiPct");
  const mQsSlOff = numOrEmpty("qualityShortSlEntryOffsetPct");
  if (
    mMargin.err ||
    mLev.err ||
    mTp1.err ||
    mTp1Partial.err ||
    mTp2.err ||
    mMaxH.err ||
    mExtH.err ||
    mSlArm.err ||
    mSlOff.err ||
    mQsTp1.err ||
    mQsTp1Partial.err ||
    mQsTp2.err ||
    mQsMaxH.err ||
    mQsExtH.err ||
    mQsSlArm.err ||
    mQsSlOff.err
  ) {
    return { ok: false, error: "snowball_numeric_invalid" };
  }

  const validateTpSlNums = (
    tp1: { v: number | null | undefined },
    tp1Partial: { v: number | null | undefined },
    tp2: { v: number | null | undefined },
    maxH: { v: number | null | undefined },
    slArm: { v: number | null | undefined },
    slOff: { v: number | null | undefined },
    prefix: string,
  ): { ok: false; error: string } | null => {
    if (typeof tp1.v === "number" && !(tp1.v > 0 && tp1.v < 100)) {
      return { ok: false, error: `${prefix}tp1_price_pct_out_of_range` };
    }
    if (typeof tp1Partial.v === "number" && !(tp1Partial.v > 0 && tp1Partial.v < 100)) {
      return { ok: false, error: `${prefix}tp1_partial_pct_out_of_range` };
    }
    if (typeof tp2.v === "number" && !(tp2.v > 0 && tp2.v < 100)) {
      return { ok: false, error: `${prefix}tp2_price_pct_out_of_range` };
    }
    if (typeof maxH.v === "number" && !(maxH.v > 0 && maxH.v <= 24 * 30)) {
      return { ok: false, error: `${prefix}max_hold_hours_out_of_range` };
    }
    if (typeof tp1.v === "number" && typeof tp2.v === "number" && !(tp2.v > tp1.v)) {
      return { ok: false, error: `${prefix}tp2_must_gt_tp1` };
    }
    if (typeof slArm.v === "number" && !(slArm.v > 0 && slArm.v < 100)) {
      return { ok: false, error: `${prefix}sl_arm_roi_pct_out_of_range` };
    }
    if (typeof slOff.v === "number" && !(slOff.v >= 0 && slOff.v < 50)) {
      return { ok: false, error: `${prefix}sl_entry_offset_pct_out_of_range` };
    }
    return null;
  };

  const mainTpErr = validateTpSlNums(mTp1, mTp1Partial, mTp2, mMaxH, mSlArm, mSlOff, "snowball_");
  if (mainTpErr) return mainTpErr;
  if (typeof mExtH.v === "number" && !(mExtH.v > 0 && mExtH.v <= 24 * 30)) {
    return { ok: false, error: "snowball_hold_extend_red_hours_out_of_range" };
  }
  const qsTpErr = validateTpSlNums(
    mQsTp1,
    mQsTp1Partial,
    mQsTp2,
    mQsMaxH,
    mQsSlArm,
    mQsSlOff,
    "snowball_quality_short_",
  );
  if (qsTpErr) return qsTpErr;
  if (typeof mQsExtH.v === "number" && !(mQsExtH.v > 0 && mQsExtH.v <= 24 * 30)) {
    return { ok: false, error: "snowball_quality_short_hold_extend_red_hours_out_of_range" };
  }

  let tpSlEnabled: boolean | undefined;
  if (typeof o.tpSlEnabled === "boolean") tpSlEnabled = o.tpSlEnabled;
  else if (o.tpSlEnabled === "1" || o.tpSlEnabled === 1 || o.tpSlEnabled === "true") tpSlEnabled = true;
  else if (o.tpSlEnabled === "0" || o.tpSlEnabled === 0 || o.tpSlEnabled === "false") tpSlEnabled = false;

  let holdExtendIfRedEnabled: boolean | undefined;
  if (typeof o.holdExtendIfRedEnabled === "boolean") holdExtendIfRedEnabled = o.holdExtendIfRedEnabled;
  else if (o.holdExtendIfRedEnabled === "1" || o.holdExtendIfRedEnabled === 1 || o.holdExtendIfRedEnabled === "true") {
    holdExtendIfRedEnabled = true;
  } else if (o.holdExtendIfRedEnabled === "0" || o.holdExtendIfRedEnabled === 0 || o.holdExtendIfRedEnabled === "false") {
    holdExtendIfRedEnabled = false;
  }

  let slAtEntryAfter24hIfGreenEnabled: boolean | undefined;
  if (typeof o.slAtEntryAfter24hIfGreenEnabled === "boolean") {
    slAtEntryAfter24hIfGreenEnabled = o.slAtEntryAfter24hIfGreenEnabled;
  } else if (
    o.slAtEntryAfter24hIfGreenEnabled === "1" ||
    o.slAtEntryAfter24hIfGreenEnabled === 1 ||
    o.slAtEntryAfter24hIfGreenEnabled === "true"
  ) {
    slAtEntryAfter24hIfGreenEnabled = true;
  } else if (
    o.slAtEntryAfter24hIfGreenEnabled === "0" ||
    o.slAtEntryAfter24hIfGreenEnabled === 0 ||
    o.slAtEntryAfter24hIfGreenEnabled === "false"
  ) {
    slAtEntryAfter24hIfGreenEnabled = false;
  }

  let qualityShortTpSlEnabled: boolean | undefined;
  if (typeof o.qualityShortTpSlEnabled === "boolean") qualityShortTpSlEnabled = o.qualityShortTpSlEnabled;
  else if (o.qualityShortTpSlEnabled === "1" || o.qualityShortTpSlEnabled === 1 || o.qualityShortTpSlEnabled === "true") {
    qualityShortTpSlEnabled = true;
  } else if (
    o.qualityShortTpSlEnabled === "0" ||
    o.qualityShortTpSlEnabled === 0 ||
    o.qualityShortTpSlEnabled === "false"
  ) {
    qualityShortTpSlEnabled = false;
  }

  let qualityShortHoldExtendIfRedEnabled: boolean | undefined;
  if (typeof o.qualityShortHoldExtendIfRedEnabled === "boolean") {
    qualityShortHoldExtendIfRedEnabled = o.qualityShortHoldExtendIfRedEnabled;
  } else if (
    o.qualityShortHoldExtendIfRedEnabled === "1" ||
    o.qualityShortHoldExtendIfRedEnabled === 1 ||
    o.qualityShortHoldExtendIfRedEnabled === "true"
  ) {
    qualityShortHoldExtendIfRedEnabled = true;
  } else if (
    o.qualityShortHoldExtendIfRedEnabled === "0" ||
    o.qualityShortHoldExtendIfRedEnabled === 0 ||
    o.qualityShortHoldExtendIfRedEnabled === "false"
  ) {
    qualityShortHoldExtendIfRedEnabled = false;
  }

  let qualitySignalLongGrades: SnowballAutoTradeGradeKey[] | undefined;
  const qsGradesRaw = o.qualitySignalLongGrades;
  if (Array.isArray(qsGradesRaw)) {
    const valid = new Set(SNOWBALL_QUALITY_SIGNAL_LONG_GRADE_OPTIONS);
    const out: SnowballAutoTradeGradeKey[] = [];
    for (const g of qsGradesRaw) {
      if (
        (g === "S" || g === "A" || g === "B" || g === "C" || g === "D" || g === "F") &&
        valid.has(g) &&
        !out.includes(g)
      ) {
        out.push(g);
      }
    }
    qualitySignalLongGrades = out;
  } else {
    const qsRaw = o.qualitySignalLongEnabled ?? o.qualitySignalGateEnabled;
    let legacyOn = false;
    if (typeof qsRaw === "boolean") {
      legacyOn = qsRaw;
    } else if (qsRaw === "1" || qsRaw === 1 || qsRaw === "true") {
      legacyOn = true;
    }
    if (legacyOn) {
      qualitySignalLongGrades = [...SNOWBALL_QUALITY_SIGNAL_LONG_GRADE_OPTIONS];
    } else if (qsRaw === false || qsRaw === "0" || qsRaw === 0 || qsRaw === "false") {
      qualitySignalLongGrades = [];
    }
  }
  const qualitySignalLongEnabled = (qualitySignalLongGrades?.length ?? 0) > 0;

  let gradeFFadeShortEnabled = false;
  const gradeFFadeRaw = o.gradeFFadeShortEnabled ?? o.qualityShortSignalShortEnabled;
  if (typeof gradeFFadeRaw === "boolean") {
    gradeFFadeShortEnabled = gradeFFadeRaw;
  } else if (gradeFFadeRaw === "1" || gradeFFadeRaw === 1 || gradeFFadeRaw === "true") {
    gradeFFadeShortEnabled = true;
  }

  let shortSignalShortEnabled = false;
  if (typeof o.shortSignalShortEnabled === "boolean") {
    shortSignalShortEnabled = o.shortSignalShortEnabled;
  } else if (
    o.shortSignalShortEnabled === "1" ||
    o.shortSignalShortEnabled === 1 ||
    o.shortSignalShortEnabled === "true"
  ) {
    shortSignalShortEnabled = true;
  }

  let sundayAllShortEnabled = false;
  if (typeof o.sundayAllShortEnabled === "boolean") {
    sundayAllShortEnabled = o.sundayAllShortEnabled;
  } else if (
    o.sundayAllShortEnabled === "1" ||
    o.sundayAllShortEnabled === 1 ||
    o.sundayAllShortEnabled === "true"
  ) {
    sundayAllShortEnabled = true;
  }

  let longDynamicBoostEnabled = false;
  if (typeof o.longDynamicBoostEnabled === "boolean") {
    longDynamicBoostEnabled = o.longDynamicBoostEnabled;
  } else if (
    o.longDynamicBoostEnabled === "1" ||
    o.longDynamicBoostEnabled === 1 ||
    o.longDynamicBoostEnabled === "true"
  ) {
    longDynamicBoostEnabled = true;
  }

  let referenceEma20_1hEnabled = false;
  const emaRefRaw = o.referenceEma20_1hEnabled ?? o.referenceEma201hEnabled;
  if (typeof emaRefRaw === "boolean") {
    referenceEma20_1hEnabled = emaRefRaw;
  } else if (emaRefRaw === "1" || emaRefRaw === 1 || emaRefRaw === "true") {
    referenceEma20_1hEnabled = true;
  }

  const patchPart: Omit<
    SaveTradingViewMexcInput,
    "mexcApiKey" | "mexcSecret" | "clearMexcCreds" | "rotateWebhookToken"
  > = {
    snowballAutoTradeEnabled: enabled,
    snowballAutoTradeRulesLong: null,
    snowballAutoTradeRulesBear: null,
    snowballAutoTradeQualitySignalLongGrades: qualitySignalLongGrades,
    snowballAutoTradeQualitySignalLongEnabled: qualitySignalLongEnabled,
    snowballAutoTradeGradeFFadeShortEnabled: gradeFFadeShortEnabled,
    snowballAutoTradeShortSignalShortEnabled: shortSignalShortEnabled,
    snowballAutoTradeQualityShortSignalShortEnabled: gradeFFadeShortEnabled,
    snowballAutoTradeSundayAllShortEnabled: sundayAllShortEnabled,
    snowballAutoTradeLongDynamicBoostEnabled: longDynamicBoostEnabled,
    snowballAutoTradeReferenceEma20_1hEnabled: referenceEma20_1hEnabled,
    snowballAutoTradeMarginUsdt: mMargin.v as number | null | undefined,
    snowballAutoTradeLeverage: mLev.v as number | null | undefined,
    snowballAutoTradeQuickTpEnabled: false,
    snowballAutoTradeTp1PricePct: mTp1.v as number | null | undefined,
    snowballAutoTradeTp1PartialPct: mTp1Partial.v as number | null | undefined,
    snowballAutoTradeTp2PricePct: mTp2.v as number | null | undefined,
    snowballAutoTradeMaxHoldHours:
      mMaxH.v == null ? (mMaxH.v as number | null | undefined) : (Math.floor(mMaxH.v) as number),
    snowballAutoTradeHoldExtendRedHours:
      mExtH.v == null ? (mExtH.v as number | null | undefined) : (Math.floor(mExtH.v) as number),
    snowballAutoTradeSlArmRoiPct: mSlArm.v as number | null | undefined,
    snowballAutoTradeSlEntryOffsetPct: mSlOff.v as number | null | undefined,
    snowballAutoTradeQualityShortTp1PricePct: mQsTp1.v as number | null | undefined,
    snowballAutoTradeQualityShortTp1PartialPct: mQsTp1Partial.v as number | null | undefined,
    snowballAutoTradeQualityShortTp2PricePct: mQsTp2.v as number | null | undefined,
    snowballAutoTradeQualityShortMaxHoldHours:
      mQsMaxH.v == null ? (mQsMaxH.v as number | null | undefined) : (Math.floor(mQsMaxH.v) as number),
    snowballAutoTradeQualityShortHoldExtendRedHours:
      mQsExtH.v == null ? (mQsExtH.v as number | null | undefined) : (Math.floor(mQsExtH.v) as number),
    snowballAutoTradeQualityShortSlArmRoiPct: mQsSlArm.v as number | null | undefined,
    snowballAutoTradeQualityShortSlEntryOffsetPct: mQsSlOff.v as number | null | undefined,
  };
  if (tpSlEnabled !== undefined) patchPart.snowballAutoTradeTpSlEnabled = tpSlEnabled;
  if (holdExtendIfRedEnabled !== undefined) {
    patchPart.snowballAutoTradeHoldExtendIfRedEnabled = holdExtendIfRedEnabled;
  }
  if (slAtEntryAfter24hIfGreenEnabled !== undefined) {
    patchPart.snowballAutoTradeSlAtEntryAfter24hIfGreenEnabled = slAtEntryAfter24hIfGreenEnabled;
    patchPart.snowballAutoTradeQualityShortSlAtEntryAfter24hIfGreenEnabled =
      slAtEntryAfter24hIfGreenEnabled;
  }
  if (qualityShortTpSlEnabled !== undefined) {
    patchPart.snowballAutoTradeQualityShortTpSlEnabled = qualityShortTpSlEnabled;
  }
  if (qualityShortHoldExtendIfRedEnabled !== undefined) {
    patchPart.snowballAutoTradeQualityShortHoldExtendIfRedEnabled = qualityShortHoldExtendIfRedEnabled;
  }

  if ("entryMode" in o) {
    patchPart.snowballAutoTradeEntryMode = parseSnowballAutoTradeEntryMode(o.entryMode);
  }
  if ("entryEmaPeriod" in o) {
    const rawPeriod = o.entryEmaPeriod;
    if (rawPeriod === null || rawPeriod === "" || rawPeriod === undefined) {
      patchPart.snowballAutoTradeEntryEmaPeriod = null;
    } else {
      const n = typeof rawPeriod === "number" ? rawPeriod : Number(String(rawPeriod).replace(/,/g, "").trim());
      if (!Number.isFinite(n)) {
        return { ok: false, error: "snowball_entry_ema_period_invalid" };
      }
      patchPart.snowballAutoTradeEntryEmaPeriod = parseSnowballAutoTradeEntryEmaPeriod(rawPeriod);
    }
  }

  return { ok: true, patch: patchPart };
}

function parseReversalAutoTradeNested(
  raw: unknown
):
  | { ok: false; error: string }
  | { ok: true; patch: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret"> } {
  if (raw === undefined || raw === null) return { ok: false, error: "missing_reversal_bundle" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "reversal_must_object" };
  const o = raw as Record<string, unknown>;

  let enabled = false;
  if (typeof o.enabled === "boolean") enabled = o.enabled;
  else if (o.enabled === "1" || o.enabled === 1 || o.enabled === "true") enabled = true;

  let longSignalShortEnabled = false;
  if (typeof o.longSignalShortEnabled === "boolean") {
    longSignalShortEnabled = o.longSignalShortEnabled;
  } else if (
    o.longSignalShortEnabled === "1" ||
    o.longSignalShortEnabled === 1 ||
    o.longSignalShortEnabled === "true"
  ) {
    longSignalShortEnabled = true;
  }

  let longDynamicLeverageEnabled = false;
  if (typeof o.longDynamicLeverageEnabled === "boolean") {
    longDynamicLeverageEnabled = o.longDynamicLeverageEnabled;
  } else if (
    o.longDynamicLeverageEnabled === "1" ||
    o.longDynamicLeverageEnabled === 1 ||
    o.longDynamicLeverageEnabled === "true"
  ) {
    longDynamicLeverageEnabled = true;
  }

  const numOrEmpty = (
    key: string
  ): { v: number | null | undefined; err?: string } => {
    if (!(key in o)) return { v: undefined };
    const x = o[key];
    if (x === null || x === "" || x === undefined) return { v: null };
    const n = typeof x === "number" ? x : Number(String(x).replace(/,/g, "").trim());
    if (!Number.isFinite(n)) return { v: undefined, err: `${key}_not_number` };
    return { v: n };
  };

  const mMargin = numOrEmpty("marginUsdt");
  const mLev = numOrEmpty("leverage");
  const mTp1 = numOrEmpty("tp1PricePct");
  const mTp1Partial = numOrEmpty("tp1PartialPct");
  const mTp2 = numOrEmpty("tp2PricePct");
  const mMaxH = numOrEmpty("maxHoldHours");
  const mExtH = numOrEmpty("holdExtendRedHours");
  const mSlArm = numOrEmpty("slArmRoiPct");
  const mSlOff = numOrEmpty("slEntryOffsetPct");
  if (
    mMargin.err ||
    mLev.err ||
    mTp1.err ||
    mTp1Partial.err ||
    mTp2.err ||
    mMaxH.err ||
    mExtH.err ||
    mSlArm.err ||
    mSlOff.err
  ) {
    return { ok: false, error: "reversal_numeric_invalid" };
  }

  if (enabled || longSignalShortEnabled) {
    const m = mMargin.v;
    const l = mLev.v;
    if (m == null || !(typeof m === "number" && Number.isFinite(m) && m > 0)) {
      return { ok: false, error: "reversal_margin_required" };
    }
    if (l == null || !(typeof l === "number" && Number.isFinite(l) && l >= 1)) {
      return { ok: false, error: "reversal_leverage_required" };
    }
  }

  if (typeof mTp1.v === "number" && !(mTp1.v > 0 && mTp1.v < 100)) {
    return { ok: false, error: "reversal_tp1_price_pct_out_of_range" };
  }
  if (typeof mTp1Partial.v === "number" && !(mTp1Partial.v > 0 && mTp1Partial.v < 100)) {
    return { ok: false, error: "reversal_tp1_partial_pct_out_of_range" };
  }
  if (typeof mTp2.v === "number" && !(mTp2.v > 0 && mTp2.v < 100)) {
    return { ok: false, error: "reversal_tp2_price_pct_out_of_range" };
  }
  if (typeof mMaxH.v === "number" && !(mMaxH.v > 0 && mMaxH.v <= 24 * 30)) {
    return { ok: false, error: "reversal_max_hold_hours_out_of_range" };
  }
  if (
    typeof mTp1.v === "number" &&
    typeof mTp2.v === "number" &&
    !(mTp2.v > mTp1.v)
  ) {
    return { ok: false, error: "reversal_tp2_must_gt_tp1" };
  }
  if (typeof mSlArm.v === "number" && !(mSlArm.v > 0 && mSlArm.v < 100)) {
    return { ok: false, error: "reversal_sl_arm_roi_pct_out_of_range" };
  }
  if (typeof mSlOff.v === "number" && !(mSlOff.v >= 0 && mSlOff.v < 50)) {
    return { ok: false, error: "reversal_sl_entry_offset_pct_out_of_range" };
  }
  if (typeof mExtH.v === "number" && !(mExtH.v > 0 && mExtH.v <= 24 * 30)) {
    return { ok: false, error: "reversal_hold_extend_red_hours_out_of_range" };
  }

  let tpSlEnabled: boolean | undefined;
  if (typeof o.tpSlEnabled === "boolean") tpSlEnabled = o.tpSlEnabled;
  else if (o.tpSlEnabled === "1" || o.tpSlEnabled === 1 || o.tpSlEnabled === "true") tpSlEnabled = true;
  else if (o.tpSlEnabled === "0" || o.tpSlEnabled === 0 || o.tpSlEnabled === "false") tpSlEnabled = false;

  let holdExtendIfRedEnabled: boolean | undefined;
  if (typeof o.holdExtendIfRedEnabled === "boolean") holdExtendIfRedEnabled = o.holdExtendIfRedEnabled;
  else if (o.holdExtendIfRedEnabled === "1" || o.holdExtendIfRedEnabled === 1 || o.holdExtendIfRedEnabled === "true") {
    holdExtendIfRedEnabled = true;
  } else if (o.holdExtendIfRedEnabled === "0" || o.holdExtendIfRedEnabled === 0 || o.holdExtendIfRedEnabled === "false") {
    holdExtendIfRedEnabled = false;
  }

  let slAtEntryAfter24hIfGreenEnabled: boolean | undefined;
  if (typeof o.slAtEntryAfter24hIfGreenEnabled === "boolean") {
    slAtEntryAfter24hIfGreenEnabled = o.slAtEntryAfter24hIfGreenEnabled;
  } else if (
    o.slAtEntryAfter24hIfGreenEnabled === "1" ||
    o.slAtEntryAfter24hIfGreenEnabled === 1 ||
    o.slAtEntryAfter24hIfGreenEnabled === "true"
  ) {
    slAtEntryAfter24hIfGreenEnabled = true;
  } else if (
    o.slAtEntryAfter24hIfGreenEnabled === "0" ||
    o.slAtEntryAfter24hIfGreenEnabled === 0 ||
    o.slAtEntryAfter24hIfGreenEnabled === "false"
  ) {
    slAtEntryAfter24hIfGreenEnabled = false;
  }

  const parseGateBool = (key: string, defaultOn: boolean): boolean => {
    if (!(key in o)) return defaultOn;
    const x = o[key];
    if (typeof x === "boolean") return x;
    if (x === "1" || x === 1 || x === "true") return true;
    if (x === "0" || x === 0 || x === "false") return false;
    return defaultOn;
  };
  const gateQualitySignal =
    "gateQualitySignal" in o
      ? parseGateBool("gateQualitySignal", true)
      : parseGateBool("gateBodyWick80", true) || parseGateBool("gateLenRank315", true);
  let saturdayAllSignalsEnabled = false;
  if (typeof o.saturdayAllSignalsEnabled === "boolean") {
    saturdayAllSignalsEnabled = o.saturdayAllSignalsEnabled;
  } else if (
    o.saturdayAllSignalsEnabled === "1" ||
    o.saturdayAllSignalsEnabled === 1 ||
    o.saturdayAllSignalsEnabled === "true"
  ) {
    saturdayAllSignalsEnabled = true;
  }

  if ((enabled || longSignalShortEnabled) && !gateQualitySignal && !saturdayAllSignalsEnabled) {
    return { ok: false, error: "reversal_gate_required" };
  }

  const patchPart: Omit<
    SaveTradingViewMexcInput,
    "mexcApiKey" | "mexcSecret" | "clearMexcCreds" | "rotateWebhookToken"
  > = {
    reversalAutoTradeEnabled: enabled,
    reversalAutoTradeMarginUsdt: mMargin.v as number | null | undefined,
    reversalAutoTradeLeverage:
      mLev.v == null
        ? (mLev.v as number | null | undefined)
        : (Math.floor(mLev.v) as number),
    reversalAutoTradeTp1PricePct: mTp1.v as number | null | undefined,
    reversalAutoTradeTp1PartialPct: mTp1Partial.v as number | null | undefined,
    reversalAutoTradeTp2PricePct: mTp2.v as number | null | undefined,
    reversalAutoTradeMaxHoldHours:
      mMaxH.v == null ? (mMaxH.v as number | null | undefined) : (Math.floor(mMaxH.v) as number),
    reversalAutoTradeHoldExtendRedHours:
      mExtH.v == null ? (mExtH.v as number | null | undefined) : (Math.floor(mExtH.v) as number),
    reversalAutoTradeSlArmRoiPct: mSlArm.v as number | null | undefined,
    reversalAutoTradeSlEntryOffsetPct: mSlOff.v as number | null | undefined,
    reversalAutoTradeGateQualitySignal: gateQualitySignal,
    reversalAutoTradeSaturdayAllSignalsEnabled: saturdayAllSignalsEnabled,
    reversalAutoTradeLongSignalShortEnabled: longSignalShortEnabled,
    reversalAutoTradeLongDynamicLeverageEnabled: longDynamicLeverageEnabled,
  };
  if (tpSlEnabled !== undefined) patchPart.reversalAutoTradeTpSlEnabled = tpSlEnabled;
  if (holdExtendIfRedEnabled !== undefined) {
    patchPart.reversalAutoTradeHoldExtendIfRedEnabled = holdExtendIfRedEnabled;
  }
  if (slAtEntryAfter24hIfGreenEnabled !== undefined) {
    patchPart.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled = slAtEntryAfter24hIfGreenEnabled;
  }

  const parseReversalEntryEmaPatch = (
    rawPeriod: unknown,
    field: "reversalAutoTradeShortEntryEmaPeriod" | "reversalAutoTradeLongEntryEmaPeriod" | "reversalAutoTradeEntryEmaPeriod",
  ): { ok: true } | { ok: false; error: string } => {
    if (rawPeriod === null || rawPeriod === "" || rawPeriod === undefined) {
      patchPart[field] = null;
      return { ok: true };
    }
    const n = typeof rawPeriod === "number" ? rawPeriod : Number(String(rawPeriod).replace(/,/g, "").trim());
    if (!Number.isFinite(n)) {
      return { ok: false, error: "reversal_entry_ema_period_invalid" };
    }
    patchPart[field] = parseReversalAutoTradeEntryEmaPeriod(rawPeriod);
    return { ok: true };
  };

  if ("shortEntryMode" in o) {
    patchPart.reversalAutoTradeShortEntryMode = parseReversalAutoTradeEntryMode(o.shortEntryMode);
    patchPart.reversalAutoTradeEntryMode = patchPart.reversalAutoTradeShortEntryMode;
  }
  if ("longEntryMode" in o) {
    patchPart.reversalAutoTradeLongEntryMode = parseReversalAutoTradeEntryMode(o.longEntryMode);
  }
  if ("shortEntryEmaPeriod" in o) {
    const r = parseReversalEntryEmaPatch(o.shortEntryEmaPeriod, "reversalAutoTradeShortEntryEmaPeriod");
    if (!r.ok) return r;
    patchPart.reversalAutoTradeEntryEmaPeriod = patchPart.reversalAutoTradeShortEntryEmaPeriod;
  }
  if ("longEntryEmaPeriod" in o) {
    const r = parseReversalEntryEmaPatch(o.longEntryEmaPeriod, "reversalAutoTradeLongEntryEmaPeriod");
    if (!r.ok) return r;
  }

  if ("entryMode" in o && !("shortEntryMode" in o)) {
    patchPart.reversalAutoTradeEntryMode = parseReversalAutoTradeEntryMode(o.entryMode);
    patchPart.reversalAutoTradeShortEntryMode = patchPart.reversalAutoTradeEntryMode;
  }
  if ("entryEmaPeriod" in o && !("shortEntryEmaPeriod" in o)) {
    const r = parseReversalEntryEmaPatch(o.entryEmaPeriod, "reversalAutoTradeEntryEmaPeriod");
    if (!r.ok) return r;
    patchPart.reversalAutoTradeShortEntryEmaPeriod = patchPart.reversalAutoTradeEntryEmaPeriod;
  }

  return { ok: true, patch: patchPart };
}

export async function liffGetTradingViewMexcSettings(userId: string): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const { origin, path } = publicAppBaseForTvWebhook();
  const row = await ensureTradingViewMexcUserRow(userId);
  const webhookUrl = origin ? `${origin}${path}` : path;
  const mexcKeyLast4 =
    row.mexcApiKey && row.mexcApiKey.length >= 4 ? row.mexcApiKey.slice(-4) : null;
  const mexcCredsComplete = Boolean(row.mexcApiKey?.trim() && row.mexcSecret?.trim());
  return {
    status: 200,
    json: {
      exchange: "mexc",
      userId,
      webhookUrl,
      webhookPath: path,
      webhookToken: row.webhookToken,
      mexcApiKeySet: Boolean(row.mexcApiKey),
      mexcApiKeyLast4: mexcKeyLast4,
      mexcSecretSet: Boolean(row.mexcSecret),
      mexcCredsComplete,
      exampleJson: mexcCredsComplete ? tradingViewMexcExamplePayload(userId, row.webhookToken) : null,
      exampleOpenJson: mexcCredsComplete
        ? tradingViewMexcExampleOpenPayload(userId, row.webhookToken, "LONG", 100, 10)
        : null,
      snowballAutotradeServerEnabled: isSnowballAutotradeEnabled(),
      snowballAutoTradeNote: SNOWBALL_AUTO_TRADE_LIFF_NOTE_TH,
      snowballAutoTrade: tradingViewSnowballAutoTradePayloadFromRow(row),
      portfolioTrailingAlert: tradingViewPortfolioTrailingPayloadFromRow(row),
      reversalAutotradeServerEnabled: isReversalAutotradeEnabled(),
      reversalAutoTradeNote: REVERSAL_AUTO_TRADE_LIFF_NOTE_TH,
      reversalAutoTrade: tradingViewReversalAutoTradePayloadFromRow(row),
    },
  };
}

export async function liffSetTradingViewMexcSettings(
  userId: string,
  body: unknown
): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const b = (body ?? {}) as Record<string, unknown>;
  const rotate = Boolean(b.rotateWebhookToken);
  const clearMexc = Boolean(b.clearMexcCreds);
  const key = typeof b.mexcApiKey === "string" ? b.mexcApiKey.trim() : "";
  const sec = typeof b.mexcSecret === "string" ? b.mexcSecret.trim() : "";

  if (key && /[\s]/.test(key)) {
    return { status: 400, json: { error: "MEXC API key ห้ามมีช่องว่าง" } };
  }

  if (b.sparkAutoTrade !== undefined && b.sparkAutoTrade !== null) {
    return {
      status: 400,
      json: {
        error: "spark_auto_trade_disabled",
        hint: "Spark auto-open (MEXC) ปิดถาวร — ใช้ Snowball / Reversal auto-open แทน",
      },
    };
  }

  const snowballBundle = b.snowballAutoTrade;
  const hasSnowballNested = snowballBundle !== undefined && snowballBundle !== null;
  let snowballPatchMerged: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret"> | undefined;
  if (hasSnowballNested) {
    const parsed = parseSnowballAutoTradeNested(snowballBundle);
    if (!parsed.ok) {
      return { status: 400, json: { error: parsed.error } };
    }
    snowballPatchMerged = parsed.patch;
  }

  const portfolioBundle = b.portfolioTrailingAlert;
  const hasPortfolioNested = portfolioBundle !== undefined && portfolioBundle !== null;
  let portfolioPatchMerged: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret"> | undefined;
  if (hasPortfolioNested) {
    const parsed = parsePortfolioTrailingAlertNested(portfolioBundle);
    if (!parsed.ok) {
      return { status: 400, json: { error: parsed.error } };
    }
    portfolioPatchMerged = parsed.patch;

    const prevRow = await ensureTradingViewMexcUserRow(userId);
    const nextEnabled = parsed.patch.portfolioTrailingAlertEnabled ?? false;
    const nextStep = parsed.patch.portfolioTrailingStepPct;
    const prevEnabled = prevRow.portfolioTrailingAlertEnabled ?? false;
    const prevStep = prevRow.portfolioTrailingStepPct;
    const settingsChanged =
      nextEnabled !== prevEnabled || (nextEnabled && nextStep !== prevStep);
    if (settingsChanged) {
      await clearPortfolioTrailingStateForUser(userId);
    }
  }

  const reversalBundle = b.reversalAutoTrade;
  const hasReversalNested = reversalBundle !== undefined && reversalBundle !== null;
  let reversalPatchMerged: Omit<SaveTradingViewMexcInput, "mexcApiKey" | "mexcSecret"> | undefined;
  if (hasReversalNested) {
    const parsed = parseReversalAutoTradeNested(reversalBundle);
    if (!parsed.ok) {
      return { status: 400, json: { error: parsed.error } };
    }
    reversalPatchMerged = parsed.patch;
  }

  const row = await saveTradingViewMexcSettings(userId, {
    mexcApiKey: key,
    mexcSecret: sec,
    rotateWebhookToken: rotate,
    clearMexcCreds: clearMexc,
    preserveSparkAutoTrade: true,
    ...(snowballPatchMerged ?? {}),
    ...(portfolioPatchMerged ?? {}),
    ...(reversalPatchMerged ?? {}),
  });

  const { origin, path } = publicAppBaseForTvWebhook();
  const webhookUrl = origin ? `${origin}${path}` : path;
  const mexcKeyLast4 =
    row.mexcApiKey && row.mexcApiKey.length >= 4 ? row.mexcApiKey.slice(-4) : null;
  const mexcCredsComplete = Boolean(row.mexcApiKey?.trim() && row.mexcSecret?.trim());
  return {
    status: 200,
    json: {
      exchange: "mexc",
      userId,
      webhookUrl,
      webhookPath: path,
      webhookToken: row.webhookToken,
      mexcApiKeySet: Boolean(row.mexcApiKey),
      mexcApiKeyLast4: mexcKeyLast4,
      mexcSecretSet: Boolean(row.mexcSecret),
      mexcCredsComplete,
      exampleJson: mexcCredsComplete ? tradingViewMexcExamplePayload(userId, row.webhookToken) : null,
      exampleOpenJson: mexcCredsComplete
        ? tradingViewMexcExampleOpenPayload(userId, row.webhookToken, "LONG", 100, 10)
        : null,
      snowballAutotradeServerEnabled: isSnowballAutotradeEnabled(),
      snowballAutoTradeNote: SNOWBALL_AUTO_TRADE_LIFF_NOTE_TH,
      snowballAutoTrade: tradingViewSnowballAutoTradePayloadFromRow(row),
      portfolioTrailingAlert: tradingViewPortfolioTrailingPayloadFromRow(row),
      reversalAutotradeServerEnabled: isReversalAutotradeEnabled(),
      reversalAutoTradeNote: REVERSAL_AUTO_TRADE_LIFF_NOTE_TH,
      reversalAutoTrade: tradingViewReversalAutoTradePayloadFromRow(row),
    },
  };
}
