import {
  resolveAutoTradeHoldCheckpoint,
  resolveAutoTradeHoldExtendIfRed,
  resolveAutoTradeMaxHoldHours,
} from "@/lib/autoTradeMaxHold";
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
import { resolveSnowballTpSlPlanFromRow } from "./snowballAutoTradeTpSlPlan";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withSnowballActiveRemoved,
  withSnowballHoldExtendedForRed,
  withSnowballSlAtEntryArmed,
  withSnowballTp1Done,
  type SnowballAutoTradeActive,
  type SnowballAutoTradeSide,
} from "./snowballAutoTradeStateStore";
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

function pricePctFavorable(side: SnowballAutoTradeSide, entry: number, mark: number): number {
  if (!(entry > 0) || !(mark > 0)) return NaN;
  if (side === "short") return ((entry - mark) / entry) * 100;
  return ((mark - entry) / entry) * 100;
}

function findActivePosition(
  positions: OpenPositionRow[],
  contractSymbol: string,
  side: SnowballAutoTradeSide
): OpenPositionRow | undefined {
  const sym = contractSymbol.trim();
  const wantType = side === "long" ? 1 : 2;
  return positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === wantType
  );
}

export function snowballActiveTracksTpSl(a: SnowballAutoTradeActive): boolean {
  return (
    a.tpSlEnabled === true &&
    typeof a.tp1PricePct === "number" &&
    a.tp1PricePct > 0 &&
    typeof a.tp2PricePct === "number" &&
    a.tp2PricePct > 0 &&
    typeof a.maxHoldHours === "number" &&
    a.maxHoldHours > 0
  );
}

async function resolveTpSlEntry(
  creds: MexcCredentials,
  a: SnowballAutoTradeActive
): Promise<number | null> {
  const m = a.mexcAvgEntryPrice;
  if (typeof m === "number" && Number.isFinite(m) && m > 0) return m;
  try {
    const pos = await getOpenPositions(creds, a.contractSymbol);
    const row = findActivePosition(pos, a.contractSymbol, a.side);
    if (!row) return null;
    const o = Number(row.openAvgPrice);
    if (Number.isFinite(o) && o > 0) return o;
    const h = Number(row.holdAvgPrice);
    if (Number.isFinite(h) && h > 0) return h;
  } catch {
    /* ignore */
  }
  return null;
}

type TpSlContext = {
  userId: string;
  creds: MexcCredentials;
  active: SnowballAutoTradeActive;
  entry: number;
  position: OpenPositionRow;
  markPrice: number;
  positionMode: 1 | 2;
};

async function handlePositionDisappeared(args: {
  userId: string;
  creds: MexcCredentials;
  active: SnowballAutoTradeActive;
}): Promise<void> {
  const { userId, creds, active } = args;
  await cancelActiveTpSlPlanOrders(creds, active);
  await notifyLines(userId, [
    "Koji — Snowball TP/SL (MEXC)",
    "ℹ️ ตำแหน่งถูกปิดภายนอกระบบ (อาจจาก SL บังทุน หรือปิดมือ)",
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `ราคาเข้าเฉลี่ย MEXC: ${fmtPrice(active.mexcAvgEntryPrice ?? active.referenceEntryPrice)} USDT`,
    "ระบบเคลียร์ state แล้ว — จะไม่ติดตาม TP/SL ของออเดอร์นี้อีก",
  ]);
}

async function handleMaxHoldForceClose(
  ctx: TpSlContext,
  holdHours: number,
  phase: 1 | 2 = 1,
): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice, entry } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Snowball TP/SL (MEXC)",
      `❌ ครบ ${holdHours} ชม. แต่ปิดไม่สำเร็จ`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)}`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  const move = pricePctFavorable(active.side, entry, markPrice);
  const phaseLabel =
    phase === 2
      ? `⏰ ครบจังหวะ 2 (${holdHours} ชม. รวม) → ปิดทั้งหมด (force)`
      : `⏰ ครบจังหวะ 1 (${holdHours} ชม.) → ปิดทั้งหมด (force)`;
  await notifyLines(userId, [
    "Koji — Snowball TP/SL (MEXC)",
    phaseLabel,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)}`,
    Number.isFinite(move) ? `ราคาเคลื่อนในทิศกำไร: ${move >= 0 ? "+" : ""}${move.toFixed(2)}%` : "",
  ]);
  return { closed: true };
}

async function handleTp2Hit(ctx: TpSlContext): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice, entry } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  const move = pricePctFavorable(active.side, entry, markPrice);
  const tp2 = active.tp2PricePct ?? 25;
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Snowball TP/SL (MEXC)",
      `❌ TP2 (${tp2}%) hit แต่ปิดไม่สำเร็จ`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move.toFixed(2)}%`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  await notifyLines(userId, [
    "Koji — Snowball TP/SL (MEXC)",
    `💰 TP2 hit — ราคาเคลื่อน ${move.toFixed(2)}% (≥ ${tp2}%) → ปิดทั้งหมด`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)}`,
  ]);
  return { closed: true };
}

/** ROI ถึง slArm% — ตั้ง SL@entry ทันที (ไม่ต้องรอ partial TP1) */
async function handleSlAtEntryOnRoi(ctx: TpSlContext): Promise<{ ok: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode, entry } = ctx;
  const move = pricePctFavorable(active.side, entry, markPrice);
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
    "Koji — Snowball TP/SL (MEXC)",
    `🛡️ ROI ≥ ${slArm}% — ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)} (ไม่รอ partial TP1)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${move.toFixed(2)}%`,
    slRes.success
      ? `plan order${slOrderId ? ` #${slOrderId}` : ""}`
      : `⚠️ ไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — ตั้งเองที่ MEXC`,
  ]);

  return { ok: slRes.success, slOrderId };
}

/** หลัง plan TP1 execute บน MEXC — ตั้ง SL บังทุนที่เหลือ (ไม่ partial close ซ้ำ) */
async function handleTp1BreakevenSlOnly(ctx: TpSlContext): Promise<{ tp1Done: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode, entry } = ctx;
  const move = pricePctFavorable(active.side, entry, markPrice);
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
    "Koji — Snowball TP/SL (MEXC)",
    `🎯 Plan TP1 execute แล้ว — ราคาเคลื่อน ${move.toFixed(2)}% (≥ ${tp1}%)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)} · holdVol คงเหลือ: ${position.holdVol}`,
    slRes.success
      ? `🛡️ ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)} (plan order${slOrderId ? ` #${slOrderId}` : ""})`
      : `⚠️ ตั้ง SL บังทุนไม่สำเร็จ (${slRes.message ?? `code ${slRes.code}`}) — กรุณาตั้งเองที่ MEXC`,
  ]);

  return { tp1Done: true, slOrderId };
}

async function handleTp1Hit(ctx: TpSlContext): Promise<{ tp1Done: boolean; slOrderId?: string }> {
  const { userId, creds, active, position, markPrice, positionMode, entry } = ctx;
  const move = pricePctFavorable(active.side, entry, markPrice);
  const tp1 = active.tp1PricePct ?? 10;
  const detail = await fetchContractDetailPublic(active.contractSymbol);
  if (!detail) {
    await notifyLines(userId, [
      "Koji — Snowball TP/SL (MEXC)",
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
      "Koji — Snowball TP/SL (MEXC)",
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
      "Koji — Snowball TP/SL (MEXC)",
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
    remaining = findActivePosition(posAfter, active.contractSymbol, active.side);
  } catch (e) {
    console.error("[snowballTpSlTick] getOpenPositions after partial", active.contractSymbol, e);
  }

  if (!remaining || !(remaining.holdVol > 0)) {
    await notifyLines(userId, [
      "Koji — Snowball TP/SL (MEXC)",
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
    "Koji — Snowball TP/SL (MEXC)",
    `🎯 TP1 hit — ราคาเคลื่อน ${move.toFixed(2)}% (≥ ${tp1}%) → ปิด ${partialPct}% ของ vol`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(entry)} · Mark: ${fmtPrice(markPrice)}`,
    `Partial vol ปิด: ${partialVol} · holdVol คงเหลือ: ${remaining.holdVol}`,
    slLine,
  ]);

  return { tp1Done: true, slOrderId };
}

export async function runSnowballAutoTradeTpSlTick(nowMs: number): Promise<number> {
  const [map, state0] = await Promise.all([loadTradingViewMexcSettingsFullMap(), loadSnowballAutoTradeState()]);
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
      console.error("[snowballTpSlTick] getFuturesUserPositionMode", userId, e);
      continue;
    }

    const tpPlan = resolveSnowballTpSlPlanFromRow(row);

    for (const a of actives as SnowballAutoTradeActive[]) {
      const tracksTpStrategy =
        tpPlan.enabled || a.tpSlEnabled === true || (a.maxHoldHours ?? 0) > 0;
      if (!tracksTpStrategy) continue;

      try {
        const phase1H = resolveAutoTradeMaxHoldHours({
          activeMaxHoldHours: a.maxHoldHours,
          liveMaxHoldHours: tpPlan.maxHoldHours,
          tpSlEnabled: tpPlan.enabled,
        });
        const extendIfRed = resolveAutoTradeHoldExtendIfRed({
          liveHoldExtendIfRed: tpPlan.holdExtendIfRedEnabled,
          tpSlEnabled: tpPlan.enabled,
        });
        const maxHoldDueMs =
          extendIfRed || a.holdExtendedForRed
            ? phase1H * 2 * 3600 * 1000
            : phase1H * 3600 * 1000;

        const positions = await getOpenPositions(creds, a.contractSymbol);
        const pos = findActivePosition(positions, a.contractSymbol, a.side);

        if (!pos) {
          if (snowballActiveTracksTpSl(a) || nowMs - a.openedAtMs >= maxHoldDueMs) {
            await handlePositionDisappeared({ userId, creds, active: a });
            state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }

        const mark = await getContractLastPricePublic(a.contractSymbol);
        if (mark == null || !(mark > 0)) continue;

        const entry =
          (await resolveTpSlEntry(creds, a)) ??
          (a.mexcAvgEntryPrice && a.mexcAvgEntryPrice > 0
            ? a.mexcAvgEntryPrice
            : a.referenceEntryPrice > 0
              ? a.referenceEntryPrice
              : null);

        const ctx: TpSlContext = {
          userId,
          creds,
          active: a,
          entry: entry ?? a.referenceEntryPrice,
          position: pos,
          markPrice: mark,
          positionMode,
        };

        const moveForHold = pricePctFavorable(a.side, ctx.entry, mark);
        const holdCheckpoint = resolveAutoTradeHoldCheckpoint({
          openedAtMs: a.openedAtMs,
          phase1Hours: phase1H,
          extendIfRedEnabled: extendIfRed,
          holdExtendedForRed: a.holdExtendedForRed === true,
          markPnlPct: moveForHold,
          nowMs,
        });
        if (holdCheckpoint.action === "extend_red") {
          state = withSnowballHoldExtendedForRed(state, userId, a.contractSymbol, a.side);
          await notifyLines(userId, [
            "Koji — Snowball TP/SL (MEXC)",
            `⏳ ครบจังหวะ 1 (${holdCheckpoint.phase1Hours} ชม.) ยังปิดแดง → ขยายอีก ${holdCheckpoint.phase1Hours} ชม.`,
            `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
            `Entry: ${fmtPrice(ctx.entry)} · Mark: ${fmtPrice(mark)} · เคลื่อน ${moveForHold.toFixed(2)}%`,
          ]);
          actionsCount += 1;
          continue;
        }
        if (holdCheckpoint.action === "force_close") {
          const r = await handleMaxHoldForceClose(ctx, holdCheckpoint.holdHours, holdCheckpoint.phase);
          if (r.closed) {
            state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }

        if (!snowballActiveTracksTpSl(a)) continue;
        if (entry == null || !(entry > 0)) continue;

        const exchangeTp1 = Boolean(a.tp1PlanOrderId?.trim());
        const exchangeTp2 = Boolean(a.tp2PlanOrderId?.trim());

        if (exchangeTp1 && !a.tp1Done && tp1PlanLikelyFilled(a.initialHoldVol, a.tp1PlanVol, pos.holdVol)) {
          const r = await handleTp1BreakevenSlOnly(ctx);
          if (r.tp1Done) {
            state = withSnowballTp1Done(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
          continue;
        }

        const move = pricePctFavorable(a.side, entry, mark);
        const tp2 = a.tp2PricePct ?? 25;
        if (!exchangeTp2 && Number.isFinite(move) && move >= tp2) {
          const r = await handleTp2Hit(ctx);
          if (r.closed) {
            state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }

        if (
          !a.slPlanOrderId?.trim() &&
          Number.isFinite(move) &&
          move >= parseSlArmRoiPct(a.slArmRoiPct, DEFAULT_SL_ARM_ROI_PCT)
        ) {
          const r = await handleSlAtEntryOnRoi(ctx);
          if (r.ok) {
            state = withSnowballSlAtEntryArmed(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
        }

        const tp1 = a.tp1PricePct ?? 10;
        if (!exchangeTp1 && !a.tp1Done && Number.isFinite(move) && move >= tp1) {
          const r = await handleTp1Hit(ctx);
          if (r.tp1Done) {
            state = withSnowballTp1Done(state, userId, a.contractSymbol, a.side, r.slOrderId);
            actionsCount += 1;
          }
          continue;
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[snowballTpSlTick] per-active fail", userId, a.contractSymbol, e);
        await notifyLines(userId, [
          "Koji — Snowball TP/SL (MEXC)",
          "❌ ระหว่างประเมิน TP/SL เกิดข้อผิดพลาด — ข้ามรอบนี้",
          `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
          `รายละเอียด: ${detail.slice(0, 320)}`,
        ]);
      }
    }
  }

  if (actionsCount > 0) {
    try {
      await saveSnowballAutoTradeState(state);
    } catch (e) {
      console.error("[snowballTpSlTick] save state failed", e);
    }
  }

  return actionsCount;
}
