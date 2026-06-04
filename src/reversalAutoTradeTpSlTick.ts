import {
  DEFAULT_SL_ARM_ROI_PCT,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  formatSlBreakevenTriggerLabel,
  parseSlArmRoiPct,
  parseSlEntryOffsetPct,
} from "@/lib/tpSlBreakevenPlan";
import { cancelActiveTpSlPlanOrders, tp1PlanLikelyFilled } from "./autoTradeTpSlPlanOrders";
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
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  loadReversalAutoTradeState,
  saveReversalAutoTradeState,
  withReversalActiveRemoved,
  withReversalSlAtEntryArmed,
  withReversalTp1Done,
  type ReversalAutoTradeActive,
} from "./reversalAutoTradeStateStore";
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
};

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

async function handleMaxHoldForceClose(ctx: TpSlContext): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ ครบ ${active.maxHoldHours} ชม. แต่ปิดไม่สำเร็จ`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `⏰ ครบ ${active.maxHoldHours} ชม. → ปิดทั้งหมด (force)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
    Number.isFinite(drop) ? `ราคาเคลื่อน: ${drop >= 0 ? "+" : ""}${drop.toFixed(2)}% จาก entry` : "",
  ]);
  return { closed: true };
}

async function handleTp2Hit(ctx: TpSlContext): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ TP2 (-${active.tp2PricePct}%) hit แต่ปิดไม่สำเร็จ`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `💰 TP2 hit — ราคาเคลื่อน ${drop.toFixed(2)}% (≥ ${active.tp2PricePct}%) → ปิดทั้งหมด`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
  ]);
  return { closed: true };
}

async function handleSlAtEntryOnRoi(ctx: TpSlContext): Promise<{ ok: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode } = ctx;
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  const entry = active.mexcAvgEntryPrice;
  const slArm = parseSlArmRoiPct(active.slArmRoiPct, DEFAULT_SL_ARM_ROI_PCT);
  const slOffset = parseSlEntryOffsetPct(active.slEntryOffsetPct, DEFAULT_SL_ENTRY_OFFSET_PCT);

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

  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `🛡️ ROI ≥ ${slArm}% — ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)} (ไม่รอ partial TP1)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
    slRes.success
      ? `plan order${slOrderId ? ` #${slOrderId}` : ""}`
      : `⚠️ ไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — ตั้งเองที่ MEXC`,
  ]);

  return { ok: slRes.success, slOrderId };
}

async function handleTp1BreakevenSlOnly(ctx: TpSlContext): Promise<{ tp1Done: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode } = ctx;
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);

  if (!(position.holdVol > 0)) {
    return { tp1Done: true };
  }

  const entry = active.mexcAvgEntryPrice;
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
    `🎯 Plan TP1 execute แล้ว — ราคาเคลื่อน ${drop.toFixed(2)}% (≥ ${active.tp1PricePct}%)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · holdVol คงเหลือ: ${position.holdVol}`,
    slRes.success
      ? `🛡️ ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)} (plan order${slOrderId ? ` #${slOrderId}` : ""})`
      : `⚠️ ตั้ง SL บังทุนไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — กรุณาตั้งเองที่ MEXC`,
  ]);

  return { tp1Done: true, slOrderId };
}

async function handleTp1Hit(ctx: TpSlContext): Promise<{ tp1Done: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode } = ctx;
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  const detail = await fetchContractDetailPublic(active.contractSymbol);
  if (!detail) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ TP1 (-${active.tp1PricePct}%) hit แต่ดึง contract detail ไม่ได้ — ข้ามรอบนี้`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
    ]);
    return { tp1Done: false };
  }
  const partialPct = Math.min(99, Math.max(1, active.tp1PartialPct));
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
      `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
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
      `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
      "ระบบจะเคลียร์ state รอบถัดไป",
    ]);
    return { tp1Done: true };
  }

  let slOrderId = active.slPlanOrderId?.trim();
  let slLine = slOrderId ? `🛡️ SL@entry ตั้งแล้ว (#${slOrderId})` : "";
  if (!slOrderId) {
    const entry = active.mexcAvgEntryPrice;
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
    `🎯 TP1 hit — ราคาเคลื่อน ${drop.toFixed(2)}% (≥ ${active.tp1PricePct}%) → ปิด ${partialPct}% ของ vol`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
    `Partial vol ปิด: ${partialVol} · holdVol คงเหลือ: ${remaining.holdVol}`,
    slLine,
  ]);

  return { tp1Done: true, slOrderId };
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
        };

        const ageMs = nowMs - a.openedAtMs;
        const maxAgeMs = a.maxHoldHours * 3600 * 1000;
        if (ageMs >= maxAgeMs) {
          const r = await handleMaxHoldForceClose(ctx);
          if (r.closed) {
            state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }

        const exchangeTp1 = Boolean(a.tp1PlanOrderId?.trim());
        const exchangeTp2 = Boolean(a.tp2PlanOrderId?.trim());

        if (exchangeTp1 && !a.tp1Done && tp1PlanLikelyFilled(a.initialHoldVol, a.tp1PlanVol, pos.holdVol)) {
          const r = await handleTp1BreakevenSlOnly(ctx);
          if (r.tp1Done) {
            state = withReversalTp1Done(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
          continue;
        }

        const drop = pricePctDrop(a.side, a.mexcAvgEntryPrice, mark);
        if (!exchangeTp2 && Number.isFinite(drop) && drop >= a.tp2PricePct) {
          const r = await handleTp2Hit(ctx);
          if (r.closed) {
            state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }

        if (
          !a.slPlanOrderId?.trim() &&
          Number.isFinite(drop) &&
          drop >= parseSlArmRoiPct(a.slArmRoiPct, DEFAULT_SL_ARM_ROI_PCT)
        ) {
          const r = await handleSlAtEntryOnRoi(ctx);
          if (r.ok) {
            state = withReversalSlAtEntryArmed(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
        }

        if (!exchangeTp1 && !a.tp1Done && Number.isFinite(drop) && drop >= a.tp1PricePct) {
          const r = await handleTp1Hit(ctx);
          if (r.tp1Done) {
            state = withReversalTp1Done(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
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
