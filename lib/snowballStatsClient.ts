/** Client-safe Snowball stats types + Grade label (no Node.js / Redis). */

import { statsFmtPctCell } from "@/lib/statsCsv";
import { formatFunding } from "@/src/marketsFormat";
import {
  snowballIsGradeDPlusLong,
  snowballIsGradeF,
  snowballLongGradeShortLabel,
  type SnowballLongBreakoutGrade,
  type SnowballLongStructureTier,
} from "@/src/snowballLongBreakoutGrade";

export type { SnowballLongStructureTier };

export type SnowballStatsOutcome = "pending" | "win_trend" | "win_quick_tp30" | "loss" | "flat";

export type SnowballStatsQualityTier = SnowballLongBreakoutGrade;

/** ทิศสัญญาณ Snowball ตอนแจ้ง (long / bear) */
export type SnowballStatsAlertSide = "long" | "bear";

export type SnowballStatsRow = {
  id: string;
  symbol: string;
  /** ทิศวัดผลสถิติ (ROI/DD/outcome) — Long alert = long เสมอ */
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
  /** โครงสร้าง HH48/HH200/VAH ตอนแจ้ง (A+/B/C) — คงที่แม้ qualityTier เป็น D+/F */
  structureTier?: SnowballLongStructureTier;
  /** snapshot เกรดตอนแจ้งครั้งแรก (ก่อน follow-up 4h) */
  alertQualityTier?: SnowballStatsQualityTier;
  /** ปรับ qualityTier แล้วหลังครบ 4 ชม. */
  qualityTier4hAdjusted?: boolean;
  /** @deprecated แถวเก่า Grade D (Long->Short) — ไม่สร้างใหม่ */
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
  /** Funding rate MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม) */
  fundingRate?: number | null;
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

/** แถวสถิติเก่า Grade D (Long->Short) — ใช้ปรับเกรด 4h follow-up เท่านั้น */
export function snowballStatsIsLongConfirmFailRow(
  row: Pick<SnowballStatsRow, "breakout1hConfirmFail">,
): boolean {
  return row.breakout1hConfirmFail === true;
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
  return snowballIsGradeDPlusLong(effectiveQualityTier(row));
}

function snowballStatsGradeLetter(tier: SnowballStatsQualityTier | undefined): string {
  if (!tier) return "—";
  return snowballLongGradeShortLabel(tier);
}

function snowballStatsStructureTierHint(tier: SnowballLongStructureTier): string {
  if (tier === "a_plus") return "HH48+HH200+VAH";
  if (tier === "b_plus") return "VAH only";
  return "HH48 (C)";
}

function snowballStatsIsStructureTier(
  tier: string | undefined,
): tier is SnowballLongStructureTier {
  return tier === "a_plus" || tier === "b_plus" || tier === "c_plus";
}

/** ป้ายคอลัมน์ Grade — เกรดแจ้ง + โครงสร้างในวงเล็บเมื่อต่างกัน */
export function snowballStatsStructureTierLabel(
  tier: SnowballLongStructureTier | null | undefined,
): string {
  if (!tier || !snowballStatsIsStructureTier(tier)) return "—";
  return snowballLongGradeShortLabel(tier);
}

export function snowballStatsGradeDisplayLabel(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "structureTier">,
): string {
  const alert = effectiveQualityTier(row);
  const struct = row.structureTier;
  const alertLabel = snowballStatsGradeLetter(alert);
  if (!struct || !snowballStatsIsStructureTier(struct)) return alertLabel;
  const structLabel = snowballLongGradeShortLabel(struct);
  if (!alert || alert === struct) return structLabel;
  return `${alertLabel} (${structLabel})`;
}

/** บรรทัดสำหรับ popup รายละเอียดเกรด */
export function snowballStatsGradeDetailLines(
  row: Pick<
    SnowballStatsRow,
    | "symbol"
    | "alertSide"
    | "triggerKind"
    | "qualityTier"
    | "alertQualityTier"
    | "structureTier"
    | "qualityTier4hAdjusted"
    | "momentumDowngrade"
    | "momentumFailGradeF"
  >,
): string[] {
  const lines: string[] = [];
  const alert = effectiveQualityTier(row);
  const alertAt = row.alertQualityTier ?? alert;
  if (alert) {
    lines.push(`เกรดแจ้ง: ${snowballLongGradeShortLabel(alert)}`);
  }
  if (alertAt && alertAt !== alert) {
    lines.push(`เกรดตอนแจ้ง (snapshot): ${snowballLongGradeShortLabel(alertAt)}`);
  }
  if (row.qualityTier4hAdjusted && row.qualityTier && row.qualityTier !== alertAt) {
    lines.push(`เกรดหลังปรับ 4h: ${snowballLongGradeShortLabel(row.qualityTier)}`);
  }
  const struct = row.structureTier;
  if (struct && snowballStatsIsStructureTier(struct)) {
    lines.push(
      `โครงสร้าง 4H: ${snowballLongGradeShortLabel(struct)} (${snowballStatsStructureTierHint(struct)})`,
    );
  } else {
    const side =
      row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
    if (side === "long") {
      lines.push("โครงสร้าง 4H: — (แถวเก่าหรือไม่บันทึก)");
    }
  }
  if (row.momentumFailGradeF || snowballIsGradeF(alert)) {
    lines.push("Momentum: ไม่ผ่าน · 1H confirm ไม่ผ่าน (Grade F)");
  } else if (row.momentumDowngrade || snowballIsGradeDPlusLong(alert)) {
    lines.push("Momentum: ไม่ผ่าน · confirm ผ่าน (Grade D+)");
  }
  return lines;
}

/** เกรดสุทธิอย่างเดียว (CSV compat / sort) */
export function snowballStatsGradeLabel(
  _side: SnowballStatsRow["side"],
  tier: SnowballStatsRow["qualityTier"] | undefined,
  _alertTier?: SnowballStatsRow["alertQualityTier"],
  _row?: Pick<SnowballStatsRow, "qualityTier4hAdjusted" | "qualityTier" | "structureTier">,
): string {
  if (_row) return snowballStatsGradeDisplayLabel(_row);
  return snowballStatsGradeLetter(tier);
}

export function snowballStatsGradeCellClass(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail">,
): string {
  const tier = effectiveQualityTier(row);
  if (snowballIsGradeF(tier)) return "snowGradeCell snowGradeCell--f";
  if (snowballIsGradeDPlusLong(tier)) {
    return "snowGradeCell snowGradeCell--d";
  }
  if (tier === "a_plus") return "snowGradeCell snowGradeCell--a";
  if (tier === "b_plus") return "snowGradeCell snowGradeCell--b";
  if (tier === "c_plus") return "snowGradeCell snowGradeCell--c";
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

export function snowballStatsFundingRateLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFunding(value);
}

export function snowballStatsSignalBarDurationSec(tf: SnowballStatsRow["signalBarTf"]): number {
  if (tf === "4h") return 4 * 3600;
  if (tf === "1h") return 3600;
  return 900;
}

/** เวลาปิดแท่งสัญญาณ (anchor) — นับ horizon 12h/24h/48h จากจุดนี้ */
export function snowballStatsAnchorCloseSec(
  row: Pick<SnowballStatsRow, "signalBarOpenSec" | "signalBarTf">,
): number {
  return row.signalBarOpenSec + snowballStatsSignalBarDurationSec(row.signalBarTf ?? "15m");
}

export function snowballStatsHorizonDue(
  row: Pick<SnowballStatsRow, "signalBarOpenSec" | "signalBarTf">,
  horizonHours: number,
  nowMs: number = Date.now(),
): boolean {
  const ac = snowballStatsAnchorCloseSec(row);
  return nowMs / 1000 >= ac + horizonHours * 3600;
}

/** ราคา+% หลังครบ horizon — ยังไม่ครบเวลาแสดง "-" */
export function snowballStatsFmtHorizonPctCell(
  row: Pick<SnowballStatsRow, "signalBarOpenSec" | "signalBarTf">,
  horizonHours: number,
  price: number | null | undefined,
  pct: number | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!snowballStatsHorizonDue(row, horizonHours, nowMs)) return "-";
  const cell = statsFmtPctCell(price, pct);
  return cell || "—";
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
