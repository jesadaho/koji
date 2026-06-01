import type { AutoOpenOrderLogRow, AutoOpenSource } from "@/lib/autoOpenOrderLogClient";
import {
  formatStatsStrategyProfitDollarAmount,
  strategyProfitUsdtFromMargin,
} from "@/lib/statsStrategyProfitClient";

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

export function isAutoOpenStrategyWinOutcome(
  outcome: string | null | undefined,
): boolean {
  return (
    outcome === "win" ||
    outcome === "win_trend" ||
    outcome === "win_quick_tp30"
  );
}

export type AutoOpenStrategy48hSummary = {
  /** ครบผล@48h (เปิดสำเร็จ + ล้มเหลวที่มี entry สมมติ) */
  trades: number;
  /** ใน trades — outcome สำเร็จ */
  successTrades: number;
  /** ใน trades — outcome ล้มเหลว (P/L สมมติ ไม่ได้เปิดจริง) */
  failedTrades: number;
  wins: number;
  losses: number;
  flats: number;
  /** ยังไม่ครบ 48h */
  pending: number;
  decisive: number;
  winratePct: number | null;
  sumUsdt: number | null;
};

function autoOpenStrategy48hEligible(row: AutoOpenOrderLogRow): boolean {
  return row.outcome === "success" || row.outcome === "failed";
}

/** สรุป Win/Loss ตามคอลัมน์ ผล@48h — ไม้สำเร็จ + ล้มเหลวที่ติดตามราคาได้ */
export function summarizeAutoOpenStrategy48h(
  rows: AutoOpenOrderLogRow[],
): AutoOpenStrategy48hSummary {
  let trades = 0;
  let successTrades = 0;
  let failedTrades = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let pending = 0;
  let sumUsdt = 0;
  let hasUsdt = false;

  for (const r of rows) {
    if (!autoOpenStrategy48hEligible(r)) continue;

    if (!autoOpenStrategyFinalized(r)) {
      pending += 1;
      continue;
    }

    trades += 1;
    if (r.outcome === "failed") failedTrades += 1;
    else successTrades += 1;
    const o = r.strategyOutcome;
    if (isAutoOpenStrategyWinOutcome(o)) wins += 1;
    else if (o === "loss") losses += 1;
    else flats += 1;

    const marginBase = r.marginUsdt;
    const scale =
      r.marginScale != null && Number.isFinite(r.marginScale) && r.marginScale > 0
        ? r.marginScale
        : 1;
    const margin =
      marginBase != null && Number.isFinite(marginBase) && marginBase > 0
        ? marginBase * scale
        : null;
    const lev = r.leverage;
    const pct = r.strategyPct;
    if (
      margin != null &&
      lev != null &&
      Number.isFinite(lev) &&
      lev > 0 &&
      pct != null &&
      Number.isFinite(pct)
    ) {
      const usd = strategyProfitUsdtFromMargin(margin, lev, pct);
      if (usd != null && Number.isFinite(usd)) {
        sumUsdt += usd;
        hasUsdt = true;
      }
    }
  }

  const decisive = wins + losses;
  const winratePct = decisive > 0 ? (wins / decisive) * 100 : null;

  return {
    trades,
    successTrades,
    failedTrades,
    wins,
    losses,
    flats,
    pending,
    decisive,
    winratePct,
    sumUsdt: hasUsdt ? sumUsdt : null,
  };
}

export function formatAutoOpenStrategy48hSummaryText(
  summary: AutoOpenStrategy48hSummary,
): string | null {
  if (summary.trades === 0 && summary.pending === 0) return null;
  if (summary.trades === 0) {
    return summary.pending > 0
      ? `ผล@48h: รอผล ${summary.pending} ไม้ (ยังไม่ครบ 48h)`
      : null;
  }

  const flatPart = summary.flats > 0 ? ` · เสมอ ${summary.flats}` : "";
  const pendingPart =
    summary.pending > 0 ? ` · รอผล ${summary.pending}` : "";
  const wrPart =
    summary.decisive > 0 && summary.winratePct != null
      ? ` · WR ${summary.winratePct.toFixed(1)}% (${summary.wins}/${summary.decisive})`
      : "";
  const netPart =
    summary.sumUsdt != null
      ? ` · สุทธิ ${formatStatsStrategyProfitDollarAmount(summary.sumUsdt)}`
      : "";
  const failedPart =
    summary.failedTrades > 0
      ? ` · ล้มเหลว(สมมติ) ${summary.failedTrades}`
      : "";

  return `ผล@48h: ชนะ ${summary.wins} ไม้ · แพ้ ${summary.losses} ไม้${flatPart} · รวม ${summary.trades} ไม้ (สำเร็จ ${summary.successTrades}${failedPart})${wrPart}${netPart}${pendingPart}`;
}
