import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type RsiDivergenceKind,
  type RsiDivergenceStatsApiPayload,
  type RsiDivergenceStatsRow,
  type RsiDivergenceTf,
  type RsiDivergenceTrigger,
} from "@/lib/rsiDivergenceStatsClient";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import { resolveMarketSentimentForStats } from "./marketSentimentSnapshotStore";

export type { RsiDivergenceStatsApiPayload, RsiDivergenceStatsRow } from "@/lib/rsiDivergenceStatsClient";

const KV_KEY = "koji:rsi_divergence_alert_stats";
const filePath = join(process.cwd(), "data", "rsi_divergence_alert_stats.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ RSI divergence stats");
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

export type RsiDivergenceStatsState = {
  rows: RsiDivergenceStatsRow[];
};

function maxRows(): number {
  const v = Number(process.env.RSI_DIVERGENCE_STATS_MAX_ROWS);
  if (Number.isFinite(v) && v >= 20 && v <= 2000) return Math.floor(v);
  return 300;
}

export function isRsiDivergenceStatsEnabled(): boolean {
  const raw = process.env.RSI_DIVERGENCE_STATS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function nullNum(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

function normalizeTf(v: unknown): RsiDivergenceTf {
  return v === "1h" ? "1h" : "4h";
}

function normalizeKind(v: unknown): RsiDivergenceKind {
  return v === "bullish" ? "bullish" : "bearish";
}

function normalizeTrigger(v: unknown): RsiDivergenceTrigger {
  return v === "price_break_prev" ? "price_break_prev" : "rsi_ma_cross";
}

function normalizeOutcome(v: unknown): RsiDivergenceStatsRow["outcome"] {
  if (v === "win" || v === "loss" || v === "flat") return v;
  return "pending";
}

function normalizeRow(r: Partial<RsiDivergenceStatsRow>): RsiDivergenceStatsRow {
  return {
    id: typeof r.id === "string" && r.id ? r.id : randomUUID(),
    symbol: typeof r.symbol === "string" ? r.symbol.trim().toUpperCase() : "",
    tf: normalizeTf(r.tf),
    kind: normalizeKind(r.kind),
    trigger: normalizeTrigger(r.trigger),
    alertedAtIso: typeof r.alertedAtIso === "string" ? r.alertedAtIso : new Date().toISOString(),
    alertedAtMs: Number.isFinite(r.alertedAtMs) ? Number(r.alertedAtMs) : Date.now(),
    signalBarOpenSec: Number.isFinite(r.signalBarOpenSec) ? Number(r.signalBarOpenSec) : 0,
    entryPrice: Number.isFinite(r.entryPrice) ? Number(r.entryPrice) : 0,
    refLevel: Number.isFinite(r.refLevel) ? Number(r.refLevel) : 0,
    priceW1: Number.isFinite(r.priceW1) ? Number(r.priceW1) : 0,
    priceW2: Number.isFinite(r.priceW2) ? Number(r.priceW2) : 0,
    rsiW1: Number.isFinite(r.rsiW1) ? Number(r.rsiW1) : 0,
    rsiW2: Number.isFinite(r.rsiW2) ? Number(r.rsiW2) : 0,
    barsBetween: Number.isFinite(r.barsBetween) ? Math.floor(Number(r.barsBetween)) : 0,
    rsiDelta: Number.isFinite(r.rsiDelta) ? Number(r.rsiDelta) : 0,
    strong: Boolean(r.strong),
    quoteVol24hUsdt: nullNum(r.quoteVol24hUsdt),
    marketCapUsd: nullNum(r.marketCapUsd),
    price1d: nullNum(r.price1d),
    pct1d: nullNum(r.pct1d),
    price3d: nullNum(r.price3d),
    pct3d: nullNum(r.pct3d),
    price7d: nullNum(r.price7d),
    pct7d: nullNum(r.pct7d),
    maxRoiPct: nullNum(r.maxRoiPct),
    durationToMfeHours: nullNum(r.durationToMfeHours),
    maxDrawdownPct: nullNum(r.maxDrawdownPct),
    followUpMaxAdversePct: nullNum(r.followUpMaxAdversePct),
    outcome: normalizeOutcome(r.outcome),
  };
}

export async function loadRsiDivergenceStatsState(): Promise<RsiDivergenceStatsState> {
  const mapRows = (rows: Partial<RsiDivergenceStatsRow>[]) => rows.map(normalizeRow);

  if (useCloudStorage()) {
    const data = await cloudGet<RsiDivergenceStatsState>(KV_KEY);
    if (data && Array.isArray(data.rows)) {
      return { rows: mapRows(data.rows as Partial<RsiDivergenceStatsRow>[]) };
    }
    return { rows: [] };
  }
  if (isVercel()) return { rows: [] };
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as RsiDivergenceStatsState;
    if (parsed && Array.isArray(parsed.rows)) {
      return { rows: mapRows(parsed.rows as Partial<RsiDivergenceStatsRow>[]) };
    }
  } catch {
    /* empty */
  }
  return { rows: [] };
}

export async function saveRsiDivergenceStatsState(state: RsiDivergenceStatsState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export type AppendRsiDivergenceStatsInput = {
  symbol: string;
  tf: RsiDivergenceTf;
  kind: RsiDivergenceKind;
  trigger: RsiDivergenceTrigger;
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  entryPrice: number;
  refLevel: number;
  priceW1: number;
  priceW2: number;
  rsiW1: number;
  rsiW2: number;
  barsBetween: number;
  /** เกณฑ์ "strong" จาก env (= |rsiW2 − rsiW1| ≥ strongDelta) */
  strongDelta: number;
  quoteVol24hUsdt?: number | null;
  marketCapUsd?: number | null;
};

export async function appendRsiDivergenceStatsRow(
  input: AppendRsiDivergenceStatsInput,
): Promise<RsiDivergenceStatsRow | null> {
  if (!isRsiDivergenceStatsEnabled()) return null;

  let marketSentiment: RsiDivergenceStatsRow["marketSentiment"] = null;
  try {
    marketSentiment = await resolveMarketSentimentForStats();
  } catch {
    /* ignore */
  }

  const symbol = input.symbol.trim().toUpperCase();
  const tf: RsiDivergenceTf = input.tf === "1h" ? "1h" : "4h";
  const kind: RsiDivergenceKind = input.kind === "bullish" ? "bullish" : "bearish";
  const trigger: RsiDivergenceTrigger =
    input.trigger === "price_break_prev" ? "price_break_prev" : "rsi_ma_cross";
  const rsiDelta = Math.abs(input.rsiW2 - input.rsiW1);
  const strong = Number.isFinite(input.strongDelta) && rsiDelta >= input.strongDelta;

  const state = await loadRsiDivergenceStatsState();

  /** Dedupe: ถ้ามีแถวเดิม symbol+tf+kind+signalBarOpenSec แล้ว (รอบ cron ชน) ไม่ append ซ้ำ */
  const duplicate = state.rows.find(
    (r) =>
      r.symbol === symbol &&
      r.tf === tf &&
      r.kind === kind &&
      r.signalBarOpenSec === input.signalBarOpenSec,
  );
  if (duplicate) return duplicate;

  const row: RsiDivergenceStatsRow = {
    id: randomUUID(),
    symbol,
    tf,
    kind,
    trigger,
    alertedAtIso: input.alertedAtIso,
    alertedAtMs: input.alertedAtMs,
    signalBarOpenSec: input.signalBarOpenSec,
    entryPrice: input.entryPrice,
    refLevel: input.refLevel,
    priceW1: input.priceW1,
    priceW2: input.priceW2,
    rsiW1: input.rsiW1,
    rsiW2: input.rsiW2,
    barsBetween: Number.isFinite(input.barsBetween) ? Math.floor(input.barsBetween) : 0,
    rsiDelta,
    strong,
    quoteVol24hUsdt:
      input.quoteVol24hUsdt != null &&
      Number.isFinite(input.quoteVol24hUsdt) &&
      input.quoteVol24hUsdt > 0
        ? input.quoteVol24hUsdt
        : null,
    marketCapUsd:
      input.marketCapUsd != null && Number.isFinite(input.marketCapUsd) && input.marketCapUsd > 0
        ? input.marketCapUsd
        : null,
    marketSentiment,
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
  await saveRsiDivergenceStatsState(state);
  return row;
}

const EMPTY_STATE: RsiDivergenceStatsState = { rows: [] };

/** ล้างตารางสถิติ RSI Divergence ทั้งหมด */
export async function resetRsiDivergenceStatsState(): Promise<void> {
  await saveRsiDivergenceStatsState(EMPTY_STATE);
}

export function rsiDivergenceStatsOutcomeWinMinPct(): number {
  const ownRaw = process.env.RSI_DIVERGENCE_STATS_WIN_MIN_PCT;
  const own = Number(ownRaw);
  if (Number.isFinite(own) && own > -100 && own < 100) return own;
  const inherited = Number(process.env.CANDLE_REVERSAL_STATS_WIN_MIN_PCT);
  if (Number.isFinite(inherited) && inherited > -100 && inherited < 100) return inherited;
  return 3;
}

export function rsiDivergenceStatsOutcomeLossMaxPct(): number {
  const ownRaw = process.env.RSI_DIVERGENCE_STATS_LOSS_MAX_PCT;
  const own = Number(ownRaw);
  if (Number.isFinite(own) && own > -100 && own < 100) return own;
  const inherited = Number(process.env.CANDLE_REVERSAL_STATS_LOSS_MAX_PCT);
  if (Number.isFinite(inherited) && inherited > -100 && inherited < 100) return inherited;
  return -3;
}
