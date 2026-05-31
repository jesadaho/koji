import {
  createOpenMarketOrder,
  getOpenPositions,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import {
  loadTradingViewMexcSettingsFullMap,
  type TradingViewMexcUserSettings,
} from "./tradingViewCloseSettingsStore";
import type { SnowballActionPlan, SnowballDisplayGrade } from "./snowballLongGradeMatrix";
import {
  snowballAutoTradeGradeKeyFromAlert,
  type SnowballAutoTradeAlertGradeInput,
} from "./snowballAutoTradeGradeRules";
import type { SnowballAutoTradeAlertSide } from "./tradingViewCloseSettingsStore";
import { resolveSnowballTpSlPlanFromRow } from "./snowballAutoTradeTpSlPlan";
import {
  bkkSnowballAutoTradeDayKeyNow,
  hasOpenedSnowballContractToday,
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withRecordedSnowballSuccessfulOpen,
  type SnowballAutoTradeSide,
} from "./snowballAutoTradeStateStore";
import { computeSvpHoleYn } from "./snowballStatsStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";
import { appendAutoOpenOrderLogSafe } from "./autoOpenOrderLogStore";
import type { AutoOpenOutcome } from "@/lib/autoOpenOrderLogClient";

/**
 * ค่าเริ่มต้นเปิด — ผู้ใช้เปิด/ปิดหลักใน Mini App (`snowballAutoTradeEnabled`)
 * ตั้ง `SNOWBALL_AUTOTRADE_ENABLED=0` / `false` / `off` / `no` เพื่อปิดฉุกเฉินทั้งเซิร์ฟ
 */
export function isSnowballAutotradeEnabled(): boolean {
  const v = process.env.SNOWBALL_AUTOTRADE_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/** Grade LONG จากสัญญาณ Snowball (สอดคล้อง publicIndicatorFeed) */
export type SnowballLongAlertGrade = "a_plus" | "b_plus" | "c_plus" | "d_plus" | "f_plus";

/** @deprecated ใช้ snowballAutoTradeGradeKeyFromAlert + user rules */
export function isSnowballLongGradeBelowB(grade: SnowballLongAlertGrade | undefined): boolean {
  return grade === "c_plus" || grade === "d_plus";
}

/** @deprecated ใช้ user grade rules แทน */
export function snowballAutotradeSideForLongGrade(
  _grade: SnowballLongAlertGrade | undefined,
  _doubleBarrierOn: boolean,
): SnowballAutoTradeSide | null {
  return null;
}

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function fmtSnowballPriceUsdt(p: number): string {
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
  contractSymbol: string,
): boolean {
  const sym = contractSymbol.trim();
  return positions.some((p) => p.symbol === sym && p.state === 1 && Number(p.holdVol) > 0);
}

/** ราคาเข้าเฉลี่ยจาก MEXC — ใช้คำนวณ Quick TP ให้ใกล้ UI จริง (ไม่ใช่แค่ close Binance) */
function readMexcAvgEntryPrice(
  positions: OpenPositionRow[],
  contractSymbol: string,
  side: SnowballAutoTradeSide,
): number | null {
  const sym = contractSymbol.trim();
  const wantType = side === "long" ? 1 : 2;
  const p = positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === wantType,
  );
  if (!p) return null;
  const o = Number(p.openAvgPrice);
  if (Number.isFinite(o) && o > 0) return o;
  const h = Number(p.holdAvgPrice);
  if (Number.isFinite(h) && h > 0) return h;
  return null;
}

type SnowballAutoOpenLogSignal = {
  contractSymbol: string;
  binanceSymbol: string;
  alertSide: SnowballAutoTradeAlertSide;
  gradeKey: ReturnType<typeof snowballAutoTradeGradeKeyFromAlert>;
  signalBarOpenSec: number;
  signalBarTf: "15m" | "1h" | "4h";
  marginScale: number;
  referenceEntryPrice: number;
};

function logSnowballAutoOpen(
  userId: string,
  signal: SnowballAutoOpenLogSignal,
  outcome: AutoOpenOutcome,
  reasonCode: string,
  extra?: {
    reasonDetail?: string;
    side?: SnowballAutoTradeSide;
    marginUsdt?: number;
    leverage?: number;
  },
): void {
  // ข้าม (ปิด auto-open / monitor / มีโพซิชันแล้ว ฯลฯ) — ไม่ลงประวัติ auto-open
  if (outcome === "skipped") return;

  const shouldLogEntry =
    (outcome === "success" || outcome === "failed") &&
    extra?.side != null &&
    signal.referenceEntryPrice > 0;

  appendAutoOpenOrderLogSafe({
    userId,
    source: "snowball",
    outcome,
    reasonCode,
    contractSymbol: signal.contractSymbol,
    binanceSymbol: signal.binanceSymbol,
    alertSide: signal.alertSide,
    gradeKey: signal.gradeKey,
    signalBarOpenSec: signal.signalBarOpenSec,
    signalBarTf: signal.signalBarTf,
    marginScale: signal.marginScale,
    ...extra,
    side: extra?.side,
    ...(shouldLogEntry ? { entryPrice: signal.referenceEntryPrice } : {}),
  });
}

export async function runSnowballAutoTradeAfterSnowballAlert(input: {
  contractSymbol: string;
  binanceSymbol: string;
  alertSide: SnowballAutoTradeAlertSide;
  displayGrade?: SnowballDisplayGrade | null;
  qualityTier?: SnowballAutoTradeAlertGradeInput["qualityTier"];
  momentumFailGradeF?: boolean | null;
  momentumDowngrade?: boolean | null;
  /** จุดเข้าซื้อที่บอทแนะนำ (จาก Snowball signal) */
  referenceEntryPrice: number;
  signalBarOpenSec: number;
  signalBarTf: "15m" | "1h" | "4h";
  signalBarLow: number | null;
  vol: number;
  volSma: number;
  /** สัดส่วน margin (เช่น 0.5 สำหรับ action plan Light) */
  marginScale?: number;
  /** จาก matrix 4h — monitor = ไม่ auto-open */
  actionPlan?: SnowballActionPlan | null;
}): Promise<{ usersAttempted: number; usersSucceeded: number }> {
  if (!isSnowballAutotradeEnabled()) return { usersAttempted: 0, usersSucceeded: 0 };
  if (input.actionPlan === "monitor") return { usersAttempted: 0, usersSucceeded: 0 };

  const sym = input.contractSymbol.trim();
  if (!sym) return { usersAttempted: 0, usersSucceeded: 0 };
  const binanceSymbol = input.binanceSymbol.trim().toUpperCase();
  if (!binanceSymbol) return { usersAttempted: 0, usersSucceeded: 0 };
  if (!(input.referenceEntryPrice > 0) || !Number.isFinite(input.referenceEntryPrice)) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }
  if (!(typeof input.signalBarOpenSec === "number" && Number.isFinite(input.signalBarOpenSec))) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }

  const gradeInput: SnowballAutoTradeAlertGradeInput = {
    displayGrade: input.displayGrade,
    qualityTier: input.qualityTier,
    momentumFailGradeF: input.momentumFailGradeF,
    momentumDowngrade: input.momentumDowngrade,
  };
  const gradeKey = snowballAutoTradeGradeKeyFromAlert(gradeInput);
  const tradeSide: SnowballAutoTradeSide = input.alertSide === "bear" ? "short" : "long";

  const [map, state0] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadSnowballAutoTradeState(),
  ]);

  let state = state0;
  const dayKey = bkkSnowballAutoTradeDayKeyNow();

  let usersAttempted = 0;
  let usersSucceeded = 0;

  const marginScale =
    typeof input.marginScale === "number" && Number.isFinite(input.marginScale) && input.marginScale > 0
      ? Math.min(1, input.marginScale)
      : 1;
  const referenceEntryPrice = input.referenceEntryPrice;
  const logSignal: SnowballAutoOpenLogSignal = {
    contractSymbol: sym,
    binanceSymbol,
    alertSide: input.alertSide,
    gradeKey,
    signalBarOpenSec: input.signalBarOpenSec,
    signalBarTf: input.signalBarTf,
    marginScale,
    referenceEntryPrice,
  };

  for (const [userId, rowRaw] of Object.entries(map)) {
    if (!/^tg:\d+$/.test(userId.trim())) continue;
    const row = rowRaw as TradingViewMexcUserSettings;
    if (!row.snowballAutoTradeEnabled) {
      logSnowballAutoOpen(userId, logSignal, "skipped", "user_disabled");
      continue;
    }

    const side = tradeSide;

    if (hasOpenedSnowballContractToday(state[userId], sym, dayKey)) {
      logSnowballAutoOpen(userId, logSignal, "skipped", "already_opened_today", { side });
      continue;
    }

    const creds: MexcCredentials | null =
      row.mexcApiKey?.trim() && row.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;
    if (!creds) {
      logSnowballAutoOpen(userId, logSignal, "skipped", "no_mexc_creds", { side });
      continue;
    }

    const marginBase = row.snowballAutoTradeMarginUsdt ?? NaN;
    const marginUsdt = marginBase * marginScale;
    const leverage = row.snowballAutoTradeLeverage ?? NaN;
    if (!(typeof marginUsdt === "number" && Number.isFinite(marginUsdt) && marginUsdt > 0)) {
      logSnowballAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage", { side });
      continue;
    }
    if (!(typeof leverage === "number" && Number.isFinite(leverage) && leverage >= 1)) {
      logSnowballAutoOpen(userId, logSignal, "skipped", "invalid_margin_or_leverage", {
        side,
        marginUsdt,
      });
      continue;
    }

    let positions: Awaited<ReturnType<typeof getOpenPositions>>;
    try {
      positions = await getOpenPositions(creds, sym);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[snowballAutoTrade] open_positions fail", sym, userId, e);
      logSnowballAutoOpen(userId, logSignal, "failed", "position_check_failed", {
        side,
        reasonDetail: detail.slice(0, 400),
        marginUsdt,
        leverage: Math.floor(leverage),
      });
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        "❌ เช็คโพซิชันจาก MEXC ไม่สำเร็จ — จึงไม่สั่งเปิด (ป้องกันซ้ำ)",
        `[${shortContractLabel(sym)}]/USDT (${side.toUpperCase()})`,
        `รายละเอียด: ${detail.slice(0, 320)}`,
      ]);
      continue;
    }
    if (hasActiveUsdtPosition(positions, sym)) {
      const active = positions.find((p) => p.symbol === sym && p.state === 1 && Number(p.holdVol) > 0);
      const sideOpen = active?.positionType === 2 ? "SHORT" : "LONG";
      const hv = active != null ? Number(active.holdVol) : NaN;
      const volLine =
        Number.isFinite(hv) && hv > 0 ? `โพซิชันที่เปิดอยู่: ${sideOpen} · holdVol ~${hv}` : "โพซิชันที่เปิดอยู่: มี (รายละเอียดจาก MEXC ไม่ครบ)";
      logSnowballAutoOpen(userId, logSignal, "skipped", "existing_position", {
        side,
        marginUsdt,
        leverage: Math.floor(leverage),
      });
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        "ℹ️ ไม่สั่งเปิด — MEXC มีโพซิชันคู่สัญญานี้อยู่แล้ว",
        `[${shortContractLabel(sym)}]/USDT`,
        `สัญญาณ Snowball ล่าสุด: ${side.toUpperCase()}${gradeKey ? ` · Grade ${gradeKey}` : ""}`,
        volLine,
        "ระบบจึงไม่เปิดซ้ำ (กันซ้อน margin / order ซ้ำ)",
      ]);
      continue;
    }

    usersAttempted += 1;

    const long = side === "long";

    try {
      const om = await createOpenMarketOrder(creds, {
        contractSymbol: sym,
        long,
        marginUsdt,
        leverage: Math.floor(leverage),
        openType: 1,
      });
      if (!om.success) {
        const msg = om.message ?? `code ${om.code}`;
        logSnowballAutoOpen(userId, logSignal, "failed", "mexc_order_rejected", {
          side,
          reasonDetail: msg.slice(0, 400),
          marginUsdt,
          leverage: Math.floor(leverage),
        });
        await notifyLines(userId, [
          "Koji — Snowball auto-open (MEXC)",
          `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น ${long ? "LONG" : "SHORT"})`,
          `[${shortContractLabel(sym)}]/USDT`,
          `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
          `MEXC: ${msg}`,
        ]);
        continue;
      }

      let mexcAvgEntry: number | null = null;
      try {
        const posAfter = await getOpenPositions(creds, sym);
        mexcAvgEntry = readMexcAvgEntryPrice(posAfter, sym, side);
      } catch (e) {
        console.error("[snowballAutoTrade] getOpenPositions after open", sym, userId, e);
      }

      const tpPlan = resolveSnowballTpSlPlanFromRow(row);
      const trackedTpSl =
        tpPlan.enabled &&
        mexcAvgEntry != null &&
        Number.isFinite(mexcAvgEntry) &&
        mexcAvgEntry > 0;

      state = withRecordedSnowballSuccessfulOpen(
        state,
        userId,
        {
          contractSymbol: sym,
          binanceSymbol,
          side,
          openedAtMs: Date.now(),
          referenceEntryPrice,
          mexcAvgEntryPrice: mexcAvgEntry,
          signalBarOpenSec: input.signalBarOpenSec,
          signalBarTf: input.signalBarTf,
          signalBarLow: input.signalBarLow,
          svpHoleYn: computeSvpHoleYn(input.vol, input.volSma),
          leverage: Math.floor(leverage),
          tpSlPlan: trackedTpSl
            ? {
                enabled: true,
                tp1PricePct: tpPlan.tp1PricePct,
                tp1PartialPct: tpPlan.tp1PartialPct,
                tp2PricePct: tpPlan.tp2PricePct,
                maxHoldHours: tpPlan.maxHoldHours,
              }
            : null,
        },
        dayKey,
      );
      usersSucceeded += 1;

      logSnowballAutoOpen(userId, logSignal, "success", "open_success_market", {
        side,
        marginUsdt,
        leverage: Math.floor(leverage),
      });

      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        long ? "✅ เปิด LONG จาก Snowball" : "✅ เปิด SHORT จาก Snowball",
        `[${shortContractLabel(sym)}]/USDT`,
        gradeKey ? `Grade ${gradeKey}` : "",
        `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
        `จุดเข้าอ้างอิง (บอท / Binance): ${fmtSnowballPriceUsdt(referenceEntryPrice)} USDT`,
        mexcAvgEntry != null && Number.isFinite(mexcAvgEntry) && mexcAvgEntry > 0
          ? `ราคาเข้าเฉลี่ย MEXC: ${fmtSnowballPriceUsdt(mexcAvgEntry)} USDT — ใช้คำนวณ TP/SL`
          : "ราคาเข้าเฉลี่ย MEXC: ยังดึงไม่ได้",
        ...(tpPlan.enabled
          ? trackedTpSl
            ? [
                `กลยุทธ์ TP/SL: TP1 ${tpPlan.tp1PricePct}% ปิด ${tpPlan.tp1PartialPct}% · TP2 ${tpPlan.tp2PricePct}% ปิดทั้งหมด`,
                `ครบ ${tpPlan.maxHoldHours} ชม.: ปิดทั้งหมด (force) · SL บังทุนหลัง TP1`,
              ]
            : ["⚠️ กลยุทธ์ TP/SL เปิดอยู่แต่ดึงราคาเข้า MEXC ไม่ได้ — จะไม่ track TP/SL รอบนี้"]
          : ["กลยุทธ์ TP/SL: ปิด (ตั้งใน Mini App)"]),
        "กติกา 24h: ถ้าครบ 24 ชม. แล้วยังติดลบและไม่เข้าเกณฑ์รันเทรน ระบบจะพยายามปิด market",
        "ครั้งถัดไปในวันนี้: จะไม่เปิดจาก Snowball ซ้ำในเหรียญนี้ (1 order/เหรียญ/วัน)",
      ]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      logSnowballAutoOpen(userId, logSignal, "failed", "network_error", {
        side,
        reasonDetail: detail.slice(0, 400),
        marginUsdt,
        leverage: Math.floor(leverage),
      });
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        `❌ สั่งเปิดล้มเหลวจากข้อผิดพลาดระหว่างเรียก MEXC / เครือข่าย (ตั้งใจเป็น ${long ? "LONG" : "SHORT"})`,
        `[${shortContractLabel(sym)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
        `รายละเอียด: ${detail.slice(0, 400)}`,
      ]);
    }
  }

  try {
    await saveSnowballAutoTradeState(state);
  } catch (e) {
    console.error("[snowballAutoTrade] save state failed", e);
  }

  return { usersAttempted, usersSucceeded };
}
