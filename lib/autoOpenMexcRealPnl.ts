import { resolveAutoOpenEntryPrice, resolveAutoOpenOrderKind } from "@/lib/autoOpenFollowUp";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { formatStatsStrategyProfitDollarAmount } from "@/lib/statsStrategyProfitClient";
import type { MexcHistoricalPositionRow } from "@/src/mexcFuturesClient";
import type { OpenPositionRow } from "@/src/mexcFuturesClient";

export type AutoOpenMexcRealisedSummary = {
  trades: number;
  sumUsdt: number | null;
};

export function autoOpenMexcPnlNeedsBackfill(row: AutoOpenOrderLogRow): boolean {
  if (row.outcome !== "success") return false;
  if (row.side !== "long" && row.side !== "short") return false;
  if (row.mexcRealisedPnlUsdt != null && Number.isFinite(row.mexcRealisedPnlUsdt)) return false;
  return true;
}

export function mexcPositionTypeForSide(side: "long" | "short"): 1 | 2 {
  return side === "long" ? 1 : 2;
}

export function parseMexcHistoryTimeMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Date.parse(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function isMexcPositionStillOpen(
  openPositions: OpenPositionRow[],
  contractSymbol: string,
  side: "long" | "short",
): boolean {
  const sym = contractSymbol.trim().toUpperCase();
  const wantType = mexcPositionTypeForSide(side);
  return openPositions.some(
    (p) =>
      p.symbol === sym &&
      p.state === 1 &&
      Number(p.holdVol) > 0 &&
      p.positionType === wantType,
  );
}

function autoOpenMexcMatchWindowMs(row: AutoOpenOrderLogRow): { startMs: number; endMs: number } {
  if (resolveAutoOpenOrderKind(row) === "limit") {
    return { startMs: row.atMs, endMs: row.atMs + 8 * 3600_000 + 30 * 60_000 };
  }
  return { startMs: row.atMs - 5 * 60_000, endMs: row.atMs + 60 * 60_000 };
}

export function matchMexcHistoricalPosition(
  row: AutoOpenOrderLogRow,
  history: MexcHistoricalPositionRow[],
  usedPositionIds: Set<number>,
): MexcHistoricalPositionRow | null {
  const sym = row.contractSymbol.trim().toUpperCase();
  const wantType = mexcPositionTypeForSide(row.side!);
  const { startMs, endMs } = autoOpenMexcMatchWindowMs(row);
  const entry = resolveAutoOpenEntryPrice(row);

  const candidates = history.filter((p) => {
    if (usedPositionIds.has(p.positionId)) return false;
    if (p.symbol !== sym) return false;
    if (p.positionType !== wantType) return false;
    if (p.state !== 3) return false;
    const createMs = parseMexcHistoryTimeMs(p.createTime);
    const updateMs = parseMexcHistoryTimeMs(p.updateTime);
    if (createMs == null || updateMs == null) return false;
    if (createMs < startMs || createMs > endMs) return false;
    if (updateMs < row.atMs) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ca = parseMexcHistoryTimeMs(a.createTime) ?? 0;
    const cb = parseMexcHistoryTimeMs(b.createTime) ?? 0;
    return Math.abs(ca - row.atMs) - Math.abs(cb - row.atMs);
  });

  if (entry != null && entry > 0) {
    for (const c of candidates) {
      const openPx = Number(c.openAvgPrice);
      if (!Number.isFinite(openPx) || openPx <= 0) continue;
      const diff = Math.abs(openPx - entry) / entry;
      if (diff <= 0.03) return c;
    }
  }

  return candidates[0] ?? null;
}

export function summarizeAutoOpenMexcRealisedPnl(
  rows: AutoOpenOrderLogRow[],
): AutoOpenMexcRealisedSummary {
  let trades = 0;
  let sumUsdt = 0;
  let hasSum = false;
  for (const r of rows) {
    const pnl = r.mexcRealisedPnlUsdt;
    if (pnl == null || !Number.isFinite(pnl)) continue;
    trades += 1;
    sumUsdt += pnl;
    hasSum = true;
  }
  return { trades, sumUsdt: hasSum ? sumUsdt : null };
}

export function formatAutoOpenMexcRealisedSummaryText(summary: AutoOpenMexcRealisedSummary): string | null {
  if (summary.trades === 0 || summary.sumUsdt == null) return null;
  return `MEXC Realised ${formatStatsStrategyProfitDollarAmount(summary.sumUsdt)} (${summary.trades} ไม้)`;
}
