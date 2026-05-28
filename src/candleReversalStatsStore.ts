import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CandleReversalStatsApiPayload,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import { loadMarketSentimentSnapshot } from "./marketSentimentSnapshotStore";

export type { CandleReversalStatsApiPayload, CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

const KV_KEY = "koji:candle_reversal_alert_stats";
const filePath = join(process.cwd(), "data", "candle_reversal_alert_stats.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ candle reversal stats");
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

export type CandleReversalStatsState = {
  rows: CandleReversalStatsRow[];
};

function maxRows(): number {
  const v = Number(process.env.CANDLE_REVERSAL_STATS_MAX_ROWS);
  if (Number.isFinite(v) && v >= 20 && v <= 2000) return Math.floor(v);
  return 300;
}

export function isCandleReversalStatsEnabled(): boolean {
  const raw = process.env.CANDLE_REVERSAL_STATS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw === "true" || raw === "yes";
}

type LegacyCandleReversalRow = CandleReversalStatsRow & {
  price4h?: number | null;
  pct4h?: number | null;
  price12h?: number | null;
  pct12h?: number | null;
  price24h?: number | null;
  pct24h?: number | null;
  price48h?: number | null;
  pct48h?: number | null;
};

type LegacyCandleReversalRowV1 = LegacyCandleReversalRow & {
  signalBarTf?: CandleReversalStatsRow["signalBarTf"];
  rangeScore?: number | null;
  wickScore?: number | null;
  rangeRankInLookback?: number | null;
};

function finiteRank(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v >= 1 ? Math.floor(v) : null;
}

function nullNum(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

function normalizeCandleReversalStatsRow(r: LegacyCandleReversalRowV1): CandleReversalStatsRow {
  return {
    ...r,
    signalBarTf: r.signalBarTf === "1h" ? "1h" : "1d",
    highRankInLookback: finiteRank(r.highRankInLookback),
    rangeRankInLookback: finiteRank(r.rangeRankInLookback),
    volRankInLookback: finiteRank(r.volRankInLookback),
    lookbackBars: finiteRank(r.lookbackBars),
    rangeScore: r.rangeScore != null && Number.isFinite(r.rangeScore) ? r.rangeScore : null,
    wickScore: r.wickScore != null && Number.isFinite(r.wickScore) ? r.wickScore : null,
    price4h: nullNum(r.price4h),
    pct4h: nullNum(r.pct4h),
    price12h: nullNum(r.price12h),
    pct12h: nullNum(r.pct12h),
    price24h: nullNum(r.price24h),
    pct24h: nullNum(r.pct24h),
    price48h: nullNum(r.price48h),
    pct48h: nullNum(r.pct48h),
    price1d: nullNum(r.price1d),
    pct1d: nullNum(r.pct1d),
    price3d: nullNum(r.price3d),
    pct3d: nullNum(r.pct3d),
    price7d: nullNum(r.price7d),
    pct7d: nullNum(r.pct7d),
    followUpMaxAdversePct: nullNum(r.followUpMaxAdversePct),
  };
}

export async function loadCandleReversalStatsState(): Promise<CandleReversalStatsState> {
  const mapRows = (rows: LegacyCandleReversalRow[]) => rows.map(normalizeCandleReversalStatsRow);

  if (useCloudStorage()) {
    const data = await cloudGet<CandleReversalStatsState>(KV_KEY);
    if (data && Array.isArray(data.rows)) return { rows: mapRows(data.rows as LegacyCandleReversalRow[]) };
    return { rows: [] };
  }
  if (isVercel()) return { rows: [] };
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as CandleReversalStatsState;
    if (parsed && Array.isArray(parsed.rows)) {
      return { rows: mapRows(parsed.rows as LegacyCandleReversalRow[]) };
    }
  } catch {
    /* empty */
  }
  return { rows: [] };
}

export async function saveCandleReversalStatsState(state: CandleReversalStatsState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export type AppendCandleReversalStatsInput = {
  symbol: string;
  signalBarTf: CandleReversalStatsRow["signalBarTf"];
  model: CandleReversalStatsRow["model"];
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  entryPrice: number;
  retestPrice: number;
  slPrice: number;
  wickRatioPct?: number | null;
  bodyPct?: number | null;
  highRankInLookback?: number | null;
  rangeRankInLookback?: number | null;
  volRankInLookback?: number | null;
  lookbackBars?: number | null;
  rangeScore?: number | null;
  wickScore?: number | null;
  afterInvertedDoji?: boolean;
  greenDaysBeforeSignal?: number | null;
};

function normalizeStatsSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function pendingReversalStatsKey(symbol: string, signalBarTf: CandleReversalStatsRow["signalBarTf"]): string {
  return `${normalizeStatsSymbol(symbol)}:${signalBarTf === "1h" ? "1h" : "1d"}`;
}

/** มีแถว pending อยู่แล้วสำหรับเหรียญ+TF นี้ */
export function hasPendingCandleReversalStatsRow(
  rows: CandleReversalStatsRow[],
  symbol: string,
  signalBarTf: CandleReversalStatsRow["signalBarTf"],
): boolean {
  const key = pendingReversalStatsKey(symbol, signalBarTf);
  return rows.some(
    (r) => r.outcome === "pending" && pendingReversalStatsKey(r.symbol, r.signalBarTf ?? "1d") === key,
  );
}

/** คีย์ symbol:tf ของทุกแถว pending — ใช้กันยิงซ้ำระหว่างสแกน */
export function candleReversalPendingStatsKeys(rows: CandleReversalStatsRow[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.outcome !== "pending") continue;
    keys.add(pendingReversalStatsKey(r.symbol, r.signalBarTf ?? "1d"));
  }
  return keys;
}

/**
 * ลบแถว pending ซ้ำ — ต่อเหรียญ+TF คงแถวที่แจ้งเร็วสุด (alertedAtMs น้อยสุด)
 */
export async function removeCandleReversalStatsDuplicatePendingRows(opts?: {
  symbol?: string;
}): Promise<{ removed: number; kept: number; scanned: number }> {
  const symbolFilter = opts?.symbol?.trim().toUpperCase() || null;
  const state = await loadCandleReversalStatsState();
  const rows = state.rows ?? [];
  const scanned = rows.length;

  const byKey = new Map<string, CandleReversalStatsRow[]>();
  for (const r of rows) {
    if (r.outcome !== "pending") continue;
    const sym = normalizeStatsSymbol(r.symbol);
    if (symbolFilter && sym !== symbolFilter) continue;
    const key = pendingReversalStatsKey(sym, r.signalBarTf ?? "1d");
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }

  const toDrop = new Set<string>();
  for (const arr of Array.from(byKey.values())) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => (a.alertedAtMs ?? 0) - (b.alertedAtMs ?? 0));
    for (let i = 1; i < arr.length; i++) {
      toDrop.add(arr[i]!.id);
    }
  }

  if (toDrop.size === 0) {
    return { removed: 0, kept: rows.length, scanned };
  }

  const next = rows.filter((r) => !toDrop.has(r.id));
  await saveCandleReversalStatsState({ rows: next });
  return { removed: toDrop.size, kept: next.length, scanned };
}

export async function appendCandleReversalStatsRow(
  input: AppendCandleReversalStatsInput,
): Promise<CandleReversalStatsRow | null> {
  if (!isCandleReversalStatsEnabled()) return null;

  const signalBarTf = input.signalBarTf === "1h" ? "1h" : "1d";
  const state = await loadCandleReversalStatsState();
  if (hasPendingCandleReversalStatsRow(state.rows, input.symbol, signalBarTf)) {
    return null;
  }

  let marketSentiment: CandleReversalStatsRow["marketSentiment"] = null;
  try {
    marketSentiment = await loadMarketSentimentSnapshot();
  } catch {
    /* ignore */
  }

  const rangeScore =
    input.rangeScore != null && Number.isFinite(input.rangeScore) && input.rangeScore >= 0
      ? input.rangeScore
      : null;
  const wickScore =
    input.wickScore != null && Number.isFinite(input.wickScore) && input.wickScore >= 0
      ? input.wickScore
      : null;

  const row: CandleReversalStatsRow = {
    id: randomUUID(),
    symbol: normalizeStatsSymbol(input.symbol),
    signalBarTf,
    model: input.model,
    alertedAtIso: input.alertedAtIso,
    alertedAtMs: input.alertedAtMs,
    signalBarOpenSec: input.signalBarOpenSec,
    entryPrice: input.entryPrice,
    retestPrice: input.retestPrice,
    slPrice: input.slPrice,
    wickRatioPct:
      input.wickRatioPct != null && Number.isFinite(input.wickRatioPct) ? input.wickRatioPct : null,
    bodyPct: input.bodyPct != null && Number.isFinite(input.bodyPct) ? input.bodyPct : null,
    highRankInLookback: finiteRank(input.highRankInLookback),
    rangeRankInLookback: finiteRank(input.rangeRankInLookback),
    volRankInLookback: finiteRank(input.volRankInLookback),
    lookbackBars: finiteRank(input.lookbackBars),
    rangeScore,
    wickScore,
    marketSentiment,
    afterInvertedDoji: Boolean(input.afterInvertedDoji),
    greenDaysBeforeSignal:
      input.greenDaysBeforeSignal != null &&
      Number.isFinite(input.greenDaysBeforeSignal) &&
      input.greenDaysBeforeSignal >= 0
        ? Math.floor(input.greenDaysBeforeSignal)
        : null,
    price4h: null,
    pct4h: null,
    price12h: null,
    pct12h: null,
    price24h: null,
    pct24h: null,
    price48h: null,
    pct48h: null,
    price1d: null,
    pct1d: null,
    price3d: null,
    pct3d: null,
    price7d: null,
    pct7d: null,
    maxRoiPct: null,
    durationToMfeHours: null,
    maxDrawdownPct: null,
    followUpMaxAdversePct: null,
    outcome: "pending",
  };

  state.rows.push(row);
  const max = maxRows();
  if (state.rows.length > max) {
    state.rows.splice(0, state.rows.length - max);
  }
  await saveCandleReversalStatsState(state);
  return row;
}

const EMPTY_CANDLE_REVERSAL_STATS_STATE: CandleReversalStatsState = { rows: [] };

/** ล้างตารางสถิติ Reversal ทั้งหมด */
export async function resetCandleReversalStatsState(): Promise<void> {
  await saveCandleReversalStatsState(EMPTY_CANDLE_REVERSAL_STATS_STATE);
}
