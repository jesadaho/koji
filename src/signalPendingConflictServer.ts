import "server-only";

import {
  buildStatsConflictIndex,
  isReversalAfterPendingSnowball,
  pendingConflictSymbolKey,
  pendingConflictWithLabel,
  shouldDualPendingConflictClose,
  type PendingConflictSets,
  type PendingStrategy,
  type StatsConflictIndex,
} from "@/lib/signalPendingConflict";
import {
  loadCandleReversalStatsState,
  saveCandleReversalStatsState,
} from "./candleReversalStatsStore";
import { loadSnowballPendingConfirms } from "./snowballConfirmStore";
import { loadSnowballStatsState, saveSnowballStatsState } from "./snowballStatsStore";

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

function oppositePendingForSymbol(
  sets: PendingConflictSets,
  symbol: string,
  self: PendingStrategy,
): boolean {
  const k = pendingConflictSymbolKey(symbol);
  if (!k) return false;
  if (self === "snowball") return sets.reversalPending.has(k);
  return sets.snowballPending.has(k);
}

/** alertedAtMs ล่าสุดของ Snowball pending (stats + confirm queue) ต่อเหรียญ */
export async function getLatestPendingSnowballAtMsForSymbol(
  symbol: string,
  nowMs = Date.now(),
): Promise<number | null> {
  const key = pendingConflictSymbolKey(symbol);
  if (!key) return null;
  let latest: number | null = null;

  try {
    const stats = await loadSnowballStatsState();
    for (const r of stats.rows ?? []) {
      if (!r || r.outcome !== "pending") continue;
      if (pendingConflictSymbolKey(r.symbol) !== key) continue;
      const atMs = typeof r.alertedAtMs === "number" && Number.isFinite(r.alertedAtMs) ? r.alertedAtMs : 0;
      if (atMs > 0 && nowMs - atMs > SNOWBALL_STATS_PENDING_MAX_AGE_MS) continue;
      latest = latest == null ? atMs : Math.max(latest, atMs);
    }
  } catch {
    /* ignore */
  }

  try {
    const pend = await loadSnowballPendingConfirms();
    for (const it of pend.items ?? []) {
      if (pendingConflictSymbolKey(it.symbol) !== key) continue;
      const atMs = typeof it.alertedAtMs === "number" && Number.isFinite(it.alertedAtMs) ? it.alertedAtMs : 0;
      if (atMs > 0) latest = latest == null ? atMs : Math.max(latest, atMs);
    }
  } catch {
    /* ignore */
  }

  return latest;
}

/** alertedAtMs ล่าสุดของ Reversal pending ต่อเหรียญ */
export async function getLatestPendingReversalAtMsForSymbol(symbol: string): Promise<number | null> {
  const key = pendingConflictSymbolKey(symbol);
  if (!key) return null;
  let latest: number | null = null;

  try {
    const rev = await loadCandleReversalStatsState();
    for (const r of rev.rows ?? []) {
      if (!r || r.outcome !== "pending") continue;
      if (pendingConflictSymbolKey(r.symbol) !== key) continue;
      const atMs = typeof r.alertedAtMs === "number" && Number.isFinite(r.alertedAtMs) ? r.alertedAtMs : 0;
      if (atMs > 0) latest = latest == null ? atMs : Math.max(latest, atMs);
    }
  } catch {
    /* ignore */
  }

  return latest;
}

/**
 * ตอนแจ้งสัญญาณใหม่ — ถ้าฝั่งตรงข้ามยัง pending ให้ stamp conflictWith ลง store (ถาวร)
 * คืนค่าสำหรับแถวใหม่ · null ถ้าไม่มี conflict
 */
export async function stampPendingConflictOnStatsAppend(
  symbol: string,
  self: PendingStrategy,
  nowMs = Date.now(),
): Promise<string | null> {
  const sets = await loadPendingConflictSets(nowMs);
  if (!oppositePendingForSymbol(sets, symbol, self)) return null;

  const newRowLabel = self === "snowball" ? "Reversal" : "Snowball";
  const oppositeLabel = self === "snowball" ? "Snowball" : "Reversal";
  const key = pendingConflictSymbolKey(symbol);
  if (!key) return null;

  if (self === "snowball") {
    const revState = await loadCandleReversalStatsState();
    let dirty = false;
    for (const r of revState.rows) {
      if (r.outcome !== "pending") continue;
      if (pendingConflictSymbolKey(r.symbol) !== key) continue;
      if (r.conflictWith === oppositeLabel) continue;
      r.conflictWith = oppositeLabel;
      dirty = true;
    }
    if (dirty) await saveCandleReversalStatsState(revState);
  } else {
    const sbState = await loadSnowballStatsState();
    let dirty = false;
    for (const r of sbState.rows) {
      if (r.outcome !== "pending") continue;
      const atMs = typeof r.alertedAtMs === "number" && Number.isFinite(r.alertedAtMs) ? r.alertedAtMs : 0;
      if (atMs > 0 && nowMs - atMs > SNOWBALL_STATS_PENDING_MAX_AGE_MS) continue;
      if (pendingConflictSymbolKey(r.symbol) !== key) continue;
      if (r.conflictWith === oppositeLabel) continue;
      r.conflictWith = oppositeLabel;
      dirty = true;
    }
    if (dirty) await saveSnowballStatsState(sbState);
  }

  return newRowLabel;
}

/** ดัชนี conflict ถาวรจากสถิติ — ใช้ enrich ประวัติ auto-open แถวเก่า */
export async function loadStatsConflictIndex(): Promise<StatsConflictIndex> {
  const entries: Array<{
    symbol: string;
    source: PendingStrategy;
    conflictWith?: string | null;
    alertedAtMs: number;
    signalBarOpenSec?: number | null;
  }> = [];

  try {
    const stats = await loadSnowballStatsState();
    for (const r of stats.rows ?? []) {
      if (!r?.conflictWith?.trim()) continue;
      entries.push({
        symbol: r.symbol,
        source: "snowball",
        conflictWith: r.conflictWith,
        alertedAtMs: r.alertedAtMs,
        signalBarOpenSec: r.signalBarOpenSec,
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const rev = await loadCandleReversalStatsState();
    for (const r of rev.rows ?? []) {
      if (!r?.conflictWith?.trim()) continue;
      entries.push({
        symbol: r.symbol,
        source: "reversal",
        conflictWith: r.conflictWith,
        alertedAtMs: r.alertedAtMs,
        signalBarOpenSec: r.signalBarOpenSec,
      });
    }
  } catch {
    /* ignore */
  }

  return buildStatsConflictIndex(entries);
}

/** ข้าม auto-open เมื่อฝั่งตรงข้ามยัง pending (รวมกรณี conflict สองฝั่ง) */
export async function shouldSkipAutoOpenForPendingConflict(
  binanceSymbol: string,
  self: PendingStrategy,
  opts?: { atMs?: number },
): Promise<boolean> {
  const sets = await loadPendingConflictSets();
  const k = pendingConflictSymbolKey(binanceSymbol);
  if (!k) return false;
  if (self === "snowball") return sets.reversalPending.has(k);
  if (!sets.snowballPending.has(k)) return false;

  const atMs = opts?.atMs ?? Date.now();
  const snowballMs = await getLatestPendingSnowballAtMsForSymbol(binanceSymbol, atMs);
  if (isReversalAfterPendingSnowball(snowballMs, atMs)) return false;
  return true;
}

/** ควร conflict-close สำหรับเหรียญนี้หรือไม่ (false = Reversal เกิดหลัง Snowball → ปล่อย Reversal เปิด/ถือต่อ) */
export async function shouldConflictCloseDualPendingForSymbol(
  symbol: string,
  sets: PendingConflictSets,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!sets.snowballPending.has(pendingConflictSymbolKey(symbol))) return false;
  if (!sets.reversalPending.has(pendingConflictSymbolKey(symbol))) return false;

  const [snowballMs, reversalMs] = await Promise.all([
    getLatestPendingSnowballAtMsForSymbol(symbol, nowMs),
    getLatestPendingReversalAtMsForSymbol(symbol),
  ]);
  return shouldDualPendingConflictClose(snowballMs, reversalMs);
}
