import {
  createOpenLimitOrder,
  createOpenMarketOrder,
  getContractTickerPublic,
  getOpenPositions,
  type MexcCredentials,
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
} from "./reversalAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";
import type { CandleReversalModel, CandleReversalTf } from "./candleReversalDetect";

/** ค่าเริ่มต้นเปิด — ตั้ง REVERSAL_AUTOTRADE_ENABLED=0/false/off/no เพื่อปิดเซิร์ฟทั้งหมด */
export function isReversalAutotradeEnabled(): boolean {
  const v = process.env.REVERSAL_AUTOTRADE_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/** เกณฑ์ body/wick ขั้นต่ำสำหรับ Reversal auto-open (ทศนิยม 0–1) */
const REVERSAL_AUTOTRADE_BODY_OR_WICK_MIN_RATIO = 0.8;

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
};

export type ReversalAutoTradeRunResult = {
  usersAttempted: number;
  usersSucceeded: number;
};

/**
 * Auto-open SHORT บน MEXC หลัง Reversal alert สำเร็จ
 * - เปิดเฉพาะ user ที่ตั้ง `reversalAutoTradeEnabled` + มี MEXC creds
 * - gate: body หรือ upper wick > 80% (>= REVERSAL_AUTOTRADE_BODY_OR_WICK_MIN_RATIO)
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
  if (
    !(bodyRatio > REVERSAL_AUTOTRADE_BODY_OR_WICK_MIN_RATIO) &&
    !(wickRatio > REVERSAL_AUTOTRADE_BODY_OR_WICK_MIN_RATIO)
  ) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }

  const contractSymbol = binanceUsdtPerpToMexcContract(binanceSymbol);
  if (!contractSymbol) return { usersAttempted: 0, usersSucceeded: 0 };

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
    if (!row.reversalAutoTradeEnabled) continue;

    if (hasPlacedReversalContractToday(state[userId], contractSymbol, dayKey)) continue;

    const creds: MexcCredentials | null =
      row.mexcApiKey?.trim() && row.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;
    if (!creds) continue;

    const marginUsdt = row.reversalAutoTradeMarginUsdt ?? NaN;
    const leverage = row.reversalAutoTradeLeverage ?? NaN;
    if (!(typeof marginUsdt === "number" && Number.isFinite(marginUsdt) && marginUsdt > 0)) continue;
    if (!(typeof leverage === "number" && Number.isFinite(leverage) && leverage >= 1)) continue;

    let positions: Awaited<ReturnType<typeof getOpenPositions>>;
    try {
      positions = await getOpenPositions(creds, contractSymbol);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[reversalAutoTrade] open_positions fail", contractSymbol, userId, e);
      await notifyLines(userId, [
        "Koji — Reversal auto-open (MEXC)",
        "❌ เช็คโพซิชันจาก MEXC ไม่สำเร็จ — จึงไม่สั่งเปิด (ป้องกันซ้ำ)",
        `[${shortContractLabel(contractSymbol)}]/USDT (SHORT)`,
        `รายละเอียด: ${detail.slice(0, 320)}`,
      ]);
      continue;
    }
    if (hasActiveUsdtPosition(positions, contractSymbol)) {
      await notifyLines(userId, [
        "Koji — Reversal auto-open (MEXC)",
        "ℹ️ ไม่สั่งเปิด — MEXC มีโพซิชันคู่สัญญานี้อยู่แล้ว",
        `[${shortContractLabel(contractSymbol)}]/USDT (SHORT)`,
        "ระบบจึงไม่เปิดซ้ำ (กันซ้อน margin / order ซ้ำ)",
      ]);
      continue;
    }

    const emaRes = await ensureEma15m();
    if ("error" in emaRes) {
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

      const bodyPct = bodyRatio * 100;
      const wickPct = wickRatio * 100;

      await notifyLines(userId, [
        "Koji — Reversal auto-open (MEXC)",
        aboveEma
          ? "✅ เปิด Market SHORT (ราคาเหนือ EMA50 15m)"
          : "✅ ตั้ง Limit SHORT รอรีเทสต์ที่ EMA50 15m",
        `[${shortContractLabel(contractSymbol)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${lev}x`,
        `สัญญาณ Reversal: ${input.model} · TF ${input.signalBarTf.toUpperCase()}`,
        `Body ${bodyPct.toFixed(1)}% · Upper wick ${wickPct.toFixed(1)}%`,
        aboveEma
          ? `ราคาตลาด ~${fmtReversalAutoTradePrice(markPrice)} > EMA50 15m ~${fmtReversalAutoTradePrice(ema50)}`
          : `Limit ~${fmtReversalAutoTradePrice(ema50)} (EMA50 15m) · ราคาปัจจุบัน ~${fmtReversalAutoTradePrice(markPrice)}`,
        "1 order/เหรียญ/วัน (BKK) — จะไม่สั่งซ้ำในเหรียญนี้วันนี้",
      ]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
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
