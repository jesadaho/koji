import {
  createOpenLimitOrder,
  createOpenMarketOrder,
  getContractLastPricePublic,
  getContractTickerPublic,
  getOpenPositions,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { fetchBinanceUsdmKlines, fetchBinanceUsdmLastPrice } from "./binanceIndicatorKline";
import { emaLine } from "./indicatorMath";
import { resolveMexcContractFromBinanceSymbol } from "./coinMap";
import {
  loadTradingViewMexcSettingsFullMap,
  type TradingViewMexcUserSettings,
} from "./tradingViewCloseSettingsStore";
import {
  bkkReversalAutoTradeDayKeyNow,
  hasPlacedReversalContractToday,
  loadReversalAutoTradeState,
  saveReversalAutoTradeState,
  withRecordedReversalPlaced,
  withReversalActiveOpen,
} from "./reversalAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";
import type { CandleReversalModel, CandleReversalTf, CandleReversalTradeSide } from "./candleReversalDetect";
import { appendAutoOpenOrderLogSafe } from "./autoOpenOrderLogStore";
import { shouldSkipAutoOpenForPendingConflict } from "./signalPendingConflictServer";
import type { AutoOpenOutcome } from "@/lib/autoOpenOrderLogClient";
import { reversalMatchesQualitySignalForAlert } from "@/lib/reversalMatrixFilters";
import { placeTpPlanOrdersAfterOpen } from "./autoTradeTpSlPlanOrders";
import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  parseSlArmRoiPct,
  parseSlEntryOffsetPct,
} from "@/lib/tpSlBreakevenPlan";
import { bkkIsSaturdayNow } from "./snowballAutoTradeStateStore";

/** ค่าเริ่มต้นกลยุทธ์ TP/SL เมื่อ user ยังไม่ตั้งค่า (อ่านจาก settings ของ user) */
const REVERSAL_TPSL_DEFAULT_TP1_PCT = 10;
const REVERSAL_TPSL_DEFAULT_TP1_PARTIAL = 50;
const REVERSAL_TPSL_DEFAULT_TP2_PCT = 25;
const REVERSAL_TPSL_DEFAULT_MAX_HOURS = 48;

/** ค่าเริ่มต้นเปิด — ตั้ง REVERSAL_AUTOTRADE_ENABLED=0/false/off/no เพื่อปิดเซิร์ฟทั้งหมด */
export function isReversalAutotradeEnabled(): boolean {
  const v = process.env.REVERSAL_AUTOTRADE_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/** gate เปิดออเดอร์ — Quality Signal (Short หรือ Long 1H ตาม TF/side) */
export function reversalAutotradePassesEntryGate(input: {
  signalBarTf: CandleReversalTf;
  alertTradeSide: CandleReversalTradeSide;
  wickRatio: number;
  greenDaysBeforeSignal?: number | null;
  rangeScore?: number | null;
  ema4hSlopePct7d?: number | null;
  allowQualitySignal?: boolean;
}): boolean {
  if (input.allowQualitySignal === false) return false;
  return reversalMatchesQualitySignalForAlert({
    signalBarTf: input.signalBarTf,
    tradeSide: input.alertTradeSide,
    wickRatio: input.wickRatio,
    greenDaysBeforeSignal: input.greenDaysBeforeSignal,
    rangeScore: input.rangeScore,
    ema4hSlopePct7d: input.ema4hSlopePct7d,
  });
}

/** EMA บน 15m สำหรับ hybrid entry (Market vs Limit retest) */
const REVERSAL_AUTOTRADE_EMA_PERIOD = 20;
/** จำนวนแท่ง 15m ที่ดึงเพื่อคำนวณ EMA (ต้องพอครอบ warmup) */
const REVERSAL_AUTOTRADE_15M_FETCH_BARS = 200;

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function fmtReversalAutoTradePrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function binanceUsdtPerpToMexcContract(binanceSymbol: string): string | null {
  return resolveMexcContractFromBinanceSymbol(binanceSymbol);
}

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function hasActiveUsdtPosition(
  positions: Awaited<ReturnType<typeof getOpenPositions>>,
  contractSymbol: string
): boolean {
  const sym = contractSymbol.trim();
  return positions.some((p) => p.symbol === sym && p.state === 1 && Number(p.holdVol) > 0);
}

function findMexcOpenPositionShort(
  positions: OpenPositionRow[],
  contractSymbol: string,
): OpenPositionRow | undefined {
  const sym = contractSymbol.trim();
  return positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === 2,
  );
}

function readMexcAvgEntryPriceShort(
  positions: OpenPositionRow[],
  contractSymbol: string
): number | null {
  const p = findMexcOpenPositionShort(positions, contractSymbol);
  if (!p) return null;
  const o = Number(p.openAvgPrice);
  if (Number.isFinite(o) && o > 0) return o;
  const h = Number(p.holdAvgPrice);
  if (Number.isFinite(h) && h > 0) return h;
  return null;
}

function resolveReversalTpSlPlanFromRow(row: TradingViewMexcUserSettings): {
  enabled: boolean;
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  maxHoldHours: number;
  slArmRoiPct: number;
  slEntryOffsetPct: number;
} {
  const en = row.reversalAutoTradeTpSlEnabled !== false;
  const t1 =
    typeof row.reversalAutoTradeTp1PricePct === "number" && Number.isFinite(row.reversalAutoTradeTp1PricePct) && row.reversalAutoTradeTp1PricePct > 0
      ? row.reversalAutoTradeTp1PricePct
      : REVERSAL_TPSL_DEFAULT_TP1_PCT;
  const t1p =
    typeof row.reversalAutoTradeTp1PartialPct === "number" && Number.isFinite(row.reversalAutoTradeTp1PartialPct) && row.reversalAutoTradeTp1PartialPct > 0
      ? row.reversalAutoTradeTp1PartialPct
      : REVERSAL_TPSL_DEFAULT_TP1_PARTIAL;
  const t2 =
    typeof row.reversalAutoTradeTp2PricePct === "number" && Number.isFinite(row.reversalAutoTradeTp2PricePct) && row.reversalAutoTradeTp2PricePct > 0
      ? row.reversalAutoTradeTp2PricePct
      : REVERSAL_TPSL_DEFAULT_TP2_PCT;
  const mh =
    typeof row.reversalAutoTradeMaxHoldHours === "number" && Number.isFinite(row.reversalAutoTradeMaxHoldHours) && row.reversalAutoTradeMaxHoldHours > 0
      ? row.reversalAutoTradeMaxHoldHours
      : REVERSAL_TPSL_DEFAULT_MAX_HOURS;
  return {
    enabled: en,
    tp1PricePct: t1,
    tp1PartialPct: Math.min(100, t1p),
    tp2PricePct: t2,
    maxHoldHours: mh,
    slArmRoiPct: parseSlArmRoiPct(row.reversalAutoTradeSlArmRoiPct, DEFAULT_SL_ARM_ROI_PCT),
    slEntryOffsetPct: parseSlEntryOffsetPct(
      row.reversalAutoTradeSlEntryOffsetPct,
      DEFAULT_SL_ENTRY_OFFSET_PCT,
    ),
  };
}

export type ReversalAutoTradeInput = {
  /** ทิศสัญญาณ Reversal ที่ยิง alert — short = แผน Short เดิม · long = fade เปิด SHORT */
  alertTradeSide?: CandleReversalTradeSide;
  /** Binance USDT-M symbol เช่น BTCUSDT (ตามที่ Reversal alert scan) */
  binanceSymbol: string;
  /** TF ของสัญญาณ Reversal */
  signalBarTf: CandleReversalTf;
  /** โมเดล Reversal ที่ยิง */
  model: CandleReversalModel;
  /** open time (sec) ของแท่งสัญญาณ */
  signalBarOpenSec: number;
  /** body / range (0–1) จากสัญญาณ */
  bodyRatio: number;
  /** upper wick / range (0–1) จากสัญญาณ */
  wickRatio: number;
  /** ช่วงแท่ง ÷ ATR100 — คอลัมน์ Range ในสถิติ */
  rangeScore?: number | null;
  /** อันดับความยาวแท่งใน lookback (Len#) — สำหรับ log */
  rangeRankInLookback?: number | null;
  /** แท่ง Day1 เขียวติดก่อนแท่งสัญญาณ */
  greenDaysBeforeSignal?: number | null;
  /** EMA(12) 4h slope 7 วัน % — สำหรับ Quality Signal (EMA4H band) */
  ema4hSlopePct7d?: number | null;
  /** ราคาปิดแท่งสัญญาณ — fallback entry เมื่อเปิดไม่สำเร็จ */
  signalClosePrice?: number;
};

export type ReversalAutoTradeRunResult = {
  usersAttempted: number;
  usersSucceeded: number;
};

type ReversalAutoOpenLogSignal = {
  contractSymbol: string;
  binanceSymbol: string;
  alertTradeSide: CandleReversalTradeSide;
  signalBarTf: CandleReversalTf;
  model: CandleReversalModel;
  signalBarOpenSec: number;
  bodyRatio: number;
  wickRatio: number;
  rangeRankInLookback?: number | null;
};

function reversalAutoOpenTelegramTitle(alertTradeSide: CandleReversalTradeSide): string {
  return alertTradeSide === "long"
    ? "Koji — Reversal auto-open (MEXC) · Long → SHORT"
    : "Koji — Reversal auto-open (MEXC)";
}

function reversalIntendedEntry(
  aboveEma: boolean,
  mark: number,
  ema: number,
): number {
  return aboveEma ? mark : ema;
}

function resolveReversalLogEntryPrice(
  outcome: AutoOpenOutcome,
  extra: {
    entryPrice?: number;
    orderKind?: "market" | "limit";
    ema20_15m?: number;
    markPrice?: number;
  } | undefined,
  signalClosePrice: number | undefined,
): number | undefined {
  if (outcome !== "success" && outcome !== "failed") return undefined;
  if (typeof extra?.entryPrice === "number" && extra.entryPrice > 0) return extra.entryPrice;
  if (
    extra?.orderKind === "limit" &&
    typeof extra.ema20_15m === "number" &&
    extra.ema20_15m > 0
  ) {
    return extra.ema20_15m;
  }
  if (typeof extra?.markPrice === "number" && extra.markPrice > 0) return extra.markPrice;
  if (typeof extra?.ema20_15m === "number" && extra.ema20_15m > 0) return extra.ema20_15m;
  if (typeof signalClosePrice === "number" && signalClosePrice > 0) return signalClosePrice;
  return undefined;
}

function logReversalAutoOpen(
  userId: string,
  signal: ReversalAutoOpenLogSignal,
  outcome: AutoOpenOutcome,
  reasonCode: string,
  extra?: {
    reasonDetail?: string;
    marginUsdt?: number;
    leverage?: number;
    orderKind?: "market" | "limit";
    ema20_15m?: number;
    markPrice?: number;
    entryPrice?: number;
  },
  signalClosePrice?: number,
): void {
  if (outcome === "skipped") return;

  const entryPrice = resolveReversalLogEntryPrice(outcome, extra, signalClosePrice);
  appendAutoOpenOrderLogSafe({
    userId,
    source: "reversal",
    outcome,
    reasonCode,
    contractSymbol: signal.contractSymbol,
    binanceSymbol: signal.binanceSymbol,
    side: "short",
    reversalAlertSide: signal.alertTradeSide,
    signalBarTf: signal.signalBarTf,
    model: signal.model,
    signalBarOpenSec: signal.signalBarOpenSec,
    bodyRatio: signal.bodyRatio,
    wickRatio: signal.wickRatio,
    rangeRankInLookback: signal.rangeRankInLookback,
    ...extra,
    ...(entryPrice != null ? { entryPrice } : {}),
  });
}

/**
 * Auto-open SHORT บน MEXC หลัง Reversal alert สำเร็จ
 * - สัญญาณ Short: `reversalAutoTradeEnabled` · สัญญาณ Long (fade): `reversalAutoTradeLongSignalShortEnabled`
 * - มี MEXC creds
 * - gate Quality Signal: Short — ดู REVERSAL_QUALITY_SIGNAL_CRITERIA · Long 1H — EMA4H <−3%
 * - entry แบบ hybrid ตาม EMA20 บน TF 15m:
 *   - ราคาตลาด > EMA20 → Market SHORT ทันที
 *   - ราคาตลาด <= EMA20 → Limit SHORT ที่ราคา EMA20 (ดักรีเทสต์)
 * - 1 order/เหรียญ/วัน (BKK) — กันสั่งซ้ำหลังวางทั้ง market และ limit
 */
export async function runReversalAutoTradeAfterReversalAlert(
  input: ReversalAutoTradeInput
): Promise<ReversalAutoTradeRunResult> {
  if (!isReversalAutotradeEnabled()) return { usersAttempted: 0, usersSucceeded: 0 };

  const binanceSymbol = input.binanceSymbol.trim().toUpperCase();
  if (!binanceSymbol) return { usersAttempted: 0, usersSucceeded: 0 };

  const bodyRatio = Number.isFinite(input.bodyRatio) ? input.bodyRatio : 0;
  const wickRatio = Number.isFinite(input.wickRatio) ? input.wickRatio : 0;
  const signalClosePrice =
    typeof input.signalClosePrice === "number" &&
    Number.isFinite(input.signalClosePrice) &&
    input.signalClosePrice > 0
      ? input.signalClosePrice
      : undefined;

  const contractSymbolEarly = binanceUsdtPerpToMexcContract(binanceSymbol);
  if (!contractSymbolEarly) return { usersAttempted: 0, usersSucceeded: 0 };
  const contractSymbol: string = contractSymbolEarly;

  try {
    if (await shouldSkipAutoOpenForPendingConflict(binanceSymbol, "reversal")) {
      return { usersAttempted: 0, usersSucceeded: 0 };
    }
  } catch {
    /* ignore */
  }

  const alertTradeSide: CandleReversalTradeSide = input.alertTradeSide === "long" ? "long" : "short";
  const tgTitle = reversalAutoOpenTelegramTitle(alertTradeSide);

  const logSignal: ReversalAutoOpenLogSignal = {
    contractSymbol,
    binanceSymbol,
    alertTradeSide,
    signalBarTf: input.signalBarTf,
    model: input.model,
    signalBarOpenSec: input.signalBarOpenSec,
    bodyRatio,
    wickRatio,
    rangeRankInLookback: input.rangeRankInLookback,
  };

  const [map, state0] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadReversalAutoTradeState(),
  ]);

  let state = state0;
  const dayKey = bkkReversalAutoTradeDayKeyNow();

  let usersAttempted = 0;
  let usersSucceeded = 0;

  /** lazy fetch — เริ่มดึงเมื่อมี user ผ่าน gate รายแรก */
  type EntryResolve =
    | {
        ok: true;
        ema20: number | null;
        mark: number;
        aboveEma: boolean;
        emaFallbackMarket: boolean;
        markSource: "mexc" | "binance" | "signal" | "kline";
      }
    | { ok: false; reasonCode: "mark_unavailable" | "ema_or_price_unavailable"; error: string };

  let entryCache: EntryResolve | undefined;

  async function resolveReversalEntry(): Promise<EntryResolve> {
    if (entryCache) return entryCache;

    let ema20: number | null = null;
    let klineLastClose: number | null = null;
    const emaMinBars = REVERSAL_AUTOTRADE_EMA_PERIOD + 2;

    try {
      const pack = await fetchBinanceUsdmKlines(
        binanceSymbol,
        "15m",
        REVERSAL_AUTOTRADE_15M_FETCH_BARS,
      );
      if (pack && pack.close.length >= emaMinBars) {
        const ema = emaLine(pack.close, REVERSAL_AUTOTRADE_EMA_PERIOD);
        const i = pack.close.length - 2;
        const v = ema[i];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          ema20 = v;
        }
        const lc = pack.close[pack.close.length - 1];
        if (typeof lc === "number" && Number.isFinite(lc) && lc > 0) {
          klineLastClose = lc;
        }
      }
    } catch (e) {
      console.error("[reversalAutoTrade] fetchBinanceUsdmKlines", binanceSymbol, e);
    }

    let mark: number | null = null;
    let markSource: "mexc" | "binance" | "signal" | "kline" | null = null;

    try {
      const t = await getContractTickerPublic(contractSymbol);
      if (t && t.lastPrice > 0) {
        mark = t.lastPrice;
        markSource = "mexc";
      }
    } catch (e) {
      console.error("[reversalAutoTrade] getContractTickerPublic", contractSymbol, e);
    }

    if (mark == null) {
      try {
        const lp = await getContractLastPricePublic(contractSymbol);
        if (lp != null && lp > 0) {
          mark = lp;
          markSource = "mexc";
        }
      } catch (e) {
        console.error("[reversalAutoTrade] getContractLastPricePublic", contractSymbol, e);
      }
    }

    if (mark == null) {
      const bp = await fetchBinanceUsdmLastPrice(binanceSymbol);
      if (bp != null && bp > 0) {
        mark = bp;
        markSource = "binance";
      }
    }

    if (mark == null && signalClosePrice != null && signalClosePrice > 0) {
      mark = signalClosePrice;
      markSource = "signal";
    }

    if (mark == null && klineLastClose != null && klineLastClose > 0) {
      mark = klineLastClose;
      markSource = "kline";
    }

    if (mark == null) {
      entryCache = {
        ok: false,
        reasonCode: "mark_unavailable",
        error: `ดึงราคาตลาดไม่ได้ (${contractSymbol} · MEXC/Binance/สัญญาณ)`,
      };
      return entryCache;
    }

    const emaFallbackMarket = ema20 == null;
    const aboveEma = emaFallbackMarket ? true : mark > (ema20 as number);

    entryCache = {
      ok: true,
      ema20,
      mark,
      aboveEma,
      emaFallbackMarket,
      markSource: markSource ?? "binance",
    };
    return entryCache;
  }

  for (const [userId, rowRaw] of Object.entries(map)) {
    if (!/^tg:\d+$/.test(userId.trim())) continue;
    const row = rowRaw as TradingViewMexcUserSettings;
    const userEnabledForAlert =
      alertTradeSide === "long"
        ? row.reversalAutoTradeLongSignalShortEnabled === true
        : row.reversalAutoTradeEnabled === true;
    if (!userEnabledForAlert) {
      logReversalAutoOpen(
        userId,
        logSignal,
        "skipped",
        alertTradeSide === "long" ? "long_fade_disabled" : "user_disabled",
      );
      continue;
    }

    const saturdayAllSignals =
      row.reversalAutoTradeSaturdayAllSignalsEnabled === true && bkkIsSaturdayNow();
    const allowQuality =
      row.reversalAutoTradeGateQualitySignal !== undefined
        ? row.reversalAutoTradeGateQualitySignal !== false
        : row.reversalAutoTradeGateBodyWick80 !== false || row.reversalAutoTradeGateLenRank315 !== false;
    if (
      !saturdayAllSignals &&
      !reversalAutotradePassesEntryGate({
        signalBarTf: input.signalBarTf,
        alertTradeSide,
        wickRatio,
        greenDaysBeforeSignal: input.greenDaysBeforeSignal,
        rangeScore: input.rangeScore,
        ema4hSlopePct7d: input.ema4hSlopePct7d,
        allowQualitySignal: allowQuality,
      })
    ) {
      logReversalAutoOpen(userId, logSignal, "skipped", "quality_signal_gate");
      continue;
    }

    if (hasPlacedReversalContractToday(state[userId], contractSymbol, dayKey)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "already_opened_today");
      continue;
    }

    const creds: MexcCredentials | null =
      row.mexcApiKey?.trim() && row.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;
    if (!creds) {
      logReversalAutoOpen(userId, logSignal, "skipped", "no_mexc_creds");
      continue;
    }

    const marginUsdt = row.reversalAutoTradeMarginUsdt ?? NaN;
    const leverage = row.reversalAutoTradeLeverage ?? NaN;
    if (!(typeof marginUsdt === "number" && Number.isFinite(marginUsdt) && marginUsdt > 0)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage");
      continue;
    }
    if (!(typeof leverage === "number" && Number.isFinite(leverage) && leverage >= 1)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage", {
        marginUsdt,
      });
      continue;
    }

    const entryRes = await resolveReversalEntry();
    const emaLogExtra = entryRes.ok
      ? {
          ema20_15m: entryRes.ema20 ?? undefined,
          markPrice: entryRes.mark,
          orderKind: (entryRes.aboveEma ? "market" : "limit") as "market" | "limit",
        }
      : {};

    let positions: Awaited<ReturnType<typeof getOpenPositions>>;
    try {
      positions = await getOpenPositions(creds, contractSymbol);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[reversalAutoTrade] open_positions fail", contractSymbol, userId, e);
      logReversalAutoOpen(
        userId,
        logSignal,
        "failed",
        "position_check_failed",
        {
          reasonDetail: detail.slice(0, 400),
          marginUsdt,
          leverage: Math.floor(leverage),
          ...emaLogExtra,
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        tgTitle,
        "❌ เช็คโพซิชันจาก MEXC ไม่สำเร็จ — จึงไม่สั่งเปิด (ป้องกันซ้ำ)",
        `[${shortContractLabel(contractSymbol)}]/USDT (SHORT)`,
        `รายละเอียด: ${detail.slice(0, 320)}`,
      ]);
      continue;
    }
    if (hasActiveUsdtPosition(positions, contractSymbol)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "existing_position", {
        marginUsdt,
        leverage: Math.floor(leverage),
      });
      await notifyLines(userId, [
        tgTitle,
        "ℹ️ ไม่สั่งเปิด — MEXC มีโพซิชันคู่สัญญานี้อยู่แล้ว",
        `[${shortContractLabel(contractSymbol)}]/USDT (SHORT)`,
        "ระบบจึงไม่เปิดซ้ำ (กันซ้อน margin / order ซ้ำ)",
      ]);
      continue;
    }

    if (!entryRes.ok) {
      logReversalAutoOpen(
        userId,
        logSignal,
        "failed",
        entryRes.reasonCode,
        {
          reasonDetail: entryRes.error.slice(0, 400),
          marginUsdt,
          leverage: Math.floor(leverage),
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        tgTitle,
        "❌ สั่งเปิดไม่สำเร็จ",
        `[${shortContractLabel(contractSymbol)}]/USDT (SHORT)`,
        entryRes.error,
      ]);
      continue;
    }
    const ema20 = entryRes.ema20;
    const markPrice = entryRes.mark;
    const aboveEma = entryRes.aboveEma;
    const emaFallbackMarket = entryRes.emaFallbackMarket;
    const markSource = entryRes.markSource;
    usersAttempted += 1;

    const intendedEntry = reversalIntendedEntry(aboveEma, markPrice, ema20 ?? markPrice);
    const lev = Math.floor(leverage);

    try {
      const om = aboveEma
        ? await createOpenMarketOrder(creds, {
            contractSymbol,
            long: false,
            marginUsdt,
            leverage: lev,
            openType: 1,
          })
        : await createOpenLimitOrder(creds, {
            contractSymbol,
            long: false,
            marginUsdt,
            leverage: lev,
            limitPrice: ema20!,
            openType: 1,
          });

      if (!om.success) {
        const msg = om.message ?? `code ${om.code}`;
        logReversalAutoOpen(
          userId,
          logSignal,
          "failed",
          "mexc_order_rejected",
          {
            reasonDetail: msg.slice(0, 400),
            marginUsdt,
            leverage: lev,
            orderKind: aboveEma ? "market" : "limit",
            ema20_15m: ema20 ?? undefined,
            markPrice,
            entryPrice: intendedEntry,
          },
          signalClosePrice,
        );
        await notifyLines(userId, [
          tgTitle,
          emaFallbackMarket
            ? "❌ สั่งเปิดไม่สำเร็จ (Market SHORT · ไม่มี EMA20)"
            : `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น SHORT${aboveEma ? " · Market (เหนือ EMA20 15m)" : " · Limit retest EMA20 15m"})`,
          `[${shortContractLabel(contractSymbol)}]/USDT`,
          `Margin ~${marginUsdt} USDT · ${lev}x`,
          emaFallbackMarket
            ? `ราคาอ้างอิง ~${fmtReversalAutoTradePrice(markPrice)} (${markSource})`
            : aboveEma
              ? `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} > EMA20 15m ~${fmtReversalAutoTradePrice(ema20!)}`
              : `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} ≤ EMA20 15m ~${fmtReversalAutoTradePrice(ema20!)}`,
          `MEXC: ${msg}`,
        ]);
        continue;
      }

      state = withRecordedReversalPlaced(state, userId, contractSymbol, dayKey);
      usersSucceeded += 1;

      logReversalAutoOpen(
        userId,
        logSignal,
        "success",
        aboveEma ? "open_success_market" : "open_success_limit",
        {
          marginUsdt,
          leverage: lev,
          orderKind: aboveEma ? "market" : "limit",
          ema20_15m: ema20 ?? undefined,
          markPrice,
          entryPrice: intendedEntry,
        },
        signalClosePrice,
      );

      const bodyPct = bodyRatio * 100;
      const wickPct = wickRatio * 100;
      const lenRank =
        input.rangeRankInLookback != null && Number.isFinite(input.rangeRankInLookback)
          ? Math.floor(input.rangeRankInLookback)
          : null;
      const greenDays =
        input.greenDaysBeforeSignal != null && Number.isFinite(input.greenDaysBeforeSignal)
          ? Math.floor(input.greenDaysBeforeSignal)
          : null;
      const rangeScore =
        input.rangeScore != null && Number.isFinite(input.rangeScore) ? input.rangeScore : null;
      const ema4hPct =
        input.ema4hSlopePct7d != null && Number.isFinite(input.ema4hSlopePct7d)
          ? input.ema4hSlopePct7d
          : null;

      const plan = resolveReversalTpSlPlanFromRow(row);

      let mexcAvgEntry: number | null = null;
      let trackedTpSl = false;
      let exchangeTpLines: string[] = [];
      let exchangeTpWarnings: string[] = [];
      if (aboveEma && plan.enabled) {
        let posAfterOpen: OpenPositionRow | undefined;
        try {
          const posAfter = await getOpenPositions(creds, contractSymbol);
          posAfterOpen = findMexcOpenPositionShort(posAfter, contractSymbol);
          mexcAvgEntry = readMexcAvgEntryPriceShort(posAfter, contractSymbol);
        } catch (e) {
          console.error("[reversalAutoTrade] getOpenPositions after open", contractSymbol, userId, e);
        }
        if (typeof mexcAvgEntry === "number" && mexcAvgEntry > 0) {
          let tp1PlanOrderId: string | undefined;
          let tp2PlanOrderId: string | undefined;
          let initialHoldVol: number | undefined;
          let tp1PlanVol: number | undefined;
          if (posAfterOpen) {
            try {
              const placed = await placeTpPlanOrdersAfterOpen(creds, {
                contractSymbol,
                position: posAfterOpen,
                entry: mexcAvgEntry,
                side: "short",
                tp1PricePct: plan.tp1PricePct,
                tp1PartialPct: plan.tp1PartialPct,
                tp2PricePct: plan.tp2PricePct,
              });
              if (placed) {
                exchangeTpLines = placed.notifyLines;
                exchangeTpWarnings = placed.warnings;
                tp1PlanOrderId = placed.tp1PlanOrderId;
                tp2PlanOrderId = placed.tp2PlanOrderId;
                initialHoldVol = placed.initialHoldVol;
                tp1PlanVol = placed.tp1Vol;
              }
            } catch (e) {
              console.error("[reversalAutoTrade] placeTpPlanOrdersAfterOpen", contractSymbol, userId, e);
              exchangeTpWarnings.push(
                `วาง plan TP ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
              );
            }
          }
          state = withReversalActiveOpen(
            state,
            userId,
            {
              contractSymbol,
              binanceSymbol,
              side: "short",
              openedAtMs: Date.now(),
              referenceEntryPrice: markPrice,
              mexcAvgEntryPrice: mexcAvgEntry,
              leverage: lev,
              tp1PricePct: plan.tp1PricePct,
              tp1PartialPct: plan.tp1PartialPct,
              tp2PricePct: plan.tp2PricePct,
              maxHoldHours: plan.maxHoldHours,
              slArmRoiPct: plan.slArmRoiPct,
              slEntryOffsetPct: plan.slEntryOffsetPct,
              tp1PlanOrderId,
              tp2PlanOrderId,
              initialHoldVol,
              tp1PlanVol,
            },
            dayKey
          );
          trackedTpSl = true;
        }
      }

      const tpSlLines: string[] = [];
      if (plan.enabled) {
        if (aboveEma) {
          if (trackedTpSl && mexcAvgEntry != null) {
            tpSlLines.push(
              `ราคาเข้าเฉลี่ย MEXC: ${fmtReversalAutoTradePrice(mexcAvgEntry)} USDT — ใช้คำนวณ % drop จริง`,
              `กลยุทธ์: TP1 -${plan.tp1PricePct}% ปิด ${plan.tp1PartialPct}% · TP2 -${plan.tp2PricePct}% ปิดทั้งหมด`,
              ...(exchangeTpLines.length
                ? ["Plan TP บน MEXC (วางทันทีหลังเปิด):", ...exchangeTpLines]
                : ["Plan TP: ใช้ tick ปิด market (วาง plan ไม่สำเร็จ)"]),
              ...exchangeTpWarnings.map((w) => `⚠️ ${w}`),
              `กติกา ${plan.maxHoldHours} ชม.: ถ้าถือครบจะปิด market ทั้งหมด · SL บังทุนตั้งหลัง TP1`
            );
          } else {
            tpSlLines.push(
              "⚠️ ดึงราคาเข้าเฉลี่ย MEXC ไม่สำเร็จ — กลยุทธ์ TP/SL จะไม่ทำงานในรอบนี้ (ตั้งเองได้)"
            );
          }
        } else {
          tpSlLines.push(
            `กลยุทธ์ TP/SL: รอ Limit fill ก่อนเริ่ม track (TP1 -${plan.tp1PricePct}% · TP2 -${plan.tp2PricePct}% · ${plan.maxHoldHours} ชม.)`
          );
        }
      }

      await notifyLines(userId, [
        tgTitle,
        emaFallbackMarket
          ? "✅ เปิด Market SHORT (ไม่มี EMA20 → Market โดยตรง)"
          : aboveEma
            ? "✅ เปิด Market SHORT (ราคาเหนือ EMA20 15m)"
            : "✅ ตั้ง Limit SHORT รอรีเทสต์ที่ EMA20 15m",
        `[${shortContractLabel(contractSymbol)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${lev}x`,
        `สัญญาณ Reversal: ${input.model} · TF ${input.signalBarTf.toUpperCase()}`,
        saturdayAllSignals
          ? "เกณฑ์: วันเสาร์ (เวลาไทย) — auto-open ทุกสัญญาณ Reversal"
          : `Quality Signal ✓ · Wick ${wickPct.toFixed(1)}%${greenDays != null ? ` · เขียว ${greenDays}d` : ""}${rangeScore != null ? ` · Range ${rangeScore.toFixed(2)}` : ""}${ema4hPct != null ? ` · EMA4h ${ema4hPct.toFixed(1)}%` : ""}${lenRank != null ? ` · Len# ${lenRank}` : ""} · Body ${bodyPct.toFixed(1)}%`,
        emaFallbackMarket
          ? `ราคาอ้างอิง ~${fmtReversalAutoTradePrice(markPrice)} (${markSource})`
          : aboveEma
            ? `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} > EMA20 15m ~${fmtReversalAutoTradePrice(ema20!)}`
            : `Limit ~${fmtReversalAutoTradePrice(ema20!)} (EMA20 15m) · ราคาปัจจุบัน ~${fmtReversalAutoTradePrice(markPrice)}`,
        ...tpSlLines,
        "1 order/เหรียญ/วัน (BKK) — จะไม่สั่งซ้ำในเหรียญนี้วันนี้",
      ]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      logReversalAutoOpen(
        userId,
        logSignal,
        "failed",
        "network_error",
        {
          reasonDetail: detail.slice(0, 400),
          marginUsdt,
          leverage: lev,
          orderKind: aboveEma ? "market" : "limit",
          ema20_15m: ema20 ?? undefined,
          markPrice,
          entryPrice: intendedEntry,
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        tgTitle,
        `❌ สั่งเปิดล้มเหลวจากข้อผิดพลาดระหว่างเรียก MEXC / เครือข่าย (ตั้งใจให้เป็น SHORT)`,
        `[${shortContractLabel(contractSymbol)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${lev}x`,
        `รายละเอียด: ${detail.slice(0, 400)}`,
      ]);
    }
  }

  try {
    await saveReversalAutoTradeState(state);
  } catch (e) {
    console.error("[reversalAutoTrade] save state failed", e);
  }

  return { usersAttempted, usersSucceeded };
}
