import {
  autoOpenFollowUpAnchorSec,
  autoOpenFollowUpEligible,
  resolveAutoOpenEntryPrice,
} from "@/lib/autoOpenFollowUp";
import {
  applyAutoOpenTpStrategyHorizon,
  autoOpenNeedsTpStrategyRecompute,
  autoOpenTpStrategyCacheKey,
  computeAutoOpenTpStrategyAtHorizon,
  resolveAutoOpenTpSlPlanForRow,
} from "@/lib/autoOpenTpStrategy";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { computeAutoOpenMfe48h } from "@/lib/autoOpenStrategyOutcome";
import {
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
} from "@/lib/statsStrategyProfitClient";
import type { ViewerStatsTpSlPlan } from "@/lib/statsTpSlPlanForUser";
import {
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import { toBinanceUsdtPerpSymbol } from "./snowballManualSymbolClear";
import type { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";

const KLINE_15M_SEC = 900;
const SEC_48H = 48 * 3600;

function rowInDaysFilter(row: AutoOpenOrderLogRow, days?: number): boolean {
  if (typeof days !== "number" || days <= 0) return true;
  return row.atMs >= Date.now() - days * 24 * 3600 * 1000;
}

function rowMatchesSource(row: AutoOpenOrderLogRow, source?: AutoOpenOrderLogRow["source"]): boolean {
  return !source || row.source === source;
}

async function enrichRowTpStrategy(
  row: AutoOpenOrderLogRow,
  plan: ViewerStatsTpSlPlan,
  pack: BinanceKlinePack,
  nowMs: number,
  nowSec: number,
): Promise<boolean> {
  const entry = resolveAutoOpenEntryPrice(row);
  const side = row.side;
  if (entry == null || (side !== "long" && side !== "short")) return false;

  const ac = autoOpenFollowUpAnchorSec(row);
  const windowEndHorizonSec = Math.min(nowSec, ac + SEC_48H);
  const { timeSec, high, low } = pack;

  const iFirst = timeSec.findIndex((t) => t + KLINE_15M_SEC >= ac);
  if (iFirst < 0) return false;

  let iLastHorizon = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + KLINE_15M_SEC <= windowEndHorizonSec) iLastHorizon = i;
  }
  if (iLastHorizon < iFirst) return false;

  let touched = false;

  if (nowSec >= ac + SEC_48H && row.pct48h != null && Number.isFinite(row.pct48h)) {
    const mfe = computeAutoOpenMfe48h(
      side,
      entry,
      timeSec,
      high,
      low,
      KLINE_15M_SEC,
      iFirst,
      iLastHorizon,
    );
    if (mfe) {
      if (row.maxRoiPct !== mfe.maxRoiPct) {
        row.maxRoiPct = mfe.maxRoiPct;
        touched = true;
      }
      if (row.maxDrawdownPct !== mfe.maxDrawdownPct) {
        row.maxDrawdownPct = mfe.maxDrawdownPct;
        touched = true;
      }
      if (row.durationToMfeHours !== mfe.durationToMfeHours) {
        row.durationToMfeHours = mfe.durationToMfeHours;
        touched = true;
      }
    }
  }

  if (nowSec >= ac + 24 * 3600 && row.pct24h != null && Number.isFinite(row.pct24h)) {
    const computed24 = computeAutoOpenTpStrategyAtHorizon({
      row,
      side,
      entry,
      pack,
      ac,
      holdHours: STATS_STRATEGY_PROFIT_HOLD_24H,
      plan,
    });
    if (applyAutoOpenTpStrategyHorizon(row, STATS_STRATEGY_PROFIT_HOLD_24H, computed24, plan)) {
      touched = true;
    }
  }

  if (nowSec >= ac + SEC_48H && row.pct48h != null && Number.isFinite(row.pct48h)) {
    const computed48 = computeAutoOpenTpStrategyAtHorizon({
      row,
      side,
      entry,
      pack,
      ac,
      holdHours: STATS_STRATEGY_PROFIT_HOLD_48H,
      plan,
    });
    if (applyAutoOpenTpStrategyHorizon(row, STATS_STRATEGY_PROFIT_HOLD_48H, computed48, plan)) {
      touched = true;
    }
  }

  void nowMs;
  return touched;
}

/** จำลอง TP/SL @24h/@48h จาก kline 15m — ใช้ตอน GET / cron follow-up */
export async function enrichAutoOpenOrderLogRowsTpStrategy(
  rows: AutoOpenOrderLogRow[],
  settingsMap: Awaited<ReturnType<typeof loadTradingViewMexcSettingsFullMap>>,
  nowMs = Date.now(),
): Promise<number> {
  if (!isBinanceIndicatorFapiEnabled()) return 0;

  const nowSec = Math.floor(nowMs / 1000);
  const packByKey = new Map<string, BinanceKlinePack | null>();
  let dirty = 0;

  for (const row of rows) {
    if (!autoOpenFollowUpEligible(row)) continue;

    const plan = resolveAutoOpenTpSlPlanForRow(row, settingsMap);
    const ac = autoOpenFollowUpAnchorSec(row);
    if (!autoOpenNeedsTpStrategyRecompute(row, plan, nowSec, ac)) continue;

    const symbol = toBinanceUsdtPerpSymbol(row.binanceSymbol || row.contractSymbol);
    if (!symbol) continue;

    const packKey = `${symbol}:${ac}`;
    let pack = packByKey.get(packKey);
    if (pack === undefined) {
      try {
        pack = await fetchBinanceUsdmKlinesRange(symbol, "15m", {
          startTimeMs: ac * 1000,
          endTimeMs: nowMs,
          limit: 500,
        });
      } catch (e) {
        console.error("[autoOpenTpStrategyEnrich] klines", symbol, e);
        pack = null;
      }
      packByKey.set(packKey, pack);
    }
    if (!pack?.timeSec.length) continue;

    try {
      if (await enrichRowTpStrategy(row, plan, pack, nowMs, nowSec)) {
        dirty += 1;
      }
    } catch (e) {
      console.error("[autoOpenTpStrategyEnrich] row", row.id, row.binanceSymbol, e);
    }
  }

  return dirty;
}

export async function enrichAutoOpenOrderLogsTpStrategyForUser(
  userId: string,
  settingsMap: Awaited<ReturnType<typeof loadTradingViewMexcSettingsFullMap>>,
  opts?: { days?: number; source?: AutoOpenOrderLogRow["source"] },
  nowMs = Date.now(),
): Promise<number> {
  const { loadAutoOpenOrderLogState, saveAutoOpenOrderLogState } = await import(
    "./autoOpenOrderLogStore"
  );
  const state = await loadAutoOpenOrderLogState();
  const uid = userId.trim();
  const targets = state.rows.filter(
    (row) =>
      row.userId === uid &&
      rowInDaysFilter(row, opts?.days) &&
      rowMatchesSource(row, opts?.source),
  );
  const dirty = await enrichAutoOpenOrderLogRowsTpStrategy(targets, settingsMap, nowMs);
  if (dirty > 0) {
    await saveAutoOpenOrderLogState(state);
  }
  return dirty;
}

export function autoOpenStrategyHorizonStored(
  row: AutoOpenOrderLogRow,
  horizonHours: 24 | 48,
): { outcome: string; pct: number; exitReason: string } | null {
  const exitReason =
    horizonHours === 24 ? row.strategyExitReason24h : row.strategyExitReason;
  const pct = horizonHours === 24 ? row.strategyPct24h : row.strategyPct;
  const outcome = horizonHours === 24 ? row.strategyOutcome24h : row.strategyOutcome;
  if (
    exitReason == null ||
    pct == null ||
    !Number.isFinite(pct) ||
    outcome == null ||
    !String(outcome).trim()
  ) {
    return null;
  }
  return { outcome: String(outcome), pct, exitReason: String(exitReason) };
}

/** แถวที่ยังไม่มี exitReason = ยังไม่ผ่านจำลอง TP (รวมแถวเก่าที่ strategyPct = pct ดิบ) */
export function autoOpenRowNeedsTpStrategyDisplayEnrich(
  row: AutoOpenOrderLogRow,
  plan: ViewerStatsTpSlPlan,
  nowSec: number,
): boolean {
  const ac = autoOpenFollowUpAnchorSec(row);
  return autoOpenNeedsTpStrategyRecompute(row, plan, nowSec, ac);
}

export { autoOpenTpStrategyCacheKey };
