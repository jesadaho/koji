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
  withReversalPendingLimitAdded,
} from "./reversalAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";
import type { CandleReversalModel, CandleReversalTf, CandleReversalTradeSide } from "./candleReversalDetect";
import { appendAutoOpenOrderLogSafe } from "./autoOpenOrderLogStore";
import { shouldSkipAutoOpenForPendingConflict } from "./signalPendingConflictServer";
import type { AutoOpenOutcome } from "@/lib/autoOpenOrderLogClient";
import { REVERSAL_TP_STRATEGY_SUMMARY } from "@/lib/reversalTpStrategy";
import { reversalMatchesQualitySignalForAlert } from "@/lib/reversalMatrixFilters";
import {
  resolveReversalLongTradeLeverage,
  reversalLongDynamicLeverageNote,
} from "@/lib/reversalLongDynamicLeverage";
import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  parseSlArmRoiPct,
  parseSlEntryOffsetPct,
  slAtEntryAfter24hIfGreenEnabledFromSetting,
} from "@/lib/tpSlBreakevenPlan";
import { bkkIsSaturdayNow } from "./snowballAutoTradeStateStore";
import {
  REVERSAL_LIMIT_EXPIRE_MS,
  reversalEma15mLabel,
  reversalEntrySettingsFromRow,
  reversalEntryUseMarket,
  type ReversalAutoTradeEntryMode,
} from "@/lib/reversalAutoTradeEntry";

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
  btcEma1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  atrPct14d?: number | null;
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
    btcEma1dSlopePct7d: input.btcEma1dSlopePct7d,
    btcEma4hSlopePct7d: input.btcEma4hSlopePct7d,
    atrPct14d: input.atrPct14d,
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

export function resolveReversalTpSlPlanFromRow(row: TradingViewMexcUserSettings): {
  enabled: boolean;
  tp1PricePct: number;
  tp1PartialPct: number;
  tp2PricePct: number;
  maxHoldHours: number;
  holdExtendIfRedEnabled: boolean;
  slArmRoiPct: number;
  slEntryOffsetPct: number;
  slAtEntryAfter24hIfGreenEnabled: boolean;
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
    holdExtendIfRedEnabled: row.reversalAutoTradeHoldExtendIfRedEnabled === true,
    slArmRoiPct: parseSlArmRoiPct(row.reversalAutoTradeSlArmRoiPct, DEFAULT_SL_ARM_ROI_PCT),
    slEntryOffsetPct: parseSlEntryOffsetPct(
      row.reversalAutoTradeSlEntryOffsetPct,
      DEFAULT_SL_ENTRY_OFFSET_PCT,
    ),
    slAtEntryAfter24hIfGreenEnabled: slAtEntryAfter24hIfGreenEnabledFromSetting(
      row.reversalAutoTradeSlAtEntryAfter24hIfGreenEnabled,
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
  /** BTC EMA(12) 1d slope 7 วัน % — Long 1H fade SHORT Quality Signal */
  btcEma1dSlopePct7d?: number | null;
  /** BTC EMA(12) 4h slope 7 วัน % — Long 1H fade SHORT Quality Signal */
  btcEma4hSlopePct7d?: number | null;
  /** Wilder ATR(14) 1d ÷ close × 100 — Long 1H fade SHORT Quality Signal */
  atrPct14d?: number | null;
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
    entryMode?: ReversalAutoTradeEntryMode;
    entryEmaPeriod?: number;
    entryEma15m?: number;
    ema25_15m?: number;
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
 * - gate Quality Signal: Short — ดู REVERSAL_QUALITY_SIGNAL_CRITERIA · Long 1H — ดู REVERSAL_QUALITY_SIGNAL_LONG_1H_CRITERIA
 * - entry ตั้งค่าต่อ user: Hybrid (EMA period บน 15m, default 20) หรือ Market ตลอด
 *   - Hybrid: ราคา > EMA → Market SHORT · ราคา ≤ EMA → Limit ที่ EMA (หมดอายุ 8 ชม.)
 * - TP ใช้ cron tick ปิด market (ไม่วาง plan TP บน MEXC)
 * - 1 order/เหรียญ/วัน (BKK) — ปลดล็อกเมื่อ Limit หมดอายุโดยไม่ fill
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

  const contractSymbol = await resolveMexcContractFromBinanceSymbolAsync(binanceSymbol);
  if (!contractSymbol) {
    console.error("[reversalAutoTrade] no MEXC contract for", binanceSymbol);
    return { usersAttempted: 0, usersSucceeded: 0 };
  }
  const sym = contractSymbol;

  try {
    if (await shouldSkipAutoOpenForPendingConflict(binanceSymbol, "reversal", { atMs: Date.now() })) {
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
    const entryPick = reversalEntryUseMarket({
      mode,
      mark: markRes.mark,
      entryEma,
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
        btcEma1dSlopePct7d: input.btcEma1dSlopePct7d,
        btcEma4hSlopePct7d: input.btcEma4hSlopePct7d,
        atrPct14d: input.atrPct14d,
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
    const baseLeverage = row.reversalAutoTradeLeverage ?? NaN;
    if (!(typeof marginUsdt === "number" && Number.isFinite(marginUsdt) && marginUsdt > 0)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage");
      continue;
    }
    if (!(typeof baseLeverage === "number" && Number.isFinite(baseLeverage) && baseLeverage >= 1)) {
      logReversalAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage", {
        marginUsdt,
      });
      continue;
    }

    const baseLev = Math.floor(baseLeverage);
    const leveragePick = resolveReversalLongTradeLeverage({
      alertTradeSide,
      baseLeverage: baseLev,
      dynamicLeverageEnabled: row.reversalAutoTradeLongDynamicLeverageEnabled === true,
      atrPct14d: input.atrPct14d,
    });
    const leverage = leveragePick.leverage;
    const leverageDynamicNote = reversalLongDynamicLeverageNote(leveragePick, baseLev);
    const leverageLogExtra = {
      leverageBase: baseLev,
      ...(leveragePick.dynamicApplied
        ? {
            dynamicLeverageApplied: true,
            dynamicLeverageTier: leveragePick.tier ?? undefined,
            atrPct14d: leveragePick.atrPct14d ?? undefined,
          }
        : {}),
    };

    const entryRes = await resolveReversalEntryForUser(row);
    const emaLogExtra = entryRes.ok
      ? {
          entryMode: entryRes.mode,
          entryEmaPeriod: entryRes.emaPeriod,
          entryEma15m: entryRes.entryEma ?? undefined,
          markPrice: entryRes.mark,
          orderKind: (entryRes.useMarket ? "market" : "limit") as "market" | "limit",
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
          ...leverageLogExtra,
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
        ...leverageLogExtra,
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
          ...leverageLogExtra,
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
          tgTitle,
          entryMode === "market"
            ? "❌ สั่งเปิดไม่สำเร็จ (Market SHORT · โหมด Market ตลอด)"
            : emaFallbackMarket
              ? `❌ สั่งเปิดไม่สำเร็จ (Market SHORT · ไม่มี ${emaLabel})`
              : `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น SHORT${useMarket ? ` · Market (เหนือ ${emaLabel})` : ` · Limit retest ${emaLabel}`})`,
          `[${shortContractLabel(contractSymbol)}]/USDT`,
          `Margin ~${marginUsdt} USDT · ${lev}x`,
          entryMode === "market"
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

      logReversalAutoOpen(
        userId,
        logSignal,
        "success",
        useMarket ? "open_success_market" : "open_success_limit",
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
      const placedAtMs = Date.now();

      if (!useMarket && limitOrderId) {
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
            ema4hSlopePct7d: ema4hPct ?? undefined,
          },
          dayKey,
        );
      }

      let mexcAvgEntry: number | null = null;
      let trackedTpSl = false;
      if (useMarket && plan.enabled) {
        try {
          const posAfter = await getOpenPositions(creds, contractSymbol);
          mexcAvgEntry = readMexcAvgEntryPriceShort(posAfter, contractSymbol);
        } catch (e) {
          console.error("[reversalAutoTrade] getOpenPositions after open", contractSymbol, userId, e);
        }
        const entryForTrack =
          typeof mexcAvgEntry === "number" && mexcAvgEntry > 0 ? mexcAvgEntry : markPrice;
        if (entryForTrack > 0) {
          state = withReversalActiveOpen(
            state,
            userId,
            {
              contractSymbol,
              binanceSymbol,
              side: "short",
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
              ema4hSlopePct7d: ema4hPct ?? undefined,
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
              `กลยุทธ์: ${REVERSAL_TP_STRATEGY_SUMMARY}`,
              `ครบ ${plan.maxHoldHours} ชม. → ปิดทั้งหมด (force)`,
            );
          } else {
            tpSlLines.push(
              "⚠️ ดึงราคาเข้าเฉลี่ย MEXC ไม่สำเร็จ — กลยุทธ์ TP/SL จะไม่ทำงานในรอบนี้ (ตั้งเองได้)",
            );
          }
        } else {
          tpSlLines.push(
            `กลยุทธ์ TP/SL: รอ Limit fill ก่อนเริ่ม track · ${REVERSAL_TP_STRATEGY_SUMMARY}`,
            `หมดอายุ Limit: ~${fmtExpireBkk(placedAtMs + REVERSAL_LIMIT_EXPIRE_MS)} (8 ชม.) — ไม่ fill จะยกเลิกและปลดล็อกวัน`,
          );
        }
      }

      await notifyLines(userId, [
        tgTitle,
        entryMode === "market"
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
        saturdayAllSignals
          ? "เกณฑ์: วันเสาร์ (เวลาไทย) — auto-open ทุกสัญญาณ Reversal"
          : `Quality Signal ✓ · Wick ${wickPct.toFixed(1)}%${greenDays != null ? ` · เขียว ${greenDays}d` : ""}${rangeScore != null ? ` · Range ${rangeScore.toFixed(2)}` : ""}${ema4hPct != null ? ` · EMA4h ${ema4hPct.toFixed(1)}%` : ""}${lenRank != null ? ` · Len# ${lenRank}` : ""} · Body ${bodyPct.toFixed(1)}%`,
        entryMode === "market"
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
