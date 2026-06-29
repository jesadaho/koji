import {
  cancelOpenOrders,
  closeOpenPositionForSymbolSide,
  createOpenLimitOrder,
  createOpenMarketOrder,
  getContractLastPricePublic,
  getContractTickerPublic,
  getOpenOrders,
  getOpenPositions,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { fetchBinanceUsdmKlines, fetchBinanceUsdmLastPrice } from "./binanceIndicatorKline";
import { emaLine } from "./indicatorMath";
import { resolveMexcContractFromBinanceSymbolAsync } from "./mexcContractResolver";
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
  withReversalActiveRemoved,
  withReversalPendingLimitAdded,
  withReversalPendingLimitRemoved,
  withReversalPlacedUnlocked,
  type ReversalAutoTradeState,
} from "./reversalAutoTradeStateStore";
import { cancelActiveTpSlPlanOrders, placeTpPlanOrdersAfterOpen } from "./autoTradeTpSlPlanOrders";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";
import type { CandleReversalModel, CandleReversalTf, CandleReversalTradeSide } from "./candleReversalDetect";
import { appendAutoOpenOrderLogSafe } from "./autoOpenOrderLogStore";
import type { AutoOpenOutcome } from "@/lib/autoOpenOrderLogClient";
import { reversalAutoTradeMarginUsdtForMexcSide } from "@/lib/reversalAutoTradeMargin";
import {
  reversalTpSlPlanFromRow,
  type ReversalTpSlSignalKind,
} from "@/lib/reversalTpSlSettings";
import { reversalMatchesQualitySignalForAlert, reversalAutoTradePlaySidesFromSettings, reversalRowMatchesMarketEntryMatrix, reversalSuggestedTradeSide } from "@/lib/reversalMatrixFilters";
import {
  resolveReversalLongTradeLeverage,
  reversalLongDynamicLeverageNote,
} from "@/lib/reversalLongDynamicLeverage";
import {
  resolveReversalShortTradeLeverage,
  reversalShortDynamicLeverageNote,
} from "@/lib/reversalShortDynamicLeverage";
import { bkkIsSaturdayNow } from "./snowballAutoTradeStateStore";
import {
  REVERSAL_ENTRY_EMA_PERIOD_DEFAULT,
  REVERSAL_LIMIT_EXPIRE_MS,
  reversalEma15mLabel,
  reversalEntrySettingsFromRow,
  reversalEntryUseMarket,
  type ReversalAutoTradeEntryMode,
  type ReversalShortHybridMarketBypass,
} from "@/lib/reversalAutoTradeEntry";
import { priceVsEmaDistPct } from "./statsEma20Dist";

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
  trendGainPct?: number | null;
  ageOfTrendHours?: number | null;
  signalVolVsSma?: number | null;
  /** open time (sec) ของแท่งสัญญาณ — ใช้หาวัน BKK สำหรับ Quality Signal */
  signalBarOpenSec?: number;
  btcEma4hSlopePct7d?: number | null;
  allowQualitySignal?: boolean;
}): boolean {
  if (input.allowQualitySignal === false) return false;
  return reversalMatchesQualitySignalForAlert({
    signalBarTf: input.signalBarTf,
    tradeSide: input.alertTradeSide,
    trendGainPct: input.trendGainPct,
    ageOfTrendHours: input.ageOfTrendHours,
    signalVolVsSma: input.signalVolVsSma,
    btcEma4hSlopePct7d: input.btcEma4hSlopePct7d,
    signalBarOpenSec: input.signalBarOpenSec,
  });
}

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

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
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

function hasActiveShortPosition(
  positions: Awaited<ReturnType<typeof getOpenPositions>>,
  contractSymbol: string,
): boolean {
  return findMexcOpenPositionShort(positions, contractSymbol) != null;
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

export function resolveReversalTpSlPlanFromRow(
  row: TradingViewMexcUserSettings,
  side: ReversalTpSlSignalKind = "short",
) {
  return reversalTpSlPlanFromRow(row, side);
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
  /** BTC EMA(12) 1d slope 7 วัน % — Long 1H fade SHORT Quality Signal */
  btcEma1dSlopePct7d?: number | null;
  /** BTC EMA(12) 4h slope 7 วัน % — Long 1H fade SHORT Quality Signal */
  btcEma4hSlopePct7d?: number | null;
  /** Wilder ATR(14) 1d ÷ close × 100 — Long 1H fade SHORT Quality Signal */
  atrPct14d?: number | null;
  /** Pump-cycle Trend Gain % — Short Quality Signal */
  trendGainPct?: number | null;
  /** Pump-cycle Age of Trend (hours) — Short Quality Signal */
  ageOfTrendHours?: number | null;
  /** Vol แท่งสัญญาณ ÷ SMA(volume) — Long 1H Quality Signal */
  signalVolVsSma?: number | null;
  /** R% ช่วงแท่งสัญญาณ — Long candidate Fresh Breakout */
  barRangePctSignal?: number | null;
  /** (close − EMA20) / EMA20 × 100 บน 1h — Long candidate */
  priceVsEma20_1hPct?: number | null;
  /** EMA20 1h slope 7d % — Long candidate */
  ema20_1hSlopePct7d?: number | null;
  /** (close − EMA20) / EMA20 × 100 บน 4h — Long candidate */
  priceVsEma20_4hPct?: number | null;
  /** EMA20 4h slope 7d % — Long candidate */
  ema20_4hSlopePct7d?: number | null;
  /** lower wick / range × 100 บนแท่งสัญญาณ — Market Entry matrix */
  lowerWickRatioPct?: number | null;
  /** เวลาแจ้ง alert (ms) — ใช้ conflict check */
  alertedAtMs?: number;
  /** ราคาปิดแท่งสัญญาณ — fallback entry เมื่อเปิดไม่สำเร็จ */
  signalClosePrice?: number;
  /** observe = stats-only (defense in depth) */
  statsPlayMode?: "play" | "observe";
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

function reversalAutoOpenTelegramTitle(
  alertTradeSide: CandleReversalTradeSide,
  openMexcLong = false,
): string {
  if (openMexcLong) {
    return "Koji — Reversal auto-open (MEXC) · LONG (ทิศแนะนำ 🟢)";
  }
  return alertTradeSide === "long"
    ? "Koji — Reversal auto-open (MEXC) · Long → SHORT"
    : "Koji — Reversal auto-open (MEXC)";
}

function reversalEma15mFromLogExtra(
  extra:
    | {
        entryEma15m?: number;
        ema25_15m?: number;
        ema20_15m?: number;
      }
    | undefined,
): number | undefined {
  const generic =
    typeof extra?.entryEma15m === "number" && Number.isFinite(extra.entryEma15m) && extra.entryEma15m > 0
      ? extra.entryEma15m
      : undefined;
  const ema25 =
    typeof extra?.ema25_15m === "number" && Number.isFinite(extra.ema25_15m) && extra.ema25_15m > 0
      ? extra.ema25_15m
      : undefined;
  const ema20 =
    typeof extra?.ema20_15m === "number" && Number.isFinite(extra.ema20_15m) && extra.ema20_15m > 0
      ? extra.ema20_15m
      : undefined;
  return generic ?? ema25 ?? ema20;
}

function resolveReversalLogEntryPrice(
  outcome: AutoOpenOutcome,
  extra: {
    entryPrice?: number;
    orderKind?: "market" | "limit";
    entryMode?: ReversalAutoTradeEntryMode;
    entryEma15m?: number;
    ema25_15m?: number;
    ema20_15m?: number;
    markPrice?: number;
  } | undefined,
  signalClosePrice: number | undefined,
): number | undefined {
  if (outcome !== "success" && outcome !== "failed") return undefined;
  if (typeof extra?.entryPrice === "number" && extra.entryPrice > 0) return extra.entryPrice;

  const mark =
    typeof extra?.markPrice === "number" && Number.isFinite(extra.markPrice) && extra.markPrice > 0
      ? extra.markPrice
      : undefined;
  const ema = reversalEma15mFromLogExtra(extra);
  const marketAboveEma = mark != null && ema != null && mark > ema;

  if (extra?.entryMode === "market" || extra?.orderKind === "market") {
    if (mark != null) return mark;
  }
  if (marketAboveEma || extra?.orderKind === "market") {
    if (mark != null) return mark;
  }
  if (extra?.orderKind === "limit" && ema != null) {
    return ema;
  }
  if (mark != null) return mark;
  if (ema != null) return ema;
  if (typeof signalClosePrice === "number" && signalClosePrice > 0) return signalClosePrice;
  return undefined;
}

function findMexcOpenPositionLong(
  positions: OpenPositionRow[],
  contractSymbol: string,
): OpenPositionRow | undefined {
  const sym = contractSymbol.trim();
  return positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === 1,
  );
}

function hasActiveLongPosition(
  positions: Awaited<ReturnType<typeof getOpenPositions>>,
  contractSymbol: string,
): boolean {
  return findMexcOpenPositionLong(positions, contractSymbol) != null;
}

function readMexcAvgEntryPriceLong(
  positions: OpenPositionRow[],
  contractSymbol: string,
): number | null {
  const p = findMexcOpenPositionLong(positions, contractSymbol);
  if (!p) return null;
  const o = Number(p.openAvgPrice);
  if (Number.isFinite(o) && o > 0) return o;
  const h = Number(p.holdAvgPrice);
  if (Number.isFinite(h) && h > 0) return h;
  return null;
}

async function cancelReversalPendingLimitOnMexc(
  creds: MexcCredentials,
  contractSymbol: string,
  orderId: string,
): Promise<void> {
  try {
    const openOrders = await getOpenOrders(creds, contractSymbol);
    const oid = orderId.trim();
    if (!openOrders.some((x) => x.orderId === oid)) return;
    const cancelRes = await cancelOpenOrders(creds, [oid]);
    if (!cancelRes.success) {
      console.error("[reversalAutoTrade] cancelOpenOrders", contractSymbol, oid, cancelRes.message);
    }
  } catch (e) {
    console.error("[reversalAutoTrade] cancel pending limit", contractSymbol, orderId, e);
  }
}

/** สัญญาณใหม่สวนทิศ → ยกเลิก Limit pending / ปิด position ฝั่งเดิมบน MEXC */
async function reversalFlipCloseOppositeSideIfNeeded(args: {
  state: ReversalAutoTradeState;
  userId: string;
  creds: MexcCredentials;
  contractSymbol: string;
  mexcSide: "short" | "long";
  dayKey: string;
  positions: OpenPositionRow[];
  userTgTitle: string;
}): Promise<{
  state: ReversalAutoTradeState;
  positions: OpenPositionRow[];
  flipped: boolean;
  oppositeCloseFailed: boolean;
}> {
  const { userId, creds, contractSymbol, mexcSide, dayKey, userTgTitle } = args;
  const sym = contractSymbol.trim().toUpperCase();
  const oppositeSide: "short" | "long" = mexcSide === "long" ? "short" : "long";
  let state = args.state;
  let positions = args.positions;
  let flipped = false;

  const pendingForSymbol = [...(state[userId]?.pendingLimits ?? [])].filter(
    (p) => p.contractSymbol.trim().toUpperCase() === sym,
  );
  if (mexcSide === "long" && pendingForSymbol.length > 0) {
    for (const pending of pendingForSymbol) {
      await cancelReversalPendingLimitOnMexc(creds, pending.contractSymbol, pending.orderId);
      state = withReversalPendingLimitRemoved(
        state,
        userId,
        pending.contractSymbol,
        pending.orderId,
        dayKey,
      );
      state = withReversalPlacedUnlocked(state, userId, pending.contractSymbol, dayKey);
      flipped = true;
      await notifyLines(userId, [
        userTgTitle,
        "🔄 สัญญาณ LONG ใหม่ → ยกเลิก Limit SHORT ที่ค้าง",
        `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
        `Limit ~${fmtReversalAutoTradePrice(pending.limitPrice)} · order #${pending.orderId}`,
      ]);
    }
  }

  const oppositePos =
    oppositeSide === "short"
      ? findMexcOpenPositionShort(positions, contractSymbol)
      : findMexcOpenPositionLong(positions, contractSymbol);
  if (!oppositePos) {
    return { state, positions, flipped, oppositeCloseFailed: false };
  }

  const tracked = (state[userId]?.active ?? []).find(
    (a) => a.contractSymbol.trim().toUpperCase() === sym && a.side === oppositeSide,
  );
  if (tracked) {
    await cancelActiveTpSlPlanOrders(creds, tracked);
  }

  const entryPx =
    oppositeSide === "short"
      ? readMexcAvgEntryPriceShort(positions, contractSymbol)
      : readMexcAvgEntryPriceLong(positions, contractSymbol);
  const mark = (await getContractLastPricePublic(contractSymbol)) ?? NaN;
  const closeRes = await closeOpenPositionForSymbolSide(creds, contractSymbol, oppositeSide);
  state = withReversalActiveRemoved(state, userId, contractSymbol, oppositeSide);
  state = withReversalPlacedUnlocked(state, userId, contractSymbol, dayKey);
  flipped = true;

  try {
    positions = await getOpenPositions(creds, contractSymbol);
  } catch (e) {
    console.error("[reversalAutoTrade] refresh positions after flip", contractSymbol, userId, e);
  }

  await notifyLines(userId, [
    userTgTitle,
    closeRes.success
      ? `🔄 สัญญาณ ${mexcSide.toUpperCase()} ใหม่ → ปิด ${oppositeSide.toUpperCase()} ทันที (market)`
      : `❌ สัญญาณ ${mexcSide.toUpperCase()} ใหม่ — ปิด ${oppositeSide.toUpperCase()} ไม่สำเร็จ`,
    `[${shortContractLabel(contractSymbol)}]/USDT`,
    entryPx != null ? `Entry เดิม ~${fmtReversalAutoTradePrice(entryPx)}` : "",
    Number.isFinite(mark) && mark > 0 ? `Mark ~${fmtReversalAutoTradePrice(mark)}` : "",
    closeRes.message && !closeRes.success ? `MEXC: ${closeRes.message}` : "",
    closeRes.success ? "เปิดทิศใหม่ต่อ…" : "",
  ]);

  return { state, positions, flipped, oppositeCloseFailed: !closeRes.success };
}

function logReversalAutoOpen(
  userId: string,
  signal: ReversalAutoOpenLogSignal,
  outcome: AutoOpenOutcome,
  reasonCode: string,
  mexcSide: "short" | "long",
  extra?: {
    reasonDetail?: string;
    marginUsdt?: number;
    leverage?: number;
    orderKind?: "market" | "limit";
    entryMode?: ReversalAutoTradeEntryMode;
    entryEmaPeriod?: number;
    entryEma15m?: number;
    ema25_15m?: number;
    ema20_15m?: number;
    markPrice?: number;
    entryPrice?: number;
    ema20_1hSlopePct7d?: number;
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
    side: mexcSide,
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
 * - สัญญาณ Short: `reversalAutoTradeEnabled` · ทิศที่เล่น Long → Market LONG (Long candidate) · สัญญาณ Long (fade): `reversalAutoTradeLongSignalShortEnabled`
 * - มี MEXC creds
 * - gate Quality Signal: Short — ดู REVERSAL_QUALITY_SIGNAL_CRITERIA · Long 1H — ดู REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA
 * - entry Short: Hybrid (EMA 15m) หรือ Market · Long (fade + ทิศที่เล่น Long): Market ตลอด
 *   - Hybrid Short: EMA20Δ15m < −2% → Market · ผ่าน Matrix Market Entry → Market
 *   - นอกนั้น: ราคา > EMA → Market SHORT · ราคา ≤ EMA → Limit ที่ EMA (หมดอายุ 8 ชม.)
 * - สลับทิศบนเหรียญเดียวกัน: มี SHORT/LONG ค้างบน MEXC แล้วสัญญาณใหม่สวนทิศ → ปิดทันที (market) แล้วเปิดทิศใหม่
 * - TP ใช้ cron tick ปิด market (ไม่วาง plan TP บน MEXC)
 * - 1 order/เหรียญ/วัน (BKK) — ปลดล็อกเมื่อ Limit หมดอายุโดยไม่ fill
 */
export async function runReversalAutoTradeAfterReversalAlert(
  input: ReversalAutoTradeInput
): Promise<ReversalAutoTradeRunResult> {
  if (!isReversalAutotradeEnabled()) return { usersAttempted: 0, usersSucceeded: 0 };
  if (input.statsPlayMode === "observe") return { usersAttempted: 0, usersSucceeded: 0 };

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

  const contractSymbol = await resolveMexcContractFromBinanceSymbolAsync(binanceSymbol);
  if (!contractSymbol) {
    console.error("[reversalAutoTrade] no MEXC contract for", binanceSymbol);
    return { usersAttempted: 0, usersSucceeded: 0 };
  }
  const sym = contractSymbol;

  const alertTradeSide: CandleReversalTradeSide = input.alertTradeSide === "long" ? "long" : "short";

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

  type EntryResolve =
    | {
        ok: true;
        mode: ReversalAutoTradeEntryMode;
        emaPeriod: number;
        entryEma: number | null;
        mark: number;
        useMarket: boolean;
        aboveEma: boolean;
        emaFallbackMarket: boolean;
        markSource: "mexc" | "binance" | "signal" | "kline";
        emaLabel: string;
        hybridMarketBypass?: ReversalShortHybridMarketBypass;
      }
    | { ok: false; reasonCode: "mark_unavailable" | "ema_or_price_unavailable"; error: string };

  type KlinePack = Awaited<ReturnType<typeof fetchBinanceUsdmKlines>>;
  let klinePack: KlinePack | null | undefined;
  let markCache:
    | {
        mark: number;
        markSource: "mexc" | "binance" | "signal" | "kline";
        klineLastClose: number | null;
      }
    | { failed: true; error: string }
    | undefined;
  const emaByPeriod = new Map<number, number | null>();

  async function ensureKlinePack(): Promise<KlinePack | null> {
    if (klinePack !== undefined) return klinePack;
    try {
      klinePack = await fetchBinanceUsdmKlines(
        binanceSymbol,
        "15m",
        REVERSAL_AUTOTRADE_15M_FETCH_BARS,
      );
    } catch (e) {
      console.error("[reversalAutoTrade] fetchBinanceUsdmKlines", binanceSymbol, e);
      klinePack = null;
    }
    return klinePack;
  }

  async function ensureMarkPrice(): Promise<
    | { ok: true; mark: number; markSource: "mexc" | "binance" | "signal" | "kline"; klineLastClose: number | null }
    | { ok: false; error: string }
  > {
    if (markCache && "failed" in markCache) {
      return { ok: false, error: markCache.error };
    }
    if (markCache && "mark" in markCache) {
      return { ok: true, ...markCache };
    }

    const pack = await ensureKlinePack();
    let klineLastClose: number | null = null;
    if (pack?.close.length) {
      const lc = pack.close[pack.close.length - 1];
      if (typeof lc === "number" && Number.isFinite(lc) && lc > 0) {
        klineLastClose = lc;
      }
    }

    let mark: number | null = null;
    let markSource: "mexc" | "binance" | "signal" | "kline" | null = null;

    try {
      const t = await getContractTickerPublic(sym);
      if (t && t.lastPrice > 0) {
        mark = t.lastPrice;
        markSource = "mexc";
      }
    } catch (e) {
      console.error("[reversalAutoTrade] getContractTickerPublic", sym, e);
    }

    if (mark == null) {
      try {
        const lp = await getContractLastPricePublic(sym);
        if (lp != null && lp > 0) {
          mark = lp;
          markSource = "mexc";
        }
      } catch (e) {
        console.error("[reversalAutoTrade] getContractLastPricePublic", sym, e);
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
      const err = `ดึงราคาตลาดไม่ได้ (${sym} · MEXC/Binance/สัญญาณ)`;
      markCache = { failed: true, error: err };
      return { ok: false, error: err };
    }

    markCache = {
      mark,
      markSource: markSource ?? "binance",
      klineLastClose,
    };
    return { ok: true, mark, markSource: markSource ?? "binance", klineLastClose };
  }

  async function emaForPeriod(period: number): Promise<number | null> {
    if (emaByPeriod.has(period)) return emaByPeriod.get(period) ?? null;
    const pack = await ensureKlinePack();
    const emaMinBars = period + 2;
    let entryEma: number | null = null;
    if (pack && pack.close.length >= emaMinBars) {
      const ema = emaLine(pack.close, period);
      const i = pack.close.length - 2;
      const v = ema[i];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        entryEma = v;
      }
    }
    emaByPeriod.set(period, entryEma);
    return entryEma;
  }

  async function resolveReversalEntryForUser(
    row: TradingViewMexcUserSettings,
  ): Promise<EntryResolve> {
    const signalKind = alertTradeSide === "long" ? "long" : "short";
    const { mode, emaPeriod } = reversalEntrySettingsFromRow(row, signalKind);
    const markRes = await ensureMarkPrice();
    if (!markRes.ok) {
      return {
        ok: false,
        reasonCode: "mark_unavailable",
        error: markRes.error,
      };
    }

    const entryEma = mode === "hybrid_ema" ? await emaForPeriod(emaPeriod) : null;
    const ema20ForDist = await emaForPeriod(REVERSAL_ENTRY_EMA_PERIOD_DEFAULT);
    const priceVsEma20_15mPct =
      ema20ForDist != null ? priceVsEmaDistPct(markRes.mark, ema20ForDist) : null;
    const marketEntryMatrixPass =
      signalKind === "short" &&
      input.signalBarTf === "1h" &&
      reversalRowMatchesMarketEntryMatrix({
        trendGainPct: input.trendGainPct,
        signalVolVsSma: input.signalVolVsSma,
        barRangePctSignal: input.barRangePctSignal,
        priceVsEma20_1hPct: input.priceVsEma20_1hPct,
        ema20_1hSlopePct7d: input.ema20_1hSlopePct7d,
        priceVsEma20_4hPct: input.priceVsEma20_4hPct,
        ema20_4hSlopePct7d: input.ema20_4hSlopePct7d,
        ema4hSlopePct7d: input.ema4hSlopePct7d,
        ageOfTrendHours: input.ageOfTrendHours,
        priceVsEma20_15mPct,
        lowerWickRatioPct: input.lowerWickRatioPct,
      });
    const entryPick = reversalEntryUseMarket({
      mode,
      mark: markRes.mark,
      entryEma,
      signalKind,
      shortHybrid:
        signalKind === "short"
          ? {
              priceVsEma20_15mPct,
              marketEntryMatrixPass,
            }
          : undefined,
    });
    const emaLabel = reversalEma15mLabel(emaPeriod);

    return {
      ok: true,
      mode,
      emaPeriod,
      entryEma,
      mark: markRes.mark,
      useMarket: entryPick.useMarket,
      aboveEma: entryPick.aboveEma,
      emaFallbackMarket: entryPick.emaFallbackMarket,
      markSource: markRes.markSource,
      emaLabel,
      hybridMarketBypass: entryPick.hybridMarketBypass,
    };
  }

  function fmtExpireBkk(ms: number): string {
    try {
      return new Date(ms).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return new Date(ms).toISOString();
    }
  }

  for (const [userId, rowRaw] of Object.entries(map)) {
    if (!/^tg:\d+$/.test(userId.trim())) continue;
    const row = rowRaw as TradingViewMexcUserSettings;
    const playSides = reversalAutoTradePlaySidesFromSettings(row);
    const longOnlyPlay = playSides.long && !playSides.short;
    const is1hShortAlert = alertTradeSide === "short" && input.signalBarTf === "1h";
    const isLongCandidate =
      is1hShortAlert &&
      reversalSuggestedTradeSide({
        trendGainPct: input.trendGainPct,
        signalVolVsSma: input.signalVolVsSma,
        barRangePctSignal: input.barRangePctSignal,
        priceVsEma20_1hPct: input.priceVsEma20_1hPct,
        ema20_1hSlopePct7d: input.ema20_1hSlopePct7d,
        priceVsEma20_4hPct: input.priceVsEma20_4hPct,
        ema20_4hSlopePct7d: input.ema20_4hSlopePct7d,
        ema4hSlopePct7d: input.ema4hSlopePct7d,
        ageOfTrendHours: input.ageOfTrendHours,
      }) === "long";

    if (
      playSides.long &&
      !playSides.short &&
      alertTradeSide === "short" &&
      input.signalBarTf !== "1h"
    ) {
      logReversalAutoOpen(userId, logSignal, "skipped", "play_long_requires_1h", "long");
      continue;
    }

    let openMexcLong = false;
    if (is1hShortAlert) {
      if (playSides.long && isLongCandidate) {
        openMexcLong = true;
      } else if (longOnlyPlay) {
        logReversalAutoOpen(userId, logSignal, "skipped", "not_long_candidate", "long");
        continue;
      }
    } else if (alertTradeSide === "short" && longOnlyPlay) {
      logReversalAutoOpen(userId, logSignal, "skipped", "play_short_disabled", "short");
      continue;
    }

    const mexcSide: "short" | "long" = openMexcLong ? "long" : "short";
    const userTgTitle = reversalAutoOpenTelegramTitle(alertTradeSide, openMexcLong);

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
        mexcSide,
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
        trendGainPct: input.trendGainPct,
        ageOfTrendHours: input.ageOfTrendHours,
        signalVolVsSma: input.signalVolVsSma,
        signalBarOpenSec: input.signalBarOpenSec,
        btcEma4hSlopePct7d: input.btcEma4hSlopePct7d,
        allowQualitySignal: allowQuality,
      })
    ) {
      logReversalAutoOpen(userId, logSignal, "skipped", "quality_signal_gate", mexcSide);
      continue;
    }

    const creds: MexcCredentials | null =
      row.mexcApiKey?.trim() && row.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;
    if (!creds) {
      logReversalAutoOpen(userId, logSignal, "skipped", "no_mexc_creds", mexcSide);
      continue;
    }

    const marginUsdt = reversalAutoTradeMarginUsdtForMexcSide(row, mexcSide) ?? NaN;
    const baseLeverage = row.reversalAutoTradeLeverage ?? NaN;
    if (!(typeof marginUsdt === "number" && Number.isFinite(marginUsdt) && marginUsdt > 0)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage", mexcSide);
      continue;
    }
    if (!(typeof baseLeverage === "number" && Number.isFinite(baseLeverage) && baseLeverage >= 1)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage", mexcSide, {
        marginUsdt,
      });
      continue;
    }

    const baseLev = Math.floor(baseLeverage);
    let leverage: number;
    let leverageDynamicNote: string | null = null;
    let leverageLogExtra: {
      leverageBase: number;
      dynamicLeverageApplied?: boolean;
      dynamicLeverageTier?: string;
      atrPct14d?: number;
      trendGainPct?: number;
      ema4hSlopePct7d?: number;
      dynamicLeverageMaxSlots?: number;
    } = { leverageBase: baseLev };

    if (openMexcLong || alertTradeSide === "long") {
      const leveragePick = resolveReversalLongTradeLeverage({
        alertTradeSide: "long",
        baseLeverage: baseLev,
        dynamicLeverageEnabled: row.reversalAutoTradeLongDynamicLeverageEnabled === true,
        atrPct14d: input.atrPct14d,
      });
      leverage = leveragePick.leverage;
      leverageDynamicNote = reversalLongDynamicLeverageNote(leveragePick, baseLev);
      if (leveragePick.dynamicApplied) {
        leverageLogExtra = {
          ...leverageLogExtra,
          dynamicLeverageApplied: true,
          dynamicLeverageTier: leveragePick.tier ?? undefined,
          atrPct14d: leveragePick.atrPct14d ?? undefined,
        };
      }
    } else {
      const shortPick = resolveReversalShortTradeLeverage({
        baseLeverage: baseLev,
        dynamicLeverageEnabled: row.reversalAutoTradeShortDynamicLeverageEnabled === true,
        trendGainPct: input.trendGainPct,
        ema20_4hSlopePct7d: input.ema20_4hSlopePct7d,
        ema4hSlopePct7d: input.ema4hSlopePct7d,
        atrPct14d: input.atrPct14d,
      });
      leverage = shortPick.leverage;
      leverageDynamicNote = reversalShortDynamicLeverageNote(shortPick, baseLev);
      if (shortPick.dynamicApplied) {
        leverageLogExtra = {
          ...leverageLogExtra,
          dynamicLeverageApplied: true,
          dynamicLeverageTier: shortPick.tier ?? undefined,
          trendGainPct: shortPick.trendGainPct ?? undefined,
          ema4hSlopePct7d: shortPick.ema4hSlopePct7d ?? undefined,
          atrPct14d: shortPick.atrPct14d ?? undefined,
          dynamicLeverageMaxSlots: shortPick.maxSlots ?? undefined,
        };
      }
    }

    let entryRes: EntryResolve;
    if (openMexcLong) {
      const markRes = await ensureMarkPrice();
      if (!markRes.ok) {
        entryRes = {
          ok: false,
          reasonCode: "mark_unavailable",
          error: markRes.error,
        };
      } else {
        entryRes = {
          ok: true,
          mode: "market",
          emaPeriod: REVERSAL_ENTRY_EMA_PERIOD_DEFAULT,
          entryEma: null,
          mark: markRes.mark,
          useMarket: true,
          aboveEma: true,
          emaFallbackMarket: true,
          markSource: markRes.markSource,
          emaLabel: reversalEma15mLabel(REVERSAL_ENTRY_EMA_PERIOD_DEFAULT),
        };
      }
    } else {
      entryRes = await resolveReversalEntryForUser(row);
    }

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
        mexcSide,
        {
          reasonDetail: detail.slice(0, 400),
          marginUsdt,
          leverage: Math.floor(leverage),
          ...leverageLogExtra,
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        userTgTitle,
        "❌ เช็คโพซิชันจาก MEXC ไม่สำเร็จ — จึงไม่สั่งเปิด (ป้องกันซ้ำ)",
        `[${shortContractLabel(contractSymbol)}]/USDT (${mexcSide.toUpperCase()})`,
        `รายละเอียด: ${detail.slice(0, 320)}`,
      ]);
      continue;
    }

    const flipRes = await reversalFlipCloseOppositeSideIfNeeded({
      state,
      userId,
      creds,
      contractSymbol,
      mexcSide,
      dayKey,
      positions,
      userTgTitle,
    });
    state = flipRes.state;
    positions = flipRes.positions;

    if (flipRes.oppositeCloseFailed) {
      logReversalAutoOpen(userId, logSignal, "skipped", "flip_close_failed", mexcSide, {
        marginUsdt,
        leverage: Math.floor(leverage),
        ...leverageLogExtra,
      });
      continue;
    }

    if (hasPlacedReversalContractToday(state[userId], contractSymbol, dayKey)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "already_opened_today", mexcSide);
      continue;
    }

    const emaLogExtra = entryRes.ok
      ? {
          entryMode: entryRes.mode,
          entryEmaPeriod: entryRes.emaPeriod,
          entryEma15m: entryRes.entryEma ?? undefined,
          markPrice: entryRes.mark,
          orderKind: (entryRes.useMarket ? "market" : "limit") as "market" | "limit",
        }
      : {};

    if (
      openMexcLong
        ? hasActiveLongPosition(positions, contractSymbol)
        : hasActiveShortPosition(positions, contractSymbol)
    ) {
      const active = openMexcLong
        ? findMexcOpenPositionLong(positions, contractSymbol)
        : findMexcOpenPositionShort(positions, contractSymbol);
      const hv = active != null ? Number(active.holdVol) : NaN;
      logReversalAutoOpen(userId, logSignal, "skipped", "existing_position", mexcSide, {
        marginUsdt,
        leverage: Math.floor(leverage),
        ...leverageLogExtra,
      });
      await notifyLines(userId, [
        userTgTitle,
        openMexcLong
          ? "ℹ️ ไม่สั่งเปิด — MEXC มีโพซิชัน LONG คู่สัญญานี้อยู่แล้ว"
          : "ℹ️ ไม่สั่งเปิด — MEXC มีโพซิชัน SHORT คู่สัญญานี้อยู่แล้ว",
        `[${shortContractLabel(contractSymbol)}]/USDT`,
        Number.isFinite(hv) && hv > 0 ? `holdVol ~${hv}` : "",
        openMexcLong ? "" : "LONG จาก Snowball ไม่บล็อก Reversal Short",
      ]);
      continue;
    }

    if (!entryRes.ok) {
      logReversalAutoOpen(
        userId,
        logSignal,
        "failed",
        entryRes.reasonCode,
        mexcSide,
        {
          reasonDetail: entryRes.error.slice(0, 400),
          marginUsdt,
          leverage: Math.floor(leverage),
          ...leverageLogExtra,
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        userTgTitle,
        "❌ สั่งเปิดไม่สำเร็จ",
        `[${shortContractLabel(contractSymbol)}]/USDT (${mexcSide.toUpperCase()})`,
        entryRes.error,
      ]);
      continue;
    }
    const entryEma = entryRes.entryEma;
    const markPrice = entryRes.mark;
    const useMarket = entryRes.useMarket;
    const aboveEma = entryRes.aboveEma;
    const emaFallbackMarket = entryRes.emaFallbackMarket;
    const markSource = entryRes.markSource;
    const entryMode = entryRes.mode;
    const emaPeriod = entryRes.emaPeriod;
    const emaLabel = entryRes.emaLabel;
    usersAttempted += 1;

    const intendedEntry = useMarket
      ? markPrice
      : entryEma != null
        ? entryEma
        : markPrice;
    const lev = Math.floor(leverage);

    try {
      const om = useMarket
        ? await createOpenMarketOrder(creds, {
            contractSymbol,
            long: openMexcLong,
            marginUsdt,
            leverage: lev,
            openType: 1,
          })
        : await createOpenLimitOrder(creds, {
            contractSymbol,
            long: openMexcLong,
            marginUsdt,
            leverage: lev,
            limitPrice: entryEma!,
            openType: 1,
          });

      if (!om.success) {
        const msg = om.message ?? `code ${om.code}`;
        logReversalAutoOpen(
          userId,
          logSignal,
          "failed",
          "mexc_order_rejected",
          mexcSide,
          {
            reasonDetail: msg.slice(0, 400),
            marginUsdt,
            leverage: lev,
            ...leverageLogExtra,
            orderKind: useMarket ? "market" : "limit",
            entryMode,
            entryEmaPeriod: emaPeriod,
            entryEma15m: entryEma ?? undefined,
            markPrice,
            entryPrice: intendedEntry,
          },
          signalClosePrice,
        );
        await notifyLines(userId, [
          userTgTitle,
          openMexcLong
            ? "❌ สั่งเปิดไม่สำเร็จ (Market LONG)"
            : entryMode === "market"
              ? "❌ สั่งเปิดไม่สำเร็จ (Market SHORT · โหมด Market ตลอด)"
              : emaFallbackMarket
                ? `❌ สั่งเปิดไม่สำเร็จ (Market SHORT · ไม่มี ${emaLabel})`
                : `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น SHORT${useMarket ? ` · Market (เหนือ ${emaLabel})` : ` · Limit retest ${emaLabel}`})`,
          `[${shortContractLabel(contractSymbol)}]/USDT`,
          `Margin ~${marginUsdt} USDT · ${lev}x`,
          openMexcLong || entryMode === "market"
            ? `ราคาอ้างอิง ~${fmtReversalAutoTradePrice(markPrice)} (${markSource})`
            : emaFallbackMarket
              ? `ราคาอ้างอิง ~${fmtReversalAutoTradePrice(markPrice)} (${markSource})`
              : useMarket
                ? `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} > ${emaLabel} ~${fmtReversalAutoTradePrice(entryEma!)}`
                : `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} ≤ ${emaLabel} ~${fmtReversalAutoTradePrice(entryEma!)}`,
          `MEXC: ${msg}`,
        ]);
        continue;
      }

      const orderData = om.data;
      const limitOrderId =
        orderData && typeof orderData === "object" && orderData !== null && "orderId" in orderData
          ? String((orderData as { orderId: unknown }).orderId)
          : undefined;

      state = withRecordedReversalPlaced(state, userId, contractSymbol, dayKey);
      usersSucceeded += 1;

      const ema20_1hPct =
        input.ema20_1hSlopePct7d != null && Number.isFinite(input.ema20_1hSlopePct7d)
          ? input.ema20_1hSlopePct7d
          : null;

      logReversalAutoOpen(
        userId,
        logSignal,
        "success",
        useMarket ? "open_success_market" : "open_success_limit",
        mexcSide,
        {
          marginUsdt,
          leverage: lev,
          ...leverageLogExtra,
          orderKind: useMarket ? "market" : "limit",
          entryMode,
          entryEmaPeriod: emaPeriod,
          entryEma15m: entryEma ?? undefined,
          markPrice,
          entryPrice: intendedEntry,
          ema20_1hSlopePct7d: ema20_1hPct ?? undefined,
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

      const plan = resolveReversalTpSlPlanFromRow(row, mexcSide);
      const placedAtMs = Date.now();

      if (!useMarket && limitOrderId && !openMexcLong) {
        state = withReversalPendingLimitAdded(
          state,
          userId,
          {
            contractSymbol,
            binanceSymbol,
            orderId: limitOrderId,
            placedAtMs,
            expireAtMs: placedAtMs + REVERSAL_LIMIT_EXPIRE_MS,
            limitPrice: entryEma!,
            leverage: lev,
            referenceEntryPrice: markPrice,
            tp1PricePct: plan.tp1PricePct,
            tp1PartialPct: plan.tp1PartialPct,
            tp2PricePct: plan.tp2PricePct,
            maxHoldHours: plan.maxHoldHours,
            slArmRoiPct: plan.slArmRoiPct,
            slEntryOffsetPct: plan.slEntryOffsetPct,
            slAtEntryAfter24hIfGreenEnabled: plan.slAtEntryAfter24hIfGreenEnabled,
            ema20_1hSlopePct7d: ema20_1hPct ?? undefined,
          },
          dayKey,
        );
      }

      let mexcAvgEntry: number | null = null;
      let posAfterOpen: OpenPositionRow | undefined;
      let trackedTpSl = false;
      let exchangeTpLines: string[] = [];
      let exchangeTpWarnings: string[] = [];
      let tpPlanOrderIds: {
        tp1PlanOrderId?: string;
        tp2PlanOrderId?: string;
        initialHoldVol?: number;
        tp1PlanVol?: number;
      } = {};
      if (useMarket && plan.enabled) {
        try {
          const posAfter = await getOpenPositions(creds, contractSymbol);
          posAfterOpen = openMexcLong
            ? findMexcOpenPositionLong(posAfter, contractSymbol)
            : findMexcOpenPositionShort(posAfter, contractSymbol);
          mexcAvgEntry = openMexcLong
            ? readMexcAvgEntryPriceLong(posAfter, contractSymbol)
            : readMexcAvgEntryPriceShort(posAfter, contractSymbol);
        } catch (e) {
          console.error("[reversalAutoTrade] getOpenPositions after open", contractSymbol, userId, e);
        }
        const entryForTrack =
          typeof mexcAvgEntry === "number" && mexcAvgEntry > 0 ? mexcAvgEntry : markPrice;
        if (entryForTrack > 0 && posAfterOpen && mexcAvgEntry != null && mexcAvgEntry > 0) {
          try {
            const placed = await placeTpPlanOrdersAfterOpen(creds, {
              contractSymbol,
              position: posAfterOpen,
              entry: mexcAvgEntry,
              side: mexcSide,
              tp1PricePct: plan.tp1PricePct,
              tp1PartialPct: plan.tp1PartialPct,
              tp2PricePct: plan.tp2PricePct,
            });
            if (placed) {
              exchangeTpLines = placed.notifyLines;
              exchangeTpWarnings = placed.warnings;
              if (placed.tp1PlanOrderId) tpPlanOrderIds.tp1PlanOrderId = placed.tp1PlanOrderId;
              if (placed.tp2PlanOrderId) tpPlanOrderIds.tp2PlanOrderId = placed.tp2PlanOrderId;
              tpPlanOrderIds.initialHoldVol = placed.initialHoldVol;
              tpPlanOrderIds.tp1PlanVol = placed.tp1Vol;
            }
          } catch (e) {
            console.error("[reversalAutoTrade] placeTpPlanOrdersAfterOpen", contractSymbol, userId, e);
            exchangeTpWarnings.push(
              `วาง plan TP ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
            );
          }
        }
        if (entryForTrack > 0) {
          state = withReversalActiveOpen(
            state,
            userId,
            {
              contractSymbol,
              binanceSymbol,
              side: mexcSide,
              openedAtMs: placedAtMs,
              referenceEntryPrice: markPrice,
              mexcAvgEntryPrice: entryForTrack,
              leverage: lev,
              tp1PricePct: plan.tp1PricePct,
              tp1PartialPct: plan.tp1PartialPct,
              tp2PricePct: plan.tp2PricePct,
              maxHoldHours: plan.maxHoldHours,
              slArmRoiPct: plan.slArmRoiPct,
              slEntryOffsetPct: plan.slEntryOffsetPct,
              slAtEntryAfter24hIfGreenEnabled: plan.slAtEntryAfter24hIfGreenEnabled,
              ema20_1hSlopePct7d: ema20_1hPct ?? undefined,
              ...tpPlanOrderIds,
            },
            dayKey,
          );
          trackedTpSl = typeof mexcAvgEntry === "number" && mexcAvgEntry > 0;
        }
      }

      const tpSlLines: string[] = [];
      if (plan.enabled) {
        if (useMarket) {
          if (trackedTpSl && mexcAvgEntry != null) {
            tpSlLines.push(
              `ราคาเข้าเฉลี่ย MEXC: ${fmtReversalAutoTradePrice(mexcAvgEntry)} USDT — ใช้คำนวณ % drop จริง`,
              `TP1: +${plan.tp1PricePct}% ปิด ${plan.tp1PartialPct}% · TP2: +${plan.tp2PricePct}% ปิดที่เหลือ · หลัง TP1 → SL บังทุน`,
              ...exchangeTpLines,
              ...(exchangeTpWarnings.length ? exchangeTpWarnings.map((w) => `⚠️ ${w}`) : []),
              `กลยุทธ์เวลา: ${reversalTpStrategySummary({ close12hEnabled: plan.tp12hCloseEnabled })}`,
              `ครบ ${plan.maxHoldHours} ชม. → ปิดทั้งหมด (force)`,
            );
          } else {
            tpSlLines.push(
              "⚠️ ดึงราคาเข้าเฉลี่ย MEXC ไม่สำเร็จ — กลยุทธ์ TP/SL จะไม่ทำงานในรอบนี้ (ตั้งเองได้)",
            );
          }
        } else {
          tpSlLines.push(
            `กลยุทธ์ TP/SL: รอ Limit fill ก่อนเริ่ม track · ${reversalTpStrategySummary({ close12hEnabled: plan.tp12hCloseEnabled })}`,
            `หมดอายุ Limit: ~${fmtExpireBkk(placedAtMs + REVERSAL_LIMIT_EXPIRE_MS)} (8 ชม.) — ไม่ fill จะยกเลิกและปลดล็อกวัน`,
          );
        }
      }

      await notifyLines(userId, [
        userTgTitle,
        openMexcLong
          ? "✅ เปิด Market LONG (ทิศแนะนำ 🟢 · Market ตลอด)"
          : entryMode === "market"
            ? "✅ เปิด Market SHORT (โหมด Market ตลอด)"
            : emaFallbackMarket
              ? `✅ เปิด Market SHORT (ไม่มี ${emaLabel} → Market โดยตรง)`
              : useMarket
                ? `✅ เปิด Market SHORT (ราคาเหนือ ${emaLabel})`
                : `✅ ตั้ง Limit SHORT รอรีเทสต์ที่ ${emaLabel}`,
        `[${shortContractLabel(contractSymbol)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${lev}x`,
        ...(leverageDynamicNote ? [leverageDynamicNote] : []),
        `สัญญาณ Reversal: ${input.model} · TF ${input.signalBarTf.toUpperCase()}`,
        openMexcLong
          ? "ทิศที่เล่น: Long — fade สัญญาณ Short · Long candidate ✓"
          : saturdayAllSignals
            ? "เกณฑ์: วันเสาร์ (เวลาไทย) — auto-open ทุกสัญญาณ Reversal"
            : `Quality Signal ✓ · Wick ${wickPct.toFixed(1)}%${greenDays != null ? ` · เขียว ${greenDays}d` : ""}${rangeScore != null ? ` · Range ${rangeScore.toFixed(2)}` : ""}${ema20_1hPct != null ? ` · EMA20∠1h ${ema20_1hPct.toFixed(1)}%` : ""}${lenRank != null ? ` · Len# ${lenRank}` : ""} · Body ${bodyPct.toFixed(1)}%`,
        openMexcLong || entryMode === "market"
          ? `ราคาอ้างอิง ~${fmtReversalAutoTradePrice(markPrice)} (${markSource})`
          : emaFallbackMarket
            ? `ราคาอ้างอิง ~${fmtReversalAutoTradePrice(markPrice)} (${markSource})`
            : useMarket
              ? `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} > ${emaLabel} ~${fmtReversalAutoTradePrice(entryEma!)}`
              : `Limit ~${fmtReversalAutoTradePrice(entryEma!)} (${emaLabel}) · ราคาปัจจุบัน ~${fmtReversalAutoTradePrice(markPrice)}`,
        ...tpSlLines,
        useMarket
          ? "1 order/เหรียญ/วัน (BKK) — จะไม่สั่งซ้ำในเหรียญนี้วันนี้"
          : "1 order/เหรียญ/วัน (BKK) — ถ้า Limit หมดอายุจะปลดล็อกให้เปิดซ้ำได้",
      ]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      logReversalAutoOpen(
        userId,
        logSignal,
        "failed",
        "network_error",
        mexcSide,
        {
          reasonDetail: detail.slice(0, 400),
          marginUsdt,
          leverage: lev,
          ...leverageLogExtra,
          orderKind: useMarket ? "market" : "limit",
          entryMode,
          entryEmaPeriod: emaPeriod,
          entryEma15m: entryEma ?? undefined,
          markPrice,
          entryPrice: intendedEntry,
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        userTgTitle,
        `❌ สั่งเปิดล้มเหลวจากข้อผิดพลาดระหว่างเรียก MEXC / เครือข่าย (ตั้งใจให้เป็น ${mexcSide.toUpperCase()})`,
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
