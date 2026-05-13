import {
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
  resetBinanceIndicatorFapi451LogDedupe,
} from "./binanceIndicatorKline";
import {
  isSnowballStatsEnabled,
  loadSnowballStatsState,
  saveSnowballStatsState,
  type SnowballStatsRow,
} from "./snowballStatsStore";

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

export async function runSnowballStatsFollowUpTick(nowMs: number): Promise<number> {
  resetBinanceIndicatorFapi451LogDedupe();
  if (!isSnowballStatsEnabled() || !isBinanceIndicatorFapiEnabled()) return 0;

  const state = await loadSnowballStatsState();
  let dirty = 0;

  for (const row of state.rows) {
    if (row.outcome !== "pending") continue;

    const entry = row.entryPrice;
    if (!Number.isFinite(entry) || entry <= 0) continue;

    const ac = anchorCloseSec(row);
    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec < ac) continue;

    const windowEndSec = Math.min(nowSec, ac + 24 * 3600);

    const pack = await fetchBinanceUsdmKlinesRange(row.symbol, "15m", {
      startTimeMs: row.signalBarOpenSec * 1000,
      endTimeMs: nowMs,
      limit: 500,
    });
    if (!pack || pack.timeSec.length === 0) continue;

    const { timeSec, high, low, close } = pack;
    // เติมฐาน low ของแท่งสัญญาณ (ถ้ายังไม่มี) — ใช้แท่งที่ open time ตรงกับ signalBarOpenSec
    if (row.signalBarLow == null || !Number.isFinite(row.signalBarLow) || row.signalBarLow <= 0) {
      const iSignal = timeSec.findIndex((t) => t === row.signalBarOpenSec);
      if (iSignal >= 0) {
        const lo = low[iSignal];
        if (typeof lo === "number" && Number.isFinite(lo) && lo > 0) row.signalBarLow = lo;
      }
    }
    const iFirst = timeSec.findIndex((t) => t + KLINE_GRAN_SEC >= ac);
    if (iFirst < 0) continue;

    let iLast = iFirst;
    for (let i = iFirst; i < timeSec.length; i++) {
      if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndSec) iLast = i;
    }
    while (iLast >= iFirst && timeSec[iLast]! + KLINE_GRAN_SEC > windowEndSec) {
      iLast--;
    }
    if (iLast < iFirst) continue;

    let maxRoi = -Infinity;
    let mfeIdx = iFirst;
    if (row.side === "long") {
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

    if (!Number.isFinite(maxRoi)) continue;

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

    const durationHours = (timeSec[mfeIdx]! + KLINE_GRAN_SEC - ac) / 3600;

    const h4 = pickHorizonClose(timeSec, close, iFirst, iLast, nowSec, ac + 4 * 3600, entry, row.side);
    const h12 = pickHorizonClose(timeSec, close, iFirst, iLast, nowSec, ac + 12 * 3600, entry, row.side);
    let h24 = pickHorizonClose(timeSec, close, iFirst, iLast, nowSec, ac + 24 * 3600, entry, row.side);

    if (h24 == null && nowSec >= ac + 24 * 3600 && iLast >= iFirst) {
      const p = close[iLast]!;
      h24 = { price: p, pct: pctVsEntry(row.side, entry, p) };
    }

    row.maxRoiPct = maxRoi;
    row.durationToMfeHours = durationHours;
    row.maxDrawdownPct = maxDd;
    if (h4) {
      row.price4h = h4.price;
      row.pct4h = h4.pct;
    }
    if (h12) {
      row.price12h = h12.price;
      row.pct12h = h12.pct;
    }
    if (h24) {
      row.price24h = h24.price;
      row.pct24h = h24.pct;
    }

    const finalized = nowSec >= ac + 24 * 3600 && row.pct24h != null && row.price24h != null;
    if (finalized) {
      const winMin = outcomeWinMinPct();
      const lossMax = outcomeLossMaxPct();
      const quickTp30 = outcomeQuickTp30MinPct();
      const pct24 = row.pct24h ?? 0;
      if (row.maxRoiPct != null && Number.isFinite(row.maxRoiPct) && row.maxRoiPct >= quickTp30) {
        row.outcome = "win_quick_tp30";
      } else if (pct24 >= winMin) {
        row.outcome = "win_trend";
      } else if (pct24 <= lossMax) {
        // กติกา “ยังรันเทรนด์ได้” แม้ 24h ติดลบ: ไม่หลุดฐาน + DD ไม่ลึก + ไม่อยู่ใน SVP hole
        row.outcome = passesRunTrendGuard(row) ? "win_trend" : "loss";
      } else {
        row.outcome = "flat";
      }

      const reward =
        rrRewardSource() === "mfe" ? (row.maxRoiPct ?? 0) : (row.pct24h ?? 0);
      row.resultRr = formatRr(reward, row.maxDrawdownPct ?? 0);
    }

    dirty += 1;
  }

  if (dirty > 0) await saveSnowballStatsState(state);
  return dirty;
}
