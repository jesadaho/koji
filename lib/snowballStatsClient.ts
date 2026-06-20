/** Client-safe Snowball stats types + Grade label (no Node.js / Redis). */

import {
  snowballGradeChecklistMark,
  snowballStatsConfirmGateStepsAllPass,
  snowballStatsConfirmOk,
  snowballStatsGradeChecklist,
  snowballStatsGradeChecklistFooter,
  snowballStatsLegacyBreakout1hConfirmFailIgnored,
} from "@/lib/snowballGradeChecklist";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";
import { statsFmtPctCell } from "@/lib/statsCsv";
import { formatFunding } from "@/src/marketsFormat";
import {
  classifySnowballTrendGrade,
  snowballIsTrendGradeF,
  snowballTrendGradeShortLabel,
  snowballTrendGradeToDisplay,
  normalizeSnowballQualityTier,
  legacySnowballQualityTierToDisplay,
  isLegacySnowballQualityTier,
  isSnowballTrendGrade,
  type ClassifySnowballTrendGradeInput,
  type SnowballTrendGrade,
  type SnowballTrendGradeDisplay,
} from "@/src/snowballTrendGrade";
import {
  classifySnowballGradeWithFallback,
  displayGradeToBaseTier,
  snowballTrendGradeDisplayLabelBase,
  snowballTrendGradeDisplayWithDangerous,
} from "@/src/snowballCompositeGrade";
import {
  snowballLongStructureTierShortLabel,
  type SnowballLongStructureTier,
} from "@/src/snowballLongBreakoutGrade";
import type { MarketSentimentLabel, MarketSentimentSnapshot } from "@/lib/marketSentiment";
import type { StrategyProfitByPlanMap } from "@/lib/statsStrategyProfitClient";
import type { StatsTpSlExitReason } from "@/lib/tpSlStrategySimulate";
import {
  STATS_VOL_VS_SMA_FILTER_OPTIONS,
  statsRowMatchesVolVsSmaFilter,
  statsVolVsSmaFilterLabel,
  type StatsVolVsSmaFilter,
} from "@/lib/statsVolVsSmaFilter";

export type { SnowballLongStructureTier };

export type SnowballStatsOutcome = "pending" | "win_trend" | "loss" | "flat";

export type SnowballStatsQualityTier = SnowballTrendGrade;

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
  /** Stage 1 — Swing HH200 (โครงสร้างใหญ่) ผ่านหรือไม่ ตอนแจ้ง */
  swing200Ok?: boolean | null;
  /** Snapshot market sentiment (Market Pulse) ณ เวลาแจ้ง */
  marketSentiment?: MarketSentimentSnapshot | null;
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
  /** อันดับความยาวแท่งใน lookback (1 = ยาวสุด) */
  rangeRankInLookback?: number | null;
  /** จำนวนแท่งในรอบ Len rank */
  lenLookbackBars?: number | null;
  /** Len percentile 0–100 (100 = ยาวสุดในรอบ) */
  lenPercentilePct?: number | null;
  barRangePctPrev?: number | null;
  barRangePctSignal?: number | null;
  barRangePct2Sum?: number | null;
  btcPsar4hTrend?: "up" | "down" | null;
  btcPsar4hClose?: number | null;
  btcPsar1hTrend?: "up" | "down" | null;
  btcPsar1hClose?: number | null;
  quoteVol24hUsdt?: number | null;
  /** version 1 = ดึงต่อ symbol (Binance quoteVolume · fallback MEXC amount24) */
  quoteVol24hV?: number;
  /** Market cap USD (CoinGecko) ณ เวลาแจ้ง */
  marketCapUsd?: number | null;
  /** Funding rate MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม) */
  fundingRate?: number | null;
  /** Wilder ATR(14) บน 1d ÷ close × 100 */
  atrPct14d?: number | null;
  /** EMA(12) 1h — slope % ย้อนหลัง 7 วัน (168 แท่ง) */
  ema1hSlopePct7d?: number | null;
  /** EMA(12) 4h — slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  ema4hSlopePct7d?: number | null;
  /** EMA(12) 1d — slope % ย้อนหลัง 7 แท่ง */
  ema1dSlopePct7d?: number | null;
  /** BTC — EMA(12) 4h slope % ย้อนหลัง 7 วัน */
  btcEma4hSlopePct7d?: number | null;
  /** BTC — EMA(12) 1d slope % ย้อนหลัง 7 แท่ง */
  btcEma1dSlopePct7d?: number | null;
  /** (close − EMA20) / EMA20 × 100 บน 1h ของคู่สัญญาณ */
  priceVsEma20_1hPct?: number | null;
  /** BTC — (close − EMA20) / EMA20 × 100 บน 4h */
  btcPriceVsEma20_4hPct?: number | null;
  /** 1 = price vs EMA20 dist คำนวณ ณ alertedAtMs */
  ema20DistV?: number;
  /** PSAR 4h ของคู่ — ทิศ SAR */
  psar4hTrend?: "up" | "down" | null;
  /** PSAR 4h — (close − SAR) / close × 100 */
  psar4hDistPct?: number | null;
  /** 1 = PSAR คำนวณ ณ alertedAtMs */
  psar4hV?: number;
  /** 2 = BTC EMA คำนวณ ณ alertedAtMs */
  btcEmaSlopesV?: number;
  /** 1 = symbol EMA4h/1d คำนวณ ณ alertedAtMs · 2 = รวม EMA1h */
  symbolEmaSlopesV?: number;
  /** 1 = trend grade (S/A/B/C/F) recompute จาก snapshot ในแถว */
  trendGradeV?: number;
  volumeCascadeYn?: "Y" | "N" | null;
  /** จำนวนครั้งที่ vol 1H ไม่ยกฐานใน lookback Vol — Stage 3 */
  volumeDropCount?: number | null;
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
  /** Swing low 1H — จุดเริ่มรอบปั๊ม (open time sec) */
  swingLowOpenSec?: number | null;
  /** Swing low 1H — ราคา Low */
  swingLowPrice?: number | null;
  /** ชั่วโมงจาก Swing Low ถึง anchor close */
  ageOfTrendHours?: number | null;
  /** ((entry − swingLow) / swingLow) × 100 */
  trendGainPct?: number | null;
  swingLowSource?: import("@/lib/pumpCycleSwingLow").PumpCycleSwingLowSource | null;
  /** 1 = pump-cycle swing low คำนวณแล้ว */
  pumpCycleSwingLowV?: number;
  greenDaysBeforeSignal?: number | null;
  /** เขียวตามวันปฏิทิน BKK (เพื่อให้ตรงกับกราฟผู้ใช้) */
  greenDaysBeforeSignalBkk?: number | null;
  svpHoleYn: "Y" | "N";
  /** Stage 1 ceiling จาก Base-Offset matrix (A / B / C) — 4h เท่านั้น */
  structureCeiling?: "A" | "B" | "C" | null;
  /** จำนวนข้อ Stage 3 ที่พลาด (0–3) — 4h เท่านั้น */
  momentumFailCount?: 0 | 1 | 2 | 3 | null;
  /** notch จาก ceiling (+1 / 0 / -1 / -2) — 4h เท่านั้น */
  gradeNotch?: 1 | 0 | -1 | -2 | null;
  /** Display grade (S+ / S / A+ / A / B+ / B / C / F) */
  displayGrade?: SnowballTrendGradeDisplay | null;
  /** Max DD > 7% → suffix ⚠️ บนป้ายเกรด */
  gradeDangerous?: boolean;
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
  /** Max adverse จาก entry ตลอดช่วง follow-up 48h (ไม่ตัดที่ MFE) */
  followUpMaxAdversePct: number | null;
  /** กำไร % ตามกลยุทธ์ TP1/TP2 (จำลองบน 15m) — 48h ใน strategyProfitPct · 24h ใน strategyProfitPct24h */
  strategyProfitPct?: number | null;
  strategyExitReason?: StatsTpSlExitReason | null;
  strategyProfitPct24h?: number | null;
  strategyExitReason24h?: StatsTpSlExitReason | null;
  strategyProfitByPlan?: StrategyProfitByPlanMap | null;
  resultRr: string | null;
  outcome: SnowballStatsOutcome;
  /** migration: รีเซ็ต horizon หลังแก้ anchor 4h two-bar (ปิดแท่ง confirm) */
  horizonAnchorV2?: boolean;
  /** ฝั่งตรงข้ามที่เคย conflict (บันทึกตอนแจ้ง) — แสดง badge ถาวร */
  conflictWith?: string | null;
  /** แหล่งข้อมูล — live stats store หรือ backtest simulation */
  source?: "live" | "backtest";
};

export type SnowballStatsApiPayload = {
  rows: SnowballStatsRow[];
  /** ลบแถว / ล้างสถิติทั้งหมด — เฉพาะ KOJI_ADMIN_IDS */
  isAdmin?: boolean;
  viewerTpSlPlanSummary?: string;
  viewerTpSlPlan?: import("@/lib/tpSlStrategySimulate").StatsTpSlPlan;
  viewerStrategyMarginUsdt?: number | null;
  viewerStrategyLeverage?: number | null;
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
  const raw = (row.qualityTier ?? row.alertQualityTier) as string | undefined;
  if (raw == null) return undefined;
  if (isSnowballTrendGrade(raw)) return raw;
  if (isLegacySnowballQualityTier(raw)) return normalizeSnowballQualityTier(raw);
  return undefined;
}

/** แถวสถิติเก่า Grade D (Long->Short) — ใช้ปรับเกรด 4h follow-up เท่านั้น */
export function snowballStatsIsLongConfirmFailRow(
  row: Pick<SnowballStatsRow, "breakout1hConfirmFail">,
): boolean {
  return row.breakout1hConfirmFail === true;
}

/** @deprecated ใช้ qualityTier === f */
export function snowballStatsIsGradeFMomentumFailRow(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "momentumFailGradeF">,
): boolean {
  if (row.momentumFailGradeF === true) return true;
  if (row.momentumFailGradeF === false) return false;
  return snowballIsTrendGradeF(effectiveQualityTier(row));
}

/** @deprecated — ไม่มี D+ ใน trend grade */
export function snowballStatsIsGradeBMomentumDowngradeRow(
  _row: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade" | "momentumFailGradeF"
  >,
): boolean {
  return false;
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

type SnowballStatsGradeDerivationFields = Partial<
  Pick<
    SnowballStatsRow,
    | "ema1hSlopePct7d"
    | "ema4hSlopePct7d"
    | "ema1dSlopePct7d"
    | "btcEma4hSlopePct7d"
    | "btcEma1dSlopePct7d"
    | "greenDaysBeforeSignal"
    | "fundingRate"
    | "barRangePctPrev"
    | "barRangePctSignal"
    | "alertSide"
    | "triggerKind"
    | "structureTier"
    | "signalBarTf"
    | "swing200Ok"
    | "signalMaxDdPct"
    | "signalVolVsSma"
    | "psar4hTrend"
    | "trendGainPct"
    | "ageOfTrendHours"
    | "alertedAtMs"
    | "alertedAtIso"
  >
>;

type SnowballStatsGradeDisplayRow = Pick<
  SnowballStatsRow,
  | "displayGrade"
  | "gradeDangerous"
  | "qualityTier"
  | "alertQualityTier"
  | "qualityTier4hAdjusted"
  | "momentumDowngrade"
  | "momentumFailGradeF"
> &
  SnowballStatsGradeDerivationFields;

function snowballStatsFormatDisplayGrade(
  display: SnowballTrendGradeDisplay,
  dangerous?: boolean,
): string {
  return snowballTrendGradeDisplayWithDangerous(display, dangerous);
}

function snowballStatsTrendGradeInputFromRow(
  row: SnowballStatsGradeDerivationFields,
): ClassifySnowballTrendGradeInput | null {
  const side = row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
  const ema4h = row.ema4hSlopePct7d;
  if (ema4h == null || !Number.isFinite(ema4h)) return null;
  return {
    alertSide: side,
    ema1hSlopePct7d: row.ema1hSlopePct7d,
    ema4hSlopePct7d: ema4h,
    ema1dSlopePct7d: row.ema1dSlopePct7d,
    btcEma4hSlopePct7d: row.btcEma4hSlopePct7d,
    btcEma1dSlopePct7d: row.btcEma1dSlopePct7d,
    greenDaysBeforeSignal: row.greenDaysBeforeSignal,
    fundingRate: row.fundingRate,
    barRangePctPrev: row.barRangePctPrev,
    barRangePctSignal: row.barRangePctSignal,
    signalVolVsSma: row.signalVolVsSma,
    psar4hTrend: row.psar4hTrend ?? null,
    signalBarTf: row.signalBarTf ?? null,
    trendGainPct: row.trendGainPct,
    ageOfTrendHours: row.ageOfTrendHours,
    alertedAtMs:
      row.alertedAtMs != null && Number.isFinite(row.alertedAtMs)
        ? row.alertedAtMs
        : row.alertedAtIso && Number.isFinite(Date.parse(row.alertedAtIso))
          ? Date.parse(row.alertedAtIso)
          : null,
  };
}

/** เทียบ qualityTier เก่ากับ schema ใหม่ — คำนวณสดจาก EMA+เขียวเมื่อมี snapshot */
export function snowballStatsDerivedDisplayGrade(
  row: Pick<SnowballStatsRow, "displayGrade" | "qualityTier" | "alertQualityTier" | "gradeDangerous"> &
    SnowballStatsGradeDerivationFields,
): string | null {
  const liveInput = snowballStatsTrendGradeInputFromRow(row);
  if (liveInput) {
    const composite = classifySnowballGradeWithFallback({
      ...liveInput,
      signalBarTf: row.signalBarTf,
      swing200Ok: row.swing200Ok,
      structureTier: row.structureTier,
      signalMaxDdPct: row.signalMaxDdPct,
      signalVolVsSma: row.signalVolVsSma,
    });
    return snowballStatsFormatDisplayGrade(composite.display, composite.dangerous);
  }
  if (row.displayGrade) {
    return snowballStatsFormatDisplayGrade(row.displayGrade, row.gradeDangerous);
  }
  const tier = effectiveQualityTier(row);
  if (tier) return snowballTrendGradeToDisplay(tier);
  const raw = (row.qualityTier ?? row.alertQualityTier) as string | undefined;
  if (raw && isLegacySnowballQualityTier(raw)) return legacySnowballQualityTierToDisplay(raw);
  return null;
}

function snowballStatsGradeLetter(tier: SnowballStatsQualityTier | undefined): string {
  if (!tier) return "—";
  return snowballTrendGradeShortLabel(tier);
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
  return snowballLongStructureTierShortLabel(tier);
}

/** ป้ายเกรดตอนแจ้ง — ใช้ displayGrade (S/A/B/C/F) ถ้ามี */
export function snowballStatsGradeAtAlertLabel(row: SnowballStatsGradeDisplayRow): string {
  return snowballStatsDerivedDisplayGrade(row) ?? snowballStatsGradeLetter(effectiveQualityTier(row));
}

/**
 * ป้ายคอลัมน์ Grade — เกรดสุทธิชั้นเดียว (โครงสร้างดูใน popup)
 * แถว 4h ที่ follow-up ปรับ qualityTier แล้ว → "B- → C"
 */
export function snowballStatsGradeDisplayLabel(row: SnowballStatsGradeDisplayRow): string {
  const atAlert = snowballStatsGradeAtAlertLabel(row);
  if (row.qualityTier4hAdjusted && row.qualityTier) {
    const after4h = snowballStatsGradeLetter(row.qualityTier);
    if (after4h !== "—" && after4h !== atAlert) {
      return `${atAlert} → ${after4h}`;
    }
  }
  return atAlert;
}

function snowballStatsGradeLabelMatchesBaseTier(label: string, grade: string): boolean {
  const normalized = snowballTrendGradeDisplayLabelBase(label);
  const parts = normalized.split(" → ").map((s) => snowballTrendGradeDisplayLabelBase(s));
  return parts.some((p) => p === grade || p === `${grade}+`);
}

function snowballStatsGradeLabelMatchesPlusTier(label: string, grade: string): boolean {
  const normalized = snowballTrendGradeDisplayLabelBase(label);
  const parts = normalized.split(" → ").map((s) => snowballTrendGradeDisplayLabelBase(s));
  return parts.some((p) => p === grade);
}

/** กรอง dropdown Grade — S/A/B/C/F · SAB = S or A or B (รวม +) */
export function snowballStatsGradeMatchesFilter(
  row: SnowballStatsGradeDisplayRow,
  filter: string,
): boolean {
  if (filter === "all") return true;
  const label = snowballStatsGradeDisplayLabel(row);
  if (filter === "SAB") {
    return ["S", "A", "B"].some((g) => snowballStatsGradeLabelMatchesBaseTier(label, g));
  }
  if (filter === "SABplus") {
    return ["S+", "A+", "B+", "C+"].some((g) => snowballStatsGradeLabelMatchesPlusTier(label, g));
  }
  if (filter === "S+" || filter === "A+" || filter === "B+" || filter === "C+") {
    return snowballStatsGradeLabelMatchesPlusTier(label, filter);
  }
  if (filter === "S" || filter === "A" || filter === "B" || filter === "C" || filter === "D" || filter === "F") {
    return snowballStatsGradeLabelMatchesBaseTier(label, filter);
  }
  return snowballStatsGradeLabelMatchesBaseTier(label, filter);
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
    if (grade) bear.push(`เกรดสุทธิ: ${snowballTrendGradeShortLabel(grade)}`);
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
  _row?: SnowballStatsGradeDisplayRow,
): string {
  if (_row) return snowballStatsGradeDisplayLabel(_row);
  return snowballStatsGradeLetter(tier);
}

/** base tier สำหรับสีคอลัมน์ — ให้ตรงกับ snowballStatsDerivedDisplayGrade */
function snowballStatsDerivedBaseTier(
  row: Pick<SnowballStatsRow, "displayGrade" | "qualityTier" | "alertQualityTier"> &
    SnowballStatsGradeDerivationFields,
): SnowballStatsQualityTier | undefined {
  const liveInput = snowballStatsTrendGradeInputFromRow(row);
  if (liveInput) {
    return classifySnowballGradeWithFallback({
      ...liveInput,
      signalBarTf: row.signalBarTf,
      swing200Ok: row.swing200Ok,
      structureTier: row.structureTier,
      signalMaxDdPct: row.signalMaxDdPct,
      signalVolVsSma: row.signalVolVsSma,
    }).baseTier;
  }
  if (row.displayGrade) return displayGradeToBaseTier(row.displayGrade);
  return effectiveQualityTier(row);
}

function snowballStatsGradeTierForStyle(
  row: Pick<SnowballStatsRow, "displayGrade" | "qualityTier" | "alertQualityTier" | "qualityTier4hAdjusted"> &
    SnowballStatsGradeDerivationFields,
): SnowballStatsQualityTier | undefined {
  if (row.qualityTier4hAdjusted && row.qualityTier) {
    return effectiveQualityTier({ qualityTier: row.qualityTier, alertQualityTier: row.qualityTier });
  }
  return snowballStatsDerivedBaseTier(row);
}

export function snowballStatsGradeCellClass(
  row: Pick<
    SnowballStatsRow,
    | "displayGrade"
    | "qualityTier"
    | "alertQualityTier"
    | "qualityTier4hAdjusted"
    | "breakout1hConfirmFail"
    | "ema1hSlopePct7d"
    | "ema4hSlopePct7d"
    | "ema1dSlopePct7d"
    | "btcEma4hSlopePct7d"
    | "btcEma1dSlopePct7d"
    | "greenDaysBeforeSignal"
    | "alertSide"
    | "triggerKind"
    | "structureTier"
    | "signalBarTf"
    | "swing200Ok"
    | "signalMaxDdPct"
    | "signalVolVsSma"
    | "psar4hTrend"
  >,
): string {
  const tier = snowballStatsGradeTierForStyle(row);
  if (tier === "f") return "snowGradeCell snowGradeCell--f";
  if (tier === "s") return "snowGradeCell snowGradeCell--s";
  if (tier === "a") return "snowGradeCell snowGradeCell--a";
  if (tier === "b") return "snowGradeCell snowGradeCell--b";
  if (tier === "d") return "snowGradeCell snowGradeCell--d";
  if (tier === "c") return "snowGradeCell snowGradeCell--c";
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

/** Efficiency Score = R% 2แท่ง ÷ Vol×SMA (ตัวหารเป็นอัตราส่วน vol/SMA เช่น 2.5× → 2.5) */
export function snowballStatsEfficiencyScore(
  row: Pick<SnowballStatsRow, "barRangePct2Sum" | "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf">,
): number | null {
  const r2 = row.barRangePct2Sum;
  const vol = snowballStatsVolVsSmaDisplay(row);
  if (r2 == null || !Number.isFinite(r2) || vol == null || !Number.isFinite(vol) || vol <= 0) {
    return null;
  }
  return r2 / vol;
}

export function snowballStatsEfficiencyScoreLabel(
  row: Pick<SnowballStatsRow, "barRangePct2Sum" | "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf">,
): string {
  const v = snowballStatsEfficiencyScore(row);
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
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

export type SnowballVolVsSmaFilter = StatsVolVsSmaFilter;
export const SNOWBALL_VOL_VS_SMA_FILTER_OPTIONS = STATS_VOL_VS_SMA_FILTER_OPTIONS;
export const snowballStatsVolVsSmaFilterLabel = statsVolVsSmaFilterLabel;

export function snowballStatsRowMatchesVolVsSmaFilter(
  row: Pick<SnowballStatsRow, "confirmVolVsSma" | "signalVolVsSma" | "signalBarTf">,
  filter: SnowballVolVsSmaFilter,
): boolean {
  return statsRowMatchesVolVsSmaFilter(snowballStatsVolVsSmaDisplay(row), filter);
}

/** ตัวกรองอันดับ vol 1H confirm (confirmVolRank) — 1 = สูงสุดในรอบ lookback */
export type SnowballVolRankFilter = "all" | "rank1" | "le2" | "le3" | "le5" | "le8" | "has" | "none";

export const SNOWBALL_VOL_RANK_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballVolRankFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "rank1", label: "#1" },
  { value: "le2", label: "≤ 2" },
  { value: "le3", label: "≤ 3" },
  { value: "le5", label: "≤ 5" },
  { value: "le8", label: "≤ 8" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballStatsVolRankFilterLabel(filter: SnowballVolRankFilter): string {
  return SNOWBALL_VOL_RANK_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

/** Funding rate ทศนิยม (×100 = %) — −0.001 = −0.10% */
export const SNOWBALL_FUNDING_LT_NEG_010_DECIMAL = -0.001;

/** Funding > −0.10% (ไม่รวมเท่ากับ −0.10%) */
export function snowballFundingRateGtNeg010Pct(fundingRate: number | null | undefined): boolean {
  const fr = fundingRate;
  if (fr == null || !Number.isFinite(fr)) return false;
  return fr > SNOWBALL_FUNDING_LT_NEG_010_DECIMAL;
}

export type SnowballFundingFilter = "all" | "ltNeg010";

export const SNOWBALL_FUNDING_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballFundingFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "ltNeg010", label: "< −0.10%" },
];

export function snowballStatsFundingFilterLabel(filter: SnowballFundingFilter): string {
  return SNOWBALL_FUNDING_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballStatsRowMatchesFundingFilter(
  row: Pick<SnowballStatsRow, "fundingRate">,
  filter: SnowballFundingFilter,
): boolean {
  if (filter === "all") return true;
  const fr = row.fundingRate;
  if (fr == null || !Number.isFinite(fr)) return false;
  return fr < SNOWBALL_FUNDING_LT_NEG_010_DECIMAL;
}

/** แท่ง Day1 เขียวติดกันก่อนแท่งสัญญาณ (ไม่นับแท่งสัญญาณ) */
export type SnowballGreenDaysFilter =
  | "all"
  | "d0"
  | "d1"
  | "d2"
  | "d3"
  | "le3"
  | "gt3"
  | "ge2"
  | "has"
  | "none";

export const SNOWBALL_GREEN_DAYS_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballGreenDaysFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "d0", label: "0 วัน" },
  { value: "d1", label: "1 วัน" },
  { value: "d2", label: "2 วัน" },
  { value: "d3", label: "3 วัน" },
  { value: "le3", label: "≤ 3 วัน" },
  { value: "gt3", label: "> 3 วัน" },
  { value: "ge2", label: "≥ 2 วัน" },
  { value: "has", label: "มีข้อมูล" },
  { value: "none", label: "ไม่มีข้อมูล" },
];

export function snowballStatsGreenDaysFilterLabel(filter: SnowballGreenDaysFilter): string {
  return SNOWBALL_GREEN_DAYS_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballStatsRowMatchesGreenDaysFilter(
  row: Pick<SnowballStatsRow, "greenDaysBeforeSignal">,
  filter: SnowballGreenDaysFilter,
): boolean {
  if (filter === "all") return true;
  const raw = row.greenDaysBeforeSignal;
  const has = raw != null && Number.isFinite(raw) && raw >= 0;
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  const n = Math.floor(raw);
  if (filter === "d0") return n === 0;
  if (filter === "d1") return n === 1;
  if (filter === "d2") return n === 2;
  if (filter === "d3") return n === 3;
  if (filter === "le3") return n <= 3;
  if (filter === "gt3") return n > 3;
  return n >= 2;
}

export type SnowballSideFilter = "all" | "long" | "bear";

export const SNOWBALL_SIDE_FILTER_OPTIONS: ReadonlyArray<{ value: SnowballSideFilter; label: string }> = [
  { value: "all", label: "ทุกทิศ" },
  { value: "long", label: "Long" },
  { value: "bear", label: "Bear" },
];

export function snowballSideFilterLabel(filter: SnowballSideFilter): string {
  return SNOWBALL_SIDE_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

function snowballRowAlertSide(
  row: Pick<SnowballStatsRow, "alertSide" | "triggerKind">,
): SnowballStatsAlertSide {
  return row.alertSide ?? (row.triggerKind === "swing_ll" ? "bear" : "long");
}

export function snowballStatsRowMatchesSideFilter(
  row: Pick<SnowballStatsRow, "alertSide" | "triggerKind">,
  filter: SnowballSideFilter,
): boolean {
  if (filter === "all") return true;
  return snowballRowAlertSide(row) === filter;
}

export function snowballStatsRowMatchesVolRankFilter(
  row: Pick<SnowballStatsRow, "confirmVolRank">,
  filter: SnowballVolRankFilter,
): boolean {
  if (filter === "all") return true;
  const rank = row.confirmVolRank;
  const has =
    rank != null && Number.isFinite(rank) && rank >= 1;
  if (filter === "none") return !has;
  if (filter === "has") return has;
  if (!has) return false;
  const r = Math.round(rank);
  if (filter === "rank1") return r === 1;
  if (filter === "le2") return r <= 2;
  if (filter === "le3") return r <= 3;
  if (filter === "le5") return r <= 5;
  return r <= 8;
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
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
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

/**
 * เกณฑ์ default สำหรับ horizon winrate (ใช้ใน UI สรุป — ต้องตรงกับ server-side outcome rule)
 * Win  = pct >= +3% · Loss = pct <= -3% · ที่เหลือเป็น flat
 */
export const SNOWBALL_STATS_WIN_MIN_PCT_DEFAULT = 3;
export const SNOWBALL_STATS_LOSS_MAX_PCT_DEFAULT = -3;

export type SnowballHorizonWinrate = {
  /** จำนวนแถวที่ pct มีค่า (ครบ horizon นั้น) — wins + losses + flats */
  done: number;
  /** จำนวนแถวที่ pct >= WIN_MIN_PCT_DEFAULT */
  wins: number;
  /** จำนวนแถวที่ pct <= LOSS_MAX_PCT_DEFAULT */
  losses: number;
  /** done - wins - losses */
  flats: number;
  /** wins + losses — decisive trades (ไม่นับ flat band ±3%) */
  decisive: number;
  /** wins / decisive × 100 — null ถ้า decisive = 0 (ไม่นับ flat) */
  winratePct: number | null;
};

type SnowballHorizonPctKey =
  | "pct4h"
  | "pct12h"
  | "pct24h"
  | "pct48h";

function snowballPctToHorizonOutcome(
  pct: number | null | undefined,
): "win" | "loss" | "flat" | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= SNOWBALL_STATS_WIN_MIN_PCT_DEFAULT) return "win";
  if (pct <= SNOWBALL_STATS_LOSS_MAX_PCT_DEFAULT) return "loss";
  return "flat";
}

/** Winrate ราย horizon — นับเฉพาะแถวที่ pct horizon นั้นมีค่า (ครบเวลา) */
export function snowballHorizonWinrate(
  rows: SnowballStatsRow[],
  pctKey: SnowballHorizonPctKey,
): SnowballHorizonWinrate {
  let wins = 0;
  let losses = 0;
  let done = 0;
  for (const r of rows) {
    const o = snowballPctToHorizonOutcome(r[pctKey]);
    if (o == null) continue;
    done += 1;
    if (o === "win") wins += 1;
    else if (o === "loss") losses += 1;
  }
  const flats = done - wins - losses;
  const decisive = wins + losses;
  const winratePct = decisive > 0 ? (wins / decisive) * 100 : null;
  return { done, wins, losses, flats, decisive, winratePct };
}

/**
 * สรุป winrate ราย horizon เป็นข้อความสั้น เช่น "12h: 60.0% (3/5) · 24h: … · 48h: …"
 * ตัวเลขในวงเล็บคือ wins/decisive (ไม่นับ flat) — ถ้ามี flat ในรายการนั้นจะต่อท้ายด้วย "+Nf"
 */
export function snowballHorizonWinrateSummary(
  rows: SnowballStatsRow[],
  horizons: ReadonlyArray<{ label: string; pctKey: SnowballHorizonPctKey }>,
): string {
  const parts = horizons.map((h) => {
    const w = snowballHorizonWinrate(rows, h.pctKey);
    if (w.decisive === 0) {
      if (w.flats > 0) return `${h.label}: — (0/0 +${w.flats}f)`;
      return `${h.label}: —`;
    }
    const flatTag = w.flats > 0 ? ` +${w.flats}f` : "";
    return `${h.label}: ${w.winratePct!.toFixed(1)}% (${w.wins}/${w.decisive}${flatTag})`;
  });
  return parts.join(" · ");
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

export type SnowballStatsSortKey =
  | "symbol"
  | "side"
  | "grade"
  | "day"
  | "time"
  | "entry"
  | "swingLowTime"
  | "swingLowPrice"
  | "ageOfTrend"
  | "trendGain"
  | "trendVelocity"
  | "swingLowSource"
  | "range"
  | "wick"
  | "lenRank"
  | "lenPct"
  | "barRangePrev"
  | "barRangeSignal"
  | "barRange2Sum"
  | "btcPsar"
  | "vol24"
  | "mcap"
  | "atr14d"
  | "ema1h"
  | "ema4h"
  | "ema1d"
  | "btcEma4h"
  | "btcEma1d"
  | "psar4h"
  | "psar4hDist"
  | "funding"
  | "volCascade"
  | "greenDays"
  | "greenDaysBkk"
  | "volVsSma"
  | "efficiencyScore"
  | "volRank"
  | "h4"
  | "h12"
  | "h24"
  | "h48"
  | "maxRoi"
  | "durationMfe"
  | "signalMaxDd"
  | "maxDrawdown"
  | "followUpAdverse"
  | "svpHole"
  | "resultRr"
  | "fng"
  | "sentiment"
  | "btcDom"
  | "volChange24h"
  | "strategyProfit24h"
  | "strategyProfit48h"
  | "outcome";

export type SnowballStatsSortDir = "asc" | "desc";

export type SnowballStatsSort = {
  key: SnowballStatsSortKey;
  dir: SnowballStatsSortDir;
};

export const SNOWBALL_STATS_DEFAULT_SORT: SnowballStatsSort = {
  key: "time",
  dir: "desc",
};

const QUALITY_TIER_SORT_ORDER: Record<SnowballStatsQualityTier, number> = {
  s: 0,
  a: 1,
  b: 2,
  d: 3,
  c: 4,
  f: 5,
};

const OUTCOME_SORT_ORDER: Record<SnowballStatsOutcome, number> = {
  win_trend: 0,
  flat: 1,
  loss: 2,
  pending: 3,
};

const SENTIMENT_SORT_ORDER: Record<MarketSentimentLabel, number> = {
  Bullish: 0,
  Neutral: 1,
  Bearish: 2,
};

function statsCmpStr(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function statsCmpNumNullLast(a: number | null | undefined, b: number | null | undefined): number {
  const fa = a != null && Number.isFinite(a);
  const fb = b != null && Number.isFinite(b);
  if (!fa && !fb) return 0;
  if (!fa) return 1;
  if (!fb) return -1;
  return a! - b!;
}

function statsCmpYnNullLast(a: "Y" | "N" | null | undefined, b: "Y" | "N" | null | undefined): number {
  const oa = a === "Y" ? 0 : a === "N" ? 1 : 2;
  const ob = b === "Y" ? 0 : b === "N" ? 1 : 2;
  return oa - ob;
}

const DISPLAY_GRADE_SORT_ORDER: Record<string, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  F: 4,
};

function snowballStatsGradeSortOrder(row: SnowballStatsRow): number {
  const tier = effectiveQualityTier(row);
  if (tier) return QUALITY_TIER_SORT_ORDER[tier] ?? 50;
  const dg = row.displayGrade;
  if (dg && dg in DISPLAY_GRADE_SORT_ORDER) return DISPLAY_GRADE_SORT_ORDER[dg]!;
  return 50;
}

function compareSnowballStatsRows(
  a: SnowballStatsRow,
  b: SnowballStatsRow,
  key: SnowballStatsSortKey,
): number {
  switch (key) {
    case "symbol":
      return statsCmpStr(a.symbol, b.symbol);
    case "side":
      return statsCmpStr(a.side, b.side);
    case "grade":
      return snowballStatsGradeSortOrder(a) - snowballStatsGradeSortOrder(b);
    case "day":
      return (
        statsCmpStr(snowballStatsDayOfWeekBkk(a.alertedAtIso, a.alertedAtMs), snowballStatsDayOfWeekBkk(b.alertedAtIso, b.alertedAtMs)) ||
        statsCmpNumNullLast(a.alertedAtMs, b.alertedAtMs)
      );
    case "time":
      return statsCmpNumNullLast(a.alertedAtMs, b.alertedAtMs);
    case "entry":
      return statsCmpNumNullLast(a.entryPrice, b.entryPrice);
    case "swingLowTime":
      return statsCmpNumNullLast(a.swingLowOpenSec, b.swingLowOpenSec);
    case "swingLowPrice":
      return statsCmpNumNullLast(a.swingLowPrice, b.swingLowPrice);
    case "ageOfTrend":
      return statsCmpNumNullLast(a.ageOfTrendHours, b.ageOfTrendHours);
    case "trendGain":
      return statsCmpNumNullLast(a.trendGainPct, b.trendGainPct);
    case "trendVelocity":
      return statsCmpNumNullLast(
        computePumpCycleTrendVelocity(a.trendGainPct, a.ageOfTrendHours),
        computePumpCycleTrendVelocity(b.trendGainPct, b.ageOfTrendHours),
      );
    case "swingLowSource":
      return statsCmpStr(a.swingLowSource ?? "", b.swingLowSource ?? "");
    case "range":
      return statsCmpNumNullLast(a.rangeScore, b.rangeScore);
    case "wick":
      return statsCmpNumNullLast(a.wickScore, b.wickScore);
    case "lenRank":
      return statsCmpNumNullLast(a.rangeRankInLookback, b.rangeRankInLookback);
    case "lenPct":
      return statsCmpNumNullLast(a.lenPercentilePct, b.lenPercentilePct);
    case "barRangePrev":
      return statsCmpNumNullLast(a.barRangePctPrev, b.barRangePctPrev);
    case "barRangeSignal":
      return statsCmpNumNullLast(a.barRangePctSignal, b.barRangePctSignal);
    case "barRange2Sum":
      return statsCmpNumNullLast(a.barRangePct2Sum, b.barRangePct2Sum);
    case "btcPsar":
      return statsCmpStr(
        snowballStatsBtcPsarCombinedLabel(a.btcPsar4hTrend, a.btcPsar1hTrend),
        snowballStatsBtcPsarCombinedLabel(b.btcPsar4hTrend, b.btcPsar1hTrend),
      );
    case "vol24":
      return statsCmpNumNullLast(a.quoteVol24hUsdt, b.quoteVol24hUsdt);
    case "mcap":
      return statsCmpNumNullLast(a.marketCapUsd, b.marketCapUsd);
    case "atr14d":
      return statsCmpNumNullLast(a.atrPct14d, b.atrPct14d);
    case "ema1h":
      return statsCmpNumNullLast(a.priceVsEma20_1hPct, b.priceVsEma20_1hPct);
    case "ema4h":
      return statsCmpNumNullLast(a.ema4hSlopePct7d, b.ema4hSlopePct7d);
    case "ema1d":
      return statsCmpNumNullLast(a.ema1dSlopePct7d, b.ema1dSlopePct7d);
    case "btcEma4h":
      return statsCmpNumNullLast(a.btcPriceVsEma20_4hPct, b.btcPriceVsEma20_4hPct);
    case "btcEma1d":
      return statsCmpNumNullLast(a.btcEma1dSlopePct7d, b.btcEma1dSlopePct7d);
    case "psar4h": {
      const order = (t: SnowballStatsRow["psar4hTrend"]) =>
        t === "up" ? 0 : t === "down" ? 1 : 2;
      return order(a.psar4hTrend) - order(b.psar4hTrend);
    }
    case "psar4hDist":
      return statsCmpNumNullLast(a.psar4hDistPct, b.psar4hDistPct);
    case "funding":
      return statsCmpNumNullLast(a.fundingRate, b.fundingRate);
    case "volCascade":
      return statsCmpYnNullLast(a.volumeCascadeYn, b.volumeCascadeYn);
    case "greenDays":
      return statsCmpNumNullLast(a.greenDaysBeforeSignal, b.greenDaysBeforeSignal);
    case "greenDaysBkk":
      return statsCmpNumNullLast(a.greenDaysBeforeSignalBkk, b.greenDaysBeforeSignalBkk);
    case "volVsSma":
      return statsCmpNumNullLast(snowballStatsVolVsSmaDisplay(a), snowballStatsVolVsSmaDisplay(b));
    case "efficiencyScore":
      return statsCmpNumNullLast(snowballStatsEfficiencyScore(a), snowballStatsEfficiencyScore(b));
    case "volRank":
      return statsCmpNumNullLast(a.confirmVolRank, b.confirmVolRank);
    case "h4":
      return statsCmpNumNullLast(a.pct4h, b.pct4h);
    case "h12":
      return statsCmpNumNullLast(a.pct12h, b.pct12h);
    case "h24":
      return statsCmpNumNullLast(a.pct24h, b.pct24h);
    case "h48":
      return statsCmpNumNullLast(a.pct48h, b.pct48h);
    case "maxRoi":
      return statsCmpNumNullLast(a.maxRoiPct, b.maxRoiPct);
    case "durationMfe":
      return statsCmpNumNullLast(a.durationToMfeHours, b.durationToMfeHours);
    case "signalMaxDd":
      return statsCmpNumNullLast(a.signalMaxDdPct, b.signalMaxDdPct);
    case "maxDrawdown":
      return statsCmpNumNullLast(a.maxDrawdownPct, b.maxDrawdownPct);
    case "followUpAdverse":
      return statsCmpNumNullLast(a.followUpMaxAdversePct, b.followUpMaxAdversePct);
    case "svpHole":
      return statsCmpYnNullLast(a.svpHoleYn, b.svpHoleYn);
    case "resultRr":
      return statsCmpStr(a.resultRr ?? "", b.resultRr ?? "");
    case "fng":
      return statsCmpNumNullLast(a.marketSentiment?.fngValue, b.marketSentiment?.fngValue);
    case "sentiment": {
      const sa = a.marketSentiment?.sentiment;
      const sb = b.marketSentiment?.sentiment;
      const oa = sa ? SENTIMENT_SORT_ORDER[sa] ?? 99 : 99;
      const ob = sb ? SENTIMENT_SORT_ORDER[sb] ?? 99 : 99;
      return oa - ob;
    }
    case "btcDom":
      return statsCmpNumNullLast(a.marketSentiment?.btcDominancePct, b.marketSentiment?.btcDominancePct);
    case "volChange24h":
      return statsCmpNumNullLast(
        a.marketSentiment?.volumeChangePct24hApprox,
        b.marketSentiment?.volumeChangePct24hApprox,
      );
    case "strategyProfit24h":
      return statsCmpNumNullLast(a.strategyProfitPct24h, b.strategyProfitPct24h);
    case "strategyProfit48h":
      return statsCmpNumNullLast(a.strategyProfitPct, b.strategyProfitPct);
    case "outcome":
      return (OUTCOME_SORT_ORDER[a.outcome] ?? 99) - (OUTCOME_SORT_ORDER[b.outcome] ?? 99);
    default:
      return 0;
  }
}

export function sortSnowballStatsRows(
  rows: SnowballStatsRow[],
  sort: SnowballStatsSort,
): SnowballStatsRow[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const c = compareSnowballStatsRows(a, b, sort.key);
    return c !== 0 ? c * mul : statsCmpNumNullLast(a.alertedAtMs, b.alertedAtMs) * -1;
  });
}

export function snowballStatsSortDefaultDir(key: SnowballStatsSortKey): SnowballStatsSortDir {
  if (
    key === "symbol" ||
    key === "side" ||
    key === "grade" ||
    key === "day" ||
    key === "btcPsar" ||
    key === "svpHole" ||
    key === "volCascade" ||
    key === "resultRr" ||
    key === "sentiment" ||
    key === "swingLowSource" ||
    key === "outcome"
  ) {
    return "asc";
  }
  return "desc";
}
