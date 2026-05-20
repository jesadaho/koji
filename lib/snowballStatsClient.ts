/** Client-safe Snowball stats types + Grade label (no Node.js / Redis). */

export type SnowballStatsOutcome = "pending" | "win_trend" | "win_quick_tp30" | "loss" | "flat";

export type SnowballStatsQualityTier = "a_plus" | "b_plus" | "c_plus" | "d_plus";

/** ทิศสัญญาณ Snowball ตอนแจ้ง (long / bear) */
export type SnowballStatsAlertSide = "long" | "bear";

export type SnowballStatsRow = {
  id: string;
  symbol: string;
  /** ทิศเทรดสำหรับสถิติ */
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
  svpHoleYn: "Y" | "N";
  price4h: number | null;
  pct4h: number | null;
  price12h: number | null;
  pct12h: number | null;
  price24h: number | null;
  pct24h: number | null;
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

function snowballStatsTradeSideLabel(trade: SnowballStatsRow["side"]): "Long" | "Short" {
  return trade === "long" ? "Long" : "Short";
}

/** ทิศในตาราง: เดียวกัน = Long/Short · สวน = Long->Short */
export function snowballStatsSideLabel(
  row: Pick<SnowballStatsRow, "side" | "alertSide" | "triggerKind">,
): string {
  const trade = snowballStatsTradeSideLabel(row.side);
  let alert: SnowballStatsAlertSide | null = row.alertSide ?? null;
  if (!alert) {
    if (row.side === "long") alert = "long";
    else if (row.triggerKind === "swing_ll") alert = "bear";
    else alert = "long";
  }
  const signal = snowballStatsAlertSideLabel(alert);
  if (signal === trade) return trade;
  return `${signal}->${trade}`;
}

/** A+/B/C สำหรับตารางสถิติ (LONG = HH48/HH200/VAH · SHORT = Double Barrier) */
export function snowballStatsGradeLabel(
  side: SnowballStatsRow["side"],
  tier: SnowballStatsRow["qualityTier"] | undefined
): string {
  if (!tier) return "—";
  if (tier === "a_plus") return "A+";
  if (tier === "b_plus") return "B";
  if (tier === "c_plus") return "C";
  if (tier === "d_plus") return "D";
  return "—";
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
