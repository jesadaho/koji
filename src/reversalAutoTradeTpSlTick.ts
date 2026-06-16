import {
  resolveAutoTradeHoldCheckpoint,
  resolveAutoTradeHoldExtendIfRed,
  resolveAutoTradeMaxHoldHours,
} from "@/lib/autoTradeMaxHold";
import {
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  formatSlBreakevenTriggerLabel,
  parseSlEntryOffsetPct,
} from "@/lib/tpSlBreakevenPlan";
import {
  REVERSAL_TP_STRATEGY_12H_BE_MIN_PCT,
  reversalTpStrategyLive12hShouldArmBe,
  reversalTpStrategyLive12hShouldClose,
  reversalTpStrategyLive24hShouldArmBe,
  reversalTpStrategyLive24hShouldClose,
} from "@/lib/reversalTpStrategy";
import {
  cancelActiveTpSlPlanOrders,
} from "./autoTradeTpSlPlanOrders";
import { mexcSlBreakevenTriggerPrice } from "./autoTradeSlBreakeven";
import {
  closeAllOpenForSymbol,
  getContractLastPricePublic,
  getFuturesUserPositionMode,
  getOpenPositions,
  placePlanOrderStopLoss,
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
  withReversalTp12hChecked,
  withReversalTp24hChecked,
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

async function handleMaxHoldForceClose(
  ctx: TpSlContext,
  holdHours: number,
  phase: 1 | 2 = 1,
): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      `❌ ครบ ${holdHours} ชม. แต่ปิดไม่สำเร็จ`,
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  const phaseLabel =
    phase === 2
      ? `⏰ ครบจังหวะ 2 (${holdHours} ชม. รวม) → ปิดทั้งหมด (force)`
      : `⏰ ครบจังหวะ 1 (${holdHours} ชม.) → ปิดทั้งหมด (force)`;
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    phaseLabel,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry MEXC: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)}`,
    Number.isFinite(drop) ? `ราคาเคลื่อน: ${drop >= 0 ? "+" : ""}${drop.toFixed(2)}% จาก entry` : "",
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
    `⏰ ครบ 12 ชม. — กลยุทธ์ปิดทันที (ติดลบ + EMA4H>0)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
  ]);
  return { closed: true };
}

async function handleReversal24hStrategyClose(ctx: TpSlContext): Promise<{ closed: boolean }> {
  const { userId, creds, active, markPrice } = ctx;
  await cancelActiveTpSlPlanOrders(creds, active);
  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Reversal TP/SL (MEXC)",
      "❌ ครบ 24 ชม. — กลยุทธ์สั่งปิด แต่ปิดไม่สำเร็จ",
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return { closed: false };
  }
  await notifyLines(userId, [
    "Koji — Reversal TP/SL (MEXC)",
    `⏰ ครบ 24 ชม. — กลยุทธ์ปิดทันที (กำไรนิดหน่อย/ติดลบนิดหน่อย + EMA4H>0)`,
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    `Entry: ${fmtPrice(active.mexcAvgEntryPrice)} · Mark: ${fmtPrice(markPrice)} · เคลื่อน ${drop.toFixed(2)}%`,
  ]);
  return { closed: true };
}

type SlBreakevenArmReason = "12h_be" | "24h_hold";

async function handleSlAtEntryOnRoi(
  ctx: TpSlContext,
  opts?: { reason?: SlBreakevenArmReason },
): Promise<{ ok: boolean; slOrderId?: string; slBreakevenAttempted?: boolean }> {
  const { userId, creds, active, position, markPrice, positionMode } = ctx;
  if (active.slBreakevenArmed || active.slPlanOrderId?.trim()) {
    return { ok: true, slOrderId: active.slPlanOrderId };
  }
  const reason = opts?.reason ?? "12h_be";
  const drop = pricePctDrop(active.side, active.mexcAvgEntryPrice, markPrice);
  const entry = active.mexcAvgEntryPrice;
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

  const headline =
    reason === "24h_hold"
      ? `🛡️ ครบ 24 ชม. ชนะ + EMA4H<0 — ถือต่อ · ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)}`
      : `🛡️ ครบ 12 ชม. กำไร > ${REVERSAL_TP_STRATEGY_12H_BE_MIN_PCT}% — ตั้ง SL บังทุน ${formatSlBreakevenTriggerLabel(active.side, entry, slOffset, fmtPrice)}`;

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

    const tpPlan = resolveReversalTpSlPlanFromRow(row);

    for (const a of actives) {
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

        const drop = pricePctDrop(a.side, a.mexcAvgEntryPrice, mark);
        const holdCheckpoint = resolveAutoTradeHoldCheckpoint({
          openedAtMs: a.openedAtMs,
          phase1Hours: phase1H,
          extendIfRedEnabled: extendIfRed,
          holdExtendedForRed: a.holdExtendedForRed === true,
          markPnlPct: drop,
          nowMs,
        });
        if (holdCheckpoint.action === "extend_red") {
          state = withReversalHoldExtendedForRed(state, userId, a.contractSymbol, a.side);
          await notifyLines(userId, [
            "Koji — Reversal TP/SL (MEXC)",
            `⏳ ครบจังหวะ 1 (${holdCheckpoint.phase1Hours} ชม.) ยังปิดแดง → ขยายอีก ${holdCheckpoint.phase1Hours} ชม.`,
            `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
            `Entry: ${fmtPrice(a.mexcAvgEntryPrice)} · Mark: ${fmtPrice(mark)} · เคลื่อน ${drop.toFixed(2)}%`,
          ]);
          actionsCount += 1;
          continue;
        }
        if (holdCheckpoint.action === "force_close") {
          const r = await handleMaxHoldForceClose(ctx, holdCheckpoint.holdHours, holdCheckpoint.phase);
          if (r.closed) {
            state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
            actionsCount += 1;
          }
          continue;
        }

        if (!tpPlan.enabled) {
          continue;
        }

        const dropForTp = pricePctDrop(a.side, a.mexcAvgEntryPrice, mark);
        const beArmed = a.slBreakevenArmed === true || Boolean(a.slPlanOrderId?.trim());

        if (!a.reversalTp12hChecked && nowMs >= a.openedAtMs + MS_12H) {
          state = withReversalTp12hChecked(state, userId, a.contractSymbol, a.side);
          if (
            reversalTpStrategyLive12hShouldClose({
              dropPct: dropForTp,
              ema4hSlopePct7d: a.ema4hSlopePct7d,
            })
          ) {
            const r = await handleReversal12hStrategyClose(ctx);
            if (r.closed) {
              state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
              actionsCount += 1;
            }
            continue;
          }
          if (reversalTpStrategyLive12hShouldArmBe(dropForTp)) {
            const r = await handleSlAtEntryOnRoi(ctx, { reason: "12h_be" });
            if (r.slBreakevenAttempted) {
              state = withReversalSlAtEntryArmed(state, userId, a.contractSymbol, a.side, r.slOrderId);
              actionsCount += 1;
            }
          }
          continue;
        }

        if (!a.reversalTp24hChecked && nowMs >= a.openedAtMs + MS_24H) {
          state = withReversalTp24hChecked(state, userId, a.contractSymbol, a.side);
          if (
            reversalTpStrategyLive24hShouldClose({
              dropPct: dropForTp,
              ema4hSlopePct7d: a.ema4hSlopePct7d,
              beArmed,
            })
          ) {
            const r = await handleReversal24hStrategyClose(ctx);
            if (r.closed) {
              state = withReversalActiveRemoved(state, userId, a.contractSymbol, a.side);
              actionsCount += 1;
            }
            continue;
          }
          if (
            reversalTpStrategyLive24hShouldArmBe({
              dropPct: dropForTp,
              ema4hSlopePct7d: a.ema4hSlopePct7d,
            })
          ) {
            const r = await handleSlAtEntryOnRoi(ctx, { reason: "24h_hold" });
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
