/**
 * Snowball closed-bar detection for historical backtest.
 * Mirrors sendSnowballLong / sendSnowballBear in publicIndicatorFeed.ts (4h two-bar inline).
 */

import type { BinanceKlinePack, SnowballBinanceTf } from "./binanceIndicatorKline";
import { emaLine, rsiWilder, smaLine, stochRsiLine } from "./indicatorMath";
import {
  evaluateSnowballLongBreakout1hConfirm,
  snowballLongBreakout1hSwingLookback,
} from "./snowballLongBreakoutConfirm";
import {
  resolveSnowballLongFinalGrade,
  snowballIsGradeF,
  snowballTfBarDurationSec,
  type SnowballLongStructureTier,
} from "./snowballLongBreakoutGrade";
import type { AppendSnowballStatsInput } from "./snowballStatsStore";
import {
  classifySnowballTrendGrade,
  snowballTrendGradeActionPlan,
  snowballTrendGradeToDisplay,
} from "./snowballTrendGrade";
import {
  calculateTrendMomentumMetrics,
  isSustainedBuyingPressure,
  snowballGradeBMomentumFailGradeDOn1hConfirmPass,
  snowballGradeBNearMissVolumeEnabled,
  snowballGradeBRequiresSustainedMomentum,
  snowballGradeFOnMomentumAnd1hConfirmFail,
  trendMomentumStatsFields,
  type TrendMomentumMetrics,
} from "./snowballTrendMomentumMetrics";
import {
  evaluateSnowballTwoBarInlineLong,
  snowballTwoBarInlinePullbackMaxFrac,
} from "./snowballTwoBarInline";
import { computeSnowballSignalLenPercentile } from "./statsLenPercentile";
import { resolveSnowballStatsTradeSide } from "./snowballStatsTradeSide";
import { snowballVolatilitySnapshotAt } from "./snowballVolatilityMetrics";
import { buildSnowballLongConfirmGateStepsForStats } from "./snowballStatsGateSteps";
import { snowballStatsConfirmVolFieldsFrom1hEval } from "@/lib/snowballStatsClient";
import {
  evaluateSnowballWaveGate,
  snowballBinanceTf,
  snowballBodyToRangeFilterEnabled,
  snowballConfirmVolMinRatio as pubConfirmVolMinRatio,
  snowballMaxHigh1hBetweenClosedBars,
  snowballSignalBarBodyRangePassed,
  snowballSymbolDedupeBlocks,
  snowballTwoBarInlineModeEnabled,
  snowballWaveEmaResetPeriod,
  snowballWaveGateEnabled,
  snowballWaveRsiPeriod,
} from "./publicIndicatorFeed";

export type SnowballBacktestFeedState = {
  lastFiredBarSec: Record<string, number>;
  lastAlertPrice: Record<string, number>;
};

export type SnowballDetectTrendGradeInput = {
  ema1hSlopePct7d: number | null;
  ema4hSlopePct7d: number | null;
  ema1dSlopePct7d: number | null;
  btcEma4hSlopePct7d: number | null;
  btcEma1dSlopePct7d: number | null;
  psar4hTrend: "up" | "down" | null;
  greenDaysBeforeSignal: number | null;
};

export type SnowballDetectHit = {
  alertSide: "long" | "bear";
  feedKey: string;
  signalBarOpenSec: number;
  entryPrice: number;
  skipFiredKeyUpdate: boolean;
  statsInput: Omit<
    AppendSnowballStatsInput,
    "symbol" | "alertedAtIso" | "alertedAtMs" | "greenDaysBeforeSignal" | "greenDaysBeforeSignalBkk"
  >;
};

export type DetectSnowballAtClosedBarOpts = {
  symbol: string;
  iClosed: number;
  pack4h: BinanceKlinePack;
  pack1h: BinanceKlinePack | null;
  pack15mMomentum?: BinanceKlinePack | null;
  state: SnowballBacktestFeedState;
  trendGradeInput?: SnowballDetectTrendGradeInput;
};

export type DetectSnowballAtClosedBarResult = {
  long: SnowballDetectHit | null;
  bear: SnowballDetectHit | null;
};

// --- env config (aligned with publicIndicatorFeed.ts) ---

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

function cfgSwingLookback(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK);
  return Number.isFinite(v) && v >= 5 && v <= 400 ? Math.floor(v) : 48;
}

function cfgSwingGradeLookback(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_GRADE_LOOKBACK);
  return Number.isFinite(v) && v >= 5 && v <= 400 ? Math.floor(v) : 200;
}

function cfgSwingExcludeRecent(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS);
  return Number.isFinite(v) && v >= 0 && v <= 10 ? Math.floor(v) : 3;
}

function cfgVolSmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_SMA);
  return Number.isFinite(v) && v >= 3 && v <= 100 ? Math.floor(v) : 20;
}

function cfgVolMult(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_MULT);
  return Number.isFinite(v) && v >= 1 && v <= 10 ? v : 2.5;
}

function cfgStochRsiPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_RSI_PERIOD);
  return Number.isFinite(v) && v >= 2 && v <= 50 ? Math.floor(v) : 14;
}

function cfgStochLength(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_LENGTH);
  return Number.isFinite(v) && v >= 2 && v <= 50 ? Math.floor(v) : 14;
}

function cfgStochKSmooth(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_K_SMOOTH);
  return Number.isFinite(v) && v >= 1 && v <= 14 ? Math.floor(v) : 1;
}

function cfgOversoldFloor(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_STOCH_OVERSOLD_MIN);
  return Number.isFinite(v) && v >= 0 && v < 50 ? v : 10;
}

function cfgResistanceEmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_RESISTANCE_EMA);
  return Number.isFinite(v) && v >= 2 && v <= 200 ? Math.floor(v) : 20;
}

function cfgShortRequireSvpHd(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_SHORT_REQUIRE_SVP_HD", false);
}

function cfgSvpInnerLb(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SVP_HD_INNER_LOOKBACK);
  return Number.isFinite(v) && v >= 5 && v <= 120 ? Math.floor(v) : 24;
}

function cfgLongVahOn(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_BREAK", true);
}

function cfgLongVahLb(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_VAH_LOOKBACK);
  return Number.isFinite(v) && v >= 5 && v <= 120 ? Math.floor(v) : 20;
}

function cfgLongRequireInnerHvn(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_REQUIRE_ABOVE_INNER_HVN", true);
}

function cfgLongSlopeEmaOn(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_EMA_SLOPE_ENABLED", true);
}

function cfgLongSlopeEmaP(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_EMA_SLOPE_PERIOD);
  return Number.isFinite(v) && v >= 2 && v <= 200 ? Math.floor(v) : 20;
}

function cfgLongSlopeMinUpBars(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_EMA_SLOPE_MIN_UP_BARS);
  return Number.isFinite(v) && v >= 1 && v <= 5 ? Math.floor(v) : 2;
}

function cfgLongEma2On(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_EMA2_SLOPE_ENABLED", true);
}

function cfgLongEma2P(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_EMA2_SLOPE_PERIOD);
  return Number.isFinite(v) && v >= 2 && v <= 200 ? Math.floor(v) : 50;
}

function cfgLongBreakout1hExcludeRecent(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_EXCLUDE_RECENT);
  if (Number.isFinite(v) && v >= 3 && v <= 4) return Math.floor(v);
  const ex = cfgSwingExcludeRecent();
  return ex >= 3 && ex <= 4 ? ex : 3;
}

function snowballVolNearMissMultiplier(strictMult: number): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_NEAR_MISS_MULT);
  if (Number.isFinite(v) && v >= 1 && v < strictMult) return v;
  return 2;
}

function snowballVolumeOk(relax: boolean, vol: number, volSma: number, mult: number): boolean {
  if (!Number.isFinite(vol) || vol <= 0) return false;
  if (relax) return true;
  return Number.isFinite(volSma) && vol > volSma * mult;
}

function snowballVolumeNearMissOnly(
  relax: boolean,
  vol: number,
  volSma: number,
  strictMult: number,
  nearMult: number,
): boolean {
  if (relax || !snowballGradeBNearMissVolumeEnabled()) return false;
  if (snowballVolumeOk(false, vol, volSma, strictMult)) return false;
  if (!Number.isFinite(vol) || vol <= 0 || !Number.isFinite(volSma) || volSma <= 0) return false;
  return vol > volSma * nearMult;
}

function maxHighPriorWindow(high: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - Math.max(0, excludeRecentTrailing);
  const start = Math.max(0, end - lookback + 1);
  if (end < start) return NaN;
  let m = -Infinity;
  for (let j = start; j <= end; j++) {
    const x = high[j]!;
    if (Number.isFinite(x) && x > m) m = x;
  }
  return Number.isFinite(m) ? m : NaN;
}

function minLowPriorWindow(low: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - Math.max(0, excludeRecentTrailing);
  const start = Math.max(0, end - lookback + 1);
  if (end < start) return NaN;
  let m = Infinity;
  for (let j = start; j <= end; j++) {
    const x = low[j]!;
    if (Number.isFinite(x) && x < m) m = x;
  }
  return Number.isFinite(m) ? m : NaN;
}

function snowballLongSwingHighBreak(
  high: number[],
  close: number[],
  iSig: number,
  lookback: number,
  excludeRecent: number,
): boolean {
  const priorMaxHigh = maxHighPriorWindow(high, iSig, lookback, excludeRecent);
  if (!Number.isFinite(priorMaxHigh)) return false;
  const clE = close[iSig]!;
  return clE > priorMaxHigh;
}

function highVolumeNodeBarRange(
  vol: number[],
  high: number[],
  low: number[],
  i: number,
  lookback: number,
): { high: number; low: number } | null {
  const start = Math.max(0, i - lookback);
  const end = i - 1;
  if (end < start) return null;
  let bestJ = start;
  let bestV = -Infinity;
  for (let j = start; j <= end; j++) {
    const v = vol[j]!;
    if (v > bestV && Number.isFinite(v)) {
      bestV = v;
      bestJ = j;
    }
  }
  const H = high[bestJ];
  const L = low[bestJ];
  return Number.isFinite(H!) && Number.isFinite(L!) ? { high: H!, low: L! } : null;
}

function highVolumeNodeBarHigh(vol: number[], high: number[], low: number[], i: number, lookback: number): number | null {
  return highVolumeNodeBarRange(vol, high, low, i, lookback)?.high ?? null;
}

function highVolumeNodeBarLow(vol: number[], high: number[], low: number[], i: number, lookback: number): number | null {
  return highVolumeNodeBarRange(vol, high, low, i, lookback)?.low ?? null;
}

function stochSeries(close: number[], rsiP: number, stochLen: number, kSmooth: number): number[] {
  const raw = stochRsiLine(close, rsiP, stochLen);
  if (kSmooth <= 1) return raw;
  return smaLine(raw, kSmooth);
}

/** Mirror updatePublicFeedFiredKey / updatePublicFeedWaveGatePrice — in-memory only for backtest */
export function applySnowballBacktestFiredKey(
  state: SnowballBacktestFeedState,
  key: string,
  barTimeSec: number,
  alertPrice?: number,
  opts?: { skipFiredBarSec?: boolean },
): void {
  if (!opts?.skipFiredBarSec) {
    state.lastFiredBarSec[key] = barTimeSec;
  }
  if (typeof alertPrice === "number" && Number.isFinite(alertPrice) && alertPrice > 0) {
    if (!state.lastAlertPrice) state.lastAlertPrice = {};
    state.lastAlertPrice[key] = alertPrice;
  }
}

function detectSnowballLongClosed(
  symbol: string,
  iEval: number,
  pack: BinanceKlinePack,
  pack1h: BinanceKlinePack | null,
  pack15m: BinanceKlinePack | null,
  state: SnowballBacktestFeedState,
  trendGradeInput: SnowballDetectTrendGradeInput | undefined,
  cfg: ReturnType<typeof buildDetectConfig>,
): SnowballDetectHit | null {
  if (iEval < 1) return null;

  const snowTf = cfg.snowTf;
  const { open: o15, close: c15, high: h15, low: l15, volume: v15, timeSec: t15 } = pack;
  const longBreakout1h = false;
  const twoBarInline = snowTf === "4h" && iEval >= 1;
  const iConf = iEval;
  const iSig = twoBarInline ? iEval - 1 : iEval;
  const iPrev = iSig - 1;
  const iPrev2 = iSig - 2;

  const vsE = cfg.volSmaArr[iSig];
  const vE = v15[iSig];
  const volNearMult = snowballVolNearMissMultiplier(cfg.volMult);
  const volStrictOk = snowballVolumeOk(false, vE!, vsE!, cfg.volMult);
  const volNearMissOnly = snowballVolumeNearMissOnly(false, vE!, vsE!, cfg.volMult, volNearMult);
  const clE = c15[iSig];
  const hiE = h15[iSig];
  const hiPrev = h15[iPrev];
  const clPrev = c15[iPrev];

  if (snowTf !== "4h" && !volStrictOk && !volNearMissOnly) return null;
  if (!Number.isFinite(clE!) || !Number.isFinite(hiE!) || !Number.isFinite(hiPrev!) || !Number.isFinite(clPrev!)) {
    return null;
  }

  const swing48 = snowballLongSwingHighBreak(h15, c15, iSig, cfg.swingLb, cfg.swingEx);
  const swing200 = snowballLongSwingHighBreak(h15, c15, iSig, cfg.swingGradeLb, cfg.swingEx);
  const vahH = cfg.longVahOn ? highVolumeNodeBarHigh(v15, h15, l15, iSig, cfg.vahLb) : null;
  const vahCross =
    cfg.longVahOn &&
    vahH != null &&
    Number.isFinite(vahH) &&
    clE! > vahH &&
    clPrev! <= vahH;
  const vahOk = Boolean(vahCross);
  if (!swing48 && !vahOk && !swing200) return null;

  if (cfg.longRequireInnerHvn) {
    const innerHvn = highVolumeNodeBarRange(v15, h15, l15, iSig, cfg.svpInnerLb);
    if (!innerHvn || !Number.isFinite(innerHvn.high) || clE! <= innerHvn.high) return null;
  }

  if (cfg.longSlopeEmaOn) {
    const eNow = cfg.emaLongSlopeArr[iSig];
    const ePrev = cfg.emaLongSlopeArr[iPrev];
    const ePrev2 = iPrev2 >= 0 ? cfg.emaLongSlopeArr[iPrev2] : NaN;
    if (typeof eNow !== "number" || typeof ePrev !== "number" || !Number.isFinite(eNow) || !Number.isFinite(ePrev) || eNow <= ePrev) {
      return null;
    }
    if (cfg.longSlopeMinUpBars >= 2) {
      if (typeof ePrev2 !== "number" || !Number.isFinite(ePrev2) || ePrev <= ePrev2) return null;
    }
  }

  if (cfg.longEma2On && cfg.emaLongSlope2Arr) {
    const a = cfg.emaLongSlope2Arr[iSig];
    const b = cfg.emaLongSlope2Arr[iPrev];
    const c = iPrev2 >= 0 ? cfg.emaLongSlope2Arr[iPrev2] : undefined;
    if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b) || a <= b) {
      return null;
    }
    if (cfg.longSlopeMinUpBars >= 2) {
      if (typeof c !== "number" || !Number.isFinite(c) || b <= c) return null;
    }
  }

  if (!twoBarInline && !longBreakout1h && snowballBodyToRangeFilterEnabled()) {
    if (!snowballSignalBarBodyRangePassed("long", iSig, o15, h15, l15, c15)) return null;
  }

  const breakout1hEval =
    !longBreakout1h && pack1h?.timeSec?.length
      ? evaluateSnowballLongBreakout1hConfirm(
          pack1h,
          snowballLongBreakout1hSwingLookback(),
          cfgLongBreakout1hExcludeRecent(),
        )
      : null;

  let twoBarEval = null;
  let twoBarInlinePassed = false;
  if (twoBarInline) {
    twoBarEval = evaluateSnowballTwoBarInlineLong({
      open: o15,
      close: c15,
      high: h15,
      low: l15,
      volume: v15,
      timeSec: t15,
      iSig,
      iConf,
      snowTf,
      pack1h,
    });
    twoBarInlinePassed = twoBarEval.ok;
    // สอดคล้อง live — two-bar ไม่ผ่านยังแจ้งได้ (grade จาก trend ไม่ block)
  }

  const signalBarOpenSec = t15[iSig]!;
  if (typeof signalBarOpenSec !== "number" || !Number.isFinite(signalBarOpenSec)) return null;

  const key = `${symbol}|SNOWBALL|${snowTf}|BULL`;
  if (snowballSymbolDedupeBlocks(state, key, signalBarOpenSec)) return null;

  const iWave = longBreakout1h ? iEval : twoBarInline ? iConf : iEval;
  if (cfg.waveGateOn) {
    const wave = evaluateSnowballWaveGate(
      "long",
      c15,
      h15,
      l15,
      t15,
      iWave,
      state.lastFiredBarSec[key],
      state.lastAlertPrice?.[key],
      cfg.waveEmaArr,
      cfg.waveRsiArr,
    );
    if (wave.blocked) return null;
  }

  const trendMomentum = calculateTrendMomentumMetrics(pack1h, { pack15m });
  const sustainedBuyingPressure = isSustainedBuyingPressure(trendMomentum);
  const gradeResolution = resolveSnowballLongFinalGrade({
    snowTf,
    swing48,
    swing200,
    vahOk,
    twoBarEval,
    trendMomentum,
    signalVolVsSma: typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 ? vE! / vsE : null,
    twoBarInlinePassed,
    longBreakout1h,
    breakout1hEval,
    momentumRequired: snowballGradeBRequiresSustainedMomentum(),
    momentumOk: sustainedBuyingPressure,
    gradeDPlusOnMomentumFail: snowballGradeBMomentumFailGradeDOn1hConfirmPass(),
    gradeFOnMomentumAndConfirmFail: snowballGradeFOnMomentumAnd1hConfirmFail(),
    volumeStrictOk: volStrictOk,
    volumeNearMissOnly: volNearMissOnly,
    gradeDPlusNearMissVolumeEnabled: snowballGradeBNearMissVolumeEnabled(),
    trendGradeInput: {
      alertSide: "long",
      ema1hSlopePct7d: trendGradeInput?.ema1hSlopePct7d ?? null,
      ema4hSlopePct7d: trendGradeInput?.ema4hSlopePct7d ?? null,
      ema1dSlopePct7d: trendGradeInput?.ema1dSlopePct7d ?? null,
      btcEma4hSlopePct7d: trendGradeInput?.btcEma4hSlopePct7d ?? null,
      btcEma1dSlopePct7d: trendGradeInput?.btcEma1dSlopePct7d ?? null,
      psar4hTrend: trendGradeInput?.psar4hTrend ?? null,
      signalBarTf: snowTf,
      signalVolVsSma:
        typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 ? vE! / vsE : null,
      greenDaysBeforeSignal: trendGradeInput?.greenDaysBeforeSignal ?? null,
    },
  });

  const longBreakoutGrade = gradeResolution.grade;
  const longDisplayGrade = gradeResolution.displayGrade;
  const longGradeDangerous = gradeResolution.gradeDangerous;
  const entryClosePx = twoBarInline ? c15[iConf]! : clE!;
  const trig = swing48 && vahOk ? "both" : swing48 ? "swing_hh" : "vah_break";
  const longSignalLow = l15[iSig];
  const longSignalHigh = h15[iSig];
  const volSnap = snowballVolatilitySnapshotAt(h15, l15, c15, o15, iSig);
  const lenSnap = computeSnowballSignalLenPercentile(pack, iSig);
  const longConfirmGateSteps = buildSnowballLongConfirmGateStepsForStats(
    snowTf,
    twoBarInline,
    pack1h,
    twoBarInline
      ? { open: o15, close: c15, high: h15, low: l15, volume: v15, timeSec: t15, iSig, iConf, snowTf, pack1h }
      : null,
    cfg.swingEx,
  );

  const statsTradeSide = resolveSnowballStatsTradeSide({
    alertSide: "long",
    qualityTier: longBreakoutGrade,
    signalOpen: o15[iSig]!,
    signalClose: clE!,
    signalHigh: longSignalHigh,
    signalLow: longSignalLow,
    signalVolume: vE!,
    confirmOpen: twoBarInline ? o15[iConf]! : null,
    confirmClose: twoBarInline ? c15[iConf]! : null,
    confirmVolume: twoBarInline ? v15[iConf]! : null,
  });

  return {
    alertSide: "long",
    feedKey: key,
    signalBarOpenSec,
    entryPrice: entryClosePx,
    skipFiredKeyUpdate: false,
    statsInput: {
      side: statsTradeSide,
      alertSide: "long",
      signalBarOpenSec,
      signalBarLow: typeof longSignalLow === "number" && Number.isFinite(longSignalLow) ? longSignalLow : null,
      signalBarTf: snowTf,
      entryPrice: entryClosePx,
      intrabar: false,
      triggerKind: trig,
      vol: vE!,
      volSma: vsE!,
      qualityTier: longBreakoutGrade,
      alertQualityTier: longBreakoutGrade,
      displayGrade: longDisplayGrade,
      ...(gradeResolution.structureTier ? { structureTier: gradeResolution.structureTier as SnowballLongStructureTier } : {}),
      swing200Ok: swing200,
      ...(gradeResolution.actionPlan ? { actionPlan: gradeResolution.actionPlan } : {}),
      momentumDowngrade: false,
      momentumFailGradeF: snowballIsGradeF(longBreakoutGrade),
      ...(longGradeDangerous ? { gradeDangerous: true } : {}),
      atr100: volSnap.atr100,
      maxUpperWick100: volSnap.maxUpperWick100,
      rangeScore: volSnap.rangeScore,
      wickScore: volSnap.wickScore,
      barRangePctPrev: volSnap.barRangePctPrev,
      barRangePctSignal: volSnap.barRangePctSignal,
      barRangePct2Sum: volSnap.barRangePct2Sum,
      rangeRankInLookback: lenSnap?.rangeRankInLookback ?? null,
      lenLookbackBars: lenSnap?.lookbackBars ?? null,
      lenPercentilePct: lenSnap?.lenPercentilePct ?? null,
      signalVolVsSma: typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 ? vE! / vsE : null,
      volStrictOk,
      volNearMissOnly,
      volMultAtAlert: cfg.volMult,
      volNearMultAtAlert: volNearMult,
      ...(longConfirmGateSteps.length > 0 ? { confirmGateSteps: longConfirmGateSteps } : {}),
      ...trendMomentumStatsFields(trendMomentum),
      ...snowballStatsConfirmVolFieldsFrom1hEval(gradeResolution.confirm1hEval ?? breakout1hEval),
    },
  };
}

function detectSnowballBearClosed(
  symbol: string,
  iEval: number,
  pack: BinanceKlinePack,
  pack1h: BinanceKlinePack | null,
  state: SnowballBacktestFeedState,
  trendGradeInput: SnowballDetectTrendGradeInput | undefined,
  cfg: ReturnType<typeof buildDetectConfig>,
): SnowballDetectHit | null {
  if (iEval < 1) return null;

  const snowTf = cfg.snowTf;
  const { open: o15, close: c15, high: h15, low: l15, volume: v15, timeSec: t15 } = pack;
  const twoBarInline = snowballTwoBarInlineModeEnabled() && iEval >= 2;
  const iConf = iEval;
  const iSig = twoBarInline ? iEval - 1 : iEval;

  const vsE = cfg.volSmaArr[iSig];
  const vE = v15[iSig];
  const clE = c15[iSig];
  const loE = l15[iSig];
  const loPrev = l15[iSig - 1];
  if (
    !snowballVolumeOk(false, vE!, vsE!, cfg.volMult) ||
    !Number.isFinite(clE!) ||
    !Number.isFinite(loE!) ||
    !Number.isFinite(loPrev!)
  ) {
    return null;
  }

  const priorMinLow = minLowPriorWindow(l15, iSig, cfg.swingLb, cfg.swingEx);
  const classicBear = Number.isFinite(priorMinLow) && clE! < priorMinLow;
  if (!classicBear) return null;
  if (cfg.stochLastClosed <= cfg.osMin) return null;

  const svpHdLowGuess = highVolumeNodeBarLow(v15, h15, l15, iSig, cfg.svpInnerLb);
  const svpHdOkBear =
    typeof svpHdLowGuess === "number" && Number.isFinite(svpHdLowGuess) && clE! < svpHdLowGuess;
  if (cfg.shortNeedSvpHd && !svpHdOkBear) return null;

  const emaResistance = cfg.emaResArr[iSig];
  if (!Number.isFinite(emaResistance)) return null;

  const signalBarOpenSec = t15[iSig]!;
  if (typeof signalBarOpenSec !== "number" || !Number.isFinite(signalBarOpenSec)) return null;

  if (!twoBarInline && snowballBodyToRangeFilterEnabled()) {
    if (!snowballSignalBarBodyRangePassed("bear", iSig, o15, h15, l15, c15)) return null;
  }

  if (twoBarInline) {
    const tfDur = snowballTfBarDurationSec(snowTf);
    const sigOpen = t15[iSig]!;
    const confEnd = t15[iConf]! + tfDur;
    const sigH = h15[iSig]!;
    const sigL = l15[iSig]!;
    const sigC = c15[iSig]!;
    const confC = c15[iConf]!;
    const sigV = v15[iSig]!;
    const confV = v15[iConf]!;
    if (
      !Number.isFinite(confC) ||
      !Number.isFinite(confV) ||
      !Number.isFinite(sigH) ||
      !Number.isFinite(sigL) ||
      !Number.isFinite(sigC) ||
      !Number.isFinite(sigV)
    ) {
      return null;
    }
    const range = sigH - sigL;
    if (!Number.isFinite(range) || range <= 0) return null;
    const maxPull = snowballTwoBarInlinePullbackMaxFrac();
    if (confC > sigC + maxPull * range) return null;
    const volRatioNeed = pubConfirmVolMinRatio();
    if (sigV <= 0 || confV / sigV < volRatioNeed) return null;
    if (!pack1h?.timeSec?.length) return null;
    const maxH1h = snowballMaxHigh1hBetweenClosedBars(pack1h.timeSec, pack1h.high, sigOpen, confEnd);
    if (maxH1h == null || maxH1h > sigH) return null;
  }

  const key = `${symbol}|SNOWBALL|${snowTf}|BEAR`;
  if (snowballSymbolDedupeBlocks(state, key, signalBarOpenSec)) return null;

  const iWave = twoBarInline ? iConf : iEval;
  if (cfg.waveGateOn) {
    const wave = evaluateSnowballWaveGate(
      "bear",
      c15,
      h15,
      l15,
      t15,
      iWave,
      state.lastFiredBarSec[key],
      state.lastAlertPrice?.[key],
      cfg.waveEmaArr,
      cfg.waveRsiArr,
    );
    if (wave.blocked) return null;
  }

  const bearTrendGrade = classifySnowballTrendGrade({
    alertSide: "bear",
    ema1hSlopePct7d: trendGradeInput?.ema1hSlopePct7d ?? null,
    ema4hSlopePct7d: trendGradeInput?.ema4hSlopePct7d ?? null,
    ema1dSlopePct7d: trendGradeInput?.ema1dSlopePct7d ?? null,
    btcEma4hSlopePct7d: trendGradeInput?.btcEma4hSlopePct7d ?? null,
    btcEma1dSlopePct7d: trendGradeInput?.btcEma1dSlopePct7d ?? null,
    psar4hTrend: trendGradeInput?.psar4hTrend ?? null,
    signalBarTf: snowTf,
    signalVolVsSma:
      typeof vsE === "number" && Number.isFinite(vsE) && vsE > 0 ? vE! / vsE : null,
  });

  const entryPx = twoBarInline ? c15[iConf]! : clE!;
  const bearSignalHigh = h15[iSig];
  const bearSignalLow = l15[iSig];
  const volSnap = snowballVolatilitySnapshotAt(h15, l15, c15, o15, iSig);
  const lenSnap = computeSnowballSignalLenPercentile(pack, iSig);
  const trendMomentum = calculateTrendMomentumMetrics(pack1h, { pack15m: null });

  const statsTradeSide = resolveSnowballStatsTradeSide({
    alertSide: "bear",
    qualityTier: bearTrendGrade,
    signalOpen: o15[iSig]!,
    signalClose: clE!,
    signalHigh: bearSignalHigh,
    signalLow: bearSignalLow,
    signalVolume: vE!,
    confirmOpen: twoBarInline ? o15[iConf]! : null,
    confirmClose: twoBarInline ? c15[iConf]! : null,
    confirmVolume: twoBarInline ? v15[iConf]! : null,
  });

  return {
    alertSide: "bear",
    feedKey: key,
    signalBarOpenSec,
    entryPrice: entryPx,
    skipFiredKeyUpdate: false,
    statsInput: {
      side: statsTradeSide,
      alertSide: "bear",
      signalBarOpenSec,
      signalBarTf: snowTf,
      entryPrice: entryPx,
      intrabar: false,
      triggerKind: "swing_ll",
      vol: vE!,
      volSma: vsE!,
      qualityTier: bearTrendGrade,
      alertQualityTier: bearTrendGrade,
      displayGrade: snowballTrendGradeToDisplay(bearTrendGrade),
      actionPlan: snowballTrendGradeActionPlan(bearTrendGrade),
      atr100: volSnap.atr100,
      maxUpperWick100: volSnap.maxUpperWick100,
      rangeScore: volSnap.rangeScore,
      wickScore: volSnap.wickScore,
      barRangePctPrev: volSnap.barRangePctPrev,
      barRangePctSignal: volSnap.barRangePctSignal,
      barRangePct2Sum: volSnap.barRangePct2Sum,
      rangeRankInLookback: lenSnap?.rangeRankInLookback ?? null,
      lenLookbackBars: lenSnap?.lookbackBars ?? null,
      lenPercentilePct: lenSnap?.lenPercentilePct ?? null,
      ...trendMomentumStatsFields(trendMomentum),
    },
  };
}

type DetectSeriesConfig = {
  snowTf: SnowballBinanceTf;
  swingLb: number;
  swingGradeLb: number;
  swingEx: number;
  volMult: number;
  longVahOn: boolean;
  vahLb: number;
  longRequireInnerHvn: boolean;
  svpInnerLb: number;
  longSlopeEmaOn: boolean;
  longSlopeMinUpBars: number;
  longEma2On: boolean;
  shortNeedSvpHd: boolean;
  osMin: number;
  waveGateOn: boolean;
  volSmaArr: number[];
  emaResArr: number[];
  emaLongSlopeArr: number[];
  emaLongSlope2Arr: number[] | null;
  waveEmaArr: number[];
  waveRsiArr: number[];
  stochLastClosed: number;
};

function buildDetectConfig(pack: BinanceKlinePack): DetectSeriesConfig {
  const snowTf = snowballBinanceTf();
  const volP = cfgVolSmaPeriod();
  const volMult = cfgVolMult();
  const rsiP = cfgStochRsiPeriod();
  const stLen = cfgStochLength();
  const kSm = cfgStochKSmooth();
  const emaResP = cfgResistanceEmaPeriod();
  const longSlopeEmaP = cfgLongSlopeEmaP();
  const longEma2P = cfgLongEma2P();
  const waveGateOn = snowballWaveGateEnabled();
  const waveEmaP = snowballWaveEmaResetPeriod();
  const waveRsiPeriod = snowballWaveRsiPeriod();

  const { close: c15 } = pack;
  const volSmaArr = smaLine(pack.volume, volP);
  const emaResArr = emaLine(c15, emaResP);
  const emaLongSlopeArr = cfgLongSlopeEmaOn() ? emaLine(c15, longSlopeEmaP) : [];
  const emaLongSlope2Arr = cfgLongEma2On() ? emaLine(c15, longEma2P) : null;
  const stochArr = stochSeries(c15, rsiP, stLen, kSm);
  const iClosed = c15.length - 1;
  const stochLastClosed = iClosed >= 0 && typeof stochArr[iClosed] === "number" ? stochArr[iClosed]! : NaN;
  const waveEmaArr = waveGateOn ? emaLine(c15, waveEmaP) : [];
  const waveRsiArr =
    waveGateOn && c15.length >= waveRsiPeriod + 3 ? rsiWilder(c15, waveRsiPeriod) : [];

  return {
    snowTf,
    swingLb: cfgSwingLookback(),
    swingGradeLb: cfgSwingGradeLookback(),
    swingEx: cfgSwingExcludeRecent(),
    volMult,
    longVahOn: cfgLongVahOn(),
    vahLb: cfgLongVahLb(),
    longRequireInnerHvn: cfgLongRequireInnerHvn(),
    svpInnerLb: cfgSvpInnerLb(),
    longSlopeEmaOn: cfgLongSlopeEmaOn(),
    longSlopeMinUpBars: cfgLongSlopeMinUpBars(),
    longEma2On: cfgLongEma2On(),
    shortNeedSvpHd: cfgShortRequireSvpHd(),
    osMin: cfgOversoldFloor(),
    waveGateOn,
    volSmaArr,
    emaResArr,
    emaLongSlopeArr,
    emaLongSlope2Arr,
    waveEmaArr,
    waveRsiArr,
    stochLastClosed,
  };
}

/** Run LONG + BEAR closed-bar detect at iClosed — mirrors live 4h two-bar inline path */
export function detectSnowballAtClosedBar(opts: DetectSnowballAtClosedBarOpts): DetectSnowballAtClosedBarResult {
  const { symbol, iClosed, pack4h, pack1h, pack15mMomentum, state, trendGradeInput } = opts;
  if (iClosed < 1 || pack4h.close.length < 2) {
    return { long: null, bear: null };
  }

  const cfg = buildDetectConfig(pack4h);
  const sym = symbol.trim().toUpperCase();

  const long = detectSnowballLongClosed(
    sym,
    iClosed,
    pack4h,
    pack1h,
    pack15mMomentum ?? null,
    state,
    trendGradeInput,
    cfg,
  );
  const bear = detectSnowballBearClosed(sym, iClosed, pack4h, pack1h, state, trendGradeInput, cfg);

  return { long, bear };
}
