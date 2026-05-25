import {
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
} from "./binanceIndicatorKline";
import {
  isRsiDivergenceStatsEnabled,
  loadRsiDivergenceStatsState,
  rsiDivergenceStatsOutcomeLossMaxPct,
  rsiDivergenceStatsOutcomeWinMinPct,
  saveRsiDivergenceStatsState,
  type RsiDivergenceStatsRow,
} from "./rsiDivergenceStatsStore";

const DAY_SEC = 24 * 3600;
const HOUR_SEC = 3600;

function tfBarSec(tf: RsiDivergenceStatsRow["tf"]): number {
  return tf === "1h" ? HOUR_SEC : 4 * HOUR_SEC;
}

function anchorCloseSec(row: RsiDivergenceStatsRow): number {
  return row.signalBarOpenSec + tfBarSec(row.tf);
}

function followupDays(): number {
  const v = Number(process.env.RSI_DIVERGENCE_STATS_FOLLOWUP_DAYS?.trim());
  if (Number.isFinite(v) && v >= 1 && v <= 30) return Math.floor(v);
  return 7;
}

/** bullish = long bias; bearish = short bias */
function pctVsEntry(
  kind: RsiDivergenceStatsRow["kind"],
  entry: number,
  price: number,
): number {
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  return kind === "bullish" ? ((price - entry) / entry) * 100 : ((entry - price) / entry) * 100;
}

function applyOutcomeFromPct(row: RsiDivergenceStatsRow, pct: number): void {
  if (pct >= rsiDivergenceStatsOutcomeWinMinPct()) row.outcome = "win";
  else if (pct <= rsiDivergenceStatsOutcomeLossMaxPct()) row.outcome = "loss";
  else row.outcome = "flat";
}

function pickHorizonClose(
  timeSec: number[],
  close: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  nowSec: number,
  horizonEndSec: number,
  entry: number,
  kind: RsiDivergenceStatsRow["kind"],
): { price: number; pct: number } | null {
  const limitSec = Math.min(horizonEndSec, nowSec);
  let best = -1;
  for (let i = iFirst; i <= iLast; i++) {
    const barClose = timeSec[i]! + barDurSec;
    if (barClose <= limitSec) best = i;
  }
  if (best < 0) return null;
  const price = close[best]!;
  return { price, pct: pctVsEntry(kind, entry, price) };
}

function computeMfeFromPack(
  timeSec: number[],
  high: number[],
  low: number[],
  barDurSec: number,
  iFirst: number,
  iLast: number,
  ac: number,
  entry: number,
  kind: RsiDivergenceStatsRow["kind"],
): { maxRoi: number; mfeIdx: number; maxDd: number; durationHours: number } | null {
  let maxRoi = -Infinity;
  let mfeIdx = iFirst;
  for (let i = iFirst; i <= iLast; i++) {
    const extreme = kind === "bullish" ? high[i]! : low[i]!;
    const roi = pctVsEntry(kind, entry, extreme);
    if (roi > maxRoi) {
      maxRoi = roi;
      mfeIdx = i;
    }
  }
  if (!Number.isFinite(maxRoi)) return null;

  let adverse = kind === "bullish" ? Infinity : -Infinity;
  for (let i = iFirst; i <= mfeIdx; i++) {
    if (kind === "bullish") {
      if (low[i]! < adverse) adverse = low[i]!;
    } else if (high[i]! > adverse) adverse = high[i]!;
  }
  let maxDd =
    kind === "bullish"
      ? ((entry - adverse) / entry) * 100
      : ((adverse - entry) / entry) * 100;
  if (!Number.isFinite(maxDd) || maxDd < 0) maxDd = 0;

  const durationHours = (timeSec[mfeIdx]! + barDurSec - ac) / 3600;
  return { maxRoi, mfeIdx, maxDd, durationHours };
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

async function followUpRow(
  row: RsiDivergenceStatsRow,
  nowMs: number,
  nowSec: number,
): Promise<boolean> {
  const entry = row.entryPrice;
  const ac = anchorCloseSec(row);
  const followSec = followupDays() * DAY_SEC;
  const windowEndSec = Math.min(nowSec, ac + followSec);

  const dayPack = await fetchBinanceUsdmKlinesRange(row.symbol, "1d", {
    startTimeMs: row.signalBarOpenSec * 1000,
    endTimeMs: nowMs,
    limit: 20,
  });
  if (!dayPack || dayPack.timeSec.length === 0) return false;

  const { timeSec: dayT, close: dayC, high: dayH, low: dayL } = dayPack;
  const iDayFirst = dayT.findIndex((t) => t + DAY_SEC >= ac);
  if (iDayFirst < 0) return false;
  const iDayLast = indexRangeThrough(dayT, DAY_SEC, iDayFirst, windowEndSec);
  if (iDayLast < iDayFirst) return false;

  const mfe = computeMfeFromPack(dayT, dayH, dayL, DAY_SEC, iDayFirst, iDayLast, ac, entry, row.kind);
  if (!mfe) return false;

  const h1d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, ac + DAY_SEC, entry, row.kind);
  const h3d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, ac + 3 * DAY_SEC, entry, row.kind);
  let h7d = pickHorizonClose(dayT, dayC, DAY_SEC, iDayFirst, iDayLast, nowSec, ac + followSec, entry, row.kind);
  if (h7d == null && nowSec >= ac + followSec && iDayLast >= iDayFirst) {
    const p = dayC[iDayLast]!;
    h7d = { price: p, pct: pctVsEntry(row.kind, entry, p) };
  }

  row.maxRoiPct = mfe.maxRoi;
  row.durationToMfeHours = mfe.durationHours;
  row.maxDrawdownPct = mfe.maxDd;
  if (h1d) {
    row.price1d = h1d.price;
    row.pct1d = h1d.pct;
  }
  if (h3d) {
    row.price3d = h3d.price;
    row.pct3d = h3d.pct;
  }
  if (h7d) {
    row.price7d = h7d.price;
    row.pct7d = h7d.pct;
  }

  const finalized = nowSec >= ac + followSec && row.pct7d != null;
  if (finalized) {
    applyOutcomeFromPct(row, row.pct7d ?? 0);
  }
  return true;
}

export async function runRsiDivergenceStatsFollowUpTick(nowMs: number): Promise<number> {
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isRsiDivergenceStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return 0;

  const state = await loadRsiDivergenceStatsState();
  const nowSec = Math.floor(nowMs / 1000);
  let dirty = 0;

  for (const row of state.rows) {
    if (row.outcome !== "pending") continue;
    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;
    const ac = anchorCloseSec(row);
    if (nowSec < ac) continue;
    try {
      const ok = await followUpRow(row, nowMs, nowSec);
      if (ok) dirty += 1;
    } catch (e) {
      console.error("[rsiDivergenceStatsTick] followUp", row.symbol, row.tf, row.kind, e);
    }
  }

  if (dirty > 0) await saveRsiDivergenceStatsState(state);
  return dirty;
}
