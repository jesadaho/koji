/** ตัวกรอง EMA slope — Reversal / Snowball stats Mini App + CSV export */

import type { CandleReversalStatsRow } from "@/lib/candleReversalStatsClient";

export type ReversalEmaSlopeFilter =
  | "all"
  | "lt0"
  | "lt3"
  | "lt5"
  | "lt10"
  | "gtm10lt0"
  | "gtm14"
  | "gt3"
  | "gt5"
  | "gt10"
  | "gt0lt30"
  | "gt15"
  | "gt20"
  | "gt30"
  | "gt50"
  | "gt80"
  | "lt80"
  | "gt100"
  | "gt150"
  | "gt200";

/** @deprecated alias — ใช้ ReversalEmaSlopeFilter */
export type ReversalEma4hFilter = ReversalEmaSlopeFilter;
export type ReversalEma1hFilter = ReversalEmaSlopeFilter;
export type ReversalEma1dFilter = ReversalEmaSlopeFilter;

export const REVERSAL_EMA_SLOPE_FILTER_OPTIONS: ReadonlyArray<{
  value: ReversalEmaSlopeFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "lt0", label: "< 0" },
  { value: "lt3", label: "< -3" },
  { value: "lt5", label: "< -5" },
  { value: "lt10", label: "< -10" },
  { value: "gtm10lt0", label: "> -10 < 0" },
  { value: "gtm14", label: "> -14" },
  { value: "gt3", label: "> 3" },
  { value: "gt5", label: "> 5" },
  { value: "gt10", label: "> 10" },
  { value: "gt0lt30", label: "> 0 < 30" },
  { value: "gt15", label: "> 15" },
  { value: "gt20", label: "> 20" },
  { value: "gt30", label: "> 30" },
  { value: "gt50", label: "> 50" },
  { value: "gt80", label: "> 80" },
  { value: "lt80", label: "< 80" },
  { value: "gt100", label: "> 100" },
  { value: "gt150", label: "> 150" },
  { value: "gt200", label: "> 200" },
];

/** @deprecated alias */
export const REVERSAL_EMA4H_FILTER_OPTIONS = REVERSAL_EMA_SLOPE_FILTER_OPTIONS;
export const REVERSAL_EMA1H_FILTER_OPTIONS = REVERSAL_EMA_SLOPE_FILTER_OPTIONS;
export const REVERSAL_EMA1D_FILTER_OPTIONS = REVERSAL_EMA_SLOPE_FILTER_OPTIONS;

const EMA_SLOPE_THRESHOLD: Record<
  Exclude<ReversalEmaSlopeFilter, "all" | "gt0lt30" | "gtm10lt0" | "gtm14">,
  number
> = {
  lt0: 0,
  lt3: -3,
  lt5: -5,
  lt10: -10,
  gt3: 3,
  gt5: 5,
  gt10: 10,
  gt15: 15,
  gt20: 20,
  gt30: 30,
  gt50: 50,
  gt80: 80,
  lt80: 80,
  gt100: 100,
  gt150: 150,
  gt200: 200,
};

function emaSlopePctMatchesFilter(pct: number | null | undefined, filter: ReversalEmaSlopeFilter): boolean {
  if (filter === "all") return true;
  if (pct == null || !Number.isFinite(pct)) return false;
  if (filter === "gt0lt30") return pct > 0 && pct < 30;
  if (filter === "gtm10lt0") return pct > -10 && pct < 0;
  if (filter === "gtm14") return pct > -14;
  const th = EMA_SLOPE_THRESHOLD[filter];
  if (filter === "lt0" || filter === "lt3" || filter === "lt5" || filter === "lt10" || filter === "lt80") {
    return pct < th;
  }
  return pct > th;
}

export function reversalEmaSlopeFilterLabel(filter: ReversalEmaSlopeFilter): string {
  return REVERSAL_EMA_SLOPE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function reversalEma4hFilterLabel(filter: ReversalEma4hFilter): string {
  return reversalEmaSlopeFilterLabel(filter);
}

export function reversalEma1hFilterLabel(filter: ReversalEma1hFilter): string {
  return reversalEmaSlopeFilterLabel(filter);
}

export function reversalEma1dFilterLabel(filter: ReversalEma1dFilter): string {
  return reversalEmaSlopeFilterLabel(filter);
}

export function reversalEma4hFilterTitle(filter: ReversalEma4hFilter): string {
  if (filter === "all") return "ไม่กรอง EMA4h slope 7 วัน";
  if (filter === "gt0lt30") return "EMA(12) 4h slope 7 วัน > 0% และ < 30%";
  if (filter === "gtm10lt0") return "EMA(12) 4h slope 7 วัน > -10% และ < 0%";
  const label = reversalEma4hFilterLabel(filter);
  return `EMA(12) 4h slope 7 วัน ${label}%`;
}

export function reversalEma1hFilterTitle(filter: ReversalEma1hFilter): string {
  if (filter === "all") return "ไม่กรอง EMA20∠1h";
  if (filter === "gt0lt30") return "EMA20∠1h > 0% และ < 30%";
  if (filter === "gtm10lt0") return "EMA20∠1h > -10% และ < 0%";
  const label = reversalEma1hFilterLabel(filter);
  return `EMA20∠1h ${label}%`;
}

export function reversalEma1dFilterTitle(filter: ReversalEma1dFilter): string {
  if (filter === "all") return "ไม่กรอง EMA1d slope 7 วัน";
  if (filter === "gt0lt30") return "EMA(12) 1d slope 7 แท่ง > 0% และ < 30%";
  if (filter === "gtm10lt0") return "EMA(12) 1d slope 7 แท่ง > -10% และ < 0%";
  const label = reversalEma1dFilterLabel(filter);
  return `EMA(12) 1d slope 7 แท่ง ${label}%`;
}

export function reversalRowMatchesEma4hFilter(
  row: Pick<CandleReversalStatsRow, "ema4hSlopePct7d">,
  filter: ReversalEma4hFilter,
): boolean {
  return emaSlopePctMatchesFilter(row.ema4hSlopePct7d, filter);
}

export function reversalRowMatchesEma1hFilter(
  row: { ema20_1hSlopePct7d?: number | null },
  filter: ReversalEma1hFilter,
): boolean {
  return emaSlopePctMatchesFilter(row.ema20_1hSlopePct7d, filter);
}

export function reversalRowMatchesEma1dFilter(
  row: Pick<CandleReversalStatsRow, "ema1dSlopePct7d">,
  filter: ReversalEma1dFilter,
): boolean {
  return emaSlopePctMatchesFilter(row.ema1dSlopePct7d, filter);
}

export type BtcEma4hFilter = ReversalEmaSlopeFilter;

/** @deprecated alias */
export const BTC_EMA4H_FILTER_OPTIONS = REVERSAL_EMA_SLOPE_FILTER_OPTIONS;

export function reversalBtcEma4hFilterTitle(filter: BtcEma4hFilter): string {
  if (filter === "all") return "ไม่กรอง BTC EMA20 4h slope 7 วัน";
  if (filter === "gt0lt30") return "BTC EMA20 4h slope 7 วัน > 0% และ < 30%";
  if (filter === "gtm10lt0") return "BTC EMA20 4h slope 7 วัน > -10% และ < 0%";
  if (filter === "gtm14") return "BTC EMA20 4h slope 7 วัน > -14%";
  const label = reversalEmaSlopeFilterLabel(filter);
  return `BTC EMA20 4h slope 7 วัน ${label}%`;
}

export function reversalRowMatchesBtcEma4hFilter(
  row: Pick<CandleReversalStatsRow, "btcEma20_4hSlopePct7d">,
  filter: BtcEma4hFilter,
): boolean {
  return emaSlopePctMatchesFilter(row.btcEma20_4hSlopePct7d, filter);
}
