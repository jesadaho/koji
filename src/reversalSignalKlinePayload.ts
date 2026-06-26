import "server-only";

import type { BinanceIndicatorTf, BinanceKlinePack } from "./binanceIndicatorKline";
import type { CandleReversalModel, CandleReversalTradeSide } from "@/lib/candleReversalStatsClient";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";
import { emaLine } from "./indicatorMath";

export const REVERSAL_KLINE_AI_BARS_PER_TF = 48;

const TF_DURATION_SEC: Record<"15m" | "1h" | "4h", number> = {
  "15m": 15 * 60,
  "1h": 3600,
  "4h": 4 * 3600,
};

export type ReversalSignalKlineBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ema20: number | null;
  is_signal?: boolean;
};

export type ReversalSignalKlineTfPayload = {
  bars: ReversalSignalKlineBar[];
};

export type ReversalSignalContextPayload = {
  trend_gain_pct: number | null;
  trend_velocity_pct_per_h: number | null;
  ema20_4h_slope_pct_7d: number | null;
  atr_pct_4h: number | null;
  funding_rate_pct: number | null;
  vol_vs_sma: number | null;
  open_interest_usdt: number | null;
  open_interest_contracts: number | null;
  btc_ema20_4h_slope_pct_7d: number | null;
  btc_ema1d_slope_pct_7d: number | null;
  btc_d_ema20_4h_slope_pct_7d: number | null;
};

export type ReversalSignalKlineAiPayload = {
  symbol: string;
  signal_timeframe: "1H";
  trade_side: CandleReversalTradeSide;
  model: CandleReversalModel;
  signal_bar_open_utc: string;
  entry: number;
  retest: number;
  sl: number;
  klines: {
    "15m": ReversalSignalKlineTfPayload;
    "1h": ReversalSignalKlineTfPayload;
    "4h": ReversalSignalKlineTfPayload;
  };
  signal_context: ReversalSignalContextPayload;
};

function finiteNum(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

function roundPrice(v: number): number {
  if (v >= 1000) return Math.round(v * 100) / 100;
  if (v >= 1) return Math.round(v * 10000) / 10000;
  return Math.round(v * 1e8) / 1e8;
}

function roundVol(v: number): number {
  return Math.round(v * 100) / 100;
}

function isoUtcFromOpenSec(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

function lastClosedBarIndex(pack: BinanceKlinePack): number {
  return Math.max(0, pack.close.length - 2);
}

function findBarIndexAtOrBefore(pack: BinanceKlinePack, openSecMax: number): number {
  let best = -1;
  for (let i = 0; i < pack.timeSec.length; i++) {
    const t = pack.timeSec[i]!;
    if (t <= openSecMax) best = i;
    else break;
  }
  return best;
}

function sliceBarsFromPack(
  pack: BinanceKlinePack,
  endIdx: number,
  barCount: number,
  signalBarOpenSec: number | null,
  markSignalOn1h: boolean,
): ReversalSignalKlineBar[] {
  const ema20 = emaLine(pack.close, 20);
  const startIdx = Math.max(0, endIdx - barCount + 1);
  const bars: ReversalSignalKlineBar[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const ema = ema20[i];
    const bar: ReversalSignalKlineBar = {
      t: isoUtcFromOpenSec(pack.timeSec[i]!),
      o: roundPrice(pack.open[i]!),
      h: roundPrice(pack.high[i]!),
      l: roundPrice(pack.low[i]!),
      c: roundPrice(pack.close[i]!),
      v: roundVol(pack.volume[i]!),
      ema20: Number.isFinite(ema) ? roundPrice(ema as number) : null,
    };
    if (markSignalOn1h && signalBarOpenSec != null && pack.timeSec[i] === signalBarOpenSec) {
      bar.is_signal = true;
    }
    bars.push(bar);
  }
  return bars;
}

function endIndexForTf(
  tf: "15m" | "1h" | "4h",
  pack: BinanceKlinePack,
  signalBarOpenSec: number,
): number {
  if (tf === "1h") {
    for (let i = 0; i < pack.timeSec.length; i++) {
      if (pack.timeSec[i] === signalBarOpenSec) return i;
    }
    return findBarIndexAtOrBefore(pack, signalBarOpenSec);
  }
  const signalCloseSec = signalBarOpenSec + TF_DURATION_SEC["1h"];
  const idx = findBarIndexAtOrBefore(pack, signalCloseSec - 1);
  if (idx >= 0) return idx;
  return lastClosedBarIndex(pack);
}

export function buildReversalSignalKlineAiPayload(input: {
  symbol: string;
  tradeSide: CandleReversalTradeSide;
  model: CandleReversalModel;
  signalBarOpenSec: number;
  entry: number;
  retest: number;
  sl: number;
  pack15m: BinanceKlinePack;
  pack1h: BinanceKlinePack;
  pack4h: BinanceKlinePack;
  signalContext: {
    trendGainPct?: number | null;
    ageOfTrendHours?: number | null;
    ema20_4hSlopePct7d?: number | null;
    atrPct4h?: number | null;
    fundingRate?: number | null;
    signalVolVsSma?: number | null;
    openInterestUsdt?: number | null;
    openInterestContracts?: number | null;
    btcEma20_4hSlopePct7d?: number | null;
    btcEma1dSlopePct7d?: number | null;
    btcDomEma20_4hSlopePct7d?: number | null;
  };
}): ReversalSignalKlineAiPayload | null {
  const n = REVERSAL_KLINE_AI_BARS_PER_TF;
  const sigOpen = input.signalBarOpenSec;

  const end1h = endIndexForTf("1h", input.pack1h, sigOpen);
  if (end1h < 19) return null;

  const end15m = endIndexForTf("15m", input.pack15m, sigOpen);
  const end4h = endIndexForTf("4h", input.pack4h, sigOpen);
  if (end15m < 0 || end4h < 0) return null;

  const funding = input.signalContext.fundingRate;
  const fundingPct =
    funding != null && Number.isFinite(funding) ? Math.round(funding * 10000) / 100 : null;

  return {
    symbol: input.symbol.trim().toUpperCase(),
    signal_timeframe: "1H",
    trade_side: input.tradeSide,
    model: input.model,
    signal_bar_open_utc: isoUtcFromOpenSec(sigOpen),
    entry: roundPrice(input.entry),
    retest: roundPrice(input.retest),
    sl: roundPrice(input.sl),
    klines: {
      "15m": {
        bars: sliceBarsFromPack(input.pack15m, end15m, n, null, false),
      },
      "1h": {
        bars: sliceBarsFromPack(input.pack1h, end1h, n, sigOpen, true),
      },
      "4h": {
        bars: sliceBarsFromPack(input.pack4h, end4h, n, null, false),
      },
    },
    signal_context: {
      trend_gain_pct: finiteNum(input.signalContext.trendGainPct),
      trend_velocity_pct_per_h: computePumpCycleTrendVelocity(
        input.signalContext.trendGainPct,
        input.signalContext.ageOfTrendHours,
      ),
      ema20_4h_slope_pct_7d: finiteNum(input.signalContext.ema20_4hSlopePct7d),
      atr_pct_4h: finiteNum(input.signalContext.atrPct4h),
      funding_rate_pct: fundingPct,
      vol_vs_sma: finiteNum(input.signalContext.signalVolVsSma),
      open_interest_usdt: finiteNum(input.signalContext.openInterestUsdt),
      open_interest_contracts: finiteNum(input.signalContext.openInterestContracts),
      btc_ema20_4h_slope_pct_7d: finiteNum(input.signalContext.btcEma20_4hSlopePct7d),
      btc_ema1d_slope_pct_7d: finiteNum(input.signalContext.btcEma1dSlopePct7d),
      btc_d_ema20_4h_slope_pct_7d: finiteNum(input.signalContext.btcDomEma20_4hSlopePct7d),
    },
  };
}

export function reversalKlineAiFetchLimit(): number {
  return 60;
}

/** ช่วงเวลา ms สำหรับดึง kline รอบแท่งสัญญาณ (backfill แถวเก่า) */
export function reversalKlineAiFetchRangeMs(
  tf: "15m" | "1h" | "4h",
  signalBarOpenSec: number,
): { startTimeMs: number; endTimeMs: number } {
  const barsNeeded = REVERSAL_KLINE_AI_BARS_PER_TF + 4;
  const barSec = TF_DURATION_SEC[tf];
  const sigOpen = signalBarOpenSec;

  if (tf === "1h") {
    return {
      startTimeMs: (sigOpen - barsNeeded * barSec) * 1000,
      endTimeMs: (sigOpen + 3 * barSec) * 1000,
    };
  }

  const signalCloseSec = sigOpen + TF_DURATION_SEC["1h"];
  const anchorSec = signalCloseSec - 1;

  return {
    startTimeMs: (anchorSec - barsNeeded * barSec) * 1000,
    endTimeMs: (anchorSec + 3 * barSec) * 1000,
  };
}

export const REVERSAL_KLINE_AI_TFS: BinanceIndicatorTf[] = ["15m", "1h", "4h"];
