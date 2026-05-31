import {
  createOpenLimitOrder,
  createOpenMarketOrder,
  getContractTickerPublic,
  getOpenPositions,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { fetchBinanceUsdmKlines } from "./binanceIndicatorKline";
import { emaLine } from "./indicatorMath";
import { resolveContractSymbol } from "./coinMap";
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
import type { CandleReversalModel, CandleReversalTf } from "./candleReversalDetect";
import { appendAutoOpenOrderLogSafe } from "./autoOpenOrderLogStore";
import type { AutoOpenOutcome } from "@/lib/autoOpenOrderLogClient";
import { reversalMatchesQualitySignal } from "@/lib/reversalMatrixFilters";

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

/** gate เปิดออเดอร์ — Quality Signal (เขียว ≥1 · Wick ≤0.20 · Range <4.5) */
export function reversalAutotradePassesEntryGate(input: {
  wickRatio: number;
  greenDaysBeforeSignal?: number | null;
  rangeScore?: number | null;
  allowQualitySignal?: boolean;
}): boolean {
  if (input.allowQualitySignal === false) return false;
  return reversalMatchesQualitySignal({
    wickRatio: input.wickRatio,
    greenDaysBeforeSignal: input.greenDaysBeforeSignal,
    rangeScore: input.rangeScore,
  });
}

/** จำนวนแท่ง 15m ที่ดึงเพื่อคำนวณ EMA50 (ต้องพอครอบ warmup) */
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
  const sym = binanceSymbol.trim().toUpperCase();
  if (!sym.endsWith("USDT") || sym.length < 5) return null;
  const base = sym.slice(0, -4);
  const resolved = resolveContractSymbol(base);
  return resolved?.contractSymbol ?? `${base}_USDT`;
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

function readMexcAvgEntryPriceShort(
  positions: OpenPositionRow[],
  contractSymbol: string
): number | null {
  const sym = contractSymbol.trim();
  const p = positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === 2
  );
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
  return { enabled: en, tp1PricePct: t1, tp1PartialPct: Math.min(100, t1p), tp2PricePct: t2, maxHoldHours: mh };
}

export type ReversalAutoTradeInput = {
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
  /** แท่ง Day1 เขียวติดก่อนแท่งสัญญาณ */
  greenDaysBeforeSignal?: number | null;
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
  signalBarTf: CandleReversalTf;
  model: CandleReversalModel;
  signalBarOpenSec: number;
  bodyRatio: number;
  wickRatio: number;
  rangeRankInLookback?: number | null;
};

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
    ema50_15m?: number;
    markPrice?: number;
  } | undefined,
  signalClosePrice: number | undefined,
): number | undefined {
  if (outcome !== "success" && outcome !== "failed") return undefined;
  if (typeof extra?.entryPrice === "number" && extra.entryPrice > 0) return extra.entryPrice;
  if (extra?.orderKind === "limit" && typeof extra.ema50_15m === "number" && extra.ema50_15m > 0) {
    return extra.ema50_15m;
  }
  if (typeof extra?.markPrice === "number" && extra.markPrice > 0) return extra.markPrice;
  if (typeof extra?.ema50_15m === "number" && extra.ema50_15m > 0) return extra.ema50_15m;
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
    ema50_15m?: number;
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
 * - เปิดเฉพาะ user ที่ตั้ง `reversalAutoTradeEnabled` + มี MEXC creds
 * - gate Quality Signal: เขียว ≥ 1 วัน · Wick ≤ 0.20 · Range < 4.5
 * - entry แบบ hybrid ตาม EMA50 บน TF 15m:
 *   - ราคาตลาด > EMA50 → Market SHORT ทันที
 *   - ราคาตลาด <= EMA50 → Limit SHORT ที่ราคา EMA50 (ดักรีเทสต์)
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
  const gateSignalBase: ReversalAutoOpenLogSignal | null = contractSymbolEarly
    ? {
        contractSymbol: contractSymbolEarly,
        binanceSymbol,
        signalBarTf: input.signalBarTf,
        model: input.model,
        signalBarOpenSec: input.signalBarOpenSec,
        bodyRatio,
        wickRatio,
        rangeRankInLookback: input.rangeRankInLookback,
      }
    : null;

  const contractSymbol = contractSymbolEarly;
  if (!contractSymbol) return { usersAttempted: 0, usersSucceeded: 0 };

  const logSignal: ReversalAutoOpenLogSignal = gateSignalBase ?? {
    contractSymbol,
    binanceSymbol,
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
  let ema50_15m: number | null | undefined;
  let lastMarketPrice: number | null | undefined;

  async function ensureEma15m(): Promise<{ ema: number; mark: number } | { error: string }> {
    if (ema50_15m === null) return { error: "ไม่สามารถคำนวณ EMA50 15m ได้ (kline ไม่พอ)" };
    if (lastMarketPrice === null) return { error: "ดึงราคาตลาดล่าสุดจาก MEXC ไม่สำเร็จ" };

    if (ema50_15m === undefined) {
      try {
        const pack = await fetchBinanceUsdmKlines(
          binanceSymbol,
          "15m",
          REVERSAL_AUTOTRADE_15M_FETCH_BARS
        );
        if (!pack || pack.close.length < 52) {
          ema50_15m = null;
          return { error: "ไม่สามารถคำนวณ EMA50 15m ได้ (kline ไม่พอ)" };
        }
        const ema = emaLine(pack.close, 50);
        const i = pack.close.length - 2;
        const v = ema[i];
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
          ema50_15m = null;
          return { error: "ไม่สามารถคำนวณ EMA50 15m ได้ (ค่า EMA ไม่ถูกต้อง)" };
        }
        ema50_15m = v;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        ema50_15m = null;
        return { error: `ดึง 15m kline ล้มเหลว: ${detail}` };
      }
    }

    if (lastMarketPrice === undefined) {
      try {
        const t = await getContractTickerPublic(contractSymbol!);
        if (!t || !(t.lastPrice > 0)) {
          lastMarketPrice = null;
          return { error: "ดึงราคาตลาดล่าสุดจาก MEXC ไม่สำเร็จ" };
        }
        lastMarketPrice = t.lastPrice;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        lastMarketPrice = null;
        return { error: `ดึงราคาตลาดล่าสุดจาก MEXC ล้มเหลว: ${detail}` };
      }
    }

    return { ema: ema50_15m as number, mark: lastMarketPrice as number };
  }

  for (const [userId, rowRaw] of Object.entries(map)) {
    if (!/^tg:\d+$/.test(userId.trim())) continue;
    const row = rowRaw as TradingViewMexcUserSettings;
    if (!row.reversalAutoTradeEnabled) {
      logReversalAutoOpen(userId, logSignal, "skipped", "user_disabled");
      continue;
    }

    const allowQuality =
      row.reversalAutoTradeGateQualitySignal !== undefined
        ? row.reversalAutoTradeGateQualitySignal !== false
        : row.reversalAutoTradeGateBodyWick80 !== false || row.reversalAutoTradeGateLenRank315 !== false;
    if (
      !reversalAutotradePassesEntryGate({
        wickRatio,
        greenDaysBeforeSignal: input.greenDaysBeforeSignal,
        rangeScore: input.rangeScore,
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

    const emaRes = await ensureEma15m();
    const emaLogExtra =
      "error" in emaRes
        ? {}
        : {
            ema50_15m: emaRes.ema,
            markPrice: emaRes.mark,
            orderKind: (emaRes.mark > emaRes.ema ? "market" : "limit") as "market" | "limit",
          };

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
        "Koji — Reversal auto-open (MEXC)",
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
        "Koji — Reversal auto-open (MEXC)",
        "ℹ️ ไม่สั่งเปิด — MEXC มีโพซิชันคู่สัญญานี้อยู่แล้ว",
        `[${shortContractLabel(contractSymbol)}]/USDT (SHORT)`,
        "ระบบจึงไม่เปิดซ้ำ (กันซ้อน margin / order ซ้ำ)",
      ]);
      continue;
    }

    if ("error" in emaRes) {
      logReversalAutoOpen(
        userId,
        logSignal,
        "failed",
        "ema_or_price_unavailable",
        {
          reasonDetail: emaRes.error.slice(0, 400),
          marginUsdt,
          leverage: Math.floor(leverage),
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        "Koji — Reversal auto-open (MEXC)",
        "❌ สั่งเปิดไม่สำเร็จ",
        `[${shortContractLabel(contractSymbol)}]/USDT (SHORT)`,
        emaRes.error,
      ]);
      continue;
    }
    const { ema: ema50, mark: markPrice } = emaRes;

    usersAttempted += 1;

    const aboveEma = markPrice > ema50;
    const intendedEntry = reversalIntendedEntry(aboveEma, markPrice, ema50);
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
            limitPrice: ema50,
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
            ema50_15m: ema50,
            markPrice,
            entryPrice: intendedEntry,
          },
          signalClosePrice,
        );
        await notifyLines(userId, [
          "Koji — Reversal auto-open (MEXC)",
          `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น SHORT${aboveEma ? " · Market (เหนือ EMA50 15m)" : " · Limit retest EMA50 15m"})`,
          `[${shortContractLabel(contractSymbol)}]/USDT`,
          `Margin ~${marginUsdt} USDT · ${lev}x`,
          aboveEma
            ? `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} > EMA50 15m ~${fmtReversalAutoTradePrice(ema50)}`
            : `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} ≤ EMA50 15m ~${fmtReversalAutoTradePrice(ema50)}`,
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
          ema50_15m: ema50,
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
      const lenRankGate =
        lenRank != null &&
        lenRank >= REVERSAL_AUTOTRADE_LEN_RANK_MIN &&
        lenRank <= REVERSAL_AUTOTRADE_LEN_RANK_MAX;

      const plan = resolveReversalTpSlPlanFromRow(row);

      let mexcAvgEntry: number | null = null;
      let trackedTpSl = false;
      if (aboveEma && plan.enabled) {
        try {
          const posAfter = await getOpenPositions(creds, contractSymbol);
          mexcAvgEntry = readMexcAvgEntryPriceShort(posAfter, contractSymbol);
        } catch (e) {
          console.error("[reversalAutoTrade] getOpenPositions after open", contractSymbol, userId, e);
        }
        if (typeof mexcAvgEntry === "number" && mexcAvgEntry > 0) {
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
        "Koji — Reversal auto-open (MEXC)",
        aboveEma
          ? "✅ เปิด Market SHORT (ราคาเหนือ EMA50 15m)"
          : "✅ ตั้ง Limit SHORT รอรีเทสต์ที่ EMA50 15m",
        `[${shortContractLabel(contractSymbol)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${lev}x`,
        `สัญญาณ Reversal: ${input.model} · TF ${input.signalBarTf.toUpperCase()}`,
        `Body ${bodyPct.toFixed(1)}% · Upper wick ${wickPct.toFixed(1)}%${lenRank != null ? ` · Len# ${lenRank}` : ""}${lenRankGate ? " (เกณฑ์ Len 3–15)" : ""}`,
        aboveEma
          ? `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} > EMA50 15m ~${fmtReversalAutoTradePrice(ema50)}`
          : `Limit ~${fmtReversalAutoTradePrice(ema50)} (EMA50 15m) · ราคาปัจจุบัน ~${fmtReversalAutoTradePrice(markPrice)}`,
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
          ema50_15m: ema50,
          markPrice,
          entryPrice: intendedEntry,
        },
        signalClosePrice,
      );
      await notifyLines(userId, [
        "Koji — Reversal auto-open (MEXC)",
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
