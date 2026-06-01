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
import { placeTpPlanOrdersAfterOpen } from "./autoTradeTpSlPlanOrders";
import { resolveSnowballTpSlPlanFromRow } from "./snowballAutoTradeTpSlPlan";
import {
  bkkIsSundayNow,
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
import {
  SNOWBALL_QUALITY_SHORT_SIGNAL_CRITERIA,
  SNOWBALL_QUALITY_SIGNAL_CRITERIA,
  snowballMatchesQualityShortSignal,
  snowballMatchesQualitySignal,
} from "@/lib/snowballMatrixFilters";

function snowballQualitySignalLongEnabled(row: TradingViewMexcUserSettings): boolean {
  return (
    row.snowballAutoTradeQualitySignalLongEnabled === true ||
    row.snowballAutoTradeQualitySignalGateEnabled === true
  );
}

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

function snowballAutoOpenMatchesQualityShortSignal(input: {
  greenDaysBeforeSignal?: number | null;
  barRangePctSignal?: number | null;
  signalBarTf: "15m" | "1h" | "4h";
  vol: number;
  volSma: number;
  signalVolVsSma?: number | null;
  confirmVolVsSma?: number | null;
}): boolean {
  const signalVolVsSma =
    input.signalVolVsSma != null && Number.isFinite(input.signalVolVsSma) && input.signalVolVsSma > 0
      ? input.signalVolVsSma
      : input.volSma > 0 && Number.isFinite(input.volSma)
        ? input.vol / input.volSma
        : null;
  return snowballMatchesQualityShortSignal({
    greenDaysBeforeSignal: input.greenDaysBeforeSignal ?? null,
    barRangePctSignal: input.barRangePctSignal ?? null,
    signalBarTf: input.signalBarTf,
    signalVolVsSma,
    confirmVolVsSma: input.confirmVolVsSma ?? null,
  });
}

function resolveSnowballAutoOpenSide(
  row: TradingViewMexcUserSettings,
  alertSide: SnowballAutoTradeAlertSide,
  input: {
    greenDaysBeforeSignal?: number | null;
    fundingRate?: number | null;
    barRangePctSignal?: number | null;
    signalBarTf: "15m" | "1h" | "4h";
    vol: number;
    volSma: number;
    signalVolVsSma?: number | null;
    confirmVolVsSma?: number | null;
  },
): SnowballAutoTradeSide | null {
  const defaultSide: SnowballAutoTradeSide = alertSide === "bear" ? "short" : "long";
  const qsOn = snowballQualitySignalLongEnabled(row);
  const qssOn = row.snowballAutoTradeQualityShortSignalShortEnabled === true;
  const qsMatch = snowballMatchesQualitySignal({
    greenDaysBeforeSignal: input.greenDaysBeforeSignal ?? null,
    fundingRate: input.fundingRate ?? null,
  });
  const qssMatch = snowballAutoOpenMatchesQualityShortSignal(input);

  /** Quality Signal / Quality Short ชนะ Sunday และ default */
  if (qsOn && qsMatch) {
    return "long";
  }
  if (qssOn && qssMatch) {
    return "short";
  }
  if (row.snowballAutoTradeSundayAllShortEnabled === true && bkkIsSundayNow()) {
    return "short";
  }
  if (qsOn || qssOn) {
    return null;
  }
  return defaultSide;
}

function hasActiveUsdtPosition(
  positions: Awaited<ReturnType<typeof getOpenPositions>>,
  contractSymbol: string,
): boolean {
  const sym = contractSymbol.trim();
  return positions.some((p) => p.symbol === sym && p.state === 1 && Number(p.holdVol) > 0);
}

/** ราคาเข้าเฉลี่ยจาก MEXC — ใช้คำนวณ Quick TP ให้ใกล้ UI จริง (ไม่ใช่แค่ close Binance) */
function findMexcOpenPosition(
  positions: OpenPositionRow[],
  contractSymbol: string,
  side: SnowballAutoTradeSide,
): OpenPositionRow | undefined {
  const sym = contractSymbol.trim();
  const wantType = side === "long" ? 1 : 2;
  return positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === wantType,
  );
}

function readMexcAvgEntryPrice(
  positions: OpenPositionRow[],
  contractSymbol: string,
  side: SnowballAutoTradeSide,
): number | null {
  const p = findMexcOpenPosition(positions, contractSymbol, side);
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
  /** Quality Signal / Quality Short Signal */
  greenDaysBeforeSignal?: number | null;
  fundingRate?: number | null;
  barRangePctSignal?: number | null;
  signalVolVsSma?: number | null;
  confirmVolVsSma?: number | null;
}): Promise<{ usersAttempted: number; usersSucceeded: number }> {
  if (!isSnowballAutotradeEnabled()) return { usersAttempted: 0, usersSucceeded: 0 };

  const qualitySignalMatch = snowballMatchesQualitySignal({
    greenDaysBeforeSignal: input.greenDaysBeforeSignal ?? null,
    fundingRate: input.fundingRate ?? null,
  });
  const qualityShortMatch = snowballAutoOpenMatchesQualityShortSignal({
    greenDaysBeforeSignal: input.greenDaysBeforeSignal ?? null,
    barRangePctSignal: input.barRangePctSignal ?? null,
    signalBarTf: input.signalBarTf,
    vol: input.vol,
    volSma: input.volSma,
    signalVolVsSma: input.signalVolVsSma ?? null,
    confirmVolVsSma: input.confirmVolVsSma ?? null,
  });
  const forceMatrixOpen = qualitySignalMatch || qualityShortMatch;

  if (input.actionPlan === "monitor" && !forceMatrixOpen) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }

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
  const qualityShortInput = {
    greenDaysBeforeSignal: input.greenDaysBeforeSignal,
    barRangePctSignal: input.barRangePctSignal,
    signalBarTf: input.signalBarTf,
    vol: input.vol,
    volSma: input.volSma,
    signalVolVsSma: input.signalVolVsSma,
    confirmVolVsSma: input.confirmVolVsSma,
  };
  const qualitySideInput = {
    ...qualityShortInput,
    fundingRate: input.fundingRate,
  };

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

    const side = resolveSnowballAutoOpenSide(row, input.alertSide, qualitySideInput);
    if (side === null) {
      logSnowballAutoOpen(userId, logSignal, "skipped", "quality_filter_no_match");
      continue;
    }

    const defaultSide: SnowballAutoTradeSide = input.alertSide === "bear" ? "short" : "long";
    const sundayShortOverride =
      row.snowballAutoTradeSundayAllShortEnabled === true &&
      bkkIsSundayNow() &&
      side === "short" &&
      defaultSide === "long";
    const qualityShortOverride =
      !sundayShortOverride &&
      row.snowballAutoTradeQualityShortSignalShortEnabled === true &&
      side === "short" &&
      defaultSide === "long";
    const qualitySignalLongOverride =
      !sundayShortOverride &&
      !qualityShortOverride &&
      snowballQualitySignalLongEnabled(row) &&
      side === "long" &&
      defaultSide !== "long";

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
      let posAfterOpen: OpenPositionRow | undefined;
      try {
        const posAfter = await getOpenPositions(creds, sym);
        posAfterOpen = findMexcOpenPosition(posAfter, sym, side);
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

      let exchangeTpLines: string[] = [];
      let exchangeTpWarnings: string[] = [];
      let tpSlPlanForState: {
        enabled: boolean;
        tp1PricePct: number;
        tp1PartialPct: number;
        tp2PricePct: number;
        maxHoldHours: number;
        tp1PlanOrderId?: string;
        tp2PlanOrderId?: string;
        initialHoldVol?: number;
        tp1PlanVol?: number;
      } | null = null;

      if (trackedTpSl) {
        tpSlPlanForState = {
          enabled: true,
          tp1PricePct: tpPlan.tp1PricePct,
          tp1PartialPct: tpPlan.tp1PartialPct,
          tp2PricePct: tpPlan.tp2PricePct,
          maxHoldHours: tpPlan.maxHoldHours,
        };
        if (posAfterOpen) {
          try {
            const placed = await placeTpPlanOrdersAfterOpen(creds, {
              contractSymbol: sym,
              position: posAfterOpen,
              entry: mexcAvgEntry!,
              side,
              tp1PricePct: tpPlan.tp1PricePct,
              tp1PartialPct: tpPlan.tp1PartialPct,
              tp2PricePct: tpPlan.tp2PricePct,
            });
            if (placed) {
              exchangeTpLines = placed.notifyLines;
              exchangeTpWarnings = placed.warnings;
              if (placed.tp1PlanOrderId) tpSlPlanForState.tp1PlanOrderId = placed.tp1PlanOrderId;
              if (placed.tp2PlanOrderId) tpSlPlanForState.tp2PlanOrderId = placed.tp2PlanOrderId;
              tpSlPlanForState.initialHoldVol = placed.initialHoldVol;
              tpSlPlanForState.tp1PlanVol = placed.tp1Vol;
            }
          } catch (e) {
            console.error("[snowballAutoTrade] placeTpPlanOrdersAfterOpen", sym, userId, e);
            exchangeTpWarnings.push(
              `วาง plan TP ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200),
            );
          }
        }
      }

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
          tpSlPlan: tpSlPlanForState,
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
        sundayShortOverride
          ? "✅ เปิด SHORT จาก Snowball (วันอาทิตย์ — สัญญาณ LONG)"
          : qualityShortOverride
            ? "✅ เปิด SHORT จาก Snowball (✨ Quality Short Signal)"
            : qualitySignalLongOverride
              ? "✅ เปิด LONG จาก Snowball (✨ Quality Signal)"
              : long
                ? "✅ เปิด LONG จาก Snowball"
                : "✅ เปิด SHORT จาก Snowball",
        `[${shortContractLabel(sym)}]/USDT`,
        sundayShortOverride
          ? "เกณฑ์: วันอาทิตย์ (เวลาไทย) — Short ทุกสัญญาณ Snowball"
          : qualityShortOverride
            ? `เกณฑ์: ${SNOWBALL_QUALITY_SHORT_SIGNAL_CRITERIA}`
            : qualitySignalLongOverride
              ? `เกณฑ์: ${SNOWBALL_QUALITY_SIGNAL_CRITERIA}`
              : "",
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
                exchangeTpLines.length
                  ? "Plan TP บน MEXC (วางทันทีหลังเปิด):"
                  : "Plan TP: ใช้ tick ปิด market (วาง plan ไม่สำเร็จหรือยังไม่วาง)",
                ...exchangeTpLines,
                ...exchangeTpWarnings.map((w) => `⚠️ ${w}`),
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
