import type { AutoOpenOrderLogRow, AutoOpenSource } from "@/lib/autoOpenOrderLogClient";
import { excludePendingConflictRows } from "@/lib/signalPendingConflict";
import {
  accumulateAutoOpenPnlUsdt,
  autoOpenContractSymbolKey,
  autoOpenFollowUpAnchorSec,
  autoOpenFollowUpEligible,
  autoOpenHorizonDue,
  autoOpenLimitPriceNotTouchedYet,
  autoOpenRowMarginUsdt,
  emptyAutoOpenPnlUsdtAccumulator,
  finalizeAutoOpenPnlUsdtBucket,
  pctVsEntrySide,
  resolveAutoOpenEntryPrice,
  type AutoOpenPnlBucketFormatSlice,
  type AutoOpenPnlUsdtBucket,
} from "@/lib/autoOpenFollowUp";
import {
  classifyStatsStrategyProfitPct,
  formatStatsStrategyProfitDollarAmount,
  resolveStatsStrategyDisplayPct,
  STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
  STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
  strategyProfitUsdtFromMargin,
} from "@/lib/statsStrategyProfitClient";

export type { AutoOpenPnlBucketFormatSlice, AutoOpenPnlUsdtBucket };

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
  strategyProfitPct: number,
): Pick<AutoOpenStrategyResolved, "strategyOutcome" | "strategyPct"> {
  return resolveAutoOpenStrategyFromProfitPct(source, strategyProfitPct);
}

/** Win/Loss/Flat จากกำไร % จำลอง TP/SL (ไม่ใช่ราคาปิด horizon ดิบ) */
export function resolveAutoOpenStrategyFromProfitPct(
  source: AutoOpenSource,
  profitPct: number,
): Pick<AutoOpenStrategyResolved, "strategyOutcome" | "strategyPct"> {
  const band =
    source === "snowball"
      ? STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND
      : STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND;
  const cls = classifyStatsStrategyProfitPct(profitPct, band);
  let strategyOutcome: AutoOpenStrategyOutcome;
  if (cls === "win") strategyOutcome = source === "snowball" ? "win_trend" : "win";
  else if (cls === "loss") strategyOutcome = "loss";
  else strategyOutcome = "flat";
  return { strategyOutcome, strategyPct: profitPct };
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

/** คำนวณผล@horizon จาก pct ที่มีอยู่ — ใช้แสดงผล/backfill แม้ยังไม่ได้ persist strategy fields */
export function resolveAutoOpenStrategyHorizonForRow(
  row: AutoOpenOrderLogRow,
  horizonHours: 24 | 48,
  nowMs = Date.now(),
): { outcome: AutoOpenStrategyOutcome; pct: number } | null {
  if (!autoOpenHorizonDue(row, horizonHours, nowMs)) return null;
  const pctHorizon = horizonHours === 24 ? row.pct24h : row.pct48h;
  if (pctHorizon == null || !Number.isFinite(pctHorizon)) return null;

  const exitReason =
    horizonHours === 24 ? row.strategyExitReason24h : row.strategyExitReason;
  const storedOutcome = horizonHours === 24 ? row.strategyOutcome24h : row.strategyOutcome;
  const storedPct = horizonHours === 24 ? row.strategyPct24h : row.strategyPct;
  if (
    exitReason != null &&
    storedOutcome != null &&
    storedPct != null &&
    Number.isFinite(storedPct)
  ) {
    return { outcome: storedOutcome as AutoOpenStrategyOutcome, pct: storedPct };
  }

  void pctHorizon;
  return null;
}

/** @deprecated ใช้ follow-up tick จำลอง TP/SL — ไม่ backfill จาก pct ดิบ */
export function backfillAutoOpenStrategyHorizonFromPct(
  _row: AutoOpenOrderLogRow,
  _nowSec = Math.floor(Date.now() / 1000),
): boolean {
  return false;
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

export type AutoOpenStrategyHorizonSummary = AutoOpenPnlBucketFormatSlice & {
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
  let sumWinUsdt = 0;
  let hasWin = false;
  let sumLossUsdt = 0;
  let hasLoss = false;
  let sumWinUsdtSuccess = 0;
  let hasWinSuccess = false;
  let sumLossUsdtSuccess = 0;
  let hasLossSuccess = false;
  let sumWinUsdtFailed = 0;
  let hasWinFailed = false;
  let sumLossUsdtFailed = 0;
  let hasLossFailed = false;

  for (const r of rows) {
    if (!autoOpenStrategy48hEligible(r)) continue;

    const resolved = resolveAutoOpenStrategyHorizonForRow(r, horizonHours);
    if (!resolved) {
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
    const o = resolved.outcome;
    if (isAutoOpenStrategyWinOutcome(o)) wins += 1;
    else if (o === "loss") losses += 1;
    else flats += 1;

    const margin = autoOpenRowMarginUsdt(r);
    const lev = r.leverage;
    const exitReason =
      horizonHours === 24 ? r.strategyExitReason24h : r.strategyExitReason;
    const displayPct = resolveStatsStrategyDisplayPct(
      resolved.pct,
      lev,
      undefined,
      exitReason,
    );
    if (
      margin != null &&
      lev != null &&
      Number.isFinite(lev) &&
      lev > 0 &&
      Number.isFinite(displayPct)
    ) {
      const usd = strategyProfitUsdtFromMargin(margin, lev, displayPct);
      if (usd != null && Number.isFinite(usd)) {
        sumUsdt += usd;
        hasUsdt = true;
        if (isAutoOpenStrategyWinOutcome(o)) {
          sumWinUsdt += usd;
          hasWin = true;
        } else if (o === "loss") {
          sumLossUsdt += usd;
          hasLoss = true;
        }
        if (r.outcome === "failed") {
          sumUsdtFailed += usd;
          hasUsdtFailed = true;
          if (isAutoOpenStrategyWinOutcome(o)) {
            sumWinUsdtFailed += usd;
            hasWinFailed = true;
          } else if (o === "loss") {
            sumLossUsdtFailed += usd;
            hasLossFailed = true;
          }
        } else {
          sumUsdtSuccess += usd;
          hasUsdtSuccess = true;
          if (isAutoOpenStrategyWinOutcome(o)) {
            sumWinUsdtSuccess += usd;
            hasWinSuccess = true;
          } else if (o === "loss") {
            sumLossUsdtSuccess += usd;
            hasLossSuccess = true;
          }
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
    sumWinUsdt: hasWin ? sumWinUsdt : null,
    sumLossUsdt: hasLoss ? sumLossUsdt : null,
    sumWinUsdtSuccess: hasWinSuccess ? sumWinUsdtSuccess : null,
    sumLossUsdtSuccess: hasLossSuccess ? sumLossUsdtSuccess : null,
    sumWinUsdtFailed: hasWinFailed ? sumWinUsdtFailed : null,
    sumLossUsdtFailed: hasLossFailed ? sumLossUsdtFailed : null,
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

/** ตัวเลขหลัก = ไม้สำเร็จเท่านั้นเมื่อมีไม้ล้มเหลว(สมมติ) — ไม่สับสนกับ MEXC Realised */
export function autoOpenPnlBucketHeadlineUsdt(
  bucket: Pick<AutoOpenPnlBucketFormatSlice, "sumUsdt" | "sumUsdtSuccess">,
  failedTrades: number,
): number | null {
  if (failedTrades > 0 && bucket.sumUsdtSuccess != null) return bucket.sumUsdtSuccess;
  return bucket.sumUsdt;
}

export function autoOpenPnlBucketHeadlineWinLoss(
  bucket: Pick<
    AutoOpenPnlBucketFormatSlice,
    | "sumWinUsdt"
    | "sumLossUsdt"
    | "sumWinUsdtSuccess"
    | "sumLossUsdtSuccess"
    | "sumUsdt"
    | "sumUsdtSuccess"
  >,
  failedTrades: number,
): { win: number | null; loss: number | null; net: number | null } {
  const useSuccessOnly = failedTrades > 0;
  return {
    win: useSuccessOnly ? bucket.sumWinUsdtSuccess : bucket.sumWinUsdt,
    loss: useSuccessOnly ? bucket.sumLossUsdtSuccess : bucket.sumLossUsdt,
    net: autoOpenPnlBucketHeadlineUsdt(bucket, failedTrades),
  };
}

export function formatAutoOpenPnlWinLossParts(
  win: number | null | undefined,
  loss: number | null | undefined,
  net: number | null | undefined,
): string {
  const parts: string[] = [];
  if (win != null && win > 0) {
    parts.push(`P ${formatStatsStrategyProfitDollarAmount(win)}`);
  }
  if (loss != null && loss < 0) {
    parts.push(`L ${formatStatsStrategyProfitDollarAmount(loss)}`);
  }
  if (parts.length === 0) {
    return net != null ? formatStatsStrategyProfitDollarAmount(net) : "";
  }
  if (net != null) {
    parts.push(`สุทธิ ${formatStatsStrategyProfitDollarAmount(net)}`);
  }
  return parts.join(" · ");
}

function formatAutoOpenPnlBucketSubSplit(
  bucket: Pick<
    AutoOpenPnlBucketFormatSlice,
    | "sumUsdtSuccess"
    | "sumUsdtFailed"
    | "sumWinUsdtSuccess"
    | "sumLossUsdtSuccess"
    | "sumWinUsdtFailed"
    | "sumLossUsdtFailed"
  >,
  successTrades: number,
  failedTrades: number,
): string {
  const sub: string[] = [];
  if (successTrades > 0 && bucket.sumUsdtSuccess != null) {
    sub.push(
      `สำเร็จ ${formatAutoOpenPnlWinLossParts(
        bucket.sumWinUsdtSuccess,
        bucket.sumLossUsdtSuccess,
        bucket.sumUsdtSuccess,
      )}`,
    );
  }
  if (failedTrades > 0 && bucket.sumUsdtFailed != null) {
    sub.push(
      `ล้มเหลว(สมมติ) ${formatAutoOpenPnlWinLossParts(
        bucket.sumWinUsdtFailed,
        bucket.sumLossUsdtFailed,
        bucket.sumUsdtFailed,
      )}`,
    );
  }
  return sub.join(" · ");
}

export function formatAutoOpenPnlBucketParts(
  label: string,
  bucket: AutoOpenPnlBucketFormatSlice,
  successTrades: number,
  failedTrades: number,
): string {
  const { win, loss, net } = autoOpenPnlBucketHeadlineWinLoss(bucket, failedTrades);
  if (net == null && win == null && loss == null) return "";
  const head = `${label} ${formatAutoOpenPnlWinLossParts(win, loss, net)}`;
  const showSplit =
    failedTrades > 0 && (bucket.sumUsdtSuccess != null || bucket.sumUsdtFailed != null);
  if (!showSplit) return ` · ${head}`;
  const sub = formatAutoOpenPnlBucketSubSplit(bucket, successTrades, failedTrades);
  if (!sub) return ` · ${head}`;
  return ` · ${head} (${sub})`;
}

/** P/L mark สด — ไม้ที่ยังไม่ครบ 24h */
export function summarizeAutoOpenUnrealizedPnl(
  rows: AutoOpenOrderLogRow[],
  markPrices: Record<string, number>,
  nowMs = Date.now(),
): AutoOpenPnlUsdtBucket {
  rows = excludePendingConflictRows(rows);
  const acc = emptyAutoOpenPnlUsdtAccumulator();

  for (const r of rows) {
    if (!autoOpenStrategy48hEligible(r)) continue;
    if (autoOpenHorizonDue(r, 24, nowMs)) continue;
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
  bucket: AutoOpenPnlBucketFormatSlice,
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
    "จำลอง@48h",
    summary,
    summary.successTrades,
    summary.failedTrades,
  );
}

function formatAutoOpenUnrealisedNetUsdtLine(bucket: AutoOpenPnlUsdtBucket): string {
  return formatAutoOpenPnlBucketLine(
    "Unrealised (<24h)",
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
  pnlBucketLabel = "จำลอง",
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
    pnlBucketLabel,
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
