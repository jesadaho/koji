import { placeTpPlanOrdersAfterOpen } from "./autoTradeTpSlPlanOrders";
import {
  cancelOpenOrders,
  getOpenOrders,
  getOpenPositions,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  bkkSnowballAutoTradeDayKeyNow,
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withRecordedSnowballSuccessfulOpen,
  withSnowballOpenedUnlocked,
  withSnowballPendingLimitRemoved,
  type SnowballAutoTradePendingLimit,
  type SnowballAutoTradeSide,
} from "./snowballAutoTradeStateStore";
import { patchAutoOpenOrderLogLimitFillSafe } from "./autoOpenOrderLogStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
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

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

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

function orderStillOpen(openOrders: { orderId: string }[], orderId: string): boolean {
  return openOrders.some((x) => x.orderId === orderId.trim());
}

async function promotePendingToActive(args: {
  userId: string;
  creds: MexcCredentials;
  pending: SnowballAutoTradePendingLimit;
  mexcAvgEntry: number;
  pos: OpenPositionRow;
  dayKey: string;
  state: Awaited<ReturnType<typeof loadSnowballAutoTradeState>>;
}): Promise<Awaited<ReturnType<typeof loadSnowballAutoTradeState>>> {
  const { userId, creds, pending, mexcAvgEntry, pos, dayKey } = args;
  let tpSlPlanForState: {
    enabled: boolean;
    tp1PricePct: number;
    tp1PartialPct: number;
    tp2PricePct: number;
    maxHoldHours: number;
    slArmRoiPct: number;
    slEntryOffsetPct: number;
    tp1PlanOrderId?: string;
    tp2PlanOrderId?: string;
    initialHoldVol?: number;
    tp1PlanVol?: number;
  } | null = null;

  if (pending.tpSlEnabled) {
    tpSlPlanForState = {
      enabled: true,
      tp1PricePct: pending.tp1PricePct,
      tp1PartialPct: pending.tp1PartialPct,
      tp2PricePct: pending.tp2PricePct,
      maxHoldHours: pending.maxHoldHours,
      slArmRoiPct: pending.slArmRoiPct,
      slEntryOffsetPct: pending.slEntryOffsetPct,
    };
    try {
      const placed = await placeTpPlanOrdersAfterOpen(creds, {
        contractSymbol: pending.contractSymbol,
        position: pos,
        entry: mexcAvgEntry,
        side: pending.side,
        tp1PricePct: pending.tp1PricePct,
        tp1PartialPct: pending.tp1PartialPct,
        tp2PricePct: pending.tp2PricePct,
      });
      if (placed) {
        if (placed.tp1PlanOrderId) tpSlPlanForState.tp1PlanOrderId = placed.tp1PlanOrderId;
        if (placed.tp2PlanOrderId) tpSlPlanForState.tp2PlanOrderId = placed.tp2PlanOrderId;
        tpSlPlanForState.initialHoldVol = placed.initialHoldVol;
        tpSlPlanForState.tp1PlanVol = placed.tp1Vol;
      }
    } catch (e) {
      console.error("[snowballLimitTick] placeTpPlanOrdersAfterOpen", userId, pending.contractSymbol, e);
    }
  }

  let state = withRecordedSnowballSuccessfulOpen(
    args.state,
    userId,
    {
      contractSymbol: pending.contractSymbol,
      binanceSymbol: pending.binanceSymbol,
      side: pending.side,
      openedAtMs: Date.now(),
      referenceEntryPrice: pending.referenceEntryPrice,
      mexcAvgEntryPrice: mexcAvgEntry,
      signalBarOpenSec: pending.signalBarOpenSec,
      signalBarTf: pending.signalBarTf,
      signalBarLow: pending.signalBarLow,
      svpHoleYn: pending.svpHoleYn,
      leverage: pending.leverage,
      tpSlPlan: tpSlPlanForState,
    },
    dayKey,
  );
  state = withSnowballPendingLimitRemoved(
    state,
    userId,
    pending.contractSymbol,
    pending.side,
    pending.orderId,
    dayKey,
  );

  patchAutoOpenOrderLogLimitFillSafe({
    userId,
    contractSymbol: pending.contractSymbol,
    side: pending.side,
    mexcAvgEntry,
    filledAtMs: Date.now(),
  });

  await notifyLines(userId, [
    "Koji — Snowball auto-open (MEXC)",
    `✅ Limit ${pending.side.toUpperCase()} fill แล้ว → เริ่มติดตาม TP/SL`,
    `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
    `ราคาเข้าเฉลี่ย MEXC: ${fmtPrice(mexcAvgEntry)} USDT`,
    pending.tpSlEnabled
      ? `กลยุทธ์: TP1 ${pending.tp1PricePct}% · TP2 ${pending.tp2PricePct}% · ${pending.maxHoldHours} ชม.`
      : "กลยุทธ์ TP/SL: ปิดใน Settings",
  ]);
  return state;
}

export async function runSnowballAutoTradeLimitTick(nowMs: number): Promise<number> {
  const dayKey = bkkSnowballAutoTradeDayKeyNow();
  const [map, state0] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadSnowballAutoTradeState(),
  ]);
  let state = state0;
  let actionsCount = 0;

  for (const [userId, perUser] of Object.entries(state)) {
    const pendingList = perUser.pendingLimits ?? [];
    if (!pendingList.length) continue;

    const row = map[userId];
    if (!row?.mexcApiKey?.trim() || !row?.mexcSecret?.trim()) continue;
    const creds: MexcCredentials = { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() };

    for (const pending of pendingList) {
      try {
        const positions = await getOpenPositions(creds, pending.contractSymbol);
        const pos = findMexcOpenPosition(positions, pending.contractSymbol, pending.side);
        if (pos) {
          const mexcAvgEntry = readMexcAvgEntryPrice(positions, pending.contractSymbol, pending.side);
          if (mexcAvgEntry != null && mexcAvgEntry > 0) {
            state = await promotePendingToActive({
              userId,
              creds,
              pending,
              mexcAvgEntry,
              pos,
              dayKey,
              state,
            });
            actionsCount += 1;
          }
          continue;
        }

        const expired = nowMs >= pending.expireAtMs;
        let openOrders: Awaited<ReturnType<typeof getOpenOrders>> = [];
        try {
          openOrders = await getOpenOrders(creds, pending.contractSymbol);
        } catch (e) {
          console.error("[snowballLimitTick] getOpenOrders", userId, pending.contractSymbol, e);
        }
        const stillOpen = orderStillOpen(openOrders, pending.orderId);

        if (expired) {
          if (stillOpen) {
            const cancelRes = await cancelOpenOrders(creds, [pending.orderId]);
            if (!cancelRes.success) {
              console.error(
                "[snowballLimitTick] cancelOpenOrders",
                userId,
                pending.orderId,
                cancelRes.message,
              );
            }
          }
          state = withSnowballPendingLimitRemoved(
            state,
            userId,
            pending.contractSymbol,
            pending.side,
            pending.orderId,
            dayKey,
          );
          state = withSnowballOpenedUnlocked(state, userId, pending.contractSymbol, dayKey);
          await notifyLines(userId, [
            "Koji — Snowball auto-open (MEXC)",
            `⏱️ Limit ${pending.side.toUpperCase()} หมดอายุ 8 ชม. — ยกเลิก order บน MEXC แล้ว`,
            `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
            `Limit ~${fmtPrice(pending.limitPrice)} · หมดอายุ ~${fmtExpireBkk(pending.expireAtMs)}`,
            "ปลดล็อก 1 order/วัน — เปิดซ้ำเหรียญนี้วันนี้ได้อีก",
          ]);
          actionsCount += 1;
          continue;
        }

        if (!stillOpen) {
          state = withSnowballPendingLimitRemoved(
            state,
            userId,
            pending.contractSymbol,
            pending.side,
            pending.orderId,
            dayKey,
          );
          state = withSnowballOpenedUnlocked(state, userId, pending.contractSymbol, dayKey);
          await notifyLines(userId, [
            "Koji — Snowball auto-open (MEXC)",
            `ℹ️ Limit ${pending.side.toUpperCase()} ถูกยกเลิก/หายจาก MEXC (ยังไม่ fill)`,
            `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
            `Limit ~${fmtPrice(pending.limitPrice)}`,
            "ปลดล็อก 1 order/วัน — เปิดซ้ำเหรียญนี้วันนี้ได้อีก",
          ]);
          actionsCount += 1;
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[snowballLimitTick] per-pending fail", userId, pending.contractSymbol, e);
        await notifyLines(userId, [
          "Koji — Snowball auto-open (MEXC)",
          "❌ ตรวจ Limit pending ผิดพลาด — ข้ามรอบนี้",
          `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
          `รายละเอียด: ${detail.slice(0, 320)}`,
        ]);
      }
    }
  }

  if (actionsCount > 0) {
    try {
      await saveSnowballAutoTradeState(state);
    } catch (e) {
      console.error("[snowballLimitTick] save state failed", e);
    }
  }

  return actionsCount;
}
