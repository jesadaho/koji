import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  SNOWBALL_STATS_WIN_MIN_PCT_DEFAULT,
  type SnowballStatsAlertSide,
  type SnowballStatsApiPayload,
  type SnowballStatsQualityTier,
  type SnowballStatsGateStep,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import {
  isSnowballLongStructureTier,
  type SnowballLongStructureTier,
} from "@/src/snowballLongBreakoutGrade";
import {
  isLegacySnowballQualityTier,
  normalizeSnowballQualityTier,
  classifySnowballTrendGrade,
  snowballTrendGradeToDisplay,
  snowballTrendGradeActionPlan,
  type ClassifySnowballTrendGradeInput,
} from "@/src/snowballTrendGrade";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import { toBinanceUsdtPerpSymbol } from "./snowballManualSymbolClear";
import { resolveMarketSentimentForStats } from "./marketSentimentSnapshotStore";
import {
  STATS_BTC_EMA_SLOPES_VERSION,
  STATS_SYMBOL_EMA_SLOPES_VERSION,
} from "./statsEmaSlope";
import {
  snowballStatsLegacyBreakout1hConfirmFailIgnored,
} from "@/lib/snowballGradeChecklist";
import { buildSnowballStatsRow } from "./snowballStatsRowBuild";

/** แถวที่ recompute trend grade (S/A/B/C/F) จาก snapshot ณ alertedAtMs แล้ว */
export const STATS_TREND_GRADE_VERSION = 7;

export function snowballStatsRowAlertSide(row: Pick<SnowballStatsRow, "alertSide" | "triggerKind">): SnowballStatsAlertSide {
  return row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
}

export function snowballStatsRowTrendGradeInput(row: SnowballStatsRow): ClassifySnowballTrendGradeInput {
  return {
    alertSide: snowballStatsRowAlertSide(row),
    ema4hSlopePct7d: row.ema4hSlopePct7d,
    ema1dSlopePct7d: row.ema1dSlopePct7d,
    btcEma4hSlopePct7d: row.btcEma4hSlopePct7d,
    greenDaysBeforeSignal: row.greenDaysBeforeSignal,
  };
}

function snowballStatsRowHasTrendGradeSlope(row: SnowballStatsRow): boolean {
  const finite = (v: number | null | undefined) => v != null && Number.isFinite(v);
  return (
    finite(row.ema4hSlopePct7d) ||
    finite(row.ema1dSlopePct7d) ||
    finite(row.btcEma4hSlopePct7d)
  );
}

/** พร้อม recompute เกรด — ต้องมี EMA snapshot ณ alertedAtMs + green days (LONG) */
export function snowballStatsRowReadyForTrendGradeBackfill(row: SnowballStatsRow): boolean {
  if (row.symbolEmaSlopesV !== STATS_SYMBOL_EMA_SLOPES_VERSION) return false;
  if (row.btcEmaSlopesV !== STATS_BTC_EMA_SLOPES_VERSION) return false;
  if (!snowballStatsRowHasTrendGradeSlope(row)) return false;
  if (snowballStatsRowAlertSide(row) === "long" && row.greenDaysBeforeSignal == null) return false;
  return true;
}

export function snowballStatsRowNeedsTrendGradeBackfill(row: SnowballStatsRow): boolean {
  if (row.trendGradeV !== STATS_TREND_GRADE_VERSION) return true;
  if (!snowballStatsRowReadyForTrendGradeBackfill(row)) return false;
  const grade = classifySnowballTrendGrade(snowballStatsRowTrendGradeInput(row));
  const display = snowballTrendGradeToDisplay(grade);
  if (row.alertQualityTier !== grade) return true;
  if (row.displayGrade !== display) return true;
  if (!row.qualityTier4hAdjusted && row.qualityTier !== grade) return true;
  return false;
}

/** คำนวณและเขียน qualityTier / displayGrade / actionPlan จาก snapshot ในแถว */
export function applySnowballStatsTrendGradeFromRow(row: SnowballStatsRow): boolean {
  const grade = classifySnowballTrendGrade(snowballStatsRowTrendGradeInput(row));
  const display = snowballTrendGradeToDisplay(grade);
  const plan = snowballTrendGradeActionPlan(grade);
  let touched = false;

  if (!row.qualityTier4hAdjusted && row.qualityTier !== grade) {
    row.qualityTier = grade;
    touched = true;
  }
  if (row.alertQualityTier !== grade) {
    row.alertQualityTier = grade;
    touched = true;
  }
  if (row.displayGrade !== display) {
    row.displayGrade = display;
    touched = true;
  }
  if (row.actionPlan !== plan) {
    row.actionPlan = plan;
    touched = true;
  }
  const failF = grade === "f";
  if (row.momentumFailGradeF !== failF) {
    row.momentumFailGradeF = failF;
    touched = true;
  }
  if (row.momentumDowngrade === true) {
    row.momentumDowngrade = false;
    touched = true;
  }
  if (row.trendGradeV !== STATS_TREND_GRADE_VERSION) {
    row.trendGradeV = STATS_TREND_GRADE_VERSION;
    touched = true;
  }
  return touched;
}

export function backfillSnowballStatsTrendGrades(
  rows: SnowballStatsRow[],
  opts?: { maxRows?: number; symbolFilter?: string },
): number {
  const maxRows = opts?.maxRows;
  let updated = 0;
  for (const row of rows) {
    if (maxRows != null && updated >= maxRows) break;
    if (opts?.symbolFilter && row.symbol.trim().toUpperCase() !== opts.symbolFilter) continue;
    if (!snowballStatsRowReadyForTrendGradeBackfill(row)) continue;
    if (!snowballStatsRowNeedsTrendGradeBackfill(row)) continue;
    if (applySnowballStatsTrendGradeFromRow(row)) updated += 1;
  }
  return updated;
}

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

/** คีย์ dedupe สัญญาณ — เหรียญ + ทิศแจ้ง + แท่งสัญญาณเปิด (ตรง live lastFiredBarSec) */
export function snowballStatsSignalDedupeKey(
  row: Pick<SnowballStatsRow, "symbol" | "alertSide" | "triggerKind" | "signalBarOpenSec">,
): string {
  const sym = row.symbol.trim().toUpperCase();
  const side = snowballStatsRowAlertSide(row);
  const bar = row.signalBarOpenSec;
  return `${sym}|${side}|${bar}`;
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
  structureTier?: SnowballLongStructureTier;
  swing200Ok?: boolean | null;
  /** Wilder ATR(100) ที่แท่งสัญญาณ — baseline ความผันผวน */
  atr100?: number | null;
  /** Max upper wick ใน 100 แท่งก่อนแท่งสัญญาณ — เพดานไส้บน */
  maxUpperWick100?: number | null;
  rangeScore?: number | null;
  wickScore?: number | null;
  rangeRankInLookback?: number | null;
  lenLookbackBars?: number | null;
  lenPercentilePct?: number | null;
  barRangePctPrev?: number | null;
  barRangePctSignal?: number | null;
  barRangePct2Sum?: number | null;
  btcPsar4hTrend?: "up" | "down" | null;
  btcPsar4hClose?: number | null;
  btcPsar1hTrend?: "up" | "down" | null;
  btcPsar1hClose?: number | null;
  quoteVol24hUsdt?: number | null;
  marketCapUsd?: number | null;
  fundingRate?: number | null;
  atrPct14d?: number | null;
  ema1hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
  ema1dSlopePct7d?: number | null;
  btcEma4hSlopePct7d?: number | null;
  btcEma1dSlopePct7d?: number | null;
  psar4hTrend?: "up" | "down" | null;
  psar4hDistPct?: number | null;
  signalVolVsSma?: number | null;
  volStrictOk?: boolean | null;
  volNearMissOnly?: boolean | null;
  volMultAtAlert?: number | null;
  volNearMultAtAlert?: number | null;
  confirmGateSteps?: SnowballStatsGateStep[];
  volumeCascadeYn?: "Y" | "N" | null;
  volumeDropCount?: number | null;
  signalMaxDdPct?: number | null;
  trendMomentumVolLookback?: number | null;
  /** Snowball LONG 1H breakout / pending confirm bar */
  confirmVolVsSma?: number | null;
  confirmVolRank?: number | null;
  confirmVolRankLb?: number | null;
  greenDaysBeforeSignal?: number | null;
  greenDaysBeforeSignalBkk?: number | null;
  breakout1hConfirmFail?: boolean;
  alertQualityTier?: SnowballStatsQualityTier;
  momentumDowngrade?: boolean;
  momentumFailGradeF?: boolean;
  structureCeiling?: SnowballStatsRow["structureCeiling"];
  momentumFailCount?: SnowballStatsRow["momentumFailCount"];
  gradeNotch?: SnowballStatsRow["gradeNotch"];
  displayGrade?: SnowballStatsRow["displayGrade"];
  actionPlan?: SnowballStatsRow["actionPlan"];
};

function resetSnowballStatsFollowUpFields(row: SnowballStatsRow): void {
  row.price4h = null;
  row.pct4h = null;
  row.price12h = null;
  row.pct12h = null;
  row.price24h = null;
  row.pct24h = null;
  row.price48h = null;
  row.pct48h = null;
  row.maxRoiPct = null;
  row.durationToMfeHours = null;
  row.maxDrawdownPct = null;
  row.followUpMaxAdversePct = null;
  row.strategyProfitPct = null;
  row.strategyExitReason = null;
  row.strategyProfitPct24h = null;
  row.strategyExitReason24h = null;
  row.strategyProfitByPlan = undefined;
  row.resultRr = null;
  row.outcome = "pending";
}

/** แถวสัญญาณ Long ที่เคยบันทึก side=short (fade) → long + รีเซ็ตผล follow-up */
export function migrateSnowballStatsLongAlertTradeSideToLong(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    const alert = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
    if (alert !== "long") continue;
    if (row.side === "long") continue;
    row.side = "long";
    resetSnowballStatsFollowUpFields(row);
    updated += 1;
  }
  return updated;
}

/** @deprecated ใช้ migrateSnowballStatsLongAlertTradeSideToLong */
export function migrateSnowballStatsConfirmFailSideToLong(rows: SnowballStatsRow[]): number {
  return migrateSnowballStatsLongAlertTradeSideToLong(rows);
}

function snowballStatsRowTrendGradeInputLegacy(row: SnowballStatsRow): ClassifySnowballTrendGradeInput {
  return snowballStatsRowTrendGradeInput(row);
}

/** แถวเก่า — ถ้า qualityTier เป็น A+/B/C ให้ copy เป็น structureTier (อ่าน raw จาก JSON) */
export function migrateSnowballStatsStructureTier(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (row.structureTier) continue;
    const src = (row.alertQualityTier ?? row.qualityTier) as string | undefined;
    if (isSnowballLongStructureTier(src)) {
      row.structureTier = src;
      updated += 1;
    }
  }
  return updated;
}

/** แปลง qualityTier / alertQualityTier เก่า (a_plus … f_plus) → s/a/b/c/f */
export function migrateSnowballStatsLegacyQualityTiersToTrend(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    const input = snowballStatsRowTrendGradeInputLegacy(row);
    let touched = false;

    const qtRaw = row.qualityTier as string | undefined;
    if (qtRaw && isLegacySnowballQualityTier(qtRaw)) {
      const next = normalizeSnowballQualityTier(qtRaw, input);
      if (next) {
        row.qualityTier = next;
        touched = true;
      }
    }

    const aqRaw = row.alertQualityTier as string | undefined;
    if (aqRaw && isLegacySnowballQualityTier(aqRaw)) {
      const next = normalizeSnowballQualityTier(aqRaw, input);
      if (next) {
        row.alertQualityTier = next;
        touched = true;
      }
    }

    if (touched) updated += 1;
  }
  return updated;
}

export type ClearSnowball4hBreakout1hConfirmFailResult = {
  totalRows: number;
  matched: number;
  updated: number;
  samples: string[];
};

/** ล้าง breakout1hConfirmFail บนแถว Master 4h (ป้าย legacy) */
export function migrateSnowball4hBreakout1hConfirmFail(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (row.signalBarTf === "4h" && row.breakout1hConfirmFail === true) {
      row.breakout1hConfirmFail = false;
      updated += 1;
    }
  }
  return updated;
}

/** โหลด stats → ล้างป้าย 4h → บันทึก (ใช้จาก Telegram admin / script) */
export async function clearSnowball4hBreakout1hConfirmFail(): Promise<ClearSnowball4hBreakout1hConfirmFailResult> {
  const state = await loadSnowballStatsState();
  const matched = state.rows.filter((r) => r.signalBarTf === "4h" && r.breakout1hConfirmFail === true);
  const samples = matched
    .slice(0, 12)
    .map((r) => `${r.symbol} · ${r.alertedAtIso ?? String(r.alertedAtMs)}`);
  const updated = migrateSnowball4hBreakout1hConfirmFail(state.rows);
  if (updated > 0) await saveSnowballStatsState(state);
  return {
    totalRows: state.rows.length,
    matched: matched.length,
    updated,
    samples,
  };
}

/** ล้าง breakout1hConfirmFail เมื่อ 4h หรือ confirmGateSteps ผ่านครบ (ป้ายเก่าไม่ตรง snapshot) */
export function migrateSnowballStatsClearSupersededBreakout1hConfirmFail(
  rows: SnowballStatsRow[],
): number {
  let updated = 0;
  for (const row of rows) {
    if (row.breakout1hConfirmFail !== true) continue;
    if (!snowballStatsLegacyBreakout1hConfirmFailIgnored(row)) continue;
    row.breakout1hConfirmFail = false;
    updated += 1;
  }
  return updated;
}

function snowballStatsRowHasHorizonData(row: SnowballStatsRow): boolean {
  return (
    row.price4h != null ||
    row.pct4h != null ||
    row.price12h != null ||
    row.pct12h != null ||
    row.price24h != null ||
    row.pct24h != null ||
    row.price48h != null ||
    row.pct48h != null
  );
}

/** รีเซ็ต horizon แถว 4h หลังแก้ anchor (เคยชี้ปิดแท่ง signal → pct4h ≈ 0%) */
export function migrateSnowballStats4hHorizonAnchorV2(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (row.signalBarTf !== "4h") continue;
    if (row.horizonAnchorV2 === true) continue;
    if (snowballStatsRowHasHorizonData(row)) {
      row.price4h = null;
      row.pct4h = null;
      row.price12h = null;
      row.pct12h = null;
      row.price24h = null;
      row.pct24h = null;
      row.price48h = null;
      row.pct48h = null;
    }
    row.horizonAnchorV2 = true;
    updated += 1;
  }
  return updated;
}

/** รัน migration แถวสถิติ (เรียกตอนโหลด API + tick follow-up) */
/** แถวเก่า outcome win_quick_tp30 → ตาม pct48h (Win/Loss/Flat) */
export function migrateSnowballStatsLegacyQuickTpOutcome(rows: SnowballStatsRow[]): number {
  const winMin = SNOWBALL_STATS_WIN_MIN_PCT_DEFAULT;
  let updated = 0;
  for (const row of rows) {
    if ((row.outcome as string) !== "win_quick_tp30") continue;
    const pct48 = row.pct48h;
    if (pct48 == null || !Number.isFinite(pct48)) continue;
    if (pct48 >= winMin) row.outcome = "win_trend";
    else if (pct48 <= -winMin) row.outcome = "loss";
    else row.outcome = "flat";
    updated += 1;
  }
  return updated;
}

export function applySnowballStatsRowMigrations(rows: SnowballStatsRow[]): number {
  return (
    migrateSnowballStatsLegacyGradeD(rows) +
    migrateSnowballStatsClearSupersededBreakout1hConfirmFail(rows) +
    migrateSnowballStatsLongAlertTradeSideToLong(rows) +
    migrateSnowballStatsStructureTier(rows) +
    migrateSnowballStatsLegacyQualityTiersToTrend(rows) +
    migrateSnowballStats4hHorizonAnchorV2(rows) +
    migrateSnowballStatsLegacyQuickTpOutcome(rows)
  );
}

/** แถวเก่า — ล้าง breakout1hConfirmFail · เติม momentumDowngrade บน D+ จากโครงสร้าง */
export function migrateSnowballStatsLegacyGradeD(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    let touched = false;
    if (row.breakout1hConfirmFail === true) {
      row.breakout1hConfirmFail = false;
      touched = true;
    }
    const tierRaw = row.qualityTier as string | undefined;
    if (tierRaw !== "d_plus") {
      if (touched) updated += 1;
      continue;
    }
    const alert = row.alertQualityTier as string | undefined;
    const isMomentumDPlus =
      alert === "a_plus" || alert === "b_plus" || alert === "c_plus";
    if (isMomentumDPlus && !row.momentumDowngrade) {
      row.momentumDowngrade = true;
      touched = true;
    }
    if (!row.alertQualityTier) {
      row.alertQualityTier = "c";
      touched = true;
    }
    if (touched) updated += 1;
  }
  return updated;
}

export async function appendSnowballStatsRow(input: AppendSnowballStatsInput): Promise<SnowballStatsRow | null> {
  if (!isSnowballStatsEnabled()) return null;

  const state = await loadSnowballStatsState();
  const dedupeKey = snowballStatsSignalDedupeKey({
    symbol: input.symbol,
    alertSide: input.alertSide,
    triggerKind: input.triggerKind,
    signalBarOpenSec: input.signalBarOpenSec,
  });
  const existing = state.rows.find((r) => snowballStatsSignalDedupeKey(r) === dedupeKey);
  if (existing) return existing;

  const row = buildSnowballStatsRow(input);
  try {
    row.marketSentiment = await resolveMarketSentimentForStats(input.alertedAtMs);
  } catch {
    /* ignore */
  }

  try {
    const { stampPendingConflictOnStatsAppend } = await import("./signalPendingConflictServer");
    const conflictWith = await stampPendingConflictOnStatsAppend(input.symbol, "snowball", input.alertedAtMs);
    if (conflictWith) row.conflictWith = conflictWith;
  } catch {
    /* ignore */
  }

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

/** ลบแถวสถิติ Snowball ตาม id — คืน false ถ้าไม่พบ */
export async function deleteSnowballStatsRowById(id: string): Promise<boolean> {
  const trimmed = id.trim();
  if (!trimmed) return false;
  const state = await loadSnowballStatsState();
  const next = state.rows.filter((r) => r.id !== trimmed);
  if (next.length === state.rows.length) return false;
  await saveSnowballStatsState({ rows: next });
  return true;
}

function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * ลบแถว Snowball stats ซ้ำภายใน window ชั่วโมง — ต่อเหรียญคงแค่สัญญาณแรก (แจ้งเร็วสุด ไม่แยก long/short)
 */
export async function removeSnowballStatsDuplicatesInLastHours(input: {
  nowMs: number;
  windowHours: number;
  symbol?: string;
}): Promise<{ removed: number; kept: number; scanned: number; matched: number }> {
  const windowMs = Math.max(1, input.windowHours) * 3600 * 1000;
  const nowMs = input.nowMs;
  const cutoffMs = nowMs - windowMs;
  const symbolFilter = input.symbol ? toBinanceUsdtPerpSymbol(input.symbol) : null;

  const state = await loadSnowballStatsState();
  const rows = state.rows ?? [];
  const scanned = rows.length;
  let matched = 0;

  const bySymbol = new Map<string, SnowballStatsRow[]>();
  for (const r of rows) {
    const sym = normalizeSymbol(r.symbol);
    if (symbolFilter && sym !== symbolFilter) continue;
    const t = r.alertedAtMs ?? 0;
    if (t < cutoffMs) continue;
    matched += 1;
    const arr = bySymbol.get(sym) ?? [];
    arr.push(r);
    bySymbol.set(sym, arr);
  }

  const toDrop = new Set<string>();
  for (const arr of Array.from(bySymbol.values())) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => (a.alertedAtMs ?? 0) - (b.alertedAtMs ?? 0));
    for (let i = 1; i < arr.length; i++) {
      toDrop.add(arr[i]!.id);
    }
  }

  if (toDrop.size === 0) {
    return { removed: 0, kept: rows.length, scanned, matched };
  }

  const next = rows.filter((r) => !toDrop.has(r.id));
  await saveSnowballStatsState({ rows: next });
  return { removed: toDrop.size, kept: next.length, scanned, matched };
}
