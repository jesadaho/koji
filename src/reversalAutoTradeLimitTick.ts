import {
  cancelOpenOrders,
  getOpenOrders,
  getOpenPositions,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  bkkReversalAutoTradeDayKeyNow,
  loadReversalAutoTradeState,
  saveReversalAutoTradeState,
  withReversalActiveOpen,
  withReversalPendingLimitRemoved,
  withReversalPlacedUnlocked,
  type ReversalAutoTradePendingLimit,
} from "./reversalAutoTradeStateStore";
import { REVERSAL_TP_STRATEGY_SUMMARY } from "@/lib/reversalTpStrategy";
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
  contractSymbol: string,
): number | null {
  const p = findMexcOpenPositionShort(positions, contractSymbol);
  if (!p) return null;
  const o = Number(p.openAvgPrice);
  if (Number.isFinite(o) && o > 0) return o;
  const h = Number(p.holdAvgPrice);
  if (Number.isFinite(h) && h > 0) return h;
  return null;
}

function orderStillOpen(openOrders: { orderId: string }[], orderId: string): boolean {
  const oid = orderId.trim();
  return openOrders.some((x) => x.orderId === oid);
}

async function promotePendingToActive(args: {
  userId: string;
  pending: ReversalAutoTradePendingLimit;
  mexcAvgEntry: number;
  dayKey: string;
  state: Awaited<ReturnType<typeof loadReversalAutoTradeState>>;
}): Promise<Awaited<ReturnType<typeof loadReversalAutoTradeState>>> {
  const { userId, pending, mexcAvgEntry, dayKey } = args;
  let state = withReversalActiveOpen(
    args.state,
    userId,
    {
      contractSymbol: pending.contractSymbol,
      binanceSymbol: pending.binanceSymbol,
      side: "short",
      openedAtMs: Date.now(),
      referenceEntryPrice: pending.referenceEntryPrice,
      mexcAvgEntryPrice: mexcAvgEntry,
      leverage: pending.leverage,
      tp1PricePct: pending.tp1PricePct,
      tp1PartialPct: pending.tp1PartialPct,
      tp2PricePct: pending.tp2PricePct,
      maxHoldHours: pending.maxHoldHours,
      slArmRoiPct: pending.slArmRoiPct,
      slEntryOffsetPct: pending.slEntryOffsetPct,
      slAtEntryAfter24hIfGreenEnabled: pending.slAtEntryAfter24hIfGreenEnabled,
      ema4hSlopePct7d: pending.ema4hSlopePct7d,
    },
    dayKey,
  );
  state = withReversalPendingLimitRemoved(state, userId, pending.contractSymbol, pending.orderId, dayKey);
  const filledAtMs = Date.now();
  patchAutoOpenOrderLogLimitFillSafe({
    userId,
    contractSymbol: pending.contractSymbol,
    side: "short",
    mexcAvgEntry,
    filledAtMs,
  });
  await notifyLines(userId, [
    "Koji — Reversal auto-open (MEXC)",
    "✅ Limit SHORT fill แล้ว → เริ่มติดตาม TP/SL (tick)",
    `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
    `ราคาเข้าเฉลี่ย MEXC: ${fmtPrice(mexcAvgEntry)} USDT`,
    `กลยุทธ์: ${REVERSAL_TP_STRATEGY_SUMMARY}`,
  ]);
  return state;
}

export async function runReversalAutoTradeLimitTick(nowMs: number): Promise<number> {
  const dayKey = bkkReversalAutoTradeDayKeyNow();
  const [map, state0] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadReversalAutoTradeState(),
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
        const pos = findMexcOpenPositionShort(positions, pending.contractSymbol);
        if (pos) {
          const mexcAvgEntry = readMexcAvgEntryPriceShort(positions, pending.contractSymbol);
          if (mexcAvgEntry != null && mexcAvgEntry > 0) {
            state = await promotePendingToActive({
              userId,
              pending,
              mexcAvgEntry,
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
          console.error("[reversalLimitTick] getOpenOrders", userId, pending.contractSymbol, e);
        }
        const stillOpen = orderStillOpen(openOrders, pending.orderId);

        if (expired) {
          if (stillOpen) {
            const cancelRes = await cancelOpenOrders(creds, [pending.orderId]);
            if (!cancelRes.success) {
              console.error(
                "[reversalLimitTick] cancelOpenOrders",
                userId,
                pending.orderId,
                cancelRes.message,
              );
            }
          }
          state = withReversalPendingLimitRemoved(
            state,
            userId,
            pending.contractSymbol,
            pending.orderId,
            dayKey,
          );
          state = withReversalPlacedUnlocked(state, userId, pending.contractSymbol, dayKey);
          await notifyLines(userId, [
            "Koji — Reversal auto-open (MEXC)",
            "⏱️ Limit SHORT หมดอายุ 8 ชม. — ยกเลิก order บน MEXC แล้ว",
            `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
            `Limit ~${fmtPrice(pending.limitPrice)} · หมดอายุ ~${fmtExpireBkk(pending.expireAtMs)}`,
            "ปลดล็อก 1 order/วัน — เปิดซ้ำเหรียญนี้วันนี้ได้อีก",
          ]);
          actionsCount += 1;
          continue;
        }

        if (!stillOpen) {
          state = withReversalPendingLimitRemoved(
            state,
            userId,
            pending.contractSymbol,
            pending.orderId,
            dayKey,
          );
          state = withReversalPlacedUnlocked(state, userId, pending.contractSymbol, dayKey);
          await notifyLines(userId, [
            "Koji — Reversal auto-open (MEXC)",
            "ℹ️ Limit SHORT ถูกยกเลิก/หายจาก MEXC (ยังไม่ fill)",
            `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
            `Limit ~${fmtPrice(pending.limitPrice)}`,
            "ปลดล็อก 1 order/วัน — เปิดซ้ำเหรียญนี้วันนี้ได้อีก",
          ]);
          actionsCount += 1;
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[reversalLimitTick] per-pending fail", userId, pending.contractSymbol, e);
        await notifyLines(userId, [
          "Koji — Reversal auto-open (MEXC)",
          "❌ ตรวจ Limit pending ผิดพลาด — ข้ามรอบนี้",
          `[${shortContractLabel(pending.contractSymbol)}]/USDT`,
          `รายละเอียด: ${detail.slice(0, 320)}`,
        ]);
      }
    }
  }

  if (actionsCount > 0) {
    try {
      await saveReversalAutoTradeState(state);
    } catch (e) {
      console.error("[reversalLimitTick] save state failed", e);
    }
  }

  return actionsCount;
}
