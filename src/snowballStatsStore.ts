import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

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

export type SnowballStatsOutcome = "pending" | "win_trend" | "loss" | "flat";

export type SnowballStatsRow = {
  id: string;
  symbol: string;
  side: "long" | "short";
  alertedAtIso: string;
  /** ms wall clock ตอนบันทึก (cron) */
  alertedAtMs: number;
  /** open time แท่งสัญญาณที่อิง (sec) */
  signalBarOpenSec: number;
  /** TF ของแท่งสัญญาณ (ถ้าไม่มีในข้อมูลเก่า = 15m) */
  signalBarTf?: "15m" | "1h" | "4h";
  entryPrice: number;
  intrabar: boolean;
  triggerKind: string;
  svpHoleYn: "Y" | "N";
  price4h: number | null;
  pct4h: number | null;
  price12h: number | null;
  pct12h: number | null;
  price24h: number | null;
  pct24h: number | null;
  maxRoiPct: number | null;
  durationToMfeHours: number | null;
  maxDrawdownPct: number | null;
  resultRr: string | null;
  outcome: SnowballStatsOutcome;
};

export type SnowballStatsState = {
  rows: SnowballStatsRow[];
};

/** ส่งให้ Mini App / API */
export type SnowballStatsApiPayload = {
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
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  signalBarTf?: "15m" | "1h" | "4h";
  entryPrice: number;
  intrabar: boolean;
  triggerKind: string;
  vol: number;
  volSma: number;
};

export async function appendSnowballStatsRow(input: AppendSnowballStatsInput): Promise<SnowballStatsRow | null> {
  if (!isSnowballStatsEnabled()) return null;

  const row: SnowballStatsRow = {
    id: randomUUID(),
    symbol: input.symbol.trim().toUpperCase(),
    side: input.side,
    alertedAtIso: input.alertedAtIso,
    alertedAtMs: input.alertedAtMs,
    signalBarOpenSec: input.signalBarOpenSec,
    signalBarTf: input.signalBarTf ?? "15m",
    entryPrice: input.entryPrice,
    intrabar: input.intrabar,
    triggerKind: input.triggerKind,
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
