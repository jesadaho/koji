/**
 * Matrix presets สำหรับกรองสถิติ Snowball (LONG)
 * — Quality Signal / The Snipers / The Whale Riders / High Winrate
 */

import {
  snowballFundingRateGtNeg010Pct,
  snowballStatsVolVsSmaDisplay,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";

export type SnowballMatrixFilter =
  | "all"
  | "qualitySignal"
  | "qualityShortSignal"
  | "snipers"
  | "whaleRiders"
  | "highWinrate";

export const SNOWBALL_QUALITY_SIGNAL_CRITERIA = "เขียว 2–3 วัน · Funding > −0.10%";

export const SNOWBALL_QUALITY_SHORT_SIGNAL_CRITERIA =
  "เขียว 1 วัน · Vol×SMA > 3× · R% สัญญาณ > 8%";

export const SNOWBALL_MATRIX_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballMatrixFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "qualitySignal", label: "✨ Quality Signal" },
  { value: "qualityShortSignal", label: "✨ Quality Short Signal" },
  { value: "snipers", label: "🥇 Snipers" },
  { value: "whaleRiders", label: "🚀 Whale Riders" },
  { value: "highWinrate", label: "📈 High Winrate" },
];

export function snowballMatrixFilterLabel(filter: SnowballMatrixFilter): string {
  return SNOWBALL_MATRIX_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballMatrixFilterTitle(filter: SnowballMatrixFilter): string {
  if (filter === "qualitySignal") {
    return `Quality Signal: ${SNOWBALL_QUALITY_SIGNAL_CRITERIA}`;
  }
  if (filter === "qualityShortSignal") {
    return `Quality Short Signal: ${SNOWBALL_QUALITY_SHORT_SIGNAL_CRITERIA}`;
  }
  if (filter === "snipers") {
    return "The Snipers (LONG): BTC 4h↑·1h↑ · R% สัญญาณ 1–5% · Wick<0.20 · Vol×SMA≥2×";
  }
  if (filter === "whaleRiders") {
    return "The Whale Riders (LONG): Vol rank #1–10 · Vol×SMA≥4× · R% สัญญาณ 3–10% (≤15%) · Wick<0.40 · ไม่กรอง Grade/BTC";
  }
  if (filter === "highWinrate") {
    return "High Winrate: BTC SAR 4h↓ · เขียว 2 วันก่อนสัญญาณ";
  }
  return "Matrix preset — กรองชุดเงื่อนไขสำเร็จรูป";
}

function snowballRowIsLong(row: Pick<SnowballStatsRow, "alertSide" | "triggerKind">): boolean {
  const side = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
  return side === "long";
}

function snowballBtcSarBothUp(
  row: Pick<SnowballStatsRow, "btcPsar4hTrend" | "btcPsar1hTrend">,
): boolean {
  return row.btcPsar4hTrend === "up" && row.btcPsar1hTrend === "up";
}

function barRangePctInRange(pct: number | null | undefined, minPct: number, maxPct: number): boolean {
  return pct != null && Number.isFinite(pct) && pct >= minPct && pct <= maxPct;
}

function barRangePctAbove(pct: number | null | undefined, minExclusive: number): boolean {
  return pct != null && Number.isFinite(pct) && pct > minExclusive;
}

function wickBelow(row: Pick<SnowballStatsRow, "wickScore">, maxWick: number): boolean {
  const w = row.wickScore;
  return w != null && Number.isFinite(w) && w >= 0 && w < maxWick;
}

function volXsmaAtLeast(
  row: Pick<SnowballStatsRow, "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf">,
  minRatio: number,
): boolean {
  const v = snowballStatsVolVsSmaDisplay(row);
  return v != null && Number.isFinite(v) && v >= minRatio;
}

function volXsmaAbove(
  row: Pick<SnowballStatsRow, "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf">,
  minExclusive: number,
): boolean {
  const v = snowballStatsVolVsSmaDisplay(row);
  return v != null && Number.isFinite(v) && v > minExclusive;
}

function confirmVolRankTop10(row: Pick<SnowballStatsRow, "confirmVolRank">): boolean {
  const r = row.confirmVolRank;
  if (r == null || !Number.isFinite(r)) return false;
  const n = Math.round(r);
  return n >= 1 && n <= 10;
}

/** 🥇 The Snipers — LONG ปลอดภัย */
export function snowballRowMatchesSnipersMatrix(row: SnowballStatsRow): boolean {
  if (!snowballRowIsLong(row)) return false;
  if (!snowballBtcSarBothUp(row)) return false;
  if (!barRangePctInRange(row.barRangePctSignal, 1, 5)) return false;
  if (!wickBelow(row, 0.2)) return false;
  if (!volXsmaAtLeast(row, 2)) return false;
  return true;
}

function btcSar4hDown(row: Pick<SnowballStatsRow, "btcPsar4hTrend">): boolean {
  return row.btcPsar4hTrend === "down";
}

function greenDaysBeforeSignalIs(
  row: Pick<SnowballStatsRow, "greenDaysBeforeSignal">,
  days: number,
): boolean {
  const n = row.greenDaysBeforeSignal;
  return n != null && Number.isFinite(n) && Math.floor(n) === days;
}

function greenDaysBeforeSignalIsOneOf(
  row: Pick<SnowballStatsRow, "greenDaysBeforeSignal">,
  days: readonly number[],
): boolean {
  return days.some((d) => greenDaysBeforeSignalIs(row, d));
}

/** ✨ Quality Signal — เขียว 2–3 วันก่อนสัญญาณ + Funding > −0.10% */
export function snowballMatchesQualitySignal(
  row: Pick<SnowballStatsRow, "greenDaysBeforeSignal" | "fundingRate">,
): boolean {
  return (
    greenDaysBeforeSignalIsOneOf(row, [2, 3]) &&
    snowballFundingRateGtNeg010Pct(row.fundingRate)
  );
}

export function snowballRowMatchesQualitySignalMatrix(row: SnowballStatsRow): boolean {
  return snowballMatchesQualitySignal(row);
}

/** ✨ Quality Short Signal — เขียว 1 วัน · Vol×SMA > 3 · R% สัญญาณ > 8% */
export function snowballMatchesQualityShortSignal(
  row: Pick<
    SnowballStatsRow,
    "greenDaysBeforeSignal" | "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf" | "barRangePctSignal"
  >,
): boolean {
  return (
    greenDaysBeforeSignalIs(row, 1) &&
    volXsmaAbove(row, 3) &&
    barRangePctAbove(row.barRangePctSignal, 8)
  );
}

export function snowballRowMatchesQualityShortSignalMatrix(row: SnowballStatsRow): boolean {
  return snowballMatchesQualityShortSignal(row);
}

/** 📈 High Winrate — BTC 4h↓ + Day1 เขียว 2 วันติดก่อนสัญญาณ */
export function snowballRowMatchesHighWinrateMatrix(row: SnowballStatsRow): boolean {
  if (!btcSar4hDown(row)) return false;
  if (!greenDaysBeforeSignalIs(row, 2)) return false;
  return true;
}

/** 🚀 The Whale Riders — ไม่กรอง Grade / BTC 4h */
export function snowballRowMatchesWhaleRidersMatrix(row: SnowballStatsRow): boolean {
  if (!snowballRowIsLong(row)) return false;
  if (!confirmVolRankTop10(row)) return false;
  if (!volXsmaAtLeast(row, 4)) return false;
  if (!barRangePctInRange(row.barRangePctSignal, 3, 10)) return false;
  if (row.barRangePctSignal != null && Number.isFinite(row.barRangePctSignal) && row.barRangePctSignal > 15) {
    return false;
  }
  if (!wickBelow(row, 0.4)) return false;
  return true;
}

export function snowballStatsRowMatchesMatrixFilter(
  row: SnowballStatsRow,
  filter: SnowballMatrixFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "qualitySignal") return snowballRowMatchesQualitySignalMatrix(row);
  if (filter === "qualityShortSignal") return snowballRowMatchesQualityShortSignalMatrix(row);
  if (filter === "snipers") return snowballRowMatchesSnipersMatrix(row);
  if (filter === "whaleRiders") return snowballRowMatchesWhaleRidersMatrix(row);
  if (filter === "highWinrate") return snowballRowMatchesHighWinrateMatrix(row);
  return true;
}
