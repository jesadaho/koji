import "server-only";

import {
  pendingConflictSymbolKey,
  pendingConflictWithLabel,
  type PendingConflictSets,
  type PendingStrategy,
} from "@/lib/signalPendingConflict";
import { loadCandleReversalStatsState } from "./candleReversalStatsStore";
import { loadSnowballPendingConfirms } from "./snowballConfirmStore";
import { loadSnowballStatsState } from "./snowballStatsStore";

const SNOWBALL_STATS_PENDING_MAX_AGE_MS = 30 * 3600 * 1000;

export async function loadPendingConflictSets(nowMs = Date.now()): Promise<PendingConflictSets> {
  const snowballPending = new Set<string>();
  const reversalPending = new Set<string>();

  try {
    const stats = await loadSnowballStatsState();
    for (const r of stats.rows ?? []) {
      if (!r || r.outcome !== "pending") continue;
      const atMs = typeof r.alertedAtMs === "number" && Number.isFinite(r.alertedAtMs) ? r.alertedAtMs : 0;
      if (atMs > 0 && nowMs - atMs > SNOWBALL_STATS_PENDING_MAX_AGE_MS) continue;
      const k = pendingConflictSymbolKey(r.symbol);
      if (k) snowballPending.add(k);
    }
  } catch {
    /* ignore */
  }

  try {
    const pend = await loadSnowballPendingConfirms();
    for (const it of pend.items ?? []) {
      const k = pendingConflictSymbolKey(it.symbol);
      if (k) snowballPending.add(k);
    }
  } catch {
    /* ignore */
  }

  try {
    const rev = await loadCandleReversalStatsState();
    for (const r of rev.rows ?? []) {
      if (!r || r.outcome !== "pending") continue;
      const k = pendingConflictSymbolKey(r.symbol);
      if (k) reversalPending.add(k);
    }
  } catch {
    /* ignore */
  }

  return { snowballPending, reversalPending };
}

export function conflictWithForSymbol(
  sets: PendingConflictSets,
  symbol: string,
  self: PendingStrategy,
): string | null {
  return pendingConflictWithLabel(sets, symbol, self);
}
