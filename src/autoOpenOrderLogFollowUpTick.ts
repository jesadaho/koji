import {
  autoOpenFollowUpAnchorSec,
  autoOpenFollowUpEligible,
  autoOpenNeedsFollowUp,
  backfillAutoOpenEntryPrice,
  pickAutoOpenHorizonClose,
  resolveAutoOpenEntryPrice,
} from "@/lib/autoOpenFollowUp";
import { computeAutoOpenMfe48h, resolveAutoOpenStrategyAt48h } from "@/lib/autoOpenStrategyOutcome";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import {
  fetchBinanceUsdmKlinesRange,
  isBinanceIndicatorFapiEnabled,
} from "./binanceIndicatorKline";
import {
  loadAutoOpenOrderLogState,
  saveAutoOpenOrderLogState,
} from "./autoOpenOrderLogStore";
import { toBinanceUsdtPerpSymbol } from "./snowballManualSymbolClear";

const KLINE_15M_SEC = 900;
const SEC_48H = 48 * 3600;
const SEC_24H = 24 * 3600;

export type AutoOpenOrderLogFollowUpResult = {
  dirty: number;
  rowsChecked: number;
};

function applyHorizon(
  row: AutoOpenOrderLogRow,
  h: { price: number; pct: number } | null,
  hours: 4 | 12 | 24 | 48,
): boolean {
  if (!h) return false;
  let touched = false;
  if (hours === 4) {
    if (row.price4h !== h.price) {
      row.price4h = h.price;
      touched = true;
    }
    if (row.pct4h !== h.pct) {
      row.pct4h = h.pct;
      touched = true;
    }
  } else if (hours === 12) {
    if (row.price12h !== h.price) {
      row.price12h = h.price;
      touched = true;
    }
    if (row.pct12h !== h.pct) {
      row.pct12h = h.pct;
      touched = true;
    }
  } else if (hours === 24) {
    if (row.price24h !== h.price) {
      row.price24h = h.price;
      touched = true;
    }
    if (row.pct24h !== h.pct) {
      row.pct24h = h.pct;
      touched = true;
    }
  } else {
    if (row.price48h !== h.price) {
      row.price48h = h.price;
      touched = true;
    }
    if (row.pct48h !== h.pct) {
      row.pct48h = h.pct;
      touched = true;
    }
  }
  return touched;
}

async function followUpRow(
  row: AutoOpenOrderLogRow,
  nowMs: number,
  nowSec: number,
): Promise<boolean> {
  const entry = resolveAutoOpenEntryPrice(row)!;
  const side = row.side!;
  const ac = autoOpenFollowUpAnchorSec(row);
  const symbol = toBinanceUsdtPerpSymbol(row.binanceSymbol || row.contractSymbol);
  if (!symbol) return false;

  const windowEndHorizonSec = Math.min(nowSec, ac + SEC_48H);
  const pack = await fetchBinanceUsdmKlinesRange(symbol, "15m", {
    startTimeMs: ac * 1000,
    endTimeMs: nowMs,
    limit: 500,
  });
  if (!pack || pack.timeSec.length === 0) return false;

  const { timeSec, close, high, low } = pack;
  const iFirst = timeSec.findIndex((t) => t + KLINE_15M_SEC >= ac);
  if (iFirst < 0) return false;

  let iLastHorizon = iFirst;
  for (let i = iFirst; i < timeSec.length; i++) {
    if (timeSec[i]! + KLINE_15M_SEC <= windowEndHorizonSec) iLastHorizon = i;
  }
  if (iLastHorizon < iFirst) return false;

  let touched = false;
  if (row.pct4h == null && nowSec >= ac + 4 * 3600) {
    touched =
      applyHorizon(
        row,
        pickAutoOpenHorizonClose(
          timeSec,
          close,
          KLINE_15M_SEC,
          iFirst,
          iLastHorizon,
          nowSec,
          ac + 4 * 3600,
          entry,
          side,
        ),
        4,
      ) || touched;
  }
  if (row.pct12h == null && nowSec >= ac + 12 * 3600) {
    touched =
      applyHorizon(
        row,
        pickAutoOpenHorizonClose(
          timeSec,
          close,
          KLINE_15M_SEC,
          iFirst,
          iLastHorizon,
          nowSec,
          ac + 12 * 3600,
          entry,
          side,
        ),
        12,
      ) || touched;
  }
  if (row.pct24h == null && nowSec >= ac + SEC_24H) {
    touched =
      applyHorizon(
        row,
        pickAutoOpenHorizonClose(
          timeSec,
          close,
          KLINE_15M_SEC,
          iFirst,
          iLastHorizon,
          nowSec,
          ac + SEC_24H,
          entry,
          side,
        ),
        24,
      ) || touched;
  }
  if (row.pct48h == null && nowSec >= ac + SEC_48H) {
    touched =
      applyHorizon(
        row,
        pickAutoOpenHorizonClose(
          timeSec,
          close,
          KLINE_15M_SEC,
          iFirst,
          iLastHorizon,
          nowSec,
          ac + SEC_48H,
          entry,
          side,
        ),
        48,
      ) || touched;
  }

  if (nowSec >= ac + SEC_48H && row.pct48h != null && Number.isFinite(row.pct48h)) {
    const mfe = computeAutoOpenMfe48h(
      side,
      entry,
      timeSec,
      high,
      low,
      KLINE_15M_SEC,
      iFirst,
      iLastHorizon,
    );
    if (mfe) {
      if (row.maxRoiPct !== mfe.maxRoiPct) {
        row.maxRoiPct = mfe.maxRoiPct;
        touched = true;
      }
      if (row.maxDrawdownPct !== mfe.maxDrawdownPct) {
        row.maxDrawdownPct = mfe.maxDrawdownPct;
        touched = true;
      }
      if (row.durationToMfeHours !== mfe.durationToMfeHours) {
        row.durationToMfeHours = mfe.durationToMfeHours;
        touched = true;
      }
      const resolved = resolveAutoOpenStrategyAt48h(row.source, mfe.maxRoiPct, row.pct48h);
      if (row.strategyOutcome !== resolved.strategyOutcome) {
        row.strategyOutcome = resolved.strategyOutcome;
        touched = true;
      }
      if (row.strategyPct !== resolved.strategyPct) {
        row.strategyPct = resolved.strategyPct;
        touched = true;
      }
    }
  }

  return touched;
}

export async function runAutoOpenOrderLogFollowUpTick(
  nowMs = Date.now(),
): Promise<AutoOpenOrderLogFollowUpResult> {
  if (!isBinanceIndicatorFapiEnabled()) {
    return { dirty: 0, rowsChecked: 0 };
  }

  const state = await loadAutoOpenOrderLogState();
  const nowSec = Math.floor(nowMs / 1000);
  let dirty = 0;
  let rowsChecked = 0;

  for (const row of state.rows) {
    if (backfillAutoOpenEntryPrice(row)) dirty += 1;
  }

  const pending = state.rows.filter((row) => autoOpenNeedsFollowUp(row, nowSec));
  for (const row of pending) {
    if (!autoOpenFollowUpEligible(row)) continue;
    rowsChecked += 1;
    try {
      if (await followUpRow(row, nowMs, nowSec)) dirty += 1;
    } catch (e) {
      console.error("[autoOpenOrderLogFollowUp] row", row.id, row.binanceSymbol, e);
    }
  }

  if (dirty > 0) {
    await saveAutoOpenOrderLogState(state);
  }

  return { dirty, rowsChecked };
}
