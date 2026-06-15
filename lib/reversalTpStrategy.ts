/**
 * Reversal TP strategy — EMA4H + profit band @ 12h / 24h · ถือต่อถึง 48h
 * 12h: กำไร > 3% → SL บังทุน
 * 24h ชนะ (≥2%) + EMA4H < 0 → ถือต่อ + SL บังทุน
 * 24h กำไรนิดหน่อย (0–2%) + EMA4H > 0 → ปิดทันที
 * 24h ติดลบนิดหน่อย (−2%–0) + EMA4H > 0 → ปิดทันที (ถ้ายังไม่มี SL@entry จาก 12h)
 */

import {
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
  type StatsStrategyProfitHorizon,
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

export const REVERSAL_TP_STRATEGY_12H_BE_MIN_PCT = 3;

export const REVERSAL_TP_STRATEGY_SUMMARY =
  "12h กำไร>3%→SL@entry · 24h ชนะ+EMA4H<0→ถือ+SL@entry · 24h กำไรนิด+EMA4H>0→ปิด · 24h ติดลบนิด+EMA4H>0→ปิด(ถ้าไม่มี SL@12h) · 48h";

export const REVERSAL_TP_STRATEGY_CACHE_VERSION = "revEma4h1";

export type ReversalTpStrategyProfitBand = "win" | "flat_profit" | "flat_loss" | "loss";

export function reversalTpStrategyCacheKey(holdHours: StatsStrategyProfitHorizon): string {
  return `${REVERSAL_TP_STRATEGY_CACHE_VERSION}:${holdHours}h`;
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

export type ReversalTpStrategy24hAction = "hold" | "close";

/** ตัดสินใจ @ 24h — null = ไม่มีข้อมูล EMA4H */
export function reversalTpStrategy24hAction(input: {
  pct24h: number;
  ema4hSlopePct7d?: number | null;
  beArmedBefore24h?: boolean;
}): ReversalTpStrategy24hAction | null {
  const band = reversalTpStrategyProfitBand(input.pct24h);
  const emaPos = reversalTpStrategyEma4hPositive(input.ema4hSlopePct7d);
  const emaNeg = reversalTpStrategyEma4hNegative(input.ema4hSlopePct7d);

  if (band === "win" && emaNeg === true) return "hold";
  if (band === "flat_profit" && emaPos === true) return "close";
  if (band === "flat_loss" && emaPos === true) {
    return input.beArmedBefore24h === true ? "hold" : "close";
  }
  return "hold";
}

export function simulateReversalTpStrategyProfit(input: {
  side: "long" | "short";
  entry: number;
  high: number[];
  low: number[];
  timeSec?: number[];
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
    input.timeSec && input.timeSec[input.iFirst] != null
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

  let beArmed = false;
  let scanFrom = input.iFirst;

  const checkLiquidation = (i: number): boolean => {
    if (liqPct == null || beArmed) return false;
    const adv = adversePctInBar(input.side, entry, input.high[i]!, input.low[i]!);
    return Number.isFinite(adv) && adv > liqPct;
  };

  const tryBeExit = (iTo: number): { profitPct: number; exitReason: StatsTpSlExitReason } | null => {
    if (!beArmed) return null;
    if (!beTriggeredInRange(input.side, entry, slOffset, input.high, input.low, scanFrom, iTo)) {
      return null;
    }
    return {
      profitPct: slBreakevenRemainderLossPct(slOffset),
      exitReason: "tp1_be",
    };
  };

  for (let i = input.iFirst; i <= Math.min(i12Last, horizonLast); i++) {
    if (checkLiquidation(i)) {
      return { profitPct: -liqPct!, exitReason: "liquidated" };
    }
  }

  if (input.pct12h > REVERSAL_TP_STRATEGY_12H_BE_MIN_PCT) {
    beArmed = true;
  }

  if (i12Last >= scanFrom) {
    const beExit = tryBeExit(Math.min(i12Last, horizonLast));
    if (beExit) return beExit;
    scanFrom = Math.min(i12Last, horizonLast) + 1;
  }

  if (maxHorizon === STATS_STRATEGY_PROFIT_HOLD_24H || horizonLast >= i24Last) {
    for (let i = scanFrom; i <= Math.min(i24Last, horizonLast); i++) {
      if (checkLiquidation(i)) {
        return { profitPct: -liqPct!, exitReason: "liquidated" };
      }
    }

    const action24 = reversalTpStrategy24hAction({
      pct24h: input.pct24h,
      ema4hSlopePct7d: input.ema4hSlopePct7d,
      beArmedBefore24h: beArmed,
    });

    if (action24 === "close") {
      return { profitPct: input.pct24h, exitReason: "time_24h" };
    }
    if (action24 === "hold" && reversalTpStrategyProfitBand(input.pct24h) === "win") {
      beArmed = true;
    }

    if (i24Last >= scanFrom) {
      const beExit = tryBeExit(Math.min(i24Last, horizonLast));
      if (beExit) return beExit;
      scanFrom = Math.min(i24Last, horizonLast) + 1;
    }

    if (maxHorizon === STATS_STRATEGY_PROFIT_HOLD_24H) {
      const pctEnd = input.pct24h;
      return {
        profitPct: pctEnd,
        exitReason: "time_24h",
      };
    }
  }

  for (let i = scanFrom; i <= horizonLast; i++) {
    if (checkLiquidation(i)) {
      return { profitPct: -liqPct!, exitReason: "liquidated" };
    }
  }

  const beExitFinal = tryBeExit(horizonLast);
  if (beExitFinal) return beExitFinal;

  const pctEnd = maxHorizon === STATS_STRATEGY_PROFIT_HOLD_24H ? input.pct24h : input.pct48h;
  return {
    profitPct: pctEnd,
    exitReason: maxHorizon === STATS_STRATEGY_PROFIT_HOLD_24H ? "time_24h" : "time_48h",
  };
}

export function reversalTpStrategyLive12hShouldArmBe(dropPct: number): boolean {
  return Number.isFinite(dropPct) && dropPct > REVERSAL_TP_STRATEGY_12H_BE_MIN_PCT;
}

export function reversalTpStrategyLive24hShouldClose(input: {
  dropPct: number;
  ema4hSlopePct7d?: number | null;
  beArmed: boolean;
}): boolean {
  const action = reversalTpStrategy24hAction({
    pct24h: input.dropPct,
    ema4hSlopePct7d: input.ema4hSlopePct7d,
    beArmedBefore24h: input.beArmed,
  });
  return action === "close";
}

export function reversalTpStrategyLive24hShouldArmBe(input: {
  dropPct: number;
  ema4hSlopePct7d?: number | null;
}): boolean {
  const band = reversalTpStrategyProfitBand(input.dropPct);
  const emaNeg = reversalTpStrategyEma4hNegative(input.ema4hSlopePct7d);
  return band === "win" && emaNeg === true;
}
