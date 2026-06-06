import type { AutoOpenOrderLogRow, AutoOpenSource } from "@/lib/autoOpenOrderLogClient";
import { excludePendingConflictRows } from "@/lib/signalPendingConflict";
import {
  accumulateAutoOpenPnlUsdt,
  autoOpenContractSymbolKey,
  autoOpenFollowUpEligible,
  autoOpenLimitPriceNotTouchedYet,
  emptyAutoOpenPnlUsdtAccumulator,
  finalizeAutoOpenPnlUsdtBucket,
  pctVsEntrySide,
  resolveAutoOpenEntryPrice,
  type AutoOpenPnlUsdtBucket,
} from "@/lib/autoOpenFollowUp";
import {
  formatStatsStrategyProfitDollarAmount,
  strategyProfitUsdtFromMargin,
} from "@/lib/statsStrategyProfitClient";

export type { AutoOpenPnlUsdtBucket };

/** ผลตามกติกา stats / strategy หลังครบ 48h (ไม่ใช่ success/skipped ของการสั่ง) */
export type AutoOpenStrategyOutcome = "win_trend" | "win" | "loss" | "flat";

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

export function resolveAutoOpenStrategyAtHorizon(
  source: AutoOpenSource,
  pct: number,
): Pick<AutoOpenStrategyResolved, "strategyOutcome" | "strategyPct"> {
  if (source === "snowball") {
    const winMin = snowballOutcomeWinMinPct();
    if (pct >= winMin) {
      return { strategyOutcome: "win_trend", strategyPct: pct };
    }
    if (pct <= -winMin) {
      return { strategyOutcome: "loss", strategyPct: pct };
    }
    return { strategyOutcome: "flat", strategyPct: pct };
  }

  const winMin = reversalOutcomeWinMinPct();
  const lossMax = reversalOutcomeLossMaxPct();
  if (pct >= winMin) {
    return { strategyOutcome: "win", strategyPct: pct };
  }
  if (pct <= lossMax) {
    return { strategyOutcome: "loss", strategyPct: pct };
  }
  return { strategyOutcome: "flat", strategyPct: pct };
}

export function resolveAutoOpenStrategyAt24h(
  source: AutoOpenSource,
  pct24h: number,
): Pick<AutoOpenStrategyResolved, "strategyOutcome" | "strategyPct"> {
  return resolveAutoOpenStrategyAtHorizon(source, pct24h);
}

export function resolveAutoOpenStrategyAt48h(
  source: AutoOpenSource,
  maxRoiPct: number,
  pct48h: number,
): Pick<AutoOpenStrategyResolved, "strategyOutcome" | "strategyPct"> {
  void maxRoiPct;
  return resolveAutoOpenStrategyAtHorizon(source, pct48h);
}

export function autoOpenStrategyOutcomeLabel(
  o: AutoOpenStrategyOutcome | "win_quick_tp30" | null | undefined,
): string {
  if (o === "win_quick_tp30" || o === "win_trend") return "Win (Trend)";
  if (o === "win") return "Win";
  if (o === "loss") return "Loss";
  if (o === "flat") return "Flat";
  return "—";
}

export function autoOpenStrategyFinalized24h(
  row: Pick<
    AutoOpenOrderLogRow,
    "strategyOutcome24h" | "strategyPct24h" | "pct24h"
  >,
): boolean {
  return (
    row.strategyOutcome24h != null &&
    row.strategyPct24h != null &&
    Number.isFinite(row.strategyPct24h) &&
    row.pct24h != null &&
    Number.isFinite(row.pct24h)
  );
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
  return outcome === "win" || outcome === "win_trend" || outcome === "win_quick_tp30";
}

export type AutoOpenStrategyHorizonSummary = {
  /** ครบผล@horizon (เปิดสำเร็จ + ล้มเหลวที่มี entry สมมติ) */
  trades: number;
  successTrades: number;
  failedTrades: number;
  wins: number;
  losses: number;
  flats: number;
  /** ยังไม่ครบ horizon */
  pending: number;
  decisive: number;
  winratePct: number | null;
  sumUsdt: number | null;
  sumUsdtSuccess: number | null;
  sumUsdtFailed: number | null;
};

export type AutoOpenStrategy48hSummary = AutoOpenStrategyHorizonSummary & {
};

function autoOpenStrategy48hEligible(row: AutoOpenOrderLogRow): boolean {
  return row.outcome === "success" || row.outcome === "failed";
}

function summarizeAutoOpenStrategyAtHorizon(
  rows: AutoOpenOrderLogRow[],
  horizonHours: 24 | 48,
  markPrices?: Record<string, number>,
): AutoOpenStrategyHorizonSummary {
  rows = excludePendingConflictRows(rows);
  let trades = 0;
  let successTrades = 0;
  let failedTrades = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let pending = 0;
  let sumUsdt = 0;
  let hasUsdt = false;
  let sumUsdtSuccess = 0;
  let hasUsdtSuccess = false;
  let sumUsdtFailed = 0;
  let hasUsdtFailed = false;

  for (const r of rows) {
    if (!autoOpenStrategy48hEligible(r)) continue;

    const finalized =
      horizonHours === 24 ? autoOpenStrategyFinalized24h(r) : autoOpenStrategyFinalized(r);
    if (!finalized) {
      const mark =
        markPrices != null
          ? markPrices[autoOpenContractSymbolKey(r.contractSymbol)]
          : undefined;
      if (!autoOpenLimitPriceNotTouchedYet(r, mark)) {
        pending += 1;
      }
      continue;
    }

    trades += 1;
    if (r.outcome === "failed") failedTrades += 1;
    else successTrades += 1;
    const o = horizonHours === 24 ? r.strategyOutcome24h : r.strategyOutcome;
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
    const pct = horizonHours === 24 ? r.strategyPct24h : r.strategyPct;
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
        if (r.outcome === "failed") {
          sumUsdtFailed += usd;
          hasUsdtFailed = true;
        } else {
          sumUsdtSuccess += usd;
          hasUsdtSuccess = true;
        }
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
    sumUsdtSuccess: hasUsdtSuccess ? sumUsdtSuccess : null,
    sumUsdtFailed: hasUsdtFailed ? sumUsdtFailed : null,
  };
}

/** สรุป Win/Loss ตามคอลัมน์ ผล@24h */
export function summarizeAutoOpenStrategy24h(
  rows: AutoOpenOrderLogRow[],
  markPrices?: Record<string, number>,
): AutoOpenStrategyHorizonSummary {
  return summarizeAutoOpenStrategyAtHorizon(rows, 24, markPrices);
}

/** สรุป Win/Loss ตามคอลัมน์ ผล@48h — ไม้สำเร็จ + ล้มเหลวที่ติดตามราคาได้ */
export function summarizeAutoOpenStrategy48h(
  rows: AutoOpenOrderLogRow[],
  markPrices?: Record<string, number>,
): AutoOpenStrategy48hSummary {
  return summarizeAutoOpenStrategyAtHorizon(rows, 48, markPrices);
}

export function formatAutoOpenPnlBucketParts(
  label: string,
  bucket: Pick<AutoOpenPnlUsdtBucket, "sumUsdt" | "sumUsdtSuccess" | "sumUsdtFailed">,
  successTrades: number,
  failedTrades: number,
): string {
  if (bucket.sumUsdt == null) return "";
  const head = `${label} ${formatStatsStrategyProfitDollarAmount(bucket.sumUsdt)}`;
  const showSplit =
    failedTrades > 0 && (bucket.sumUsdtSuccess != null || bucket.sumUsdtFailed != null);
  if (!showSplit) return ` · ${head}`;
  const sub: string[] = [];
  if (successTrades > 0 && bucket.sumUsdtSuccess != null) {
    sub.push(`สำเร็จ ${formatStatsStrategyProfitDollarAmount(bucket.sumUsdtSuccess)}`);
  }
  if (failedTrades > 0 && bucket.sumUsdtFailed != null) {
    sub.push(`ล้มเหลว(สมมติ) ${formatStatsStrategyProfitDollarAmount(bucket.sumUsdtFailed)}`);
  }
  if (sub.length === 0) return ` · ${head}`;
  return ` · ${head} (${sub.join(" · ")})`;
}

/** P/L mark สด — ไม้ที่ยังไม่ครบผล@48h */
export function summarizeAutoOpenUnrealizedPnl(
  rows: AutoOpenOrderLogRow[],
  markPrices: Record<string, number>,
): AutoOpenPnlUsdtBucket {
  rows = excludePendingConflictRows(rows);
  const acc = emptyAutoOpenPnlUsdtAccumulator();

  for (const r of rows) {
    if (!autoOpenStrategy48hEligible(r)) continue;
    if (autoOpenStrategyFinalized(r)) continue;
    if (!autoOpenFollowUpEligible(r)) continue;
    if (r.side !== "long" && r.side !== "short") continue;

    const entry = resolveAutoOpenEntryPrice(r);
    if (entry == null) continue;
    const mark = markPrices[autoOpenContractSymbolKey(r.contractSymbol)];
    if (mark == null || !Number.isFinite(mark)) continue;
    if (autoOpenLimitPriceNotTouchedYet(r, mark)) continue;

    const pct = pctVsEntrySide(r.side, entry, mark);
    accumulateAutoOpenPnlUsdt(acc, r, pct);
  }

  return finalizeAutoOpenPnlUsdtBucket(acc);
}

function formatAutoOpenPnlBucketLine(
  label: string,
  bucket: Pick<AutoOpenPnlUsdtBucket, "sumUsdt" | "sumUsdtSuccess" | "sumUsdtFailed">,
  successTrades: number,
  failedTrades: number,
  tradeCount?: number,
): string {
  const core = formatAutoOpenPnlBucketParts(label, bucket, successTrades, failedTrades).replace(
    /^ · /,
    "",
  );
  if (!core) return "";
  return tradeCount != null && tradeCount > 0 ? `${core} (${tradeCount} ไม้)` : core;
}

function formatAutoOpenClosedNetUsdtLine(summary: AutoOpenStrategy48hSummary): string {
  return formatAutoOpenPnlBucketLine(
    "Realised",
    summary,
    summary.successTrades,
    summary.failedTrades,
  );
}

function formatAutoOpenUnrealisedNetUsdtLine(bucket: AutoOpenPnlUsdtBucket): string {
  return formatAutoOpenPnlBucketLine(
    "Unrealised",
    bucket,
    bucket.successTrades,
    bucket.failedTrades,
    bucket.trades,
  );
}

export function formatAutoOpenStrategyHorizonSummaryText(
  label: string,
  summary: AutoOpenStrategyHorizonSummary,
  pendingLabel: string,
): string | null {
  if (summary.trades === 0 && summary.pending === 0) return null;

  if (summary.trades === 0) {
    return summary.pending > 0 ? `${label}: รอผล ${summary.pending} ไม้ (${pendingLabel})` : null;
  }

  const flatPart = summary.flats > 0 ? ` · เสมอ ${summary.flats}` : "";
  const pendingPart =
    summary.pending > 0 ? ` · รอผล ${summary.pending}` : "";
  const wrPart =
    summary.decisive > 0 && summary.winratePct != null
      ? ` · WR ${summary.winratePct.toFixed(1)}% (${summary.wins}/${summary.decisive})`
      : "";
  const failedPart =
    summary.failedTrades > 0 ? ` · ล้มเหลว(สมมติ) ${summary.failedTrades}` : "";
  const pnlPart = formatAutoOpenPnlBucketParts(
    "Realised",
    summary,
    summary.successTrades,
    summary.failedTrades,
  );

  return `${label}: ชนะ ${summary.wins} ไม้ · แพ้ ${summary.losses} ไม้${flatPart} · รวม ${summary.trades} ไม้ (สำเร็จ ${summary.successTrades}${failedPart})${wrPart}${pendingPart}${pnlPart}`;
}

export function formatAutoOpenStrategy48hSummaryText(
  summary: AutoOpenStrategy48hSummary,
  unrealised?: AutoOpenPnlUsdtBucket,
): string | null {
  const realisedLine = formatAutoOpenClosedNetUsdtLine(summary);
  const unrealLine = unrealised ? formatAutoOpenUnrealisedNetUsdtLine(unrealised) : "";
  const pnlLines = [realisedLine, unrealLine].filter(Boolean).join("\n");

  if (summary.trades === 0 && summary.pending === 0) {
    return pnlLines || null;
  }

  if (summary.trades === 0) {
    const pendingLine =
      summary.pending > 0
        ? `ผล@48h: รอผล ${summary.pending} ไม้ (ยังไม่ครบ 48h)`
        : "ผล@48h:";
    return pnlLines ? `${pendingLine}\n${pnlLines}` : pendingLine;
  }

  const flatPart = summary.flats > 0 ? ` · เสมอ ${summary.flats}` : "";
  const pendingPart =
    summary.pending > 0 ? ` · รอผล ${summary.pending}` : "";
  const wrPart =
    summary.decisive > 0 && summary.winratePct != null
      ? ` · WR ${summary.winratePct.toFixed(1)}% (${summary.wins}/${summary.decisive})`
      : "";
  const failedPart =
    summary.failedTrades > 0
      ? ` · ล้มเหลว(สมมติ) ${summary.failedTrades}`
      : "";

  const statsLine = `ผล@48h: ชนะ ${summary.wins} ไม้ · แพ้ ${summary.losses} ไม้${flatPart} · รวม ${summary.trades} ไม้ (สำเร็จ ${summary.successTrades}${failedPart})${wrPart}${pendingPart}`;
  return pnlLines ? `${statsLine}\n${pnlLines}` : statsLine;
}
