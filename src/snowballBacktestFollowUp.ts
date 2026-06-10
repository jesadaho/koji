import { SNOWBALL_STATS_WIN_MIN_PCT_DEFAULT } from "@/lib/snowballStatsClient";
import {
  computeFollowUpMaxAdversePct,
  firstFollowUpKlineIndexAfterAnchorClose,
} from "@/lib/statsFollowUpAdverse";
import { DEFAULT_STATS_TPSL_PLAN, favorablePctInBar } from "@/lib/tpSlStrategySimulate";
import {
  computeStatsStrategyProfitFromBars,
  statsStrategyProfitCacheKey,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
} from "@/lib/statsStrategyProfitClient";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import type { SnowballStatsOutcome, SnowballStatsRow } from "./snowballStatsStore";
import { snowballStatsAnchorCloseSec } from "@/lib/snowballStatsClient";

const KLINE_GRAN_SEC = 900;
const SEC_48H = 48 * 3600;
const SEC_24H = 24 * 3600;

function pctVsEntry(side: "long" | "short", entry: number, price: number): number {
  if (side === "long") return ((price - entry) / entry) * 100;
  return ((entry - price) / entry) * 100;
}

function klineIndexLastThrough(
  timeSec: number[],
  barDurSec: number,
  iFirst: number,
  windowEndSec: number,
): number {
  let iLast = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + barDurSec <= windowEndSec) iLast = i;
  }
  while (iLast >= iFirst && timeSec[iLast]! + barDurSec > windowEndSec) {
    iLast--;
  }
  return iLast;
}

function outcomeWinMinPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_WIN_MIN_PCT);
  if (Number.isFinite(v) && v > 0 && v < 100) return v;
  return SNOWBALL_STATS_WIN_MIN_PCT_DEFAULT;
}

function rrRewardSource(): "close_48h" | "mfe" {
  const v = process.env.SNOWBALL_STATS_RR_REWARD_SOURCE?.trim().toLowerCase();
  if (v === "mfe") return "mfe";
  return "close_48h";
}

function formatRr(rewardPct: number, riskPct: number): string {
  if (!Number.isFinite(riskPct) || riskPct <= 1e-9) return "N/A";
  if (!Number.isFinite(rewardPct) || rewardPct <= 0) return "N/A";
  const r = rewardPct / riskPct;
  if (!Number.isFinite(r) || r <= 0) return "N/A";
  return `1:${r.toFixed(2)}`;
}

function applySnowballOutcomeFromPct48h(row: SnowballStatsRow): boolean {
  const pct48 = row.pct48h;
  if (pct48 == null || !Number.isFinite(pct48)) return false;

  const winMin = outcomeWinMinPct();
  let nextOutcome: SnowballStatsOutcome;
  if (pct48 >= winMin) {
    nextOutcome = "win_trend";
  } else if (pct48 <= -winMin) {
    nextOutcome = "loss";
  } else {
    nextOutcome = "flat";
  }

  const reward = rrRewardSource() === "mfe" ? (row.maxRoiPct ?? 0) : pct48;
  const nextRr = formatRr(reward, row.maxDrawdownPct ?? 0);

  let dirty = false;
  if (row.outcome !== nextOutcome) {
    row.outcome = nextOutcome;
    dirty = true;
  }
  if (row.resultRr !== nextRr) {
    row.resultRr = nextRr;
    dirty = true;
  }
  return dirty;
}

function pickHorizonClose(
  timeSec: number[],
  close: number[],
  iFirst: number,
  iLast: number,
  nowSec: number,
  horizonEndSec: number,
  entry: number,
  side: "long" | "short",
): { price: number; pct: number } | null {
  const limitSec = Math.min(horizonEndSec, nowSec);
  let best = -1;
  for (let i = iFirst; i <= iLast; i++) {
    const barClose = timeSec[i]! + KLINE_GRAN_SEC;
    if (barClose <= limitSec) best = i;
  }
  if (best < 0) return null;
  const price = close[best]!;
  return { price, pct: pctVsEntry(side, entry, price) };
}

function applySnowballStrategyProfitAtHorizon(
  row: SnowballStatsRow,
  high: number[],
  low: number[],
  iFirst: number,
  iLast: number,
  holdHours: typeof STATS_STRATEGY_PROFIT_HOLD_24H | typeof STATS_STRATEGY_PROFIT_HOLD_48H,
  pctAtHorizon: number,
): boolean {
  const sim = computeStatsStrategyProfitFromBars({
    side: row.side,
    entry: row.entryPrice,
    high,
    low,
    iFirst,
    iLast,
    holdHours,
    pctAtHorizon,
    plan: DEFAULT_STATS_TPSL_PLAN,
  });
  if (!sim) return false;
  const key = statsStrategyProfitCacheKey(DEFAULT_STATS_TPSL_PLAN, holdHours);
  const prev = row.strategyProfitByPlan?.[key];
  if (!prev || prev.profitPct !== sim.profitPct || prev.exitReason !== sim.exitReason) {
    row.strategyProfitByPlan = {
      ...row.strategyProfitByPlan,
      [key]: { profitPct: sim.profitPct, exitReason: sim.exitReason },
    };
    return true;
  }
  return false;
}

/**
 * จำลอง follow-up 48h จาก 15m pack ที่โหลดมาแล้ว — ตั้ง nowSec = anchorClose + 48h
 */
export function simulateSnowballStatsFollowUp(row: SnowballStatsRow, pack15m: BinanceKlinePack): void {
  const entry = row.entryPrice;
  if (!Number.isFinite(entry) || entry <= 0) return;

  const ac = snowballStatsAnchorCloseSec(row);
  const nowSec = ac + SEC_48H;

  const { timeSec, high, low, close } = pack15m;
  if (timeSec.length === 0) return;

  if (row.signalBarLow == null || !Number.isFinite(row.signalBarLow) || row.signalBarLow <= 0) {
    const iSignal = timeSec.findIndex((t) => t === row.signalBarOpenSec);
    if (iSignal >= 0) {
      const lo = low[iSignal];
      if (typeof lo === "number" && Number.isFinite(lo) && lo > 0) row.signalBarLow = lo;
    }
  }

  const iFirst = timeSec.findIndex((t) => t + KLINE_GRAN_SEC >= ac);
  if (iFirst < 0) return;

  let iLastHorizon = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + KLINE_GRAN_SEC <= nowSec) iLastHorizon = i;
  }
  while (iLastHorizon >= iFirst && timeSec[iLastHorizon]! + KLINE_GRAN_SEC > nowSec) {
    iLastHorizon--;
  }
  if (iLastHorizon < iFirst) return;

  const iFollowFirst = firstFollowUpKlineIndexAfterAnchorClose(timeSec, ac);

  const adverse =
    iFollowFirst >= 0 && iLastHorizon >= iFollowFirst
      ? computeFollowUpMaxAdversePct(high, low, iFollowFirst, iLastHorizon, entry, row.side)
      : null;
  if (adverse != null) row.followUpMaxAdversePct = adverse;

  const h4 = pickHorizonClose(timeSec, close, iFirst, iLastHorizon, nowSec, ac + 4 * 3600, entry, row.side);
  const h12 = pickHorizonClose(timeSec, close, iFirst, iLastHorizon, nowSec, ac + 12 * 3600, entry, row.side);
  const h24 = pickHorizonClose(timeSec, close, iFirst, iLastHorizon, nowSec, ac + SEC_24H, entry, row.side);
  let h48 = pickHorizonClose(timeSec, close, iFirst, iLastHorizon, nowSec, ac + SEC_48H, entry, row.side);

  if (h4) {
    row.price4h = h4.price;
    row.pct4h = h4.pct;
  }
  if (h12) {
    row.price12h = h12.price;
    row.pct12h = h12.pct;
  }
  if (h24) {
    row.price24h = h24.price;
    row.pct24h = h24.pct;
  }
  if (h48) {
    row.price48h = h48.price;
    row.pct48h = h48.pct;
  } else if (iLastHorizon >= iFirst) {
    const p = close[iLastHorizon]!;
    row.price48h = p;
    row.pct48h = pctVsEntry(row.side, entry, p);
  }

  if (row.pct24h != null) {
    const iLast24 = klineIndexLastThrough(timeSec, KLINE_GRAN_SEC, iFirst, ac + SEC_24H);
    if (iFollowFirst >= 0 && iLast24 >= iFollowFirst) {
      applySnowballStrategyProfitAtHorizon(
        row,
        high,
        low,
        iFollowFirst,
        iLast24,
        STATS_STRATEGY_PROFIT_HOLD_24H,
        row.pct24h,
      );
    }
  }

  if (row.pct48h != null) {
    const iLast48 = klineIndexLastThrough(timeSec, KLINE_GRAN_SEC, iFirst, ac + SEC_48H);
    if (iFollowFirst >= 0 && iLast48 >= iFollowFirst) {
      applySnowballStrategyProfitAtHorizon(
        row,
        high,
        low,
        iFollowFirst,
        iLast48,
        STATS_STRATEGY_PROFIT_HOLD_48H,
        row.pct48h,
      );
    }
  }

  let iLastMfe = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + KLINE_GRAN_SEC <= nowSec) iLastMfe = i;
  }
  while (iLastMfe >= iFirst && timeSec[iLastMfe]! + KLINE_GRAN_SEC > nowSec) {
    iLastMfe--;
  }
  if (iLastMfe < iFirst) return;

  const iMfeFirst = iFollowFirst >= 0 ? Math.max(iFollowFirst, iFirst) : iFirst;
  if (iMfeFirst > iLastMfe) return;

  let maxRoi = -Infinity;
  let mfeIdx = iMfeFirst;
  for (let i = iMfeFirst; i <= iLastMfe; i++) {
    const roi = favorablePctInBar(row.side, entry, high[i]!, low[i]!);
    if (Number.isFinite(roi) && roi > maxRoi) {
      maxRoi = roi;
      mfeIdx = i;
    }
  }

  if (Number.isFinite(maxRoi)) {
    let minLow = Infinity;
    let maxHigh = -Infinity;
    for (let i = iMfeFirst; i <= mfeIdx; i++) {
      minLow = Math.min(minLow, low[i]!);
      maxHigh = Math.max(maxHigh, high[i]!);
    }
    let maxDd = 0;
    if (row.side === "long") {
      maxDd = ((entry - minLow) / entry) * 100;
    } else {
      maxDd = ((maxHigh - entry) / entry) * 100;
    }
    if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;

    row.maxRoiPct = maxRoi;
    row.durationToMfeHours = (timeSec[mfeIdx]! + KLINE_GRAN_SEC - ac) / 3600;
    row.maxDrawdownPct = maxDd;

    if (row.pct48h != null && row.price48h != null) {
      applySnowballOutcomeFromPct48h(row);
    }
  }
}
