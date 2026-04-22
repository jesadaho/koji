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
import { ensureTradingViewMexcUserRow, saveTradingViewMexcSettings } from "./tradingViewCloseSettingsStore";

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

/** สถิติ Spark (global) — ไม่มี userId แต่ต้องผ่าน LIFF auth */
export async function liffGetSparkStats(): Promise<SparkStatsApiPayload> {
  const state = await loadSparkFollowUpState();
  return buildSparkStatsApiPayload(state);
}

function publicAppBaseForTvWebhook(): { origin: string; path: string } {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const origin = raw.replace(/\/$/, "");
  return { origin, path: "/api/webhooks/tv/close" };
}

/** URL เต็มสำหรับ TradingView Webhook (เช่น https://koji-five.vercel.app/api/webhooks/tv/close) */
export function getTradingViewMexcWebhookCloseUrl(): string {
  const { origin, path } = publicAppBaseForTvWebhook();
  return origin ? `${origin}${path}` : path;
}

export function tradingViewMexcExamplePayload(userId: string, token: string): Record<string, string> {
  return {
    id: userId,
    token,
    symbol: "{{ticker}}",
    price: "{{close}}",
    cmd: "CLOSE_POSITION",
    remark: "Break Trendline",
  };
}

export function formatTradingViewMexcWebhookJson(userId: string, token: string): string {
  return `${JSON.stringify(tradingViewMexcExamplePayload(userId, token), null, 2)}\n`;
}

/**
 * ตั้งค่า MEXC + token สำหรับ Webhook ปิด position
 */
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

  const row = await saveTradingViewMexcSettings(userId, {
    mexcApiKey: key,
    mexcSecret: sec,
    rotateWebhookToken: rotate,
    clearMexcCreds: clearMexc,
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
    },
  };
}
