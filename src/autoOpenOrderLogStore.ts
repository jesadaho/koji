import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AutoOpenOrderLogRow,
  AutoOpenSource,
} from "@/lib/autoOpenOrderLogClient";
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
  if (typeof o.ema50_15m === "number" && Number.isFinite(o.ema50_15m)) row.ema50_15m = o.ema50_15m;
  if (typeof o.markPrice === "number" && Number.isFinite(o.markPrice)) row.markPrice = o.markPrice;

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

export async function listAutoOpenOrderLogsForUser(
  userId: string,
  opts?: { days?: number; source?: AutoOpenSource },
): Promise<AutoOpenOrderLogRow[]> {
  const uid = userId.trim();
  if (!uid) return [];
  const state = await loadAutoOpenOrderLogState();
  let rows = state.rows.filter((r) => r.userId === uid);
  if (opts?.source) rows = rows.filter((r) => r.source === opts.source);
  if (typeof opts?.days === "number" && opts.days > 0) {
    const cutoff = Date.now() - opts.days * 24 * 3600 * 1000;
    rows = rows.filter((r) => r.atMs >= cutoff);
  }
  rows.sort((a, b) => b.atMs - a.atMs);
  return rows;
}
