/** Client-safe Snowball stats types + Grade label (no Node.js / Redis). */

import {
  snowballGradeChecklistMark,
  snowballStatsConfirmGateStepsAllPass,
  snowballStatsConfirmOk,
  snowballStatsGradeChecklist,
  snowballStatsGradeChecklistFooter,
  snowballStatsLegacyBreakout1hConfirmFailIgnored,
} from "@/lib/snowballGradeChecklist";
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

/** ขั้น confirm ตอนแจ้ง — ใช้ใน popup เมื่อไม่ผ่าน */
export type SnowballStatsGateStep = {
  label: string;
  ok: boolean;
  detail: string;
};

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
  /** Market cap USD (CoinGecko) ณ เวลาแจ้ง */
  marketCapUsd?: number | null;
  /** Funding rate MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม) */
  fundingRate?: number | null;
  volumeCascadeYn?: "Y" | "N" | null;
  /** Max DD% (stats-style 15m, lookback 32 แท่ง) ณ เวลาแจ้ง — undefined = แถวเก่าก่อนเพิ่ม field */
  signalMaxDdPct?: number | null;
  trendMomentumVolLookback?: number | null;
  /** Vol แท่งสัญญาณ ÷ SMA ณ เวลาแจ้ง */
  signalVolVsSma?: number | null;
  volStrictOk?: boolean | null;
  volNearMissOnly?: boolean | null;
  volMultAtAlert?: number | null;
  volNearMultAtAlert?: number | null;
  confirmGateSteps?: SnowballStatsGateStep[];
  confirmVolVsSma?: number | null;
  confirmVolRank?: number | null;
  confirmVolRankLb?: number | null;
  greenDaysBeforeSignal?: number | null;
  svpHoleYn: "Y" | "N";
  /** Stage 1 ceiling จาก Base-Offset matrix (A / B / C) — 4h เท่านั้น */
  structureCeiling?: "A" | "B" | "C" | null;
  /** จำนวนข้อ Stage 3 ที่พลาด (0–3) — 4h เท่านั้น */
  momentumFailCount?: 0 | 1 | 2 | 3 | null;
  /** notch จาก ceiling (+1 / 0 / -1 / -2) — 4h เท่านั้น */
  gradeNotch?: 1 | 0 | -1 | -2 | null;
  /** Display grade (A+ / A / A- / B+ / B / B- / C+ / C / C- / D) — 4h เท่านั้น */
  displayGrade?:
    | "A+"
    | "A"
    | "A-"
    | "B+"
    | "B"
    | "B-"
    | "C+"
    | "C"
    | "C-"
    | "D"
    | null;
  /** Action plan — ผูก margin scale / auto-open */
  actionPlan?: "full" | "standard" | "light" | "monitor" | null;
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
  /** migration: รีเซ็ต horizon หลังแก้ anchor 4h two-bar (ปิดแท่ง confirm) */
  horizonAnchorV2?: boolean;
};

export type SnowballStatsApiPayload = {
  rows: SnowballStatsRow[];
  /** ลบแถว / ล้างสถิติทั้งหมด — เฉพาะ KOJI_ADMIN_IDS */
  isAdmin?: boolean;
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

/** Label สำหรับ Action Plan (ใช้ใน popup + TG footer) */
export function snowballStatsActionPlanLabel(
  plan: SnowballStatsRow["actionPlan"] | undefined,
): string {
  if (plan === "full") return "Full (1.0×)";
  if (plan === "standard") return "Standard (1.0×)";
  if (plan === "light") return "Light (0.5×)";
  if (plan === "monitor") return "Monitor (no auto-open)";
  return "—";
}

/** เทียบ qualityTier เก่ากับ schema ใหม่ (สำหรับแถวที่ไม่มี displayGrade) */
export function snowballStatsDerivedDisplayGrade(
  row: Pick<SnowballStatsRow, "displayGrade" | "qualityTier" | "alertQualityTier" | "momentumDowngrade" | "momentumFailGradeF">,
): string | null {
  if (row.displayGrade) return row.displayGrade;
  if (row.momentumFailGradeF) return "F";
  const tier = row.qualityTier ?? row.alertQualityTier;
  if (tier === "a_plus") return "A+";
  if (tier === "b_plus") return "B";
  if (tier === "c_plus") return "C";
  if (tier === "d_plus") return row.momentumDowngrade ? "D+" : "D";
  if (tier === "f_plus") return "F";
  return null;
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

/** ป้ายคอลัมน์โครงสร้าง (CSV / วิเคราะห์) */
export function snowballStatsStructureTierLabel(
  tier: SnowballLongStructureTier | null | undefined,
): string {
  if (!tier || !snowballStatsIsStructureTier(tier)) return "—";
  return snowballLongGradeShortLabel(tier);
}

/** ป้ายคอลัมน์ Grade — เกรดสุทธิชั้นเดียว (โครงสร้างดูใน popup) */
export function snowballStatsGradeDisplayLabel(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier">,
): string {
  return snowballStatsGradeLetter(effectiveQualityTier(row));
}

export type { SnowballGradeChecklistItem } from "@/lib/snowballGradeChecklist";
export {
  snowballGradeChecklistMark,
  snowballStatsConfirmGateStepsAllPass,
  snowballStatsConfirmOk,
  snowballStatsGradeChecklist,
  snowballStatsGradeChecklistFooter,
  snowballStatsLegacyBreakout1hConfirmFailIgnored,
  snowballStatsStagedPopupText,
} from "@/lib/snowballGradeChecklist";

/** @deprecated ใช้ snowballStatsGradeChecklist + footer ใน popup */
export function snowballStatsGradeDetailLines(row: SnowballStatsRow): string[] {
  const side = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
  if (side === "bear") {
    const grade = effectiveQualityTier(row);
    const bear: string[] = ["— grade SHORT —"];
    if (grade) bear.push(`เกรดสุทธิ: ${snowballLongGradeShortLabel(grade)}`);
    return bear;
  }
  const items = snowballStatsGradeChecklist(row);
  const lines = items.map(
    (it) => `${snowballGradeChecklistMark(it.status)} ${it.title}${it.detail ? ` — ${it.detail}` : ""}`,
  );
  lines.push(...snowballStatsGradeChecklistFooter(row));
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

/** Vol×SMA ในตาราง — 4h ใช้ signal (ตรง debug Signal Vol Spurt) · อื่นๆ ใช้ 1H confirm ก่อน */
export function snowballStatsVolVsSmaDisplay(
  row: Pick<SnowballStatsRow, "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf">,
): number | null {
  const tf = row.signalBarTf ?? "15m";
  if (
    tf === "4h" &&
    row.signalVolVsSma != null &&
    Number.isFinite(row.signalVolVsSma) &&
    row.signalVolVsSma > 0
  ) {
    return row.signalVolVsSma;
  }
  if (row.confirmVolVsSma != null && Number.isFinite(row.confirmVolVsSma) && row.confirmVolVsSma > 0) {
    return row.confirmVolVsSma;
  }
  if (row.signalVolVsSma != null && Number.isFinite(row.signalVolVsSma) && row.signalVolVsSma > 0) {
    return row.signalVolVsSma;
  }
  return null;
}

export function snowballStatsVolVsSmaColumnTitle(signalBarTf?: SnowballStatsRow["signalBarTf"]): string {
  if (signalBarTf === "4h") {
    return "Vol แท่งสัญญาณ 4H ÷ SMA(4H) — ตรง Signal Vol Spurt ใน debug";
  }
  return "แท่งยืนยัน 1H breakout · หรือ Vol แท่งสัญญาณเมื่อไม่มี 1H confirm";
}

export type SnowballStats1hVolEvalSnapshot = {
  volRatio: number;
  volRank: number;
  volRankLookback: number;
};

/** บันทึก Vol×SMA / Vol rank จาก 1H confirm eval (รวมแจ้ง Master 4h ที่มี breakout1hEval) */
export function snowballStatsConfirmVolFieldsFrom1hEval(
  ev: SnowballStats1hVolEvalSnapshot | null | undefined,
): Pick<SnowballStatsRow, "confirmVolVsSma" | "confirmVolRank" | "confirmVolRankLb"> | Record<string, never> {
  if (!ev) return {};
  return {
    confirmVolVsSma: Number.isFinite(ev.volRatio) ? ev.volRatio : null,
    confirmVolRank: Number.isFinite(ev.volRank) ? ev.volRank : null,
    confirmVolRankLb: ev.volRankLookback,
  };
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

/** Market cap USD — รูปแบบเดียวกับ Vol 24h ($ prefix) */
export function snowballStatsMarketCapUsdLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
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

/**
 * เวลาปิด anchor สำหรับ horizon 4h/12h/24h/48h
 * - 15m/1h: ปิดแท่งสัญญาณ
 * - 4h two-bar: ปิดแท่ง confirm (แท่งที่สอง) = signal open + 8h — ตรง entry/เวลาแจ้ง
 */
export function snowballStatsAnchorCloseSec(
  row: Pick<SnowballStatsRow, "signalBarOpenSec" | "signalBarTf">,
): number {
  const dur = snowballStatsSignalBarDurationSec(row.signalBarTf ?? "15m");
  if (row.signalBarTf === "4h") {
    return row.signalBarOpenSec + 2 * dur;
  }
  return row.signalBarOpenSec + dur;
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
