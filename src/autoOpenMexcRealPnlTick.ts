import {
  autoOpenMexcPnlNeedsBackfill,
  isMexcPositionStillOpen,
  matchMexcHistoricalPosition,
  parseMexcHistoryTimeMs,
} from "@/lib/autoOpenMexcRealPnl";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import {
  fetchAllOpenPositions,
  fetchHistoricalPositions,
  type MexcCredentials,
  type MexcHistoricalPositionRow,
} from "./mexcFuturesClient";
import {
  loadAutoOpenOrderLogState,
  patchAutoOpenOrderLogMexcPnl,
} from "./autoOpenOrderLogStore";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";

export type AutoOpenMexcRealPnlTickResult = {
  dirty: number;
  rowsChecked: number;
};

const MAX_ROWS_PER_USER = 30;

async function fetchUserHistoryForRows(
  creds: MexcCredentials,
  rows: AutoOpenOrderLogRow[],
): Promise<MexcHistoricalPositionRow[]> {
  if (rows.length === 0) return [];
  const symbols = [...new Set(rows.map((r) => r.contractSymbol.trim().toUpperCase()))];
  const minAt = Math.min(...rows.map((r) => r.atMs));
  const startTimeMs = minAt - 10 * 60_000;
  const endTimeMs = Date.now() + 60_000;
  const merged: MexcHistoricalPositionRow[] = [];
  const seen = new Set<number>();

  for (const symbol of symbols) {
    const res = await fetchHistoricalPositions(creds, {
      symbol,
      startTimeMs,
      endTimeMs,
      pageSize: 100,
      maxPages: 5,
    });
    if (!res.ok) continue;
    for (const row of res.rows) {
      if (seen.has(row.positionId)) continue;
      seen.add(row.positionId);
      merged.push(row);
    }
  }

  return merged;
}

async function backfillUserRows(
  userId: string,
  creds: MexcCredentials,
  rows: AutoOpenOrderLogRow[],
): Promise<{ dirty: number; rowsChecked: number }> {
  const pending = rows.filter(autoOpenMexcPnlNeedsBackfill).slice(0, MAX_ROWS_PER_USER);
  if (pending.length === 0) return { dirty: 0, rowsChecked: 0 };

  const openRes = await fetchAllOpenPositions(creds);
  const openPositions = openRes.ok ? openRes.rows : [];

  const closedCandidates = pending.filter(
    (row) => !isMexcPositionStillOpen(openPositions, row.contractSymbol, row.side!),
  );
  if (closedCandidates.length === 0) {
    return { dirty: 0, rowsChecked: pending.length };
  }

  const history = await fetchUserHistoryForRows(creds, closedCandidates);
  const usedPositionIds = new Set<number>();
  const updates: {
    id: string;
    mexcRealisedPnlUsdt: number;
    mexcClosedAtMs: number;
    mexcPositionId?: number;
  }[] = [];

  for (const row of closedCandidates) {
    const match = matchMexcHistoricalPosition(row, history, usedPositionIds);
    if (!match) continue;
    const realised = Number(match.realised);
    const closedAtMs = parseMexcHistoryTimeMs(match.updateTime);
    if (!Number.isFinite(realised) || closedAtMs == null) continue;
    usedPositionIds.add(match.positionId);
    updates.push({
      id: row.id,
      mexcRealisedPnlUsdt: realised,
      mexcClosedAtMs: closedAtMs,
      mexcPositionId: match.positionId,
    });
  }

  const dirty = updates.length > 0 ? await patchAutoOpenOrderLogMexcPnl(updates) : 0;
  return { dirty, rowsChecked: pending.length };
}

export async function runAutoOpenMexcRealPnlTick(
  nowMs = Date.now(),
): Promise<AutoOpenMexcRealPnlTickResult> {
  void nowMs;
  const [state, credsMap] = await Promise.all([
    loadAutoOpenOrderLogState(),
    loadTradingViewMexcSettingsFullMap(),
  ]);

  const byUser = new Map<string, AutoOpenOrderLogRow[]>();
  for (const row of state.rows) {
    if (!autoOpenMexcPnlNeedsBackfill(row)) continue;
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  let dirty = 0;
  let rowsChecked = 0;

  for (const [userId, userRows] of byUser) {
    const row = credsMap[userId];
    if (!row?.mexcApiKey?.trim() || !row?.mexcSecret?.trim()) continue;
    const creds: MexcCredentials = {
      apiKey: row.mexcApiKey.trim(),
      secret: row.mexcSecret.trim(),
    };
    try {
      const res = await backfillUserRows(userId, creds, userRows);
      dirty += res.dirty;
      rowsChecked += res.rowsChecked;
    } catch (e) {
      console.error("[autoOpenMexcRealPnl] user", userId, e);
    }
  }

  return { dirty, rowsChecked };
}
