import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type SnowballStatsAlertSide,
  type SnowballStatsApiPayload,
  type SnowballStatsQualityTier,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import { toBinanceUsdtPerpSymbol } from "./snowballManualSymbolClear";

export type {
  SnowballStatsApiPayload,
  SnowballStatsOutcome,
  SnowballStatsQualityTier,
  SnowballStatsRow,
} from "@/lib/snowballStatsClient";

const KV_KEY = "koji:snowball_alert_stats";
const filePath = join(process.cwd(), "data", "snowball_alert_stats.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ snowball alert stats");
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

export type SnowballStatsState = {
  rows: SnowballStatsRow[];
};

function snowballStatsMaxRows(): number {
  const v = Number(process.env.SNOWBALL_STATS_MAX_ROWS);
  if (Number.isFinite(v) && v >= 20 && v <= 2000) return Math.floor(v);
  return 400;
}

export function isSnowballStatsEnabled(): boolean {
  const raw = process.env.SNOWBALL_STATS_ENABLED?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return raw === "1" || raw === "true" || raw === "yes";
}

function svpHoleVolRatioMax(): number {
  const v = Number(process.env.SNOWBALL_STATS_SVP_HOLE_VOL_RATIO_MAX);
  if (Number.isFinite(v) && v > 0 && v < 2) return v;
  return 0.85;
}

export function computeSvpHoleYn(vol: number, volSma: number): "Y" | "N" {
  if (!Number.isFinite(vol) || !Number.isFinite(volSma) || volSma <= 0) return "N";
  return vol / volSma < svpHoleVolRatioMax() ? "Y" : "N";
}

export async function loadSnowballStatsState(): Promise<SnowballStatsState> {
  if (useCloudStorage()) {
    const data = await cloudGet<SnowballStatsState>(KV_KEY);
    if (data && Array.isArray(data.rows)) {
      return { rows: [...data.rows] };
    }
    return { rows: [] };
  }
  if (isVercel()) return { rows: [] };
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as SnowballStatsState;
    if (parsed && Array.isArray(parsed.rows)) {
      return { rows: [...parsed.rows] };
    }
  } catch {
    /* empty */
  }
  return { rows: [] };
}

export async function saveSnowballStatsState(state: SnowballStatsState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export type AppendSnowballStatsInput = {
  symbol: string;
  side: "long" | "short";
  alertSide: SnowballStatsAlertSide;
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  signalBarLow?: number | null;
  signalBarTf?: "15m" | "1h" | "4h";
  entryPrice: number;
  intrabar: boolean;
  triggerKind: string;
  vol: number;
  volSma: number;
  qualityTier?: SnowballStatsQualityTier;
  /** Wilder ATR(100) ที่แท่งสัญญาณ — baseline ความผันผวน */
  atr100?: number | null;
  /** Max upper wick ใน 100 แท่งก่อนแท่งสัญญาณ — เพดานไส้บน */
  maxUpperWick100?: number | null;
  rangeScore?: number | null;
  wickScore?: number | null;
  barRangePctPrev?: number | null;
  barRangePctSignal?: number | null;
  barRangePct2Sum?: number | null;
  btcPsar4hTrend?: "up" | "down" | null;
  btcPsar4hClose?: number | null;
  quoteVol24hUsdt?: number | null;
  maxDrawback1hPct?: number | null;
  volumeCascadeYn?: "Y" | "N" | null;
};

export async function appendSnowballStatsRow(input: AppendSnowballStatsInput): Promise<SnowballStatsRow | null> {
  if (!isSnowballStatsEnabled()) return null;

  const atr100 =
    input.atr100 != null && Number.isFinite(input.atr100) && input.atr100 > 0 ? input.atr100 : null;
  const maxUpperWick100 =
    input.maxUpperWick100 != null && Number.isFinite(input.maxUpperWick100) && input.maxUpperWick100 >= 0
      ? input.maxUpperWick100
      : null;
  const rangeScore =
    input.rangeScore != null && Number.isFinite(input.rangeScore) && input.rangeScore >= 0
      ? input.rangeScore
      : null;
  const wickScore =
    input.wickScore != null && Number.isFinite(input.wickScore) && input.wickScore >= 0
      ? input.wickScore
      : null;
  const normBarRangePct = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v >= 0 ? v : null;
  const barRangePctPrev = normBarRangePct(input.barRangePctPrev);
  const barRangePctSignal = normBarRangePct(input.barRangePctSignal);
  const barRangePct2Sum = normBarRangePct(input.barRangePct2Sum);

  const row: SnowballStatsRow = {
    id: randomUUID(),
    symbol: input.symbol.trim().toUpperCase(),
    side: input.side,
    alertSide: input.alertSide,
    alertedAtIso: input.alertedAtIso,
    alertedAtMs: input.alertedAtMs,
    signalBarOpenSec: input.signalBarOpenSec,
    signalBarLow: input.signalBarLow ?? null,
    signalBarTf: input.signalBarTf ?? "15m",
    entryPrice: input.entryPrice,
    intrabar: input.intrabar,
    triggerKind: input.triggerKind,
    qualityTier: input.qualityTier,
    atr100,
    maxUpperWick100,
    rangeScore,
    wickScore,
    barRangePctPrev,
    barRangePctSignal,
    barRangePct2Sum,
    btcPsar4hTrend:
      input.btcPsar4hTrend === "up" || input.btcPsar4hTrend === "down" ? input.btcPsar4hTrend : null,
    btcPsar4hClose:
      input.btcPsar4hClose != null && Number.isFinite(input.btcPsar4hClose) && input.btcPsar4hClose > 0
        ? input.btcPsar4hClose
        : null,
    quoteVol24hUsdt:
      input.quoteVol24hUsdt != null && Number.isFinite(input.quoteVol24hUsdt) && input.quoteVol24hUsdt > 0
        ? input.quoteVol24hUsdt
        : null,
    maxDrawback1hPct:
      input.maxDrawback1hPct != null && Number.isFinite(input.maxDrawback1hPct) && input.maxDrawback1hPct >= 0
        ? input.maxDrawback1hPct
        : null,
    volumeCascadeYn:
      input.volumeCascadeYn === "Y" || input.volumeCascadeYn === "N" ? input.volumeCascadeYn : null,
    svpHoleYn: computeSvpHoleYn(input.vol, input.volSma),
    price4h: null,
    pct4h: null,
    price12h: null,
    pct12h: null,
    price24h: null,
    pct24h: null,
    maxRoiPct: null,
    durationToMfeHours: null,
    maxDrawdownPct: null,
    resultRr: null,
    outcome: "pending",
  };

  const state = await loadSnowballStatsState();
  state.rows.push(row);
  const max = snowballStatsMaxRows();
  if (state.rows.length > max) {
    state.rows.splice(0, state.rows.length - max);
  }
  await saveSnowballStatsState(state);
  return row;
}

export async function replaceSnowballStatsRows(rows: SnowballStatsRow[]): Promise<void> {
  await saveSnowballStatsState({ rows });
}

const EMPTY_SNOWBALL_STATS_STATE: SnowballStatsState = { rows: [] };

/**
 * ล้าง Snowball stats ทั้งหมด
 * KV key `koji:snowball_alert_stats` หรือไฟล์ data/snowball_alert_stats.json
 */
export async function resetSnowballStatsState(): Promise<void> {
  await saveSnowballStatsState(EMPTY_SNOWBALL_STATS_STATE);
}

function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * ลบแถว Snowball stats ที่ซ้ำภายใน window ชั่วโมง (ต่อ symbol+side) โดยคงแถวที่แจ้งก่อน (แถวแรก) ไว้
 */
export async function removeSnowballStatsDuplicatesInLastHours(input: {
  nowMs: number;
  windowHours: number;
  symbol?: string;
}): Promise<{ removed: number; kept: number; scanned: number; matched: number }> {
  const windowMs = Math.max(1, input.windowHours) * 3600 * 1000;
  const nowMs = input.nowMs;
  const symbolFilter = input.symbol ? toBinanceUsdtPerpSymbol(input.symbol) : null;

  const state = await loadSnowballStatsState();
  const rows = state.rows ?? [];
  const scanned = rows.length;
  let matched = 0;

  const byKey = new Map<string, SnowballStatsRow[]>();
  for (const r of rows) {
    const sym = normalizeSymbol(r.symbol);
    if (symbolFilter && sym !== symbolFilter) continue;
    matched += 1;
    const key = `${sym}|${r.side}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }
  for (const arr of Array.from(byKey.values())) {
    arr.sort((a, b) => (a.alertedAtMs ?? 0) - (b.alertedAtMs ?? 0));
  }

  const toDrop = new Set<string>();
  for (const arr of Array.from(byKey.values())) {
    if (arr.length <= 1) continue;
    let lastKeptMs = arr[0]!.alertedAtMs ?? 0;
    for (let i = 1; i < arr.length; i++) {
      const r = arr[i]!;
      const t = r.alertedAtMs ?? 0;
      const dt = t - lastKeptMs;
      if (dt >= 0 && dt <= windowMs) {
        toDrop.add(r.id);
      } else {
        lastKeptMs = t;
      }
    }
  }

  if (toDrop.size === 0) {
    return { removed: 0, kept: rows.length, scanned, matched };
  }

  const next = rows.filter((r) => !toDrop.has(r.id));
  await saveSnowballStatsState({ rows: next });
  return { removed: toDrop.size, kept: next.length, scanned, matched };
}
