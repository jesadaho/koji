/**
 * Reversal TP strategy — SHORT · EMA4H + ROI @ 12h / 24h · ถือต่อถึง 48h
 * 12h: ROI < 0 AND EMA4H > 0 → CLOSE
 * 24h: ROI < 3% AND EMA4H > 0 → CLOSE
 * 24h: ROI > 3% AND EMA4H < 0 → HOLD + SL@entry
 * 24h: อื่นๆ → HOLD
 * 24–48h: แตะ SL@entry → EXIT ~0%
 * 48h: FORCE CLOSE
 */

import {
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
  capStrategyProfitPctForLeverage,
  statsStrategyExitReasonForHorizon,
  statsStrategyProfitFinalizedAtHorizon,
  statsStrategyProfitPctForHorizon,
  type StatsStrategyProfitHorizon,
  type StatsStrategyProfitRowSlice,
} from "@/lib/statsStrategyProfitClient";
import {
  breakevenSlTriggered,
  DEFAULT_SL_ENTRY_OFFSET_PCT,
  slBreakevenRemainderLossPct,
} from "@/lib/tpSlBreakevenPlan";
import {
  adversePctInBar,
  type StatsTpSlExitReason,
} from "@/lib/tpSlStrategySimulate";

export const REVERSAL_TP_STRATEGY_24H_ROI_CLOSE_MAX_EXCLUSIVE = 3;
export const REVERSAL_TP_STRATEGY_24H_ROI_HOLD_SL_MIN_EXCLUSIVE = 3;

export const REVERSAL_TP_STRATEGY_SUMMARY =
  "12h ROI<0+EMA4H>0→ปิด · 24h ROI<3%+EMA4H>0→ปิด · 24h ROI>3%+EMA4H<0→ถือ+SL@entry · 24–48h SL@entry→0% · 48h force";

export const REVERSAL_TP_STRATEGY_CACHE_VERSION = "revRoi3v1";

export type ReversalTpStrategyProfitBand = "win" | "flat_profit" | "flat_loss" | "loss";

export function reversalTpStrategyCacheKey(holdHours: StatsStrategyProfitHorizon): string {
  return `${REVERSAL_TP_STRATEGY_CACHE_VERSION}:${holdHours}h`;
}

/** cache กำไรกลยุทธ์ฝั่ง Long (fade) — ตาราง Reversal Short 1H · ทิศแนะนำ 🟢 Long */
export function reversalTpStrategyCacheKeyLong(holdHours: StatsStrategyProfitHorizon): string {
  return `${REVERSAL_TP_STRATEGY_CACHE_VERSION}:${holdHours}h:long`;
}

export function reversalStatsLongHorizonPct(shortPct: number): number {
  return -shortPct;
}

export type ReversalLongStrategyProfitRowSlice = StatsStrategyProfitRowSlice & {
  strategyProfitPctLong?: number | null;
  strategyProfitPctLong24h?: number | null;
  strategyExitReasonLong?: StatsTpSlExitReason | null;
  strategyExitReasonLong24h?: StatsTpSlExitReason | null;
};

function reversalStatsStrategyProfitPctLongForHorizon(
  row: Pick<ReversalLongStrategyProfitRowSlice, "strategyProfitPctLong" | "strategyProfitPctLong24h">,
  holdHours: StatsStrategyProfitHorizon,
): number | null | undefined {
  return holdHours === STATS_STRATEGY_PROFIT_HOLD_24H
    ? row.strategyProfitPctLong24h
    : row.strategyProfitPctLong;
}

function reversalStatsStrategyExitReasonLongForHorizon(
  row: Pick<ReversalLongStrategyProfitRowSlice, "strategyExitReasonLong" | "strategyExitReasonLong24h">,
  holdHours: StatsStrategyProfitHorizon,
): StatsTpSlExitReason | null | undefined {
  return holdHours === STATS_STRATEGY_PROFIT_HOLD_24H
    ? row.strategyExitReasonLong24h
    : row.strategyExitReasonLong;
}

/** กำไรกลยุทธ์ Reversal ฝั่ง Long (fade) — ใช้ผลจำลอง EMA4H/BE บน ROI ฝั่ง Long */
export function reversalStatsStrategyProfitLongResolvedForHorizon(
  row: ReversalLongStrategyProfitRowSlice,
  holdHours: StatsStrategyProfitHorizon,
  leverage?: number | null,
): { profitPct: number; exitReason: StatsTpSlExitReason } | null {
  if (!statsStrategyProfitFinalizedAtHorizon(row, holdHours)) return null;

  const raw = reversalStatsStrategyProfitPctLongForHorizon(row, holdHours);
  const exitReason = reversalStatsStrategyExitReasonLongForHorizon(row, holdHours);

  if (raw != null && Number.isFinite(raw)) {
    return {
      profitPct: capStrategyProfitPctForLeverage(raw, leverage),
      exitReason:
        exitReason ?? (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H ? "time_24h" : "time_48h"),
    };
  }

  return null;
}

export function reversalTpStrategyProfitBand(pct: number): ReversalTpStrategyProfitBand {
  const { winMinPct, lossMaxPct } = STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND;
  if (pct >= winMinPct) return "win";
  if (pct <= lossMaxPct) return "loss";
  if (pct > 0) return "flat_profit";
  return "flat_loss";
}

export function reversalTpStrategyEma4hPositive(ema4hSlopePct7d?: number | null): boolean | null {
  const v = ema4hSlopePct7d;
  if (v == null || !Number.isFinite(v)) return null;
  return v > 0;
}

export function reversalTpStrategyEma4hNegative(ema4hSlopePct7d?: number | null): boolean | null {
  const v = ema4hSlopePct7d;
  if (v == null || !Number.isFinite(v)) return null;
  return v < 0;
}

function indexRangeThrough(
  timeSec: number[],
  barDurSec: number,
  iFirst: number,
  windowEndSec: number,
): number {
  let iLast = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + barDurSec <= windowEndSec) iLast = i;
  }
  return iLast;
}

function beTriggeredInRange(
  side: "long" | "short",
  entry: number,
  slOffset: number,
  high: number[],
  low: number[],
  iFrom: number,
  iTo: number,
): boolean {
  if (iFrom > iTo) return false;
  for (let i = iFrom; i <= iTo; i++) {
    if (breakevenSlTriggered(side, entry, slOffset, high[i]!, low[i]!)) return true;
  }
  return false;
}

function isolatedLiquidationPricePct(leverage: number): number {
  return 100 / leverage;
}

/** ตัดสินใจ @ 24h — null = ไม่มีข้อมูล EMA4H สำหรับเงื่อนไขที่ต้องใช้ */
export function reversalTpStrategy24hShouldClose(input: {
  roiPct: number;
  ema4hSlopePct7d?: number | null;
}): boolean {
  const emaPos = reversalTpStrategyEma4hPositive(input.ema4hSlopePct7d);
  return (
    emaPos === true &&
    Number.isFinite(input.roiPct) &&
    input.roiPct < REVERSAL_TP_STRATEGY_24H_ROI_CLOSE_MAX_EXCLUSIVE
  );
}

export function reversalTpStrategy24hShouldArmSlAtEntry(input: {
  roiPct: number;
  ema4hSlopePct7d?: number | null;
}): boolean {
  const emaNeg = reversalTpStrategyEma4hNegative(input.ema4hSlopePct7d);
  return (
    emaNeg === true &&
    Number.isFinite(input.roiPct) &&
    input.roiPct > REVERSAL_TP_STRATEGY_24H_ROI_HOLD_SL_MIN_EXCLUSIVE
  );
}

export type ReversalTpStrategy24hAction = "hold" | "close";

/** @deprecated ใช้ reversalTpStrategy24hShouldClose / ShouldArmSlAtEntry */
export function reversalTpStrategy24hAction(input: {
  pct24h: number;
  ema4hSlopePct7d?: number | null;
  beArmedBefore24h?: boolean;
}): ReversalTpStrategy24hAction | null {
  if (reversalTpStrategy24hShouldClose({ roiPct: input.pct24h, ema4hSlopePct7d: input.ema4hSlopePct7d })) {
    return "close";
  }
  return "hold";
}

export function simulateReversalTpStrategyProfit(input: {
  side: "long" | "short";
  entry: number;
  high: number[];
  low: number[];
  timeSec?: number[];
  /** anchor close (วินาที) — ใช้หา checkpoint 12h/24h บนแท่ง 15m */
  anchorCloseSec?: number;
  iFirst: number;
  iLast: number;
  pct12h: number;
  pct24h: number;
  pct48h: number;
  ema4hSlopePct7d?: number | null;
  maxHorizonHours?: StatsStrategyProfitHorizon;
  slEntryOffsetPct?: number;
  leverage?: number | null;
}): { profitPct: number; exitReason: StatsTpSlExitReason } | null {
  const entry = input.entry;
  if (!(entry > 0) || input.iFirst < 0 || input.iLast < input.iFirst) return null;
  if (
    !Number.isFinite(input.pct12h) ||
    !Number.isFinite(input.pct24h) ||
    !Number.isFinite(input.pct48h)
  ) {
    return null;
  }

  const maxHorizon = input.maxHorizonHours ?? STATS_STRATEGY_PROFIT_HOLD_48H;
  const slOffset = input.slEntryOffsetPct ?? DEFAULT_SL_ENTRY_OFFSET_PCT;
  const liqPct =
    input.leverage != null && Number.isFinite(input.leverage) && input.leverage > 0
      ? isolatedLiquidationPricePct(input.leverage)
      : null;

  const barDurSec = 900;
  const ac =
    input.anchorCloseSec != null && Number.isFinite(input.anchorCloseSec) && input.anchorCloseSec > 0
      ? input.anchorCloseSec
      : input.timeSec && input.timeSec[input.iFirst] != null
        ? input.timeSec[input.iFirst]! - barDurSec
        : 0;
  const i12Last =
    input.timeSec && ac > 0
      ? indexRangeThrough(input.timeSec, barDurSec, input.iFirst, ac + 12 * 3600)
      : input.iLast;
  const i24Last =
    input.timeSec && ac > 0
      ? indexRangeThrough(input.timeSec, barDurSec, input.iFirst, ac + 24 * 3600)
      : input.iLast;
  const horizonLast =
    maxHorizon === STATS_STRATEGY_PROFIT_HOLD_24H
      ? Math.min(i24Last, input.iLast)
      : input.iLast;
  const i12End = Math.min(i12Last, horizonLast);
  const i24End = Math.min(i24Last, horizonLast);

  let beArmed = false;
  let scanFrom = input.iFirst;

  const checkLiquidation = (i: number): boolean => {
    if (liqPct == null || beArmed) return false;
    const adv = adversePctInBar(input.side, entry, input.high[i]!, input.low[i]!);
    return Number.isFinite(adv) && adv > liqPct;
  };

  const tryBeExit = (iTo: number): { profitPct: number; exitReason: StatsTpSlExitReason } | null => {
    if (!beArmed || scanFrom > iTo) return null;
    if (!beTriggeredInRange(input.side, entry, slOffset, input.high, input.low, scanFrom, iTo)) {
      return null;
    }
    return {
      profitPct: slBreakevenRemainderLossPct(slOffset),
      exitReason: "tp1_be",
    };
  };

  // Phase 1: ถึง 12h — liquidation เท่านั้น (ยังไม่มี SL@entry)
  for (let i = input.iFirst; i <= i12End; i++) {
    if (checkLiquidation(i)) {
      return { profitPct: -liqPct!, exitReason: "liquidated" };
    }
  }

  if (
    reversalTpStrategyLive12hShouldClose({
      dropPct: input.pct12h,
      ema4hSlopePct7d: input.ema4hSlopePct7d,
    })
  ) {
    return { profitPct: input.pct12h, exitReason: "time_12h" };
  }

  // Phase 2: หลัง 12h → 24h — liquidation เท่านั้น
  for (let i = scanFrom; i <= i24End; i++) {
    if (checkLiquidation(i)) {
      return { profitPct: -liqPct!, exitReason: "liquidated" };
    }
  }

  if (maxHorizon === STATS_STRATEGY_PROFIT_HOLD_24H || horizonLast >= i24End) {
    if (
      reversalTpStrategy24hShouldClose({
        roiPct: input.pct24h,
        ema4hSlopePct7d: input.ema4hSlopePct7d,
      })
    ) {
      return { profitPct: input.pct24h, exitReason: "time_24h" };
    }
    if (
      reversalTpStrategy24hShouldArmSlAtEntry({
        roiPct: input.pct24h,
        ema4hSlopePct7d: input.ema4hSlopePct7d,
      })
    ) {
      beArmed = true;
      scanFrom = Math.max(scanFrom, i24End + 1);
    }

    if (maxHorizon === STATS_STRATEGY_PROFIT_HOLD_24H) {
      return {
        profitPct: input.pct24h,
        exitReason: "time_24h",
      };
    }
  }

  // Phase 3: 24h → 48h
  for (let i = scanFrom; i <= horizonLast; i++) {
    if (checkLiquidation(i)) {
      return { profitPct: -liqPct!, exitReason: "liquidated" };
    }
  }

  const beExitFinal = tryBeExit(horizonLast);
  if (beExitFinal) return beExitFinal;

  return {
    profitPct: input.pct48h,
    exitReason: "time_48h",
  };
}

/** กำไรกลยุทธ์ Reversal — ใช้ผลจำลอง EMA4H/BE โดยตรง (ไม่ทับด้วย Snowball ADV-cap) */
export function reversalStatsStrategyProfitResolvedForHorizon(
  row: StatsStrategyProfitRowSlice,
  holdHours: StatsStrategyProfitHorizon,
  leverage?: number | null,
): { profitPct: number; exitReason: StatsTpSlExitReason } | null {
  if (!statsStrategyProfitFinalizedAtHorizon(row, holdHours)) return null;

  const raw = statsStrategyProfitPctForHorizon(row, holdHours);
  const exitReason = statsStrategyExitReasonForHorizon(row, holdHours);

  if (raw != null && Number.isFinite(raw)) {
    return {
      profitPct: capStrategyProfitPctForLeverage(raw, leverage),
      exitReason:
        exitReason ?? (holdHours === STATS_STRATEGY_PROFIT_HOLD_24H ? "time_24h" : "time_48h"),
    };
  }

  return null;
}

export function reversalTpStrategyLive12hShouldClose(input: {
  dropPct: number;
  ema4hSlopePct7d?: number | null;
}): boolean {
  const emaPos = reversalTpStrategyEma4hPositive(input.ema4hSlopePct7d);
  return emaPos === true && Number.isFinite(input.dropPct) && input.dropPct < 0;
}

export function reversalTpStrategyLive24hShouldClose(input: {
  dropPct: number;
  ema4hSlopePct7d?: number | null;
}): boolean {
  return reversalTpStrategy24hShouldClose({
    roiPct: input.dropPct,
    ema4hSlopePct7d: input.ema4hSlopePct7d,
  });
}

export function reversalTpStrategyLive24hShouldArmBe(input: {
  dropPct: number;
  ema4hSlopePct7d?: number | null;
}): boolean {
  return reversalTpStrategy24hShouldArmSlAtEntry({
    roiPct: input.dropPct,
    ema4hSlopePct7d: input.ema4hSlopePct7d,
  });
}
