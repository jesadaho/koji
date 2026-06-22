/**
 * ตัวกรองสถิติ Reversal — ใช้ร่วม Mini App + API export CSV
 */

import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";
import {
  reversalStatsRowMatchesMatrixFilter,
  type ReversalMatrixFilter,
} from "@/lib/reversalMatrixFilters";
import {
  reversalRowMatchesBtcEma4hFilter,
  reversalRowMatchesEma4hFilter,
  reversalRowMatchesEma1dFilter,
  type BtcEma4hFilter,
  type ReversalEma4hFilter,
  type ReversalEma1dFilter,
} from "@/lib/reversalEma4hFilter";
import {
  statsRowMatchesAtrPct14dFilter,
  STATS_ATR_PCT14D_FILTER_OPTIONS,
  type StatsAtrPct14dFilter,
} from "@/lib/statsAtrPct14dFilter";
import {
  statsRowMatchesVolVsSmaFilter,
  STATS_VOL_VS_SMA_FILTER_OPTIONS,
  type StatsVolVsSmaFilter,
} from "@/lib/statsVolVsSmaFilter";
import {
  snowballBarRangeSignalFilterLabel,
  snowballBarRangeSignalFilterTitle,
  snowballStatsRowMatchesBarRangeSignalFilter,
  SNOWBALL_BAR_RANGE_SIGNAL_FILTER_OPTIONS,
  type SnowballBarRangeSignalFilter,
} from "@/lib/snowballBarRangeSignalFilter";

export type { StatsAtrPct14dFilter } from "@/lib/statsAtrPct14dFilter";
export {
  STATS_ATR_PCT14D_FILTER_OPTIONS,
  statsAtrPct14dFilterLabel,
  statsAtrPct14dFilterTitle,
  statsRowMatchesAtrPct14dFilter,
} from "@/lib/statsAtrPct14dFilter";

export type ReversalBarRangeSignalFilter = SnowballBarRangeSignalFilter;
export {
  SNOWBALL_BAR_RANGE_SIGNAL_FILTER_OPTIONS as REVERSAL_BAR_RANGE_SIGNAL_FILTER_OPTIONS,
  snowballBarRangeSignalFilterLabel as reversalBarRangeSignalFilterLabel,
  snowballBarRangeSignalFilterTitle as reversalBarRangeSignalFilterTitle,
};

export type {
  BtcEma4hFilter,
  ReversalEma4hFilter,
  ReversalEma1dFilter,
  ReversalEmaSlopeFilter,
} from "@/lib/reversalEma4hFilter";
export {
  BTC_EMA4H_FILTER_OPTIONS,
  REVERSAL_EMA4H_FILTER_OPTIONS,
  REVERSAL_EMA1D_FILTER_OPTIONS,
  reversalBtcEma4hFilterTitle,
  reversalEma4hFilterLabel,
  reversalEma4hFilterTitle,
  reversalEma1dFilterLabel,
  reversalEma1dFilterTitle,
  reversalRowMatchesBtcEma4hFilter,
  reversalRowMatchesEma4hFilter,
  reversalRowMatchesEma1dFilter,
} from "@/lib/reversalEma4hFilter";

export type ReversalShapeFilter = "all" | "wick80" | "body80" | "wickOrBody80";
export type ReversalDayFilter = "all" | "3" | "7" | "30" | "90";
/** BKK = UTC+7 — 0 = Sunday, 1 = Monday, ..., 6 = Saturday */
export type ReversalDowFilter = "all" | "0" | "1" | "2" | "3" | "4" | "5" | "6";
export type ReversalLenRankFilter = "all" | "rank3to15";

export const REVERSAL_DAY_FILTER_OPTIONS: ReadonlyArray<{ value: ReversalDayFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "3", label: "3 วัน" },
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
];

export const REVERSAL_LEN_RANK_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalLenRankFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "rank3to15", label: "อันดับ 3–15" },
];

export const REVERSAL_DOW_FILTER_OPTIONS: ReadonlyArray<{ value: ReversalDowFilter; label: string }> = [
  { value: "all", label: "ทุกวัน" },
  { value: "1", label: "จันทร์" },
  { value: "2", label: "อังคาร" },
  { value: "3", label: "พุธ" },
  { value: "4", label: "พฤหัส" },
  { value: "5", label: "ศุกร์" },
  { value: "6", label: "เสาร์" },
  { value: "0", label: "อาทิตย์" },
];

export type ReversalStatsFilterQuery = {
  tf?: "1d" | "1h";
  side?: "long" | "short";
  days?: ReversalDayFilter;
  dow?: ReversalDowFilter;
  shape?: ReversalShapeFilter;
  lenRank?: ReversalLenRankFilter;
  vol?: StatsVolVsSmaFilter;
  ema4h?: ReversalEma4hFilter;
  ema1d?: ReversalEma1dFilter;
  btcEma4h?: BtcEma4hFilter;
  atr?: StatsAtrPct14dFilter;
  /** R% สัญญาณ (barRangePctSignal) */
  rSignal?: ReversalBarRangeSignalFilter;
  matrix?: ReversalMatrixFilter;
};

export function reversalShapeFilterLabel(filter: ReversalShapeFilter): string {
  if (filter === "wick80") return "ไส้ >= 80%";
  if (filter === "body80") return "เนื้อ >= 80%";
  if (filter === "wickOrBody80") return "ไส้หรือเนื้อ >= 80%";
  return "ทั้งหมด";
}

export function reversalDayFilterLabel(filter: ReversalDayFilter): string {
  return REVERSAL_DAY_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalLenRankFilterLabel(filter: ReversalLenRankFilter): string {
  return REVERSAL_LEN_RANK_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalDowFilterLabel(filter: ReversalDowFilter): string {
  return REVERSAL_DOW_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

function bkkDayOfWeekIndex(ms: number): number {
  if (!Number.isFinite(ms)) return -1;
  return new Date(ms + 7 * 3600 * 1000).getUTCDay();
}

function reversalAlertedAtMs(row: CandleReversalStatsRow): number {
  return row.alertedAtMs != null && Number.isFinite(row.alertedAtMs)
    ? row.alertedAtMs
    : Date.parse(row.alertedAtIso);
}

export function reversalRowMatchesShapeFilter(
  row: CandleReversalStatsRow,
  filter: ReversalShapeFilter,
): boolean {
  if (filter === "all") return true;
  const wickOk = row.wickRatioPct != null && Number.isFinite(row.wickRatioPct) && row.wickRatioPct >= 80;
  const bodyOk = row.bodyPct != null && Number.isFinite(row.bodyPct) && row.bodyPct >= 80;
  if (filter === "wick80") return wickOk;
  if (filter === "body80") return bodyOk;
  return wickOk || bodyOk;
}

export function reversalRowMatchesDayFilter(
  row: CandleReversalStatsRow,
  filter: ReversalDayFilter,
): boolean {
  if (filter === "all") return true;
  const days = Number(filter);
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const ms = reversalAlertedAtMs(row);
  return Number.isFinite(ms) && ms >= cutoffMs;
}

export function reversalRowMatchesDowFilter(
  row: CandleReversalStatsRow,
  filter: ReversalDowFilter,
): boolean {
  if (filter === "all") return true;
  const targetDow = Number(filter);
  const ms = reversalAlertedAtMs(row);
  return Number.isFinite(ms) && bkkDayOfWeekIndex(ms) === targetDow;
}

export function reversalRowMatchesLenRankFilter(
  row: CandleReversalStatsRow,
  filter: ReversalLenRankFilter,
): boolean {
  if (filter === "all") return true;
  const rank = row.rangeRankInLookback;
  if (rank == null || !Number.isFinite(rank)) return false;
  const r = Math.floor(rank);
  return r >= 3 && r <= 15;
}

export function reversalRowMatchesVolVsSmaFilter(
  row: CandleReversalStatsRow,
  filter: StatsVolVsSmaFilter,
): boolean {
  return statsRowMatchesVolVsSmaFilter(row.signalVolVsSma, filter);
}

export function reversalRowMatchesAtrPct14dFilter(
  row: CandleReversalStatsRow,
  filter: StatsAtrPct14dFilter,
): boolean {
  return statsRowMatchesAtrPct14dFilter(row.atrPct14d, filter);
}

export function reversalRowMatchesBarRangeSignalFilter(
  row: CandleReversalStatsRow,
  filter: ReversalBarRangeSignalFilter,
): boolean {
  return snowballStatsRowMatchesBarRangeSignalFilter(row, filter);
}

export function filterCandleReversalStatsRows(
  rows: CandleReversalStatsRow[],
  q: ReversalStatsFilterQuery,
): CandleReversalStatsRow[] {
  return rows.filter((r) => {
    if (q.tf && (r.signalBarTf ?? "1d") !== q.tf) return false;
    if (q.side && (r.tradeSide ?? "short") !== q.side) return false;
    if (q.days && q.days !== "all" && !reversalRowMatchesDayFilter(r, q.days)) return false;
    if (q.dow && q.dow !== "all" && !reversalRowMatchesDowFilter(r, q.dow)) return false;
    if (q.shape && q.shape !== "all" && !reversalRowMatchesShapeFilter(r, q.shape)) return false;
    if (q.lenRank && q.lenRank !== "all" && !reversalRowMatchesLenRankFilter(r, q.lenRank)) return false;
    if (q.vol && q.vol !== "all" && !reversalRowMatchesVolVsSmaFilter(r, q.vol)) return false;
    if (q.ema4h && q.ema4h !== "all" && !reversalRowMatchesEma4hFilter(r, q.ema4h)) return false;
    if (q.ema1d && q.ema1d !== "all" && !reversalRowMatchesEma1dFilter(r, q.ema1d)) return false;
    if (q.btcEma4h && q.btcEma4h !== "all" && !reversalRowMatchesBtcEma4hFilter(r, q.btcEma4h)) return false;
    if (q.atr && q.atr !== "all" && !reversalRowMatchesAtrPct14dFilter(r, q.atr)) return false;
    if (q.rSignal && q.rSignal !== "all" && !reversalRowMatchesBarRangeSignalFilter(r, q.rSignal)) {
      return false;
    }
    if (q.matrix && q.matrix !== "all" && !reversalStatsRowMatchesMatrixFilter(r, q.matrix)) return false;
    return true;
  });
}

const SHAPE_SET = new Set<string>(["all", "wick80", "body80", "wickOrBody80"]);
const DAY_SET = new Set<string>(["all", "3", "7", "30", "90"]);
const DOW_SET = new Set<string>(["all", "0", "1", "2", "3", "4", "5", "6"]);
const LEN_SET = new Set<string>(["all", "rank3to15"]);
const VOL_SET = new Set(STATS_VOL_VS_SMA_FILTER_OPTIONS.map((o) => o.value));
const ATR_SET = new Set(STATS_ATR_PCT14D_FILTER_OPTIONS.map((o) => o.value));
const R_SIGNAL_SET = new Set(SNOWBALL_BAR_RANGE_SIGNAL_FILTER_OPTIONS.map((o) => o.value));
const MATRIX_SET = new Set<string>(["all", "qualitySignal", "neutral", "slowMover"]);

function parseReversalEmaSlopeFilterParam(raw: string | null): ReversalEma4hFilter {
  const k = raw?.trim().toLowerCase() ?? "";
  if (k === "lt0" || k === "slopedown") return "lt0";
  if (k === "lt3" || k === "lt-3") return "lt3";
  if (k === "lt5" || k === "lt-5") return "lt5";
  if (k === "lt10" || k === "lt-10") return "lt10";
  if (
    k === "gtm10lt0" ||
    k === "gt-10lt0" ||
    k === "-10to0" ||
    k === "between-10and0"
  ) {
    return "gtm10lt0";
  }
  if (k === "gtm14" || k === "gt-14" || k === "gt+14") return "gtm14";
  if (k === "gt3" || k === "gt+3" || k === "slopeup") return "gt3";
  if (k === "gt5" || k === "gt+5") return "gt5";
  if (k === "gt10" || k === "gt+10") return "gt10";
  if (k === "gt0lt30" || k === "0-30" || k === "0to30" || k === "between0and30") return "gt0lt30";
  if (k === "gt15" || k === "gt+15") return "gt15";
  if (k === "gt20" || k === "gt+20") return "gt20";
  if (k === "gt30" || k === "gt+30") return "gt30";
  if (k === "gt50" || k === "gt+50") return "gt50";
  if (k === "gt80" || k === "gt+80") return "gt80";
  if (k === "lt80" || k === "lt+80" || k === "lt-80") return "lt80";
  if (k === "gt100" || k === "gt+100") return "gt100";
  if (k === "gt150" || k === "gt+150") return "gt150";
  if (k === "gt200" || k === "gt+200") return "gt200";
  return "all";
}

function pickEnum<T extends string>(raw: string | null, allowed: Set<string>, fallback: T): T {
  const k = raw?.trim().toLowerCase() ?? "";
  return (allowed.has(k) ? k : fallback) as T;
}

/** อ่าน query จาก URL / searchParams */
export function reversalStatsFilterQueryFromSearchParams(
  sp: URLSearchParams,
): ReversalStatsFilterQuery {
  const tfRaw = sp.get("tf")?.toLowerCase();
  const sideRaw = sp.get("side")?.toLowerCase();
  const q: ReversalStatsFilterQuery = {};
  if (tfRaw === "1d" || tfRaw === "1h") q.tf = tfRaw;
  if (sideRaw === "long" || sideRaw === "short") q.side = sideRaw;
  q.days = pickEnum(sp.get("days"), DAY_SET, "all");
  q.dow = pickEnum(sp.get("dow"), DOW_SET, "all");
  q.shape = pickEnum(sp.get("shape"), SHAPE_SET, "all");
  q.lenRank = pickEnum(sp.get("lenRank"), LEN_SET, "all");
  q.vol = pickEnum(sp.get("vol"), VOL_SET, "all");
  q.ema4h = parseReversalEmaSlopeFilterParam(sp.get("ema4h"));
  q.ema1d = parseReversalEmaSlopeFilterParam(sp.get("ema1d"));
  q.btcEma4h = parseReversalEmaSlopeFilterParam(sp.get("btcEma4h"));
  q.atr = pickEnum(sp.get("atr"), ATR_SET, "all");
  q.rSignal = pickEnum(sp.get("rSignal"), R_SIGNAL_SET, "all");
  q.matrix = pickEnum(sp.get("matrix"), MATRIX_SET, "all");
  return q;
}

export function buildReversalStatsCsvSearchParams(q: ReversalStatsFilterQuery): string {
  const p = new URLSearchParams();
  if (q.tf) p.set("tf", q.tf);
  if (q.side) p.set("side", q.side);
  if (q.days && q.days !== "all") p.set("days", q.days);
  if (q.dow && q.dow !== "all") p.set("dow", q.dow);
  if (q.shape && q.shape !== "all") p.set("shape", q.shape);
  if (q.lenRank && q.lenRank !== "all") p.set("lenRank", q.lenRank);
  if (q.vol && q.vol !== "all") p.set("vol", q.vol);
  if (q.ema4h && q.ema4h !== "all") p.set("ema4h", q.ema4h);
  if (q.ema1d && q.ema1d !== "all") p.set("ema1d", q.ema1d);
  if (q.btcEma4h && q.btcEma4h !== "all") p.set("btcEma4h", q.btcEma4h);
  if (q.atr && q.atr !== "all") p.set("atr", q.atr);
  if (q.rSignal && q.rSignal !== "all") p.set("rSignal", q.rSignal);
  if (q.matrix && q.matrix !== "all") p.set("matrix", q.matrix);
  const s = p.toString();
  return s ? `?${s}` : "";
}
