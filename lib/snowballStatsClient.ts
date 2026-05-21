/** Client-safe Snowball stats types + Grade label (no Node.js / Redis). */

export type SnowballStatsOutcome = "pending" | "win_trend" | "win_quick_tp30" | "loss" | "flat";

export type SnowballStatsQualityTier = "a_plus" | "b_plus" | "c_plus" | "d_plus";

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
  qualityTier?: SnowballStatsQualityTier;
  /** เกรดตอนแจ้ง — ไม่เปลี่ยนเมื่อ follow-up 4h ปรับ qualityTier */
  alertQualityTier?: SnowballStatsQualityTier;
  /** ปรับ qualityTier แล้วหลังครบ 4 ชม. (เช่น confirm fail → C) */
  qualityTier4hAdjusted?: boolean;
  /** Long 1H breakout confirm ไม่ผ่าน — เกรด D · ทิศสัญญาณ Long */
  breakout1hConfirmFail?: boolean;
  /** ส่ง Grade D+ (Long): momentum 1H ไม่ผ่าน + 1H confirm ผ่าน — ไม่ใช่ Grade C fade */
  momentumDowngrade?: boolean;
  /** Wilder ATR(100) ตอนแจ้ง — baseline ความผันผวน */
  atr100?: number | null;
  /** Max upper wick 100 แท่งก่อนสัญญาณ — เพดานไส้บน */
  maxUpperWick100?: number | null;
  /** (H−L) แท่งสัญญาณ / ATR(100) */
  rangeScore?: number | null;
  /** UpperWick แท่งสัญญาณ / MaxWick(100) */
  wickScore?: number | null;
  /** % กว้าง (H−L)/Close แท่งก่อนสัญญาณ */
  barRangePctPrev?: number | null;
  /** % กว้างแท่งสัญญาณ */
  barRangePctSignal?: number | null;
  /** รวม % 2 แท่งล่าสุด */
  barRangePct2Sum?: number | null;
  /** BTC PSAR 4h trend ตอนแจ้ง (Binance BTCUSDT) */
  btcPsar4hTrend?: "up" | "down" | null;
  /** ปิดแท่ง 4h BTC ล่าสุดที่ปิดแล้ว */
  btcPsar4hClose?: number | null;
  /** quoteVolume 24h ของคู่สัญญาณ (USDT, Binance futures) */
  quoteVol24hUsdt?: number | null;
  /** DD 1H% — ไส้บนหรือไส้ล่างใหญ่สุดเทียบช่วงแท่ง (H−L) ใน 8 แท่ง 1H (0–100%) */
  maxDrawback1hPct?: number | null;
  /** Volume cascade ยืดหยุ่น (ยอมสะดุด ≤1 ครั้งใน 5 แท่ง 1H ล่าสุด) */
  volumeCascadeYn?: "Y" | "N" | null;
  /** lookback DD 1H% — แถวเก่าไม่ตรง = รีคำนวณเมื่อ backfill */
  trendMomentumLookback?: number | null;
  /** lookback Vol↗ */
  trendMomentumVolLookback?: number | null;
  /** แท่งยืนยัน (1H breakout / หรือแท่ง 2 ของ pending): volume ÷ SMA ที่เกณฑ์ใช้นั้นจังหวะนั้น (ไม่มีแท่งยืนยัน = null) */
  confirmVolVsSma?: number | null;
  /** อันดับ volume ในรอบ lookback เดียวกับที่ยืนยันใช้ (1 = สูงสุด) */
  confirmVolRank?: number | null;
  /** window ของอันดับ vol (จำนวนแท่ง; เก่ามีแถวว่างฟิลด์พวกนี้) */
  confirmVolRankLb?: number | null;
  /** แท่ง Day1 เขียว (close>open) ติดกันก่อนแท่งสัญญาณ Snowball */
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
  return alert === "long" ? "Long" : "Short";
}

/** ทิศในตาราง = ทิศสัญญาณ (Long / Short สำหรับ bear) — สถิติวัดผล long alert เป็น Long เสมอ */
export function snowballStatsSideLabel(
  row: Pick<SnowballStatsRow, "alertSide" | "triggerKind">,
): string {
  let alert: SnowballStatsAlertSide | null = row.alertSide ?? null;
  if (!alert) {
    alert = row.triggerKind === "swing_ll" ? "bear" : "long";
  }
  return snowballStatsAlertSideLabel(alert);
}

/** momentum ไม่ผ่าน + 1H confirm ผ่าน → ส่ง D+ (Long) */
export function snowballStatsIsGradeBMomentumDowngradeRow(
  row: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade"
  >,
): boolean {
  if (row.momentumDowngrade === true) return true;
  if (row.momentumDowngrade === false) return false;
  const alert = row.alertQualityTier;
  if (alert !== "a_plus" && alert !== "b_plus" && alert !== "c_plus") return false;
  /** qualityTier d_plus + alert โครงสร้าง = D+ (แม้แถวเก่ามี breakout1hConfirmFail ผิดจาก migration) */
  return row.qualityTier === "d_plus";
}

function snowballStatsGradeLetter(
  tier: SnowballStatsQualityTier | undefined,
  row?: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade"
  >,
): string {
  if (!tier) return "—";
  if (tier === "a_plus") return "A+";
  if (tier === "b_plus") return "B";
  if (tier === "c_plus") return "C";
  if (tier === "d_plus") {
    if (row && snowballStatsIsGradeBMomentumDowngradeRow({ ...row, qualityTier: tier })) return "D+";
    return "D";
  }
  return "—";
}

/** แถวสถิติ Grade D จาก 1H confirm fail (ไม่รวม D+ momentum downgrade) */
export function snowballStatsIsLongConfirmFailRow(
  row: Pick<SnowballStatsRow, "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail">,
): boolean {
  if (snowballStatsIsGradeBMomentumDowngradeRow(row)) return false;
  if (row.breakout1hConfirmFail) return true;
  if (row.qualityTier === "d_plus" || row.alertQualityTier === "d_plus") return true;
  return false;
}

function snowballStatsGradeDisplayLetter(
  tier: SnowballStatsQualityTier | undefined,
  row?: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade"
  >,
): string {
  return snowballStatsGradeLetter(tier, row);
}

/** เกรดตอนแจ้ง (สำหรับวงเล็บหลัง follow-up 4h) */
function snowballStatsGradeAtAlertLetter(
  ctx: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade"
  >,
): string {
  if (snowballStatsIsGradeBMomentumDowngradeRow(ctx)) return "D+";
  return snowballStatsGradeDisplayLetter(ctx.alertQualityTier, {
    qualityTier: ctx.alertQualityTier,
    alertQualityTier: ctx.alertQualityTier,
    breakout1hConfirmFail: true,
  });
}

/** A+/B/C/D — วงเล็บเฉพาะหลัง follow-up 4h ปรับ qualityTier แล้ว (เช่น C (D) · C (D+)) */
export function snowballStatsGradeLabel(
  _side: SnowballStatsRow["side"],
  tier: SnowballStatsRow["qualityTier"] | undefined,
  alertTier?: SnowballStatsRow["alertQualityTier"],
  row?: Pick<
    SnowballStatsRow,
    | "qualityTier"
    | "alertQualityTier"
    | "breakout1hConfirmFail"
    | "momentumDowngrade"
    | "qualityTier4hAdjusted"
  >,
): string {
  const ctx: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade"
  > = {
    qualityTier: tier,
    alertQualityTier: alertTier,
    breakout1hConfirmFail: row?.breakout1hConfirmFail ?? false,
    momentumDowngrade: row?.momentumDowngrade,
  };

  if (snowballStatsIsGradeBMomentumDowngradeRow(ctx)) {
    if (!row?.qualityTier4hAdjusted) return "D+";
    const cur = snowballStatsGradeDisplayLetter(tier, ctx);
    if (cur === "D+" || cur === "—") return "D+";
    return `${cur} (D+)`;
  }

  if (!row?.qualityTier4hAdjusted) {
    return snowballStatsGradeDisplayLetter(tier, ctx);
  }

  const cur = snowballStatsGradeDisplayLetter(tier, ctx);
  const atAlert = snowballStatsGradeAtAlertLetter(ctx);
  if (atAlert !== "—" && cur !== "—" && cur !== atAlert) {
    return `${cur} (${atAlert})`;
  }
  return cur;
}

export function snowballStatsGradeCellClass(
  row: Pick<
    SnowballStatsRow,
    "qualityTier" | "alertQualityTier" | "breakout1hConfirmFail" | "momentumDowngrade"
  >,
): string {
  if (snowballStatsIsGradeBMomentumDowngradeRow(row)) {
    return "snowGradeCell snowGradeCell--d";
  }
  const tier = row.qualityTier;
  if (tier === "a_plus") return "snowGradeCell snowGradeCell--a";
  if (tier === "b_plus") return "snowGradeCell snowGradeCell--b";
  if (tier === "c_plus") return "snowGradeCell snowGradeCell--c";
  if (tier === "d_plus") return "snowGradeCell snowGradeCell--d";
  if (snowballStatsIsLongConfirmFailRow(row) && row.alertQualityTier === "d_plus") {
    return "snowGradeCell snowGradeCell--d";
  }
  return "snowGradeCell";
}

/** แสดงค่า ATR / Max Wick ในตาราง (ราคา + % ของ entry ถ้ามี) */
export function snowballStatsVolMetricLabel(
  value: number | null | undefined,
  entryPrice: number | null | undefined
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

/** แสดง Range / Wick score (อัตราส่วนไม่มีหน่วย) */
export function snowballStatsVolScoreLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

/** แสดง % ความกว้างแท่ง (H−L)/Close */
export function snowballStatsBarRangePctLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

/** วันในสัปดาห์ (ปฏิทินไทย / Asia/Bangkok) จากเวลาแจ้งสัญญาณ */
export function snowballStatsBtcPsar4hLabel(trend: SnowballStatsRow["btcPsar4hTrend"]): string {
  if (trend === "up") return "BTC↑";
  if (trend === "down") return "BTC↓";
  return "—";
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

/** อัตรา vol แท่งยืนยัน ÷ SMA (เช่น 1.85×) */
export function snowballStatsConfirmVolVsSmaLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  return `${v.toFixed(2)}×`;
}

/** อันดับ vol ในรอบ N แท่ง เช่น #3/48 */
export function snowballStatsConfirmVolRankLabel(
  rank: number | null | undefined,
  lb: number | null | undefined,
): string {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return "—";
  const r = Math.round(rank);
  if (lb != null && Number.isFinite(lb) && lb >= 1) return `#${r}/${Math.round(lb)}`;
  return `#${r}`;
}

/** แสดง quote vol 24h (USDT) แบบย่อ */
export function snowballStatsQuoteVol24hLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

export function snowballStatsDayOfWeekBkk(
  alertedAtIso: string,
  alertedAtMs?: number | null
): string {
  const ms =
    alertedAtMs != null && Number.isFinite(alertedAtMs) ? alertedAtMs : Date.parse(alertedAtIso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
  });
}
