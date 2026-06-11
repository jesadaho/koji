import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AutoOpenOrderLogRow,
  AutoOpenSource,
  ReversalAutoOpenAlertSide,
} from "@/lib/autoOpenOrderLogClient";
import { resolveReversalAutoOpenAlertSide } from "@/lib/autoOpenOrderLogClient";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

export type {
  AutoOpenOrderLogRow,
  AutoOpenSource,
} from "@/lib/autoOpenOrderLogClient";

const KV_KEY = "koji:auto_open_order_log";
const filePath = join(process.cwd(), "data", "auto_open_order_log.json");

export type AutoOpenOrderLogState = {
  rows: AutoOpenOrderLogRow[];
};

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ auto-open order log");
  }
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '{"rows":[]}', "utf-8");
  }
}

function maxRows(): number {
  const v = Number(process.env.AUTO_OPEN_LOG_MAX_ROWS);
  if (Number.isFinite(v) && v >= 50 && v <= 5000) return Math.floor(v);
  return 600;
}

function normalizeRow(raw: unknown): AutoOpenOrderLogRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : "";
  const userId = typeof o.userId === "string" && o.userId.trim() ? o.userId.trim() : "";
  const source = o.source === "snowball" || o.source === "reversal" ? o.source : null;
  const outcome =
    o.outcome === "success" || o.outcome === "skipped" || o.outcome === "failed" ? o.outcome : null;
  const reasonCode = typeof o.reasonCode === "string" ? o.reasonCode.trim() : "";
  const contractSymbol =
    typeof o.contractSymbol === "string" ? o.contractSymbol.trim().toUpperCase() : "";
  const binanceSymbol =
    typeof o.binanceSymbol === "string" ? o.binanceSymbol.trim().toUpperCase() : "";
  const atMs = typeof o.atMs === "number" && Number.isFinite(o.atMs) ? o.atMs : NaN;
  if (!id || !userId || !source || !outcome || !reasonCode || !contractSymbol || !Number.isFinite(atMs)) {
    return null;
  }

  const row: AutoOpenOrderLogRow = {
    id,
    atMs,
    userId,
    source,
    outcome,
    reasonCode,
    contractSymbol,
    binanceSymbol: binanceSymbol || contractSymbol.replace(/_USDT$/i, "USDT"),
  };

  if (typeof o.reasonDetail === "string" && o.reasonDetail.trim()) {
    row.reasonDetail = o.reasonDetail.trim().slice(0, 400);
  }
  if (o.side === "long" || o.side === "short") row.side = o.side;
  if (o.alertSide === "long" || o.alertSide === "bear") row.alertSide = o.alertSide;
  if (o.reversalAlertSide === "short" || o.reversalAlertSide === "long") {
    row.reversalAlertSide = o.reversalAlertSide;
  }
  if (typeof o.gradeKey === "string") row.gradeKey = o.gradeKey;
  else if (o.gradeKey === null) row.gradeKey = null;
  if (typeof o.signalBarTf === "string") row.signalBarTf = o.signalBarTf;
  if (typeof o.signalBarOpenSec === "number" && Number.isFinite(o.signalBarOpenSec)) {
    row.signalBarOpenSec = o.signalBarOpenSec;
  }
  if (typeof o.marginUsdt === "number" && Number.isFinite(o.marginUsdt)) row.marginUsdt = o.marginUsdt;
  if (typeof o.leverage === "number" && Number.isFinite(o.leverage)) row.leverage = o.leverage;
  if (typeof o.marginScale === "number" && Number.isFinite(o.marginScale)) row.marginScale = o.marginScale;
  if (typeof o.model === "string") row.model = o.model;
  if (typeof o.bodyRatio === "number" && Number.isFinite(o.bodyRatio)) row.bodyRatio = o.bodyRatio;
  if (typeof o.wickRatio === "number" && Number.isFinite(o.wickRatio)) row.wickRatio = o.wickRatio;
  if (o.rangeRankInLookback === null) row.rangeRankInLookback = null;
  else if (typeof o.rangeRankInLookback === "number" && Number.isFinite(o.rangeRankInLookback)) {
    row.rangeRankInLookback = o.rangeRankInLookback;
  }
  if (o.orderKind === "market" || o.orderKind === "limit") row.orderKind = o.orderKind;
  if (o.entryMode === "hybrid_ema" || o.entryMode === "market") row.entryMode = o.entryMode;
  if (typeof o.entryEmaPeriod === "number" && Number.isFinite(o.entryEmaPeriod)) {
    row.entryEmaPeriod = o.entryEmaPeriod;
  }
  if (typeof o.entryEma15m === "number" && Number.isFinite(o.entryEma15m)) row.entryEma15m = o.entryEma15m;
  if (typeof o.entryEma1h === "number" && Number.isFinite(o.entryEma1h)) row.entryEma1h = o.entryEma1h;
  if (typeof o.ema25_15m === "number" && Number.isFinite(o.ema25_15m)) row.ema25_15m = o.ema25_15m;
  if (typeof o.ema20_15m === "number" && Number.isFinite(o.ema20_15m)) row.ema20_15m = o.ema20_15m;
  if (typeof o.ema50_15m === "number" && Number.isFinite(o.ema50_15m)) row.ema50_15m = o.ema50_15m;
  if (typeof o.markPrice === "number" && Number.isFinite(o.markPrice)) row.markPrice = o.markPrice;
  if (typeof o.entryPrice === "number" && Number.isFinite(o.entryPrice) && o.entryPrice > 0) {
    row.entryPrice = o.entryPrice;
  }
  const nullNum = (v: unknown): number | null | undefined => {
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return undefined;
  };
  const p4 = nullNum(o.price4h);
  if (p4 !== undefined) row.price4h = p4;
  const pc4 = nullNum(o.pct4h);
  if (pc4 !== undefined) row.pct4h = pc4;
  const p12 = nullNum(o.price12h);
  if (p12 !== undefined) row.price12h = p12;
  const pc12 = nullNum(o.pct12h);
  if (pc12 !== undefined) row.pct12h = pc12;
  const p24 = nullNum(o.price24h);
  if (p24 !== undefined) row.price24h = p24;
  const pc24 = nullNum(o.pct24h);
  if (pc24 !== undefined) row.pct24h = pc24;
  const p48 = nullNum(o.price48h);
  if (p48 !== undefined) row.price48h = p48;
  const pc48 = nullNum(o.pct48h);
  if (pc48 !== undefined) row.pct48h = pc48;
  const maxRoi = nullNum(o.maxRoiPct);
  if (maxRoi !== undefined) row.maxRoiPct = maxRoi;
  const maxDd = nullNum(o.maxDrawdownPct);
  if (maxDd !== undefined) row.maxDrawdownPct = maxDd;
  const durMfe = nullNum(o.durationToMfeHours);
  if (durMfe !== undefined) row.durationToMfeHours = durMfe;
  const stratPct24 = nullNum(o.strategyPct24h);
  if (stratPct24 !== undefined) row.strategyPct24h = stratPct24;
  if (typeof o.strategyOutcome24h === "string" && o.strategyOutcome24h.trim()) {
    row.strategyOutcome24h = o.strategyOutcome24h.trim();
  } else if (o.strategyOutcome24h === null) {
    row.strategyOutcome24h = null;
  }
  if (typeof o.strategyExitReason24h === "string" && o.strategyExitReason24h.trim()) {
    row.strategyExitReason24h = o.strategyExitReason24h.trim() as AutoOpenOrderLogRow["strategyExitReason24h"];
  } else if (o.strategyExitReason24h === null) {
    row.strategyExitReason24h = null;
  }
  const stratPct = nullNum(o.strategyPct);
  if (stratPct !== undefined) row.strategyPct = stratPct;
  if (typeof o.strategyOutcome === "string" && o.strategyOutcome.trim()) {
    row.strategyOutcome = o.strategyOutcome.trim();
  } else if (o.strategyOutcome === null) {
    row.strategyOutcome = null;
  }
  if (typeof o.strategyExitReason === "string" && o.strategyExitReason.trim()) {
    row.strategyExitReason = o.strategyExitReason.trim() as AutoOpenOrderLogRow["strategyExitReason"];
  } else if (o.strategyExitReason === null) {
    row.strategyExitReason = null;
  }
  if (o.strategyProfitByPlan && typeof o.strategyProfitByPlan === "object" && !Array.isArray(o.strategyProfitByPlan)) {
    row.strategyProfitByPlan = o.strategyProfitByPlan as AutoOpenOrderLogRow["strategyProfitByPlan"];
  } else if (o.strategyProfitByPlan === null) {
    row.strategyProfitByPlan = null;
  }
  const mexcPnl = nullNum(o.mexcRealisedPnlUsdt);
  if (mexcPnl !== undefined) row.mexcRealisedPnlUsdt = mexcPnl;
  if (typeof o.mexcClosedAtMs === "number" && Number.isFinite(o.mexcClosedAtMs)) {
    row.mexcClosedAtMs = o.mexcClosedAtMs;
  } else if (o.mexcClosedAtMs === null) {
    row.mexcClosedAtMs = null;
  }
  if (typeof o.mexcPositionId === "number" && Number.isFinite(o.mexcPositionId)) {
    row.mexcPositionId = o.mexcPositionId;
  } else if (o.mexcPositionId === null) {
    row.mexcPositionId = null;
  }
  if (typeof o.limitFilledAtMs === "number" && Number.isFinite(o.limitFilledAtMs)) {
    row.limitFilledAtMs = o.limitFilledAtMs;
  } else if (o.limitFilledAtMs === null) {
    row.limitFilledAtMs = null;
  }

  return row;
}

function normalizeState(raw: unknown): AutoOpenOrderLogState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { rows: [] };
  const o = raw as { rows?: unknown };
  if (!Array.isArray(o.rows)) return { rows: [] };
  const rows: AutoOpenOrderLogRow[] = [];
  for (const item of o.rows) {
    const row = normalizeRow(item);
    if (row) rows.push(row);
  }
  return { rows };
}

export async function loadAutoOpenOrderLogState(): Promise<AutoOpenOrderLogState> {
  if (useCloudStorage()) {
    const data = await cloudGet<AutoOpenOrderLogState>(KV_KEY);
    return normalizeState(data);
  }
  if (isVercel()) return { rows: [] };
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return { rows: [] };
  }
}

export async function saveAutoOpenOrderLogState(state: AutoOpenOrderLogState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export type AppendAutoOpenOrderLogInput = Omit<AutoOpenOrderLogRow, "id" | "atMs"> & {
  id?: string;
  atMs?: number;
};

export async function appendAutoOpenOrderLog(input: AppendAutoOpenOrderLogInput): Promise<void> {
  const row = normalizeRow({
    ...input,
    id: input.id ?? randomUUID(),
    atMs: input.atMs ?? Date.now(),
  });
  if (!row) return;

  const state = await loadAutoOpenOrderLogState();
  state.rows.push(row);
  const cap = maxRows();
  if (state.rows.length > cap) {
    state.rows = state.rows.slice(state.rows.length - cap);
  }
  await saveAutoOpenOrderLogState(state);
}

/** Fire-and-forget — ไม่ให้ล้ม flow auto-open หลัก */
export function appendAutoOpenOrderLogSafe(input: AppendAutoOpenOrderLogInput): void {
  void appendAutoOpenOrderLog(input).catch((e) => {
    console.error("[autoOpenOrderLog] append failed", input.userId, input.reasonCode, e);
  });
}

function matchesReversalAlertSideFilter(
  row: AutoOpenOrderLogRow,
  reversalAlertSide?: ReversalAutoOpenAlertSide,
): boolean {
  if (!reversalAlertSide) return true;
  return row.source === "reversal" && resolveReversalAutoOpenAlertSide(row) === reversalAlertSide;
}

export async function listAutoOpenOrderLogsForUser(
  userId: string,
  opts?: { days?: number; source?: AutoOpenSource; reversalAlertSide?: ReversalAutoOpenAlertSide },
): Promise<AutoOpenOrderLogRow[]> {
  const uid = userId.trim();
  if (!uid) return [];
  const state = await loadAutoOpenOrderLogState();
  let rows = state.rows.filter((r) => r.userId === uid);
  if (opts?.source) rows = rows.filter((r) => r.source === opts.source);
  if (opts?.reversalAlertSide) {
    rows = rows.filter((r) => matchesReversalAlertSideFilter(r, opts.reversalAlertSide));
  }
  if (typeof opts?.days === "number" && opts.days > 0) {
    const cutoff = Date.now() - opts.days * 24 * 3600 * 1000;
    rows = rows.filter((r) => r.atMs >= cutoff);
  }
  rows.sort((a, b) => b.atMs - a.atMs);
  return rows;
}

/** ลบแถว outcome=skipped ของ user (เฉพาะของตัวเอง) */
export async function deleteSkippedAutoOpenOrderLogsForUser(
  userId: string,
  opts?: { source?: AutoOpenSource; reversalAlertSide?: ReversalAutoOpenAlertSide },
): Promise<{ removed: number }> {
  const uid = userId.trim();
  if (!uid) return { removed: 0 };

  const state = await loadAutoOpenOrderLogState();
  const before = state.rows.length;
  state.rows = state.rows.filter((r) => {
    if (r.userId !== uid) return true;
    if (r.outcome !== "skipped") return true;
    if (opts?.source && r.source !== opts.source) return true;
    if (opts?.reversalAlertSide && !matchesReversalAlertSideFilter(r, opts.reversalAlertSide)) {
      return true;
    }
    return false;
  });
  const removed = before - state.rows.length;
  if (removed > 0) await saveAutoOpenOrderLogState(state);
  return { removed };
}

/** อัปเดตแถว log หลัง Limit fill บน MEXC (reversal/snowball limit tick) */
export async function patchAutoOpenOrderLogLimitFill(input: {
  userId: string;
  contractSymbol: string;
  side: "long" | "short";
  mexcAvgEntry: number;
  filledAtMs: number;
}): Promise<boolean> {
  const uid = input.userId.trim();
  const sym = input.contractSymbol.trim().toUpperCase();
  if (!uid || !sym || !(input.mexcAvgEntry > 0) || !Number.isFinite(input.filledAtMs)) {
    return false;
  }

  const state = await loadAutoOpenOrderLogState();
  let best: AutoOpenOrderLogRow | null = null;
  for (const r of state.rows) {
    if (r.userId !== uid || r.contractSymbol !== sym || r.outcome !== "success") continue;
    if (r.side !== input.side) continue;
    if (r.limitFilledAtMs != null) continue;
    const isLimit =
      r.orderKind === "limit" ||
      r.reasonCode === "open_success_limit" ||
      r.reasonCode === "open_success_limit_filled";
    if (!isLimit) continue;
    if (!best || r.atMs > best.atMs) best = r;
  }
  if (!best) return false;

  best.entryPrice = input.mexcAvgEntry;
  best.limitFilledAtMs = input.filledAtMs;
  if (best.reasonCode === "open_success_limit") {
    best.reasonCode = "open_success_limit_filled";
  }
  await saveAutoOpenOrderLogState(state);
  return true;
}

export function patchAutoOpenOrderLogLimitFillSafe(input: {
  userId: string;
  contractSymbol: string;
  side: "long" | "short";
  mexcAvgEntry: number;
  filledAtMs: number;
}): void {
  void patchAutoOpenOrderLogLimitFill(input).catch((e) => {
    console.error("[autoOpenOrderLog] patch limit fill failed", input.userId, input.contractSymbol, e);
  });
}

export async function patchAutoOpenOrderLogMexcPnl(
  updates: {
    id: string;
    mexcRealisedPnlUsdt: number;
    mexcClosedAtMs: number;
    mexcPositionId?: number;
  }[],
): Promise<number> {
  if (updates.length === 0) return 0;
  const state = await loadAutoOpenOrderLogState();
  const byId = new Map(updates.map((u) => [u.id, u]));
  let dirty = 0;
  for (const row of state.rows) {
    const u = byId.get(row.id);
    if (!u) continue;
    row.mexcRealisedPnlUsdt = u.mexcRealisedPnlUsdt;
    row.mexcClosedAtMs = u.mexcClosedAtMs;
    if (u.mexcPositionId != null) row.mexcPositionId = u.mexcPositionId;
    dirty += 1;
  }
  if (dirty > 0) await saveAutoOpenOrderLogState(state);
  return dirty;
}

export async function countSkippedAutoOpenOrderLogsForUser(
  userId: string,
  opts?: { source?: AutoOpenSource; reversalAlertSide?: ReversalAutoOpenAlertSide },
): Promise<number> {
  const uid = userId.trim();
  if (!uid) return 0;

  const state = await loadAutoOpenOrderLogState();
  return state.rows.filter((r) => {
    if (r.userId !== uid) return false;
    if (r.outcome !== "skipped") return false;
    if (opts?.source && r.source !== opts.source) return false;
    if (opts?.reversalAlertSide && !matchesReversalAlertSideFilter(r, opts.reversalAlertSide)) {
      return false;
    }
    return true;
  }).length;
}
