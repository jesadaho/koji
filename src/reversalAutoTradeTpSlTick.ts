import {
  formatEma12_1hHoldLine,
  EMA12_1H_HOLD_SLOPE_LABEL,
  resolveAutoTradeHoldCheckpoint,
  resolveAutoTradeHoldExtendIfRed,
  resolveAutoTradeHoldExtendRedHours,
  resolveAutoTradeMaxHoldHours,
} from "@/lib/autoTradeMaxHold";
import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  formatSlBreakevenTriggerLabel,
  parseSlArmRoiPct,
  parseSlEntryOffsetPct,
  resolveSlAtEntryAfter24hIfGreenEnabled,
  slBreakevenDueAfter24hIfGreen,
} from "@/lib/tpSlBreakevenPlan";
import {
  reversalTpStrategyLive12hShouldClose,
  reversalTpStrategyLive24hShouldArmBe,
  reversalTpStrategyResolvedEma20_1hSlope,
} from "@/lib/reversalTpStrategy";
import {
  cancelActiveTpPlanOrders,
  cancelActiveTpSlPlanOrders,
  cancelActiveSlPlanOrder,
  shouldExecuteMarkTp1Fallback,
  tp1PlanLikelyFilled,
} from "./autoTradeTpSlPlanOrders";
import { mexcSlBreakevenTriggerPrice } from "./autoTradeSlBreakeven";
import {
  closeAllOpenForSymbol,
  createPartialCloseOrder,
  fetchContractDetailPublic,
  getContractLastPricePublic,
  getFuturesUserPositionMode,
  getOpenPositions,
  placePlanOrderStopLoss,
  roundVolDown,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { resolveReversalTpSlPlanFromRow } from "./reversalAutoTradeExecutor";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  loadReversalAutoTradeState,
  saveReversalAutoTradeState,
  withReversalActiveRemoved,
  withReversalHoldExtendedForRed,
  withReversalSlAtEntryArmed,
  withReversalTp1Done,
  withReversalTp8hChecked,
  withReversalTp12hChecked,
  withReversalTp24hChecked,
  type ReversalAutoTradeActive,
} from "./reversalAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";
import { fetchEma12_1hHoldSlopePct } from "./statsEmaSlope";

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

function pricePctDrop(side: "short" | "long", entry: number, mark: number): number {
  if (!(entry > 0) || !(mark > 0)) return NaN;
  if (side === "short") return ((entry - mark) / entry) * 100;
  return ((mark - entry) / entry) * 100;
}

function findActivePositionShort(
  positions: OpenPositionRow[],
  contractSymbol: string,
  side: "short" | "long"
): OpenPositionRow | undefined {
  const sym = contractSymbol.trim();
  const wantType = side === "long" ? 1 : 2;
  return positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === wantType
  );
}

type TpSlContext = {
  userId: string;
  creds: MexcCredentials;
  active: ReversalAutoTradeActive;
  position: OpenPositionRow;
  markPrice: number;
  positionMode: 1 | 2;
  entry: number;
};

type SlBreakevenArmReason = "roi" | "24h_green" | "24h_strategy";

async function handlePositionDisappeared(args: {
  userId: string;
  creds: MexcCredentials;
  active: ReversalAutoTradeActive;
}): Promise<void> {
  const { userId, creds, active } = args;
  await cancelActiveTpSlPlanOrders(creds, active);
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    "ℹ️ ตำแหน่งถูกปิดภายนอกระบบ (อาจจาก SL บังทุน หรือปิดมือ)",
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `ราคาเข้าเฉลี่ย MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} USDT`,
    "ระบบเคลียร์ state แล้ว — จะไม่ติดตาม TP/SL ของออเดอร์นี้อีก",
  ]);
}

async function handleMaxHoldForceClose(
  ctx: TpSlContext,
  holdHours: number,
  phase: 1 | 2 = 1,
  ema12_1hSlopePct7d?: number | null,
): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  const emaLine = formatEma12_1hHoldLine(active.side, ema12_1hSlopePct7d);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ ครบ ${holdHours} ชม. แต่ปิดไม่สำเร็จ`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
      emaLine,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  const phaseLabel =
    phase === 2
      ? `⏰ ครบจังหวะ 2 (${holdHours} ชม. รวม) → ปิดทั้งหมด (force)`
      : ema12_1hSlopePct7d !== undefined
        ? `⏰ ครบจังหวะ 1 (${holdHours} ชม.) · ${EMA12_1H_HOLD_SLOPE_LABEL} ผิดฝั่ง → ปิดทั้งหมด (force)`
        : `⏰ ครบจังหวะ 1 (${holdHours} ชม.) → ปิดทั้งหมด (force)`;
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    phaseLabel,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
    Number.isFinite(drop) ? `ราคาเคลื่อน: ${drop >= 0 ? "+" : ""}${drop.toFixed(2)}% จาก entry` : "",
    emaLine,
  ]);
  return { closed: true };
}

const MS_12H = 12 * 3600 * 1000;
const MS_24H = 24 * 3600 * 1000;

async function handleReversal12hStrategyClose(ctx: TpSlContext): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      "❌ ครบ 12 ชม. — กลยุทธ์สั่งปิด แต่ปิดไม่สำเร็จ",
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `⏰ ครบ 12 ชม. — กลยุทธ์ปิดทันที (ติดลบ + EMA20∠1h>0)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
  ]);
  return { closed: true };
}

async function handleTp2Hit(ctx: TpSlContext): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice, entry } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  const move = pricePctDrop(active.side, entry, markPrice);
  const tp2 = active.tp2PricePct ?? 25;
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ TP2 (${tp2}%) hit แต่ปิดไม่สำเร็จ`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move.toFixed(2)}%`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `💰 TP2 hit — ราคาเคลื่อน ${move.toFixed(2)}% (≥ ${tp2}%) → ปิดทั้งหมด`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)}`,
  ]);
  return { closed: true };
}

/** หลัง plan TP1 execute บน MEXC — ตั้ง SL บังทุนที่เหลือ (ไม่ partial close ซ้ำ) */
async function handleTp1BreakevenSlOnly(ctx: TpSlContext): Promise<{ tp1Done: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode, entry } = ctx;
  if (active.slBreakevenArmed || active.slPlanOrderId?.trim()) {
    return { tp1Done: true, slOrderId: active.slPlanOrderId };
  }
  const move = pricePctDrop(active.side, entry, markPrice);
  const tp1 = active.tp1PricePct ?? 10;

  if (!(position.holdVol > 0)) {
    return { tp1Done: true };
  }

  const slOffset = parseSlEntryOffsetPct(active.slEntryOffsetPct, DEFAULT_SL_ENTRY_OFFSET_PCT);
  const trigger = await mexcSlBreakevenTriggerPrice(
    active.contractSymbol,
    active.side,
    entry,
    slOffset,
  );
  const slRes =
    trigger > 0
      ? await placePlanOrderStopLoss(creds, {
          contractSymbol: active.contractSymbol,
          position,
          triggerPrice: trigger,
          positionMode,
        })
      : { success: false as const, code: -1, message: "trigger ไม่ถูกต้อง" };
  const slOrderId =
    slRes.success && slRes.data && typeof slRes.data === "object" && slRes.data && "orderId" in slRes.data
      ? String((slRes.data as { orderId: unknown }).orderId)
      : undefined;

  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `🎯 Plan TP1 execute แล้ว — ราคาเคลื่อน ${move.toFixed(2)}% (≥ ${tp1}%)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · holdVol คงเหลือ: ${position.holdVol}`,
    slRes.success
      ? `🛡️ ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)} (plan order${slOrderId ? ` #${slOrderId}` : ""})`
      : `⚠️ ตั้ง SL บังทุนไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — กรุณาตั้งเองที่ MEXC`,
  ]);

  return { tp1Done: true, slOrderId };
}

async function handleTp1Hit(
  ctx: TpSlContext,
  opts?: { cancelExchangeTpPlans?: boolean },
): Promise<{ tp1Done: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode, entry } = ctx;
  const move = pricePctDrop(active.side, entry, markPrice);
  const tp1 = active.tp1PricePct ?? 10;
  if (opts?.cancelExchangeTpPlans) {
    await cancelActiveTpPlanOrders(creds, active);
  }
  const detail = await fetchContractDetailPublic(active.contractSymbol);
  if (!detail) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ TP1 (${tp1}%) hit แต่ดึง contract detail ไม่ได้ — ข้ามรอบนี้`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move.toFixed(2)}%`,
    ]);
    return { tp1Done: false };
  }
  const partialPct = Math.min(99, Math.max(1, active.tp1PartialPct ?? 50));
  const partialVolRaw = position.holdVol * (partialPct / 100);
  const partialVol = roundVolDown(partialVolRaw, detail);
  if (!(partialVol > 0)) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ TP1 hit แต่คำนวณ partial vol ไม่ได้ (vol น้อยเกิน) — ข้าม`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `holdVol: ${position.holdVol} · partial ${partialPct}% ≈ ${partialVolRaw.toFixed(4)}`,
    ]);
    return { tp1Done: false };
  }

  const partialRes = await createPartialCloseOrder(creds, {
    symbol: active.contractSymbol,
    position,
    vol: partialVol,
    markPrice,
    positionMode,
  });
  if (!partialRes.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ TP1 hit แต่ปิด partial ไม่สำเร็จ — ไม่ตั้ง SL บังทุนรอบนี้`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move.toFixed(2)}%`,
      partialRes.message ? `MEXC: ${partialRes.message}` : `MEXC: code ${partialRes.code}`,
    ]);
    return { tp1Done: false };
  }

  let remaining: OpenPositionRow | undefined;
  try {
    const posAfter = await getOpenPositions(creds, active.contractSymbol);
    remaining = findActivePositionShort(posAfter, active.contractSymbol, active.side);
  } catch (e) {
    console.error("[reversalTpSlTick] getOpenPositions after partial", active.contractSymbol, e);
  }

  if (!remaining || !(remaining.holdVol > 0)) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `🎯 TP1 hit — ปิด ${partialPct}% แล้ว · แต่ตำแหน่งที่เหลือไม่พบ (อาจปิดเสร็จทั้งหมด)`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move.toFixed(2)}%`,
      "ระบบจะเคลียร์ state รอบถัดไป",
    ]);
    return { tp1Done: true };
  }

  let slOrderId = active.slPlanOrderId?.trim();
  let slLine = slOrderId ? `🛡️ SL@entry ตั้งแล้ว (#${slOrderId})` : "";
  if (!slOrderId) {
    const slOffset = parseSlEntryOffsetPct(active.slEntryOffsetPct, DEFAULT_SL_ENTRY_OFFSET_PCT);
    const trigger = await mexcSlBreakevenTriggerPrice(
      active.contractSymbol,
      active.side,
      entry,
      slOffset,
    );
    const slRes =
      trigger > 0
        ? await placePlanOrderStopLoss(creds, {
            contractSymbol: active.contractSymbol,
            position: remaining,
            triggerPrice: trigger,
            positionMode,
          })
        : { success: false as const, code: -1, message: "trigger ไม่ถูกต้อง" };
    slOrderId =
      slRes.success && slRes.data && typeof slRes.data === "object" && slRes.data && "orderId" in slRes.data
        ? String((slRes.data as { orderId: unknown }).orderId)
        : undefined;
    slLine = slRes.success
      ? `🛡️ ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)} (plan order${slOrderId ? ` #${slOrderId}` : ""})`
      : `⚠️ ตั้ง SL บังทุนไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — ตั้งเองที่ MEXC`;
  }

  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `🎯 TP1 hit — ราคาเคลื่อน ${move.toFixed(2)}% (≥ ${tp1}%) → ปิด ${partialPct}% ของ vol`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)}`,
    `Partial vol ปิด: ${partialVol} · holdVol คงเหลือ: ${remaining.holdVol}`,
    slLine,
  ]);

  return { tp1Done: true, slOrderId };
}

async function handleSlAtEntryOnRoi(
  ctx: TpSlContext,
  opts?: { reason?: SlBreakevenArmReason },
): Promise<{ ok: boolean; slOrderId?: string; slBreakevenAttempted?: boolean }> {
  const { userId, creds, active, position, markPrice, positionMode, entry } = ctx;
  if (active.slBreakevenArmed || active.slPlanOrderId?.trim()) {
    return { ok: true, slOrderId: active.slPlanOrderId };
  }
  const reason = opts?.reason ?? "24h_strategy";
  const drop = pricePctDrop(active.side, entry, markPrice);
  const slArm = parseSlArmRoiPct(active.slArmRoiPct, DEFAULT_SL_ARM_ROI_PCT);
  const slOffset =
    reason === "24h_green"
      ? 0
      : parseSlEntryOffsetPct(active.slEntryOffsetPct, DEFAULT_SL_ENTRY_OFFSET_PCT);

  if (!(position.holdVol > 0)) {
    return { ok: false };
  }

  const trigger = await mexcSlBreakevenTriggerPrice(
    active.contractSymbol,
    active.side,
    entry,
    slOffset,
  );
  if (!(trigger > 0)) return { ok: false };

  const slRes = await placePlanOrderStopLoss(creds, {
    contractSymbol: active.contractSymbol,
    position,
    triggerPrice: trigger,
    positionMode,
  });
  const slOrderId =
    slRes.success && slRes.data && typeof slRes.data === "object" && slRes.data && "orderId" in slRes.data
      ? String((slRes.data as { orderId: unknown }).orderId)
      : undefined;

  const headline =
    reason === "24h_green"
      ? `🛡️ ครบ 24 ชม. และยังเขียว — ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)}`
      : reason === "roi"
        ? `🛡️ ROI ≥ ${slArm}% — ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)} (ไม่รอ partial TP1)`
        : `🛡️ ครบ 24 ชม. ROI > 3% + EMA20∠1h<0 — ถือต่อ · ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)}`;

  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    headline,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
    slRes.success
      ? `plan order${slOrderId ? ` #${slOrderId}` : ""}`
      : `⚠️ ไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — ตั้งเองที่ MEXC`,
  ]);

  return { ok: slRes.success, slOrderId, slBreakevenAttempted: true };
}

async function handleReversal8hAboveSignalBarHighClose(
  ctx: TpSlContext,
  signalBarHigh: number,
): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice, entry } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  const move = pricePctDrop(active.side, entry, markPrice);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      "❌ ครบ 8 ชม. — ราคา > ยอดแท่งสัญญาณ แต่ปิดไม่สำเร็จ",
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `ยอดแท่ง: ${fmtPrice(signalBarHigh)} · Mark: ${fmtPrice(markPrice)} · Entry: ${fmtPrice(entry)}`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `⏰ ครบ 8 ชม. — ราคา > ยอดแท่งสัญญาณ (${fmtPrice(signalBarHigh)}) → ปิดทันที`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move >= 0 ? "+" : ""}${Number.isFinite(move) ? move.toFixed(2) : "—"}%`,
  ]);
  return { closed: true };
}

async function handleReversal8hSignalBarHighSl(
  ctx: TpSlContext,
  signalBarHigh: number,
): Promise<{ ok: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode, entry } = ctx;
  if (!(position.holdVol > 0)) return { ok: false };

  if (active.slPlanOrderId?.trim()) {
    await cancelActiveSlPlanOrder(creds, active.slPlanOrderId);
  }

  const slRes = await placePlanOrderStopLoss(creds, {
    contractSymbol: active.contractSymbol,
    position,
    triggerPrice: signalBarHigh,
    positionMode,
  });
  const slOrderId =
    slRes.success && slRes.data && typeof slRes.data === "object" && slRes.data && "orderId" in slRes.data
      ? String((slRes.data as { orderId: unknown }).orderId)
      : undefined;
  const move = pricePctDrop(active.side, entry, markPrice);

  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `⏰ ครบ 8 ชม. — ราคา ≤ ยอดแท่ง → ตั้ง SL ที่ยอดแท่ง ${fmtPrice(signalBarHigh)}`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move >= 0 ? "+" : ""}${Number.isFinite(move) ? move.toFixed(2) : "—"}%`,
    slRes.success
      ? `🛡️ plan SL ยอดแท่ง${slOrderId ? ` #${slOrderId}` : ""}`
      : `⚠️ ตั้ง SL ยอดแท่งไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — ตั้งเองที่ MEXC`,
  ]);

  return { ok: slRes.success, slOrderId };
}

export async function runReversalAutoTradeTpSlTick(nowMs: number): Promise<number> {
  const [map, state0] = await Promise.all([loadTradingViewMexcSettingsFullMap(), loadReversalAutoTradeState()]);
  let state = state0;
  let actionsCount = 0;

  for (const [userId, perUser] of Object.entries(state)) {
    const actives = perUser.active ?? [];
    if (!actives.length) continue;

    const row = map[userId];
    if (!row?.mexcApiKey?.trim() || !row?.mexcSecret?.trim()) continue;
    const creds: MexcCredentials = { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() };

    let positionMode: 1 | 2 = 1;
    try {
      positionMode = await getFuturesUserPositionMode(creds);
    } catch (e) {
      console.error("[reversalTpSlTick] getFuturesUserPositionMode", userId, e);
      continue;
    }

    for (const a of actives) {
      try {
        const tpPlan = resolveReversalTpSlPlanFromRow(row, a.side);
        const phase1H = resolveAutoTradeMaxHoldHours({
          activeMaxHoldHours: a.maxHoldHours,
          liveMaxHoldHours: tpPlan.maxHoldHours,
          tpSlEnabled: tpPlan.enabled,
        });
        const extendIfRed = resolveAutoTradeHoldExtendIfRed({
          liveHoldExtendIfRed: tpPlan.holdExtendIfRedEnabled,
          tpSlEnabled: tpPlan.enabled,
        });
        const extendRedH = resolveAutoTradeHoldExtendRedHours({
          phase1Hours: phase1H,
          liveHoldExtendRedHours: tpPlan.holdExtendRedHours,
          tpSlEnabled: tpPlan.enabled,
        });

        const positions = await getOpenPositions(creds, a.contractSymbol);
        const pos = findActivePositionShort(positions, a.contractSymbol, a.side);

        if (!pos) {
          await handlePositionDisappeared({ userId, creds, active: a });
          state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
          actionsCount += 1;
          continue;
        }

        const mark = await getContractLastPricePublic(a.contractSymbol);
        if (mark == null || !(mark > 0)) continue;

        const ctx: TpSlContext = {
          userId,
          creds,
          active: a,
          position: pos,
          markPrice: mark,
          positionMode,
          entry: a.mexcAvgEntryPrice,
        };

        const drop = pricePctDrop(a.side, a.mexcAvgEntryPrice, mark);
        const p1Ms = phase1H * 3600 * 1000;
        const ageMs = nowMs - a.openedAtMs;
        let ema12_1hSlopePct7d: number | null = null;
        if (ageMs >= p1Ms - 3600_000 || a.holdExtendedForRed === true) {
          try {
            ema12_1hSlopePct7d = await fetchEma12_1hHoldSlopePct(a.binanceSymbol);
          } catch (e) {
            console.error("[reversalTpSlTick] ema12 1h slope", a.binanceSymbol, e);
          }
        }
        const holdCheckpoint = resolveAutoTradeHoldCheckpoint({
          openedAtMs: a.openedAtMs,
          phase1Hours: phase1H,
          extendRedHours: extendRedH,
          extendIfRedEnabled: extendIfRed,
          holdExtendedForRed: a.holdExtendedForRed === true,
          markPnlPct: drop,
          side: a.side,
          ema12_1hSlopePct7d,
          nowMs,
        });
        if (holdCheckpoint.action === "extend_red") {
          state = withReversalHoldExtendedForRed(state, userId, a.contractSymbol, a.side);
          await notifyLines(userId, [
            "Koji — Reversal TP/SL (MEXC)",
            `⏳ ครบจังหวะ 1 (${holdCheckpoint.phase1Hours} ชม.) · ${EMA12_1H_HOLD_SLOPE_LABEL} ข้างเรา → ขยายอีก ${holdCheckpoint.extendRedHours} ชม.`,
            `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
            `Entry: ${fmtPrice(a.mexcAvgEntryPrice)} · Mark: ${fmtPrice(mark)} · เคลื่อน ${drop >= 0 ? "+" : ""}${drop.toFixed(2)}%`,
            formatEma12_1hHoldLine(a.side, ema12_1hSlopePct7d),
          ]);
          actionsCount += 1;
          continue;
        }
        if (holdCheckpoint.action === "force_close") {
          const r = await handleMaxHoldForceClose(
            ctx,
            holdCheckpoint.holdHours,
            holdCheckpoint.phase,
            ema12_1hSlopePct7d,
          );
          if (r.closed) {
            state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }

        if (
          a.side === "short" &&
          !a.reversalTp8hChecked &&
          typeof a.signalBarHigh === "number" &&
          a.signalBarHigh > 0 &&
          typeof a.signalCheckpoint8hMs === "number" &&
          nowMs >= a.signalCheckpoint8hMs
        ) {
          state = withReversalTp8hChecked(state, userId, a.contractSymbol, a.side);
          if (mark > a.signalBarHigh) {
            const r = await handleReversal8hAboveSignalBarHighClose(ctx, a.signalBarHigh);
            if (r.closed) {
              state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
              actionsCount += 1;
            }
            continue;
          }
          const slR = await handleReversal8hSignalBarHighSl(ctx, a.signalBarHigh);
          if (slR.ok || slR.slOrderId) {
            state = withReversalSlAtEntryArmed(state, userId, a.contractSymbol, a.side, slR.slOrderId);
          }
          actionsCount += 1;
          continue;
        }

        if (!tpPlan.enabled) {
          continue;
        }

        const entry = a.mexcAvgEntryPrice;
        if (!(entry > 0)) continue;

        const exchangeTp1 = Boolean(a.tp1PlanOrderId?.trim());
        const exchangeTp2 = Boolean(a.tp2PlanOrderId?.trim());
        const move = pricePctDrop(a.side, entry, mark);
        const tp1 = a.tp1PricePct ?? 10;
        const tp1Filled = tp1PlanLikelyFilled(a.initialHoldVol, a.tp1PlanVol, pos.holdVol);

        if (exchangeTp1 && !a.tp1Done && tp1Filled) {
          if (a.slBreakevenArmed || a.slPlanOrderId?.trim()) {
            state = withReversalTp1Done(state, userId, a.contractSymbol, a.side, a.slPlanOrderId);
            actionsCount += 1;
          } else {
            const r = await handleTp1BreakevenSlOnly(ctx);
            if (r.tp1Done) {
              state = withReversalTp1Done(state, userId, a.contractSymbol, a.side, r.slOrderId);
              actionsCount += 1;
            }
          }
          continue;
        }

        const tp2 = a.tp2PricePct ?? 25;
        if (!exchangeTp2 && Number.isFinite(move) && move >= tp2) {
          const r = await handleTp2Hit(ctx);
          if (r.closed) {
            state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }
        if (
          shouldExecuteMarkTp1Fallback({
            tp1Done: a.tp1Done === true,
            exchangeTp1,
            movePct: move,
            tp1PricePct: tp1,
            initialHoldVol: a.initialHoldVol,
            tp1PlanVol: a.tp1PlanVol,
            currentHoldVol: pos.holdVol,
          })
        ) {
          const r = await handleTp1Hit(ctx, { cancelExchangeTpPlans: exchangeTp1 });
          if (r.tp1Done) {
            state = withReversalTp1Done(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
          continue;
        }

        if (
          !a.slPlanOrderId?.trim() &&
          !a.slBreakevenArmed &&
          resolveSlAtEntryAfter24hIfGreenEnabled(a, tpPlan.slAtEntryAfter24hIfGreenEnabled) &&
          slBreakevenDueAfter24hIfGreen(a.openedAtMs, move, nowMs)
        ) {
          const r = await handleSlAtEntryOnRoi(ctx, { reason: "24h_green" });
          if (r.slBreakevenAttempted) {
            state = withReversalSlAtEntryArmed(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
          continue;
        }

        const slArm = parseSlArmRoiPct(a.slArmRoiPct, DEFAULT_SL_ARM_ROI_PCT);
        if (
          !a.slPlanOrderId?.trim() &&
          !a.slBreakevenArmed &&
          Number.isFinite(move) &&
          move >= slArm &&
          !a.tp1Done &&
          !tp1Filled &&
          move < tp1
        ) {
          const r = await handleSlAtEntryOnRoi(ctx, { reason: "roi" });
          if (r.slBreakevenAttempted) {
            state = withReversalSlAtEntryArmed(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
          continue;
        }

        const dropForTp = move;

        const emaSlope = reversalTpStrategyResolvedEma20_1hSlope({
          ema20_1hSlopePct7d: a.ema20_1hSlopePct7d,
          ema4hSlopePct7d: a.ema4hSlopePct7d,
        });

        if (!a.reversalTp12hChecked && nowMs >= a.openedAtMs + MS_12H) {
          state = withReversalTp12hChecked(state, userId, a.contractSymbol, a.side);
          if (
            tpPlan.tp12hCloseEnabled &&
            reversalTpStrategyLive12hShouldClose({
              dropPct: dropForTp,
              ema20_1hSlopePct7d: emaSlope,
            })
          ) {
            const r = await handleReversal12hStrategyClose(ctx);
            if (r.closed) {
              state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
              actionsCount += 1;
            }
            continue;
          }
          continue;
        }

        if (!a.reversalTp24hChecked && nowMs >= a.openedAtMs + MS_24H) {
          state = withReversalTp24hChecked(state, userId, a.contractSymbol, a.side);
          if (
            reversalTpStrategyLive24hShouldArmBe({
              dropPct: dropForTp,
              ema20_1hSlopePct7d: emaSlope,
            })
          ) {
            const r = await handleSlAtEntryOnRoi(ctx, { reason: "24h_strategy" });
            if (r.slBreakevenAttempted) {
              state = withReversalSlAtEntryArmed(state, userId, a.contractSymbol, a.side, r.slOrderId);
              actionsCount += 1;
            }
          }
          continue;
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[reversalTpSlTick] per-active fail", userId, a.contractSymbol, e);
        await notifyLines(userId, [
          "Koji — Reversal TP/SL (MEXC)",
          "❌ ระหว่างประเมิน TP/SL เกิดข้อผิดพลาด — ข้ามรอบนี้",
          `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
          `รายละเอียด: ${detail.slice(0, 320)}`,
        ]);
      }
    }
  }

  if (actionsCount > 0) {
    try {
      await saveReversalAutoTradeState(state);
    } catch (e) {
      console.error("[reversalTpSlTick] save state failed", e);
    }
  }

  return actionsCount;
}
