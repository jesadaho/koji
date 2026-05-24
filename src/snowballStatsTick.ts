import {
  fetchBinanceUsdmKlines,
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
  type BinanceKlinePack,
} from "./binanceIndicatorKline";
import {
  isSnowballStatsEnabled,
  loadSnowballStatsState,
  applySnowballStatsRowMigrations,
  saveSnowballStatsState,
  type SnowballStatsRow,
} from "./snowballStatsStore";
import {
  calculateTrendMomentumMetrics,
  fetchSnowball1hPackForTrendMomentum,
  SNOWBALL_TREND_1H_DD_LOOKBACK,
  SNOWBALL_TREND_1H_VOL_LOOKBACK,
  trendMomentumStatsFields,
} from "./snowballTrendMomentumMetrics";
import { applySnowballStatsGrade4hFollowUp } from "./snowballStatsGrade4hFollowUp";
import { buildSnowballLongConfirmGateStepsForStats } from "./snowballStatsGateSteps";
import type { BinanceIndicatorTf } from "./binanceIndicatorKline";
import { countGreenDaysBeforeSignalBar } from "./greenDayStreak";

/** ความละเอียดของ kline ที่ใช้คำนวณ MFE / horizon (คง 15m) */
const KLINE_GRAN_SEC = 900;

function signalBarDurationSec(row: SnowballStatsRow): number {
  const tf = row.signalBarTf ?? "15m";
  if (tf === "4h") return 4 * 3600;
  if (tf === "1h") return 3600;
  return 900;
}

function anchorCloseSec(row: SnowballStatsRow): number {
  return row.signalBarOpenSec + signalBarDurationSec(row);
}

function pctVsEntry(side: "long" | "short", entry: number, price: number): number {
  if (side === "long") return ((price - entry) / entry) * 100;
  return ((entry - price) / entry) * 100;
}

function rrRewardSource(): "close_24h" | "mfe" {
  const v = process.env.SNOWBALL_STATS_RR_REWARD_SOURCE?.trim().toLowerCase();
  return v === "mfe" ? "mfe" : "close_24h";
}

function outcomeWinMinPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_WIN_MIN_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return 0.3;
}

function outcomeLossMaxPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_LOSS_MAX_PCT);
  if (Number.isFinite(v) && v > -100 && v < 100) return v;
  return -0.3;
}

function outcomeQuickTp30MinPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_QUICK_TP30_MIN_PCT);
  if (Number.isFinite(v) && v > 0 && v < 200) return v;
  return 30;
}

function outcomeRunTrendMaxDdPct(): number {
  const v = Number(process.env.SNOWBALL_STATS_OUTCOME_RUN_TREND_MAX_DD_PCT);
  if (Number.isFinite(v) && v > 0 && v < 100) return v;
  return 3;
}

async function backfillSnowballGreenDaysBeforeSignal(rows: SnowballStatsRow[]): Promise<number> {
  const need = rows.filter((r) => r.greenDaysBeforeSignal == null);
  if (need.length === 0) return 0;

  const packBySymbol = new Map<string, BinanceKlinePack | null>();
  let updated = 0;
  for (const row of need) {
    const sym = row.symbol.trim().toUpperCase();
    let pack = packBySymbol.get(sym);
    if (pack === undefined) {
      try {
        pack = await fetchBinanceUsdmKlines(sym, "1d", 90);
      } catch (e) {
        console.error("[snowballStatsTick] backfill green days 1d", sym, e);
        pack = null;
      }
      packBySymbol.set(sym, pack);
    }
    const tf = row.signalBarTf ?? "15m";
    const n = countGreenDaysBeforeSignalBar(pack, row.signalBarOpenSec, tf);
    if (n == null) continue;
    row.greenDaysBeforeSignal = n;
    updated += 1;
  }
  return updated;
}

function passesRunTrendGuard(row: SnowballStatsRow): boolean {
  // ตอนนี้ snowball stats เป็น Binance 15m long/short ได้ แต่กติกา “หลุด Low ของแท่งเบรก” ที่ผู้ใช้ให้มาคือ long-case
  // ใช้เฉพาะ long ก่อน (ถ้าต้องการ short จะเพิ่ม signalBarHigh ภายหลัง)
  if (row.side !== "long") return false;
  const cur = row.price24h;
  const baseLow = row.signalBarLow;
  const maxDd = row.maxDrawdownPct;
  if (cur == null || !Number.isFinite(cur)) return false;
  if (baseLow == null || !Number.isFinite(baseLow) || baseLow <= 0) return false;
  if (maxDd == null || !Number.isFinite(maxDd) || maxDd < 0) return false;
  if (cur <= baseLow) return false;
  if (maxDd > outcomeRunTrendMaxDdPct()) return false;
  if (row.svpHoleYn !== "N") return false;
  return true;
}

function formatRr(rewardPct: number, riskPct: number): string {
  if (!Number.isFinite(riskPct) || riskPct <= 1e-9) return "N/A";
  if (!Number.isFinite(rewardPct) || rewardPct <= 0) return "N/A";
  const r = rewardPct / riskPct;
  if (!Number.isFinite(r) || r <= 0) return "N/A";
  return `1:${r.toFixed(2)}`;
}

/** ปิดแท่งล่าสุดที่ปิดไม่เกิน horizonEndSec และไม่เกิน now */
function pickHorizonClose(
  timeSec: number[],
  close: number[],
  iFirst: number,
  iLast: number,
  nowSec: number,
  horizonEndSec: number,
  entry: number,
  side: "long" | "short"
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

function rowNeedsTrendMomentumBackfill(row: SnowballStatsRow): boolean {
  if (row.volumeCascadeYn == null) return true;
  if (row.maxDrawback1hPct == null) return true;
  /** รีคำนวณ 8 แท่ง 1H ณ anchor เวลาแจ้ง — pending ทุกรอบ · แถวเก่ารีคำนวณเมื่อ lookback เปลี่ยน */
  if (row.outcome === "pending") return true;
  return (
    row.trendMomentumLookback !== SNOWBALL_TREND_1H_DD_LOOKBACK ||
    row.trendMomentumVolLookback !== SNOWBALL_TREND_1H_VOL_LOOKBACK
  );
}

function trendMomentumAnchorSec(row: SnowballStatsRow): number {
  if (Number.isFinite(row.alertedAtMs) && row.alertedAtMs > 0) {
    return Math.floor(row.alertedAtMs / 1000);
  }
  return anchorCloseSec(row);
}

/** เติม/อัปเดต DD 1H% และ vol_cascade จากแท่ง 1H ณ เวลาแจ้งสัญญาณ */
async function backfillSnowballTrendMomentumFields(rows: SnowballStatsRow[]): Promise<number> {
  const need = rows.filter(rowNeedsTrendMomentumBackfill);
  if (need.length === 0) return 0;

  const bySymbol = new Map<string, SnowballStatsRow[]>();
  for (const row of need) {
    const sym = row.symbol.trim().toUpperCase();
    const arr = bySymbol.get(sym) ?? [];
    arr.push(row);
    bySymbol.set(sym, arr);
  }

  let updated = 0;
  for (const [symbol, symRows] of Array.from(bySymbol.entries())) {
    const pack1h = await fetchSnowball1hPackForTrendMomentum(symbol);
    if (!pack1h) continue;
    for (const row of symRows) {
      const metrics = calculateTrendMomentumMetrics(pack1h, {
        asOfSec: trendMomentumAnchorSec(row),
      });
      const fields = trendMomentumStatsFields(metrics);
      if (fields.maxDrawback1hPct == null && fields.volumeCascadeYn == null) continue;
      let touched = false;
      if (fields.maxDrawback1hPct != null && row.maxDrawback1hPct !== fields.maxDrawback1hPct) {
        row.maxDrawback1hPct = fields.maxDrawback1hPct;
        touched = true;
      }
      if (fields.volumeCascadeYn != null && row.volumeCascadeYn !== fields.volumeCascadeYn) {
        row.volumeCascadeYn = fields.volumeCascadeYn;
        touched = true;
      }
      if (row.trendMomentumLookback !== SNOWBALL_TREND_1H_DD_LOOKBACK) {
        row.trendMomentumLookback = SNOWBALL_TREND_1H_DD_LOOKBACK;
        touched = true;
      }
      if (row.trendMomentumVolLookback !== SNOWBALL_TREND_1H_VOL_LOOKBACK) {
        row.trendMomentumVolLookback = SNOWBALL_TREND_1H_VOL_LOOKBACK;
        touched = true;
      }
      if (touched) updated += 1;
    }
  }
  return updated;
}

function rowNeedsConfirmGateStepsBackfill(row: SnowballStatsRow): boolean {
  if ((row.alertSide ?? "long") === "bear") return false;
  const tf = row.signalBarTf ?? "15m";
  if (tf === "4h") return false;
  return !row.confirmGateSteps?.length;
}

/** เติม confirmGateSteps สำหรับแถว LONG 1h/15m ที่ยังไม่บันทึกขั้น (ณ เวลาแจ้ง) */
export async function backfillSnowballConfirmGateSteps(rows: SnowballStatsRow[]): Promise<number> {
  const need = rows.filter(rowNeedsConfirmGateStepsBackfill);
  if (need.length === 0) return 0;

  const bySymbol = new Map<string, SnowballStatsRow[]>();
  for (const row of need) {
    const sym = row.symbol.trim().toUpperCase();
    const arr = bySymbol.get(sym) ?? [];
    arr.push(row);
    bySymbol.set(sym, arr);
  }

  let updated = 0;
  for (const [symbol, symRows] of Array.from(bySymbol.entries())) {
    const pack1h = await fetchSnowball1hPackForTrendMomentum(symbol);
    if (!pack1h) continue;
    for (const row of symRows) {
      const tf = (row.signalBarTf ?? "15m") as BinanceIndicatorTf;
      const steps = buildSnowballLongConfirmGateStepsForStats(
        tf,
        false,
        pack1h,
        null,
        3,
        trendMomentumAnchorSec(row),
      );
      if (steps.length === 0) continue;
      row.confirmGateSteps = steps;
      updated += 1;
    }
  }
  return updated;
}

export async function runSnowballStatsFollowUpTick(nowMs: number): Promise<number> {
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isSnowballStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return 0;

  const state = await loadSnowballStatsState();
  let dirty = 0;
  const nowSec = Math.floor(nowMs / 1000);

  dirty += applySnowballStatsRowMigrations(state.rows);
  dirty += await backfillSnowballTrendMomentumFields(state.rows);
  dirty += await backfillSnowballConfirmGateSteps(state.rows);
  dirty += await backfillSnowballGreenDaysBeforeSignal(state.rows);

  const pack1hGradeCache = new Map<string, BinanceKlinePack | null>();
  for (const row of state.rows) {
    if (row.qualityTier4hAdjusted) continue;
    const ac = anchorCloseSec(row);
    if (nowSec < ac + 4 * 3600) continue;
    if (await applySnowballStatsGrade4hFollowUp(row, nowSec, pack1hGradeCache)) {
      dirty += 1;
    }
  }

  const SEC_48H = 48 * 3600;
  const SEC_24H = 24 * 3600;

  for (const row of state.rows) {
    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const ac = anchorCloseSec(row);
    if (nowSec < ac) continue;

    const pending = row.outcome === "pending";
    const needs48h = row.pct48h == null && nowSec >= ac + SEC_48H;
    if (!pending && !needs48h) continue;

    const windowEndHorizonSec = Math.min(nowSec, ac + SEC_48H);
    const windowEndMfeSec = Math.min(nowSec, ac + SEC_24H);

    const pack = await fetchBinanceUsdmKlinesRange(row.symbol, "15m", {
      startTimeMs: row.signalBarOpenSec * 1000,
      endTimeMs: nowMs,
      limit: 500,
    });
    if (!pack || pack.timeSec.length === 0) continue;

    const { timeSec, high, low, close } = pack;
    if (row.signalBarLow == null || !Number.isFinite(row.signalBarLow) || row.signalBarLow <= 0) {
      const iSignal = timeSec.findIndex((t) => t === row.signalBarOpenSec);
      if (iSignal >= 0) {
        const lo = low[iSignal];
        if (typeof lo === "number" && Number.isFinite(lo) && lo > 0) row.signalBarLow = lo;
      }
    }
    const iFirst = timeSec.findIndex((t) => t + KLINE_GRAN_SEC >= ac);
    if (iFirst < 0) continue;

    let iLastHorizon = iFirst;
    for (let i = iFirst; i < timeSec.length; i++) {
      if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndHorizonSec) iLastHorizon = i;
    }
    while (iLastHorizon >= iFirst && timeSec[iLastHorizon]! + KLINE_GRAN_SEC > windowEndHorizonSec) {
      iLastHorizon--;
    }
    if (iLastHorizon < iFirst) continue;

    let rowTouched = false;

    const h4 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + 4 * 3600,
      entry,
      row.side,
    );
    const h12 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + 12 * 3600,
      entry,
      row.side,
    );
    let h24 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + SEC_24H,
      entry,
      row.side,
    );
    let h48 = pickHorizonClose(
      timeSec,
      close,
      iFirst,
      iLastHorizon,
      nowSec,
      ac + SEC_48H,
      entry,
      row.side,
    );

    if (h4) {
      row.price4h = h4.price;
      row.pct4h = h4.pct;
      rowTouched = true;
    }
    if (h12) {
      row.price12h = h12.price;
      row.pct12h = h12.pct;
      rowTouched = true;
    }
    if (h24) {
      row.price24h = h24.price;
      row.pct24h = h24.pct;
      rowTouched = true;
    }
    if (h48) {
      row.price48h = h48.price;
      row.pct48h = h48.pct;
      rowTouched = true;
    } else if (nowSec >= ac + SEC_48H && iLastHorizon >= iFirst) {
      const p = close[iLastHorizon]!;
      row.price48h = p;
      row.pct48h = pctVsEntry(row.side, entry, p);
      rowTouched = true;
    }

    if (pending) {
      let iLastMfe = iFirst;
      for (let i = iFirst; i < timeSec.length; i++) {
        if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndMfeSec) iLastMfe = i;
      }
      while (iLastMfe >= iFirst && timeSec[iLastMfe]! + KLINE_GRAN_SEC > windowEndMfeSec) {
        iLastMfe--;
      }
      if (iLastMfe < iFirst) continue;

      if (h24 == null && nowSec >= ac + SEC_24H && iLastMfe >= iFirst) {
        const p = close[iLastMfe]!;
        h24 = { price: p, pct: pctVsEntry(row.side, entry, p) };
        row.price24h = h24.price;
        row.pct24h = h24.pct;
        rowTouched = true;
      }

      let maxRoi = -Infinity;
      let mfeIdx = iFirst;
      if (row.side === "long") {
        for (let i = iFirst; i <= iLastMfe; i++) {
          const roi = ((high[i]! - entry) / entry) * 100;
          if (roi > maxRoi) {
            maxRoi = roi;
            mfeIdx = i;
          }
        }
      } else {
        for (let i = iFirst; i <= iLastMfe; i++) {
          const roi = ((entry - low[i]!) / entry) * 100;
          if (roi > maxRoi) {
            maxRoi = roi;
            mfeIdx = i;
          }
        }
      }

      if (Number.isFinite(maxRoi)) {
        let minLow = Infinity;
        let maxHigh = -Infinity;
        for (let i = iFirst; i <= mfeIdx; i++) {
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
        rowTouched = true;

        const finalized =
          nowSec >= ac + SEC_24H && row.pct24h != null && row.price24h != null;
        if (finalized) {
          const winMin = outcomeWinMinPct();
          const lossMax = outcomeLossMaxPct();
          const quickTp30 = outcomeQuickTp30MinPct();
          const pct24 = row.pct24h ?? 0;
          if (
            row.maxRoiPct != null &&
            Number.isFinite(row.maxRoiPct) &&
            row.maxRoiPct >= quickTp30
          ) {
            row.outcome = "win_quick_tp30";
          } else if (pct24 >= winMin) {
            row.outcome = "win_trend";
          } else if (pct24 <= lossMax) {
            row.outcome = passesRunTrendGuard(row) ? "win_trend" : "loss";
          } else {
            row.outcome = "flat";
          }

          const reward =
            rrRewardSource() === "mfe" ? (row.maxRoiPct ?? 0) : (row.pct24h ?? 0);
          row.resultRr = formatRr(reward, row.maxDrawdownPct ?? 0);
        }
      }
    }

    if (rowTouched) dirty += 1;
  }

  if (dirty > 0) await saveSnowballStatsState(state);
  return dirty;
}
