import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CandleReversalStatsApiPayload,
  type CandleReversalStatsRow,
} from "@/lib/candleReversalStatsClient";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

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
};

function normalizeCandleReversalStatsRow(r: LegacyCandleReversalRow): CandleReversalStatsRow {
  return {
    ...r,
    price1d: r.price1d ?? r.price4h ?? null,
    pct1d: r.pct1d ?? r.pct4h ?? null,
    price3d: r.price3d ?? r.price12h ?? null,
    pct3d: r.pct3d ?? r.pct12h ?? null,
    price7d: r.price7d ?? r.price24h ?? null,
    pct7d: r.pct7d ?? r.pct24h ?? null,
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
  model: CandleReversalStatsRow["model"];
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  entryPrice: number;
  retestPrice: number;
  slPrice: number;
  wickRatioPct?: number | null;
  bodyPct?: number | null;
  afterInvertedDoji?: boolean;
};

export async function appendCandleReversalStatsRow(
  input: AppendCandleReversalStatsInput,
): Promise<CandleReversalStatsRow | null> {
  if (!isCandleReversalStatsEnabled()) return null;

  const row: CandleReversalStatsRow = {
    id: randomUUID(),
    symbol: input.symbol.trim().toUpperCase(),
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
    afterInvertedDoji: Boolean(input.afterInvertedDoji),
    price1d: null,
    pct1d: null,
    price3d: null,
    pct3d: null,
    price7d: null,
    pct7d: null,
    maxRoiPct: null,
    durationToMfeHours: null,
    maxDrawdownPct: null,
    outcome: "pending",
  };

  const state = await loadCandleReversalStatsState();
  state.rows.push(row);
  const max = maxRows();
  if (state.rows.length > max) {
    state.rows.splice(0, state.rows.length - max);
  }
  await saveCandleReversalStatsState(state);
  return row;
}
