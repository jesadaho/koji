import {
  closeAllOpenForSymbol,
  getContractLastPricePublic,
  getOpenPositions,
  type MexcCredentials,
} from "./mexcFuturesClient";
import { fetchBinanceUsdmKlinesRange, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withSnowballActiveRemoved,
  withSnowballGuard24hEvaluated,
  type SnowballAutoTradeActive,
} from "./snowballAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

const KLINE_GRAN_SEC = 900;
const SEC_24H = 24 * 3600;

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function entryRefPrice(a: SnowballAutoTradeActive): number {
  const m = a.mexcAvgEntryPrice;
  if (typeof m === "number" && Number.isFinite(m) && m > 0) return m;
  return a.referenceEntryPrice;
}

function passesRunTrendGuardLikeStats(p: {
  side: "long" | "short";
  price24h: number;
  signalBarLow: number | null;
  maxDrawdownPct: number;
  svpHoleYn: "Y" | "N";
}): boolean {
  if (p.side !== "long") return false;
  if (!Number.isFinite(p.price24h)) return false;
  if (p.signalBarLow == null || !Number.isFinite(p.signalBarLow) || p.signalBarLow <= 0) return false;
  if (!Number.isFinite(p.maxDrawdownPct) || p.maxDrawdownPct < 0) return false;
  const maxDdAllowed = (() => {
    const v = Number(process.env.SNOWBALL_STATS_OUTCOME_RUN_TREND_MAX_DD_PCT);
    return Number.isFinite(v) && v > 0 && v < 100 ? v : 3;
  })();
  if (p.price24h <= p.signalBarLow) return false;
  if (p.maxDrawdownPct > maxDdAllowed) return false;
  if (p.svpHoleYn !== "N") return false;
  return true;
}

async function tryCloseUnderwater24h(args: {
  userId: string;
  creds: MexcCredentials;
  active: SnowballAutoTradeActive;
  reason: string;
}): Promise<boolean> {
  const { userId, creds, active, reason } = args;
  const positions = await getOpenPositions(creds, active.contractSymbol);
  const wantType = active.side === "long" ? 1 : 2;
  const stillOpen = positions.some(
    (p) =>
      p.symbol === active.contractSymbol.trim().toUpperCase() &&
      p.state === 1 &&
      Number(p.holdVol) > 0 &&
      p.positionType === wantType,
  );
  if (!stillOpen) return true;

  const r = await closeAllOpenForSymbol(creds, active.contractSymbol);
  if (!r.success) {
    await notifyLines(userId, [
      "Koji — Snowball auto-open (MEXC)",
      "❌ 24h rule: ปิดไม่สำเร็จ",
      `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
      reason,
      r.message ? `MEXC: ${r.message}` : "",
    ]);
    return false;
  }

  await notifyLines(userId, [
    "Koji — Snowball auto-open (MEXC)",
    "✅ 24h rule: ปิดโพซิชันแล้ว",
    `[${shortContractLabel(active.contractSymbol)}]/USDT (${active.side.toUpperCase()})`,
    reason,
  ]);
  return true;
}

export async function runSnowballAutoTrade24hGuardTick(nowMs: number): Promise<number> {
  if (!isBinanceIndicatorFapiEnabled()) return 0;

  const [map, state0] = await Promise.all([loadTradingViewMexcSettingsFullMap(), loadSnowballAutoTradeState()]);
  let state = state0;
  let closed = 0;
  let stateDirty = false;

  for (const [userId, perUser] of Object.entries(state)) {
    const actives = perUser.active ?? [];
    if (!actives.length) continue;

    const row = map[userId];
    if (!row?.mexcApiKey?.trim() || !row?.mexcSecret?.trim()) continue;
    const creds: MexcCredentials = { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() };

    for (const a of actives as SnowballAutoTradeActive[]) {
      if (a.guard24hEvaluated) continue;

      const ageMs = nowMs - a.openedAtMs;
      if (!(ageMs >= SEC_24H * 1000)) continue;

      if (a.side !== "long") {
        state = withSnowballGuard24hEvaluated(state, userId, a.contractSymbol, a.side);
        stateDirty = true;
        continue;
      }

      const mark = await getContractLastPricePublic(a.contractSymbol);
      if (mark == null || !(mark > 0)) continue;

      const entry = entryRefPrice(a);
      if (!(mark < entry)) {
        state = withSnowballGuard24hEvaluated(state, userId, a.contractSymbol, a.side);
        stateDirty = true;
        continue;
      }

      const openAcSec = Math.floor(a.openedAtMs / 1000);
      const windowEndSec = openAcSec + SEC_24H;
      const pack = await fetchBinanceUsdmKlinesRange(a.binanceSymbol, "15m", {
        startTimeMs: (openAcSec - KLINE_GRAN_SEC) * 1000,
        endTimeMs: nowMs,
        limit: 500,
      });

      const failCloseReason = "เหตุผล: ครบ 24 ชม. หลังเปิดแล้วยังต่ำกว่าจุดซื้อ และไม่เข้าเกณฑ์รันเทรน";

      if (!pack || pack.timeSec.length === 0) {
        if (await tryCloseUnderwater24h({ userId, creds, active: a, reason: `${failCloseReason} (ดึง kline ไม่สำเร็จ)` })) {
          closed += 1;
          state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
        } else {
          state = withSnowballGuard24hEvaluated(state, userId, a.contractSymbol, a.side);
        }
        stateDirty = true;
        continue;
      }

      const { timeSec, low, close } = pack;
      const iFirst = timeSec.findIndex((t) => t + KLINE_GRAN_SEC >= openAcSec);
      if (iFirst < 0) {
        if (await tryCloseUnderwater24h({ userId, creds, active: a, reason: `${failCloseReason} (ไม่มี kline ครอบคลุมช่วงเปิด)` })) {
          closed += 1;
          state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
        } else {
          state = withSnowballGuard24hEvaluated(state, userId, a.contractSymbol, a.side);
        }
        stateDirty = true;
        continue;
      }

      let iLast = iFirst;
      for (let i = iFirst; i < timeSec.length; i++) {
        if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndSec) iLast = i;
      }
      if (iLast < iFirst) {
        if (await tryCloseUnderwater24h({ userId, creds, active: a, reason: `${failCloseReason} (ช่วง 24h ไม่ครบแท่ง)` })) {
          closed += 1;
          state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
        } else {
          state = withSnowballGuard24hEvaluated(state, userId, a.contractSymbol, a.side);
        }
        stateDirty = true;
        continue;
      }

      let minLow = Infinity;
      for (let i = iFirst; i <= iLast; i++) {
        minLow = Math.min(minLow, low[i]!);
      }
      const maxDdPct = ((entry - minLow) / entry) * 100;
      const p24 = close[iLast]!;

      const runTrendOk = passesRunTrendGuardLikeStats({
        side: a.side,
        price24h: p24,
        signalBarLow: a.signalBarLow,
        maxDrawdownPct: Number.isFinite(maxDdPct) && maxDdPct >= 0 ? maxDdPct : 0,
        svpHoleYn: a.svpHoleYn,
      });

      if (runTrendOk) {
        state = withSnowballGuard24hEvaluated(state, userId, a.contractSymbol, a.side);
        stateDirty = true;
        continue;
      }

      if (await tryCloseUnderwater24h({ userId, creds, active: a, reason: failCloseReason })) {
        closed += 1;
        state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
      } else {
        state = withSnowballGuard24hEvaluated(state, userId, a.contractSymbol, a.side);
      }
      stateDirty = true;
    }
  }

  if (stateDirty) {
    await saveSnowballAutoTradeState(state);
  }
  return closed;
}
