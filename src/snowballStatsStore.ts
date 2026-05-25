import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type SnowballStatsAlertSide,
  type SnowballStatsApiPayload,
  type SnowballStatsQualityTier,
  type SnowballStatsGateStep,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import type { SnowballLongStructureTier } from "@/src/snowballLongBreakoutGrade";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import { toBinanceUsdtPerpSymbol } from "./snowballManualSymbolClear";
import {
  snowballStatsLegacyBreakout1hConfirmFailIgnored,
} from "@/lib/snowballGradeChecklist";
import {
  SNOWBALL_TREND_1H_VOL_LOOKBACK,
} from "./snowballTrendMomentumMetrics";

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
  structureTier?: SnowballLongStructureTier;
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
  btcPsar1hTrend?: "up" | "down" | null;
  btcPsar1hClose?: number | null;
  quoteVol24hUsdt?: number | null;
  marketCapUsd?: number | null;
  fundingRate?: number | null;
  signalVolVsSma?: number | null;
  volStrictOk?: boolean | null;
  volNearMissOnly?: boolean | null;
  volMultAtAlert?: number | null;
  volNearMultAtAlert?: number | null;
  confirmGateSteps?: SnowballStatsGateStep[];
  volumeCascadeYn?: "Y" | "N" | null;
  trendMomentumVolLookback?: number | null;
  /** Snowball LONG 1H breakout / pending confirm bar */
  confirmVolVsSma?: number | null;
  confirmVolRank?: number | null;
  confirmVolRankLb?: number | null;
  greenDaysBeforeSignal?: number | null;
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

/** แถวเก่า — ถ้า qualityTier เป็น A+/B/C ให้ copy เป็น structureTier */
export function migrateSnowballStatsStructureTier(rows: SnowballStatsRow[]): number {
  let updated = 0;
  for (const row of rows) {
    if (row.structureTier) continue;
    const src = row.alertQualityTier ?? row.qualityTier;
    if (src === "a_plus" || src === "b_plus" || src === "c_plus") {
      row.structureTier = src;
      updated += 1;
    }
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
export function applySnowballStatsRowMigrations(rows: SnowballStatsRow[]): number {
  return (
    migrateSnowballStatsLegacyGradeD(rows) +
    migrateSnowballStatsClearSupersededBreakout1hConfirmFail(rows) +
    migrateSnowballStatsLongAlertTradeSideToLong(rows) +
    migrateSnowballStatsStructureTier(rows) +
    migrateSnowballStats4hHorizonAnchorV2(rows)
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
    if (row.qualityTier !== "d_plus") {
      if (touched) updated += 1;
      continue;
    }
    const alert = row.alertQualityTier;
    const isMomentumDPlus =
      alert === "a_plus" || alert === "b_plus" || alert === "c_plus";
    if (isMomentumDPlus && !row.momentumDowngrade) {
      row.momentumDowngrade = true;
      touched = true;
    }
    if (!row.alertQualityTier) {
      row.alertQualityTier = "d_plus";
      touched = true;
    }
    if (touched) updated += 1;
  }
  return updated;
}

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

  const normFiniteRatio = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v > 0 ? v : null;
  const normVolRank = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v >= 1 ? Math.round(v) : null;
  const normVolRankLb = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(v) && v >= 1 ? Math.round(v) : null;

  const confirmVolVsSma = normFiniteRatio(input.confirmVolVsSma);
  const confirmVolRank = normVolRank(input.confirmVolRank);
  const confirmVolRankLb = confirmVolRank != null ? normVolRankLb(input.confirmVolRankLb) : null;

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
    ...(input.signalBarTf === "4h" ? { horizonAnchorV2: true as const } : {}),
    entryPrice: input.entryPrice,
    intrabar: input.intrabar,
    triggerKind: input.triggerKind,
    qualityTier: input.qualityTier,
    ...(input.structureTier === "a_plus" ||
    input.structureTier === "b_plus" ||
    input.structureTier === "c_plus"
      ? { structureTier: input.structureTier }
      : {}),
    alertQualityTier: input.alertQualityTier ?? input.qualityTier,
    ...(input.breakout1hConfirmFail === true ? { breakout1hConfirmFail: true } : {}),
    momentumDowngrade: input.momentumDowngrade === true,
    momentumFailGradeF: input.momentumFailGradeF === true,
    ...(input.structureCeiling === "A" ||
    input.structureCeiling === "B" ||
    input.structureCeiling === "C"
      ? { structureCeiling: input.structureCeiling }
      : {}),
    ...(input.momentumFailCount === 0 ||
    input.momentumFailCount === 1 ||
    input.momentumFailCount === 2 ||
    input.momentumFailCount === 3
      ? { momentumFailCount: input.momentumFailCount }
      : {}),
    ...(input.gradeNotch === 1 ||
    input.gradeNotch === 0 ||
    input.gradeNotch === -1 ||
    input.gradeNotch === -2
      ? { gradeNotch: input.gradeNotch }
      : {}),
    ...(input.displayGrade
      ? { displayGrade: input.displayGrade }
      : {}),
    ...(input.actionPlan === "full" ||
    input.actionPlan === "standard" ||
    input.actionPlan === "light" ||
    input.actionPlan === "monitor"
      ? { actionPlan: input.actionPlan }
      : {}),
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
    btcPsar1hTrend:
      input.btcPsar1hTrend === "up" || input.btcPsar1hTrend === "down" ? input.btcPsar1hTrend : null,
    btcPsar1hClose:
      input.btcPsar1hClose != null && Number.isFinite(input.btcPsar1hClose) && input.btcPsar1hClose > 0
        ? input.btcPsar1hClose
        : null,
    quoteVol24hUsdt:
      input.quoteVol24hUsdt != null && Number.isFinite(input.quoteVol24hUsdt) && input.quoteVol24hUsdt > 0
        ? input.quoteVol24hUsdt
        : null,
    marketCapUsd:
      input.marketCapUsd != null && Number.isFinite(input.marketCapUsd) && input.marketCapUsd > 0
        ? input.marketCapUsd
        : null,
    fundingRate:
      input.fundingRate != null && Number.isFinite(input.fundingRate) ? input.fundingRate : null,
    signalVolVsSma:
      input.signalVolVsSma != null && Number.isFinite(input.signalVolVsSma) && input.signalVolVsSma > 0
        ? input.signalVolVsSma
        : input.volSma > 0 && Number.isFinite(input.vol) && input.vol > 0
          ? input.vol / input.volSma
          : null,
    volStrictOk: input.volStrictOk === true ? true : input.volStrictOk === false ? false : null,
    volNearMissOnly:
      input.volNearMissOnly === true ? true : input.volNearMissOnly === false ? false : null,
    volMultAtAlert:
      input.volMultAtAlert != null && Number.isFinite(input.volMultAtAlert) && input.volMultAtAlert > 0
        ? input.volMultAtAlert
        : null,
    volNearMultAtAlert:
      input.volNearMultAtAlert != null &&
      Number.isFinite(input.volNearMultAtAlert) &&
      input.volNearMultAtAlert > 0
        ? input.volNearMultAtAlert
        : null,
    confirmGateSteps:
      Array.isArray(input.confirmGateSteps) && input.confirmGateSteps.length > 0
        ? input.confirmGateSteps.filter(
            (s) =>
              s &&
              typeof s.label === "string" &&
              typeof s.detail === "string" &&
              (s.ok === true || s.ok === false),
          )
        : undefined,
    volumeCascadeYn:
      input.volumeCascadeYn === "Y" || input.volumeCascadeYn === "N" ? input.volumeCascadeYn : null,
    trendMomentumVolLookback: SNOWBALL_TREND_1H_VOL_LOOKBACK,
    confirmVolVsSma,
    confirmVolRank,
    confirmVolRankLb,
    greenDaysBeforeSignal:
      input.greenDaysBeforeSignal != null &&
      Number.isFinite(input.greenDaysBeforeSignal) &&
      input.greenDaysBeforeSignal >= 0
        ? Math.floor(input.greenDaysBeforeSignal)
        : null,
    svpHoleYn: computeSvpHoleYn(input.vol, input.volSma),
    price4h: null,
    pct4h: null,
    price12h: null,
    pct12h: null,
    price24h: null,
    pct24h: null,
    price48h: null,
    pct48h: null,
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
