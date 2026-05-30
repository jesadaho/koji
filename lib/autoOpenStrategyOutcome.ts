import type { AutoOpenOrderLogRow, AutoOpenSource } from "@/lib/autoOpenOrderLogClient";

/** ผลตามกติกา stats / strategy หลังครบ 48h (ไม่ใช่ success/skipped ของการสั่ง) */
export type AutoOpenStrategyOutcome =
  | "win_quick_tp30"
  | "win_trend"
  | "win"
  | "loss"
  | "flat";

export type AutoOpenMfe48h = {
  maxRoiPct: number;
  maxDrawdownPct: number;
  durationToMfeHours: number;
};

function snowballOutcomeWinMinPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_WIN_MIN_PCT);
  if (Number.isFinite(v) && v > 0 && v < 100) return v;
  return 3;
}

function snowballOutcomeQuickTp30MinPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_QUICK_TP30_MIN_PCT);
  if (Number.isFinite(v) && v > 0 && v < 200) return v;
  return 30;
}

function reversalOutcomeWinMinPct(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_WIN_MIN_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return 2;
}

function reversalOutcomeLossMaxPct(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_LOSS_MAX_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return -2;
}

/** สแกน MFE / DD ถึง MFE ในกรอบ 48h (15m) */
export function computeAutoOpenMfe48h(
  side: "long" | "short",
  entry: number,
  timeSec: number[],
  high: number[],
  low: number[],
  klineGranSec: number,
  iFirst: number,
  iLast: number,
): AutoOpenMfe48h | null {
  if (!(entry > 0) || iFirst < 0 || iLast < iFirst) return null;

  let maxRoi = -Infinity;
  let mfeIdx = iFirst;
  if (side === "long") {
    for (let i = iFirst; i <= iLast; i++) {
      const roi = ((high[i]! - entry) / entry) * 100;
      if (roi > maxRoi) {
        maxRoi = roi;
        mfeIdx = i;
      }
    }
  } else {
    for (let i = iFirst; i <= iLast; i++) {
      const roi = ((entry - low[i]!) / entry) * 100;
      if (roi > maxRoi) {
        maxRoi = roi;
        mfeIdx = i;
      }
    }
  }
  if (!Number.isFinite(maxRoi)) return null;

  let minLow = Infinity;
  let maxHigh = -Infinity;
  for (let i = iFirst; i <= mfeIdx; i++) {
    minLow = Math.min(minLow, low[i]!);
    maxHigh = Math.max(maxHigh, high[i]!);
  }
  let maxDd = 0;
  if (side === "long") {
    maxDd = ((entry - minLow) / entry) * 100;
  } else {
    maxDd = ((maxHigh - entry) / entry) * 100;
  }
  if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;

  return {
    maxRoiPct: maxRoi,
    maxDrawdownPct: maxDd,
    durationToMfeHours: (timeSec[mfeIdx]! + klineGranSec - timeSec[iFirst]!) / 3600,
  };
}

export type AutoOpenStrategyResolved = {
  strategyOutcome: AutoOpenStrategyOutcome;
  /** P/L % ราคา (เทียบ entry) ที่ใช้สรุปผล strategy */
  strategyPct: number;
  maxRoiPct: number;
  maxDrawdownPct: number;
  durationToMfeHours: number;
};

export function resolveAutoOpenStrategyAt48h(
  source: AutoOpenSource,
  maxRoiPct: number,
  pct48h: number,
): Pick<AutoOpenStrategyResolved, "strategyOutcome" | "strategyPct"> {
  if (source === "snowball") {
    const quickTp = snowballOutcomeQuickTp30MinPct();
    const winMin = snowballOutcomeWinMinPct();
    if (maxRoiPct >= quickTp) {
      return { strategyOutcome: "win_quick_tp30", strategyPct: quickTp };
    }
    if (pct48h >= winMin) {
      return { strategyOutcome: "win_trend", strategyPct: pct48h };
    }
    if (pct48h <= -winMin) {
      return { strategyOutcome: "loss", strategyPct: pct48h };
    }
    return { strategyOutcome: "flat", strategyPct: pct48h };
  }

  const winMin = reversalOutcomeWinMinPct();
  const lossMax = reversalOutcomeLossMaxPct();
  if (pct48h >= winMin) {
    return { strategyOutcome: "win", strategyPct: pct48h };
  }
  if (pct48h <= lossMax) {
    return { strategyOutcome: "loss", strategyPct: pct48h };
  }
  return { strategyOutcome: "flat", strategyPct: pct48h };
}

export function autoOpenStrategyOutcomeLabel(o: AutoOpenStrategyOutcome | null | undefined): string {
  if (o === "win_quick_tp30") return "Win (Quick TP30%)";
  if (o === "win_trend") return "Win (Trend)";
  if (o === "win") return "Win";
  if (o === "loss") return "Loss";
  if (o === "flat") return "Flat";
  return "—";
}

export function autoOpenStrategyFinalized(
  row: Pick<
    AutoOpenOrderLogRow,
    "strategyOutcome" | "strategyPct" | "pct48h"
  >,
): boolean {
  return (
    row.strategyOutcome != null &&
    row.strategyPct != null &&
    Number.isFinite(row.strategyPct) &&
    row.pct48h != null &&
    Number.isFinite(row.pct48h)
  );
}
