import { type PendingConflictSets } from "@/lib/signalPendingConflict";
import { cancelActiveTpSlPlanOrders } from "./autoTradeTpSlPlanOrders";
import {
  cancelOpenOrders,
  closeAllOpenForSymbol,
  getContractLastPricePublic,
  getOpenOrders,
  type MexcCredentials,
} from "./mexcFuturesClient";
import {
  loadPendingConflictSets,
  shouldConflictCloseDualPendingForSymbol,
} from "./signalPendingConflictServer";
import {
  bkkReversalAutoTradeDayKeyNow,
  loadReversalAutoTradeState,
  saveReversalAutoTradeState,
  withReversalActiveRemoved,
  withReversalPendingLimitRemoved,
  withReversalPlacedUnlocked,
} from "./reversalAutoTradeStateStore";
import {
  bkkSnowballAutoTradeDayKeyNow,
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withSnowballActiveRemoved,
  withSnowballOpenedUnlocked,
  withSnowballPendingLimitRemoved,
} from "./snowballAutoTradeStateStore";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

export function isAutoTradeConflictCloseEnabled(): boolean {
  return false;
}

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

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function orderStillOpen(openOrders: { orderId: string }[], orderId: string): boolean {
  return openOrders.some((x) => x.orderId === orderId.trim());
}

async function cancelPendingLimitOnMexc(
  creds: MexcCredentials,
  contractSymbol: string,
  orderId: string,
): Promise<void> {
  try {
    const openOrders = await getOpenOrders(creds, contractSymbol);
    if (!orderStillOpen(openOrders, orderId)) return;
    const cancelRes = await cancelOpenOrders(creds, [orderId]);
    if (!cancelRes.success) {
      console.error("[conflictClose] cancelOpenOrders", contractSymbol, orderId, cancelRes.message);
    }
  } catch (e) {
    console.error("[conflictClose] cancel pending limit", contractSymbol, orderId, e);
  }
}

async function closeActivePositionOnMexc(
  creds: MexcCredentials,
  active: { contractSymbol: string; slPlanOrderId?: string; tp1PlanOrderId?: string; tp2PlanOrderId?: string },
): Promise<{ success: boolean; message?: string }> {
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  return { success: r.success, message: r.message };
}

async function processReversalUserConflictClose(args: {
  userId: string;
  creds: MexcCredentials;
  reversalDayKey: string;
  sets: PendingConflictSets;
  state: Awaited<ReturnType<typeof loadReversalAutoTradeState>>;
  nowMs: number;
}): Promise<{ state: Awaited<ReturnType<typeof loadReversalAutoTradeState>>; actions: number }> {
  const { userId, creds, reversalDayKey, sets, nowMs } = args;
  let state = args.state;
  let actions = 0;
  const perUser = state[userId];
  if (!perUser) return { state, actions };

  for (const pending of [...(perUser.pendingLimits ?? [])]) {
    if (!(await shouldConflictCloseDualPendingForSymbol(pending.binanceSymbol, sets, nowMs))) continue;
    await cancelPendingLimitOnMexc(creds, pending.contractSymbol, pending.orderId);
    state = withReversalPendingLimitRemoved(
      state,
      userId,
      pending.contractSymbol,
      pending.orderId,
      reversalDayKey,
    );
    state = withReversalPlacedUnlocked(state, userId, pending.contractSymbol, reversalDayKey);
    await notifyLines(userId, [
      "Koji — Reversal auto-open (MEXC)",
      "⚠️ Conflict Snowball + Reversal → ยกเลิก Limit pending",
      `[${shortContractLabel(pending.contractSymbol)}]/USDT (SHORT)`,
      `Limit ~${fmtPrice(pending.limitPrice)} · order #${pending.orderId}`,
      "ปลดล็อก 1 order/วัน — เปิดซ้ำเหรียญนี้วันนี้ได้อีก",
    ]);
    actions += 1;
  }

  for (const active of [...(perUser.active ?? [])]) {
    if (!(await shouldConflictCloseDualPendingForSymbol(active.binanceSymbol, sets, nowMs))) continue;
    const mark = (await getContractLastPricePublic(active.contractSymbol)) ?? NaN;
    const closeRes = await closeActivePositionOnMexc(creds, active);
    state = withReversalActiveRemoved(state, userId, active.contractSymbol, active.side);
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      closeRes.success
        ? "⚠️ Conflict Snowball + Reversal → ปิด position ทันที (market)"
        : "❌ Conflict Snowball + Reversal — ปิด position ไม่สำเร็จ",
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(mark)}`,
      closeRes.message && !closeRes.success ? `MEXC: ${closeRes.message}` : "",
      "ระบบเคลียร์ state แล้ว — ไม่ติดตาม TP/SL ของออเดอร์นี้อีก",
    ]);
    actions += 1;
  }

  return { state, actions };
}

async function processSnowballUserConflictClose(args: {
  userId: string;
  creds: MexcCredentials;
  snowballDayKey: string;
  sets: PendingConflictSets;
  state: Awaited<ReturnType<typeof loadSnowballAutoTradeState>>;
  nowMs: number;
}): Promise<{ state: Awaited<ReturnType<typeof loadSnowballAutoTradeState>>; actions: number }> {
  const { userId, creds, snowballDayKey, sets, nowMs } = args;
  let state = args.state;
  let actions = 0;
  const perUser = state[userId];
  if (!perUser) return { state, actions };

  for (const pending of [...(perUser.pendingLimits ?? [])]) {
    if (!(await shouldConflictCloseDualPendingForSymbol(pending.binanceSymbol, sets, nowMs))) continue;
    await cancelPendingLimitOnMexc(creds, pending.contractSymbol, pending.orderId);
    state = withSnowballPendingLimitRemoved(
      state,
      userId,
      pending.contractSymbol,
      pending.side,
      pending.orderId,
      snowballDayKey,
    );
    state = withSnowballOpenedUnlocked(state, userId, pending.contractSymbol, snowballDayKey);
    await notifyLines(userId, [
      "Koji — Snowball auto-open (MEXC)",
      "⚠️ Conflict Snowball + Reversal → ยกเลิก Limit pending",
      `[${shortContractLabel(pending.contractSymbol)}]/USDT (${pending.side.toUpperCase()})`,
      `Limit ~${fmtPrice(pending.limitPrice)} · order #${pending.orderId}`,
      "ปลดล็อก 1 order/วัน — เปิดซ้ำเหรียญนี้วันนี้ได้อีก",
    ]);
    actions += 1;
  }

  for (const active of [...(perUser.active ?? [])]) {
    if (!(await shouldConflictCloseDualPendingForSymbol(active.binanceSymbol, sets, nowMs))) continue;
    const mark = (await getContractLastPricePublic(active.contractSymbol)) ?? NaN;
    const entry = active.mexcAvgEntryPrice ?? active.referenceEntryPrice;
    const closeRes = await closeActivePositionOnMexc(creds, active);
    state = withSnowballActiveRemoved(state, userId, active.contractSymbol, active.side);
    await notifyLines(userId, [
      "Koji — Snowball TP/SL (MEXC)",
      closeRes.success
        ? "⚠️ Conflict Snowball + Reversal → ปิด position ทันที (market)"
        : "❌ Conflict Snowball + Reversal — ปิด position ไม่สำเร็จ",
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry MEXC: ${fmtPrice(entry)} · Mark: ${fmtPrice(mark)}`,
      closeRes.message && !closeRes.success ? `MEXC: ${closeRes.message}` : "",
      "ระบบเคลียร์ state แล้ว — ไม่ติดตาม TP/SL ของออเดอร์นี้อีก",
    ]);
    actions += 1;
  }

  return { state, actions };
}

/** ปิด position + ยกเลิก limit pending ทั้ง Snowball และ Reversal เมื่อ stats ทั้งสองฝั่ง pending พร้อมกัน */
export async function runAutoTradeConflictCloseTick(nowMs = Date.now()): Promise<number> {
  if (!isAutoTradeConflictCloseEnabled()) return 0;

  const sets = await loadPendingConflictSets(nowMs);
  if (!sets.snowballPending.size || !sets.reversalPending.size) return 0;

  const [map, reversalState0, snowballState0] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadReversalAutoTradeState(),
    loadSnowballAutoTradeState(),
  ]);

  const reversalDayKey = bkkReversalAutoTradeDayKeyNow();
  const snowballDayKey = bkkSnowballAutoTradeDayKeyNow();
  let reversalState = reversalState0;
  let snowballState = snowballState0;
  let actionsCount = 0;

  const userIds = new Set([
    ...Object.keys(reversalState),
    ...Object.keys(snowballState),
  ]);

  for (const userId of userIds) {
    const row = map[userId];
    if (!row?.mexcApiKey?.trim() || !row?.mexcSecret?.trim()) continue;
    const creds: MexcCredentials = { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() };

    try {
      const rev = await processReversalUserConflictClose({
        userId,
        creds,
        reversalDayKey,
        sets,
        state: reversalState,
        nowMs,
      });
      reversalState = rev.state;
      actionsCount += rev.actions;

      const sb = await processSnowballUserConflictClose({
        userId,
        creds,
        snowballDayKey,
        sets,
        state: snowballState,
        nowMs,
      });
      snowballState = sb.state;
      actionsCount += sb.actions;
    } catch (e) {
      console.error("[conflictClose] user fail", userId, e);
    }
  }

  if (actionsCount > 0) {
    try {
      await Promise.all([
        saveReversalAutoTradeState(reversalState),
        saveSnowballAutoTradeState(snowballState),
      ]);
    } catch (e) {
      console.error("[conflictClose] save state failed", e);
    }
  }

  return actionsCount;
}
