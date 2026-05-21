/** Client-safe Snowball stats types + Grade label (no Node.js / Redis). */

import {
  snowballIsGradeDLongToShort,
  snowballIsGradeDPlusLong,
  snowballIsGradeF,
  snowballLongGradeShortLabel,
  type SnowballLongBreakoutGrade,
} from "@/src/snowballLongBreakoutGrade";

export type SnowballStatsOutcome = "pending" | "win_trend" | "win_quick_tp30" | "loss" | "flat";

export type SnowballStatsQualityTier = SnowballLongBreakoutGrade;

/** ทิศสัญญาณ Snowball ตอนแจ้ง (long / bear) */
export type SnowballStatsAlertSide = "long" | "bear";

export type SnowballStatsRow = {
  id: string;
  symbol: string;
  /** ทิศวัดผลสถิติ (ROI/DD/outcome) — Grade D = long ตามสัญญาณ */
  side: "long" | "short";
  /** ทิศสัญญาณตอนแจ้ง — แถวเก่าอาจไม่มี */
  alertSide?: SnowballStatsAlertSide;
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  signalBarLow?: number | null;
  signalBarTf?: "15m" | "1h" | "4h";
  entryPrice: number;
  intrabar: boolean;
  triggerKind: string;
  /** เกรดสุทธิตอนแจ้ง (Single-Layer Matrix) */
  qualityTier?: SnowballStatsQualityTier;
  /** @deprecated ใช้ qualityTier — คงไว้สำหรับแถวเก่า */
  alertQualityTier?: SnowballStatsQualityTier;
  /** ปรับ qualityTier แล้วหลังครบ 4 ชม. */
  qualityTier4hAdjusted?: boolean;
  /** Long 1H Breakout confirm fail → Grade D (Long->Short) */
  breakout1hConfirmFail?: boolean;
  /** @deprecated อ่านจาก qualityTier=d_plus + !breakout1hConfirmFail */
  momentumDowngrade?: boolean;
  /** @deprecated อ่านจาก qualityTier=f_plus */
  momentumFailGradeF?: boolean;
  atr100?: number | null;
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
  maxDrawback1hPct?: number | null;
  volumeCascadeYn?: "Y" | "N" | null;
  trendMomentumLookback?: number | null;
  trendMomentumVolLookback?: number | null;
  confirmVolVsSma?: number | null;
  confirmVolRank?: number | null;
  confirmVolRankLb?: number | null;
  greenDaysBeforeSignal?: number | null;
  svpHoleYn: "Y" | "N";
  price4h: number | null;
  pct4h: number | null;
  price12h: number | null;
  pct12h: number | null;
  price24h: number | null;
  pct24h: number | null;
  price48h: number | null;
  pct48h: number | null;
  maxRoiPct: number | null;
  durationToMfeHours: number | null;
  maxDrawdownPct: number | null;
  resultRr: string | null;
  outcome: SnowballStatsOutcome;
};

export type SnowballStatsApiPayload = {
  rows: SnowballStatsRow[];
};

function snowballStatsAlertSideLabel(alert: SnowballStatsAlertSide): "Long" | "Short" {
  return alert === "bear" ? "Short" : "Long";
}

export function snowballStatsSideLabel(
  row: Pick<SnowballStatsRow, "alertSide" | "triggerKind">,
): string {
  let alert: SnowballStatsAlertSide | null = row.alertSide ?? null;
  if (!alert) {
    alert = row.triggerKind === "swing_ll" ? "bear" : "long";
  }
  return snowballStatsAlertSideLabel(alert);
}

function effectiveQualityTier(row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier">): SnowballStatsQualityTier | undefined {
  return row.qualityTier ?? row.alertQualityTier;
}

/** แถวสถิติ Grade D จาก 1H confirm fail (Long->Short) */
export function snowballStatsIsLongConfirmFailRow(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail">,
): boolean {
  const tier = effectiveQualityTier(row);
  if (snowballIsGradeF(tier)) return false;
  if (snowballIsGradeDPlusLong(tier, row.breakout1hConfirmFail)) return false;
  if (row.breakout1hConfirmFail) return true;
  return snowballIsGradeDLongToShort(tier, row.breakout1hConfirmFail);
}

/** @deprecated ใช้ qualityTier === f_plus */
export function snowballStatsIsGradeFMomentumFailRow(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "momentumFailGradeF">,
): boolean {
  if (row.momentumFailGradeF === true) return true;
  if (row.momentumFailGradeF === false) return false;
  return snowballIsGradeF(effectiveQualityTier(row));
}

/** @deprecated ใช้ qualityTier === d_plus && !breakout1hConfirmFail */
export function snowballStatsIsGradeBMomentumDowngradeRow(
  row: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade" | "momentumFailGradeF"
  >,
): boolean {
  if (row.momentumFailGradeF) return false;
  if (row.momentumDowngrade === true) return true;
  if (row.momentumDowngrade === false) return false;
  return snowballIsGradeDPlusLong(effectiveQualityTier(row), row.breakout1hConfirmFail);
}

function snowballStatsGradeLetter(
  tier: SnowballStatsQualityTier | undefined,
  row?: Pick<SnowballStatsRow, "breakout1hConfirmFail">,
): string {
  if (!tier) return "—";
  if (snowballIsGradeDLongToShort(tier, row?.breakout1hConfirmFail)) return "D";
  return snowballLongGradeShortLabel(tier);
}

/** เกรดสุทธิ — ไม่ใช้วงเล็บประวัติโครงสร้างเดิม (Single-Layer) */
export function snowballStatsGradeLabel(
  _side: SnowballStatsRow["side"],
  tier: SnowballStatsRow["qualityTier"] | undefined,
  _alertTier?: SnowballStatsRow["alertQualityTier"],
  row?: Pick<SnowballStatsRow, "breakout1hConfirmFail" | "qualityTier4hAdjusted" | "qualityTier">,
): string {
  const effective = tier ?? row?.qualityTier;
  return snowballStatsGradeLetter(effective, row);
}

export function snowballStatsGradeCellClass(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail">,
): string {
  const tier = effectiveQualityTier(row);
  if (snowballIsGradeF(tier)) return "snowGradeCell snowGradeCell--f";
  if (snowballIsGradeDPlusLong(tier, row.breakout1hConfirmFail)) {
    return "snowGradeCell snowGradeCell--d";
  }
  if (tier === "a_plus") return "snowGradeCell snowGradeCell--a";
  if (tier === "b_plus") return "snowGradeCell snowGradeCell--b";
  if (tier === "c_plus") return "snowGradeCell snowGradeCell--c";
  if (snowballIsGradeDLongToShort(tier, row.breakout1hConfirmFail)) {
    return "snowGradeCell snowGradeCell--d";
  }
  return "snowGradeCell";
}

/** แสดงค่า ATR / Max Wick ในตาราง (ราคา + % ของ entry ถ้ามี) */
export function snowballStatsVolMetricLabel(
  value: number | null | undefined,
  entryPrice: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  let px: string;
  if (abs >= 1000) px = value.toFixed(2);
  else if (abs >= 1) px = value.toFixed(4);
  else px = value.toFixed(6);
  if (entryPrice != null && Number.isFinite(entryPrice) && entryPrice > 0) {
    const pct = (value / entryPrice) * 100;
    return `${px} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
  }
  return px;
}

export function snowballStatsVolScoreLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export function snowballStatsBarRangePctLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

function snowballStatsBtcPsarTrendChip(
  tf: "4h" | "1h",
  trend: "up" | "down" | null | undefined,
): string {
  if (trend === "up") return `${tf}↑`;
  if (trend === "down") return `${tf}↓`;
  return `${tf}—`;
}

export function snowballStatsBtcPsar4hLabel(trend: SnowballStatsRow["btcPsar4hTrend"]): string {
  return snowballStatsBtcPsarTrendChip("4h", trend);
}

export function snowballStatsBtcPsar1hLabel(trend: SnowballStatsRow["btcPsar1hTrend"]): string {
  return snowballStatsBtcPsarTrendChip("1h", trend);
}

export function snowballStatsBtcPsarCombinedLabel(
  trend4h: SnowballStatsRow["btcPsar4hTrend"],
  trend1h: SnowballStatsRow["btcPsar1hTrend"],
): string {
  const a = snowballStatsBtcPsarTrendChip("4h", trend4h);
  const b = snowballStatsBtcPsarTrendChip("1h", trend1h);
  if (a === "4h—" && b === "1h—") return "—";
  return `${a} · ${b}`;
}

export function snowballStatsMaxDrawback1hLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

export function snowballStatsGreenDaysLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v < 0) return "—";
  return `${Math.floor(v)} วัน`;
}

export function snowballStatsVolumeCascadeLabel(v: "Y" | "N" | null | undefined): string {
  if (v === "Y") return "Y";
  if (v === "N") return "N";
  return "—";
}

export function snowballStatsConfirmVolVsSmaLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  return `${v.toFixed(2)}×`;
}

export function snowballStatsConfirmVolRankLabel(
  rank: number | null | undefined,
  lb: number | null | undefined,
): string {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return "—";
  const r = Math.round(rank);
  if (lb != null && Number.isFinite(lb) && lb >= 1) return `#${r}/${Math.round(lb)}`;
  return `#${r}`;
}

export function snowballStatsQuoteVol24hLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

export function snowballStatsDayOfWeekBkk(
  alertedAtIso: string,
  alertedAtMs?: number | null,
): string {
  const ms =
    alertedAtMs != null && Number.isFinite(alertedAtMs) ? alertedAtMs : Date.parse(alertedAtIso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
  });
}
