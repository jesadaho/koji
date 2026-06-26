import {
  annotateAutoOpenRowsWithMexcActive,
  autoOpenMexcActiveKey,
  mexcOpenPositionActiveKeys,
} from "@/lib/autoOpenMexcActive";
import {
  evaluateAutoOpenMaxHoldSafetyClose,
  formatEma12_1hHoldLine,
  resolveAutoTradeHoldExtendIfRed,
  resolveAutoTradeHoldExtendRedHours,
  resolveAutoTradeMaxHoldHours,
} from "@/lib/autoTradeMaxHold";
import { resolveAutoOpenOpenedAtMs, resolveAutoOpenEntryPrice } from "@/lib/autoOpenFollowUp";
import { resolveAutoOpenTpSlPlanForRow } from "@/lib/autoOpenTpStrategy";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { cancelActiveTpSlPlanOrders } from "./autoTradeTpSlPlanOrders";
import { loadAutoOpenOrderLogState } from "./autoOpenOrderLogStore";
import {
  closeAllOpenForSymbol,
  fetchAllOpenPositions,
  getContractLastPricePublic,
  type MexcCredentials,
} from "./mexcFuturesClient";
import {
  loadReversalAutoTradeState,
  saveReversalAutoTradeState,
  withReversalActiveRemoved,
  type ReversalAutoTradeActive,
} from "./reversalAutoTradeStateStore";
import {
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withSnowballActiveRemoved,
  type SnowballAutoTradeActive,
} from "./snowballAutoTradeStateStore";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";
import {
  fetchSymbolEmaSlopePctTf,
  STATS_EMA1H_SLOPE_LOOKBACK_BARS,
} from "./statsEmaSlope";

const TG_USER_RE = /^tg:\d+$/;

export function isAutoOpenMaxHoldSafetyEnabled(): boolean {
  const v = process.env.AUTO_OPEN_MAX_HOLD_SAFETY?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
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

function pricePctDrop(side: "short" | "long", entry: number, mark: number): number {
  if (!(entry > 0) || !(mark > 0)) return NaN;
  if (side === "short") return ((entry - mark) / entry) * 100;
  return ((mark - entry) / entry) * 100;
}

type BotActiveMatch =
  | { source: "snowball"; active: SnowballAutoTradeActive }
  | { source: "reversal"; active: ReversalAutoTradeActive };

function findBotActive(
  contractSymbol: string,
  side: "long" | "short",
  snowballActives: SnowballAutoTradeActive[],
  reversalActives: ReversalAutoTradeActive[],
): BotActiveMatch | null {
  const key = autoOpenMexcActiveKey(contractSymbol, side);
  for (const a of snowballActives) {
    if (autoOpenMexcActiveKey(a.contractSymbol, a.side) === key) {
      return { source: "snowball", active: a };
    }
  }
  for (const a of reversalActives) {
    if (autoOpenMexcActiveKey(a.contractSymbol, a.side) === key) {
      return { source: "reversal", active: a };
    }
  }
  return null;
}

function resolveSafetyHoldParams(
  row: AutoOpenOrderLogRow,
  plan: ReturnType<typeof resolveAutoOpenTpSlPlanForRow>,
  bot: BotActiveMatch | null,
): {
  openedAtMs: number;
  phase1Hours: number;
  extendIfRedEnabled: boolean;
  extendRedHours: number;
  holdExtendedForRed: boolean;
  entry: number;
} | null {
  const logOpenedAt = resolveAutoOpenOpenedAtMs(row);
  if (logOpenedAt == null) return null;

  if (bot?.source === "snowball" && bot.active.quickTpEnabled && !bot.active.tpSlEnabled) {
    const h = bot.active.quickTpMaxHours;
    const phase1Hours = typeof h === "number" && Number.isFinite(h) && h > 0 ? h : 4;
    const entry =
      (typeof bot.active.mexcAvgEntryPrice === "number" && bot.active.mexcAvgEntryPrice > 0
        ? bot.active.mexcAvgEntryPrice
        : resolveAutoOpenEntryPrice(row)) ?? NaN;
    if (!(entry > 0)) return null;
    return {
      openedAtMs: bot.active.openedAtMs,
      phase1Hours,
      extendIfRedEnabled: false,
      extendRedHours: phase1Hours,
      holdExtendedForRed: false,
      entry,
    };
  }

  const activeMaxHold =
    bot?.source === "snowball"
      ? bot.active.maxHoldHours
      : bot?.source === "reversal"
        ? bot.active.maxHoldHours
        : undefined;

  const phase1Hours = resolveAutoTradeMaxHoldHours({
    activeMaxHoldHours: activeMaxHold,
    liveMaxHoldHours: plan.maxHoldHours,
    tpSlEnabled: plan.tpSlEnabled,
  });
  const extendIfRedEnabled = resolveAutoTradeHoldExtendIfRed({
    activeHoldExtendIfRed: plan.holdExtendIfRedEnabled,
    liveHoldExtendIfRed: plan.holdExtendIfRedEnabled,
    tpSlEnabled: plan.tpSlEnabled,
  });
  const extendRedHours = resolveAutoTradeHoldExtendRedHours({
    phase1Hours,
    liveHoldExtendRedHours: plan.holdExtendRedHours,
    tpSlEnabled: plan.tpSlEnabled,
  });
  const openedAtMs = bot?.active.openedAtMs ?? logOpenedAt;
  const holdExtendedForRed = bot?.active.holdExtendedForRed === true;

  const entry =
    (bot?.source === "snowball" &&
    typeof bot.active.mexcAvgEntryPrice === "number" &&
    bot.active.mexcAvgEntryPrice > 0
      ? bot.active.mexcAvgEntryPrice
      : bot?.source === "reversal" && bot.active.mexcAvgEntryPrice > 0
        ? bot.active.mexcAvgEntryPrice
        : resolveAutoOpenEntryPrice(row)) ?? NaN;
  if (!(entry > 0)) return null;

  return {
    openedAtMs,
    phase1Hours,
    extendIfRedEnabled,
    extendRedHours,
    holdExtendedForRed,
    entry,
  };
}

function safetyReasonLabel(
  due: NonNullable<ReturnType<typeof evaluateAutoOpenMaxHoldSafetyClose>>,
  inBotState: boolean,
): string {
  if (due.reason === "checkpoint_force_close") {
    return due.phase === 2
      ? `ครบจังหวะ 2 (${due.holdHours} ชม.) — primary tick ไม่ปิด`
      : `ครบจังหวะ 1 (${due.holdHours} ชม.) — primary tick ไม่ปิด`;
  }
  if (due.reason === "past_absolute_max") {
    return `เกิน max hold สูงสุด (${due.holdHours} ชม.+grace)`;
  }
  if (!inBotState) {
    return `orphan — ไม่อยู่ใน state แต่ MEXC ยังเปิด (ครบ ${due.holdHours} ชม.+grace)`;
  }
  return `เกินกำหนด ${due.holdHours} ชม.+grace`;
}

function liveRowsForUser(rows: AutoOpenOrderLogRow[]): AutoOpenOrderLogRow[] {
  const seen = new Set<string>();
  const out: AutoOpenOrderLogRow[] = [];
  for (const r of rows) {
    if (r.outcome !== "success" || r.mexcActive !== true) continue;
    if (r.side !== "long" && r.side !== "short") continue;
    const k = autoOpenMexcActiveKey(r.contractSymbol, r.side);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

type SafetyCandidate = {
  row: AutoOpenOrderLogRow | null;
  bot: BotActiveMatch | null;
};

function collectSafetyCandidates(
  liveRows: AutoOpenOrderLogRow[],
  snowballActives: SnowballAutoTradeActive[],
  reversalActives: ReversalAutoTradeActive[],
  mexcKeys: Set<string>,
): SafetyCandidate[] {
  const out: SafetyCandidate[] = [];
  const seen = new Set<string>();

  for (const row of liveRows) {
    const side = row.side as "long" | "short";
    const k = autoOpenMexcActiveKey(row.contractSymbol, side);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ row, bot: findBotActive(row.contractSymbol, side, snowballActives, reversalActives) });
  }

  const pushBotOnly = (bot: BotActiveMatch) => {
    const k = autoOpenMexcActiveKey(bot.active.contractSymbol, bot.active.side);
    if (seen.has(k) || !mexcKeys.has(k)) return;
    seen.add(k);
    out.push({ row: null, bot });
  };
  for (const a of snowballActives) pushBotOnly({ source: "snowball", active: a });
  for (const a of reversalActives) pushBotOnly({ source: "reversal", active: a });

  return out;
}

function resolveHoldForCandidate(
  candidate: SafetyCandidate,
  settingsMap: Awaited<ReturnType<typeof loadTradingViewMexcSettingsFullMap>>,
): ReturnType<typeof resolveSafetyHoldParams> {
  const { row, bot } = candidate;
  if (row) {
    const plan = resolveAutoOpenTpSlPlanForRow(row, settingsMap);
    return resolveSafetyHoldParams(row, plan, bot);
  }
  if (!bot) return null;

  const plan = resolveAutoOpenTpSlPlanForRow(
    {
      id: "",
      atMs: bot.active.openedAtMs,
      userId: "",
      source: bot.source,
      outcome: "success",
      reasonCode: "",
      contractSymbol: bot.active.contractSymbol,
      binanceSymbol: bot.active.binanceSymbol,
      side: bot.active.side,
    },
    settingsMap,
  );
  return resolveSafetyHoldParams(
    {
      id: "",
      atMs: bot.active.openedAtMs,
      userId: "",
      source: bot.source,
      outcome: "success",
      reasonCode: "",
      contractSymbol: bot.active.contractSymbol,
      binanceSymbol: bot.active.binanceSymbol,
      side: bot.active.side,
      leverage: bot.active.leverage,
    },
    plan,
    bot,
  );
}

/** Safety net — ปิดไม้ live ที่เกิน max hold (order log + MEXC) ถ้า primary TP/SL tick พลาดหรือ state หลุด */
export async function runAutoOpenMaxHoldSafetyTick(nowMs: number): Promise<number> {
  if (!isAutoOpenMaxHoldSafetyEnabled()) return 0;

  const [settingsMap, orderLog, snowballState0, reversalState0] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadAutoOpenOrderLogState(),
    loadSnowballAutoTradeState(),
    loadReversalAutoTradeState(),
  ]);

  const rowsByUser = new Map<string, AutoOpenOrderLogRow[]>();
  for (const row of orderLog.rows) {
    const uid = row.userId.trim();
    if (!uid) continue;
    const list = rowsByUser.get(uid) ?? [];
    list.push(row);
    rowsByUser.set(uid, list);
  }

  let snowballState = snowballState0;
  let reversalState = reversalState0;
  let snowballDirty = false;
  let reversalDirty = false;
  let actions = 0;

  for (const [userId, settingsRow] of Object.entries(settingsMap)) {
    if (!TG_USER_RE.test(userId.trim())) continue;
    const apiKey = settingsRow.mexcApiKey?.trim();
    const secret = settingsRow.mexcSecret?.trim();
    if (!apiKey || !secret) continue;

    const creds: MexcCredentials = { apiKey, secret };
    let mexcKeys: Set<string>;
    try {
      const res = await fetchAllOpenPositions(creds);
      if (!res.ok) continue;
      mexcKeys = mexcOpenPositionActiveKeys(res.rows);
    } catch (e) {
      console.error("[autoOpenMaxHoldSafety] fetch positions", userId, e);
      continue;
    }
    if (mexcKeys.size === 0) continue;

    const userRows = rowsByUser.get(userId) ?? [];
    const annotated = annotateAutoOpenRowsWithMexcActive(userRows, mexcKeys);
    const liveRows = liveRowsForUser(annotated);
    const snowballActives = snowballState[userId]?.active ?? [];
    const reversalActives = reversalState[userId]?.active ?? [];
    const candidates = collectSafetyCandidates(liveRows, snowballActives, reversalActives, mexcKeys);
    if (candidates.length === 0) continue;

    for (const candidate of candidates) {
      const row = candidate.row;
      const bot = candidate.bot;
      const contractSymbol = row?.contractSymbol ?? bot?.active.contractSymbol;
      const side = (row?.side ?? bot?.active.side) as "long" | "short" | undefined;
      if (!contractSymbol || (side !== "long" && side !== "short")) continue;

      const hold = resolveHoldForCandidate(candidate, settingsMap);
      if (!hold) continue;

      const mark = await getContractLastPricePublic(contractSymbol);
      if (mark == null || !(mark > 0)) continue;

      const drop = pricePctDrop(side, hold.entry, mark);
      let ema12_1hSlopePct7d: number | null | undefined;
      if (bot?.source === "reversal") {
        const p1Ms = hold.phase1Hours * 3600 * 1000;
        const ageMs = nowMs - hold.openedAtMs;
        if (ageMs >= p1Ms - 3600_000 || hold.holdExtendedForRed) {
          try {
            ema12_1hSlopePct7d = await fetchSymbolEmaSlopePctTf(
              bot.active.binanceSymbol,
              "1h",
              STATS_EMA1H_SLOPE_LOOKBACK_BARS,
            );
          } catch (e) {
            console.error("[autoOpenMaxHoldSafety] ema12 1h", bot.active.binanceSymbol, e);
            ema12_1hSlopePct7d = null;
          }
        }
      }
      const due = evaluateAutoOpenMaxHoldSafetyClose({
        openedAtMs: hold.openedAtMs,
        phase1Hours: hold.phase1Hours,
        extendRedHours: hold.extendRedHours,
        extendIfRedEnabled: hold.extendIfRedEnabled,
        holdExtendedForRed: hold.holdExtendedForRed,
        inBotState: bot != null,
        markPnlPct: drop,
        side: bot?.source === "reversal" ? side : undefined,
        ema12_1hSlopePct7d,
        nowMs,
      });
      if (!due) continue;

      try {
        if (bot) {
          await cancelActiveTpSlPlanOrders(creds, bot.active);
        }
        const r = await closeAllOpenForSymbol(creds, contractSymbol);
        const label = shortContractLabel(contractSymbol);
        const sourceLabel =
          (row?.source ?? bot?.source) === "snowball" ? "Snowball" : "Reversal";
        const reasonLine = safetyReasonLabel(due, bot != null);

        if (!r.success) {
          await notifyLines(userId, [
            "Koji — Auto-open max-hold safety (MEXC)",
            `❌ ควรปิดแล้วแต่ปิดไม่สำเร็จ`,
            `[${label}]/USDT (${side.toUpperCase()}) · ${sourceLabel}`,
            reasonLine,
            `Entry: ${fmtPrice(hold.entry)} · Mark: ${fmtPrice(mark)}`,
            r.message ? `MEXC: ${r.message}` : "",
          ]);
          continue;
        }

        if (bot?.source === "snowball") {
          snowballState = withSnowballActiveRemoved(snowballState, userId, contractSymbol, side);
          snowballDirty = true;
        } else if (bot?.source === "reversal") {
          reversalState = withReversalActiveRemoved(reversalState, userId, contractSymbol, side);
          reversalDirty = true;
        }

        await notifyLines(userId, [
          "Koji — Auto-open max-hold safety (MEXC)",
          `⏰ ${reasonLine}`,
          `[${label}]/USDT (${side.toUpperCase()}) · ${sourceLabel}`,
          `Entry: ${fmtPrice(hold.entry)} · Mark: ${fmtPrice(mark)}`,
          Number.isFinite(drop) ? `ราคาเคลื่อน: ${drop >= 0 ? "+" : ""}${drop.toFixed(2)}% จาก entry` : "",
          bot?.source === "reversal" && ema12_1hSlopePct7d !== undefined
            ? formatEma12_1hHoldLine(side, ema12_1hSlopePct7d)
            : "",
          bot ? "เคลียร์ state แล้ว" : "ไม่อยู่ใน state — ปิดจาก order log + MEXC",
        ]);
        actions += 1;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[autoOpenMaxHoldSafety] close fail", userId, contractSymbol, e);
        await notifyLines(userId, [
          "Koji — Auto-open max-hold safety (MEXC)",
          "❌ เกิดข้อผิดพลาดระหว่างปิด",
          `[${shortContractLabel(contractSymbol)}]/USDT (${side.toUpperCase()})`,
          detail.slice(0, 320),
        ]);
      }
    }
  }

  if (snowballDirty) {
    try {
      await saveSnowballAutoTradeState(snowballState);
    } catch (e) {
      console.error("[autoOpenMaxHoldSafety] save snowball state", e);
    }
  }
  if (reversalDirty) {
    try {
      await saveReversalAutoTradeState(reversalState);
    } catch (e) {
      console.error("[autoOpenMaxHoldSafety] save reversal state", e);
    }
  }

  return actions;
}
