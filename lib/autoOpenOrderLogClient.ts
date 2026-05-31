export type AutoOpenSource = "snowball" | "reversal";
export type AutoOpenOutcome = "success" | "skipped" | "failed";

export type AutoOpenOrderLogRow = {
  id: string;
  atMs: number;
  userId: string;
  source: AutoOpenSource;
  outcome: AutoOpenOutcome;
  reasonCode: string;
  reasonDetail?: string;
  contractSymbol: string;
  binanceSymbol: string;
  side?: "long" | "short";
  alertSide?: "long" | "bear";
  gradeKey?: string | null;
  signalBarTf?: string;
  signalBarOpenSec?: number;
  marginUsdt?: number;
  leverage?: number;
  marginScale?: number;
  model?: string;
  bodyRatio?: number;
  wickRatio?: number;
  rangeRankInLookback?: number | null;
  orderKind?: "market" | "limit";
  ema50_15m?: number;
  markPrice?: number;
  /** ราคาเข้าอ้างอิง (สัญญาณ / ตั้งใจเปิด) — ใช้ follow-up แม้เปิดล้มเหลว */
  entryPrice?: number;
  price4h?: number | null;
  pct4h?: number | null;
  price12h?: number | null;
  pct12h?: number | null;
  price24h?: number | null;
  pct24h?: number | null;
  price48h?: number | null;
  pct48h?: number | null;
  /** Max ROI% ถึง MFE ในกรอบ 48h */
  maxRoiPct?: number | null;
  maxDrawdownPct?: number | null;
  durationToMfeHours?: number | null;
  /** ผล strategy หลังครบ 48h — ดู AutoOpenStrategyOutcome */
  strategyOutcome?: string | null;
  /** P/L % ราคาตามกติกา strategy (ใช้แสดงผลจริง @48h) */
  strategyPct?: number | null;
};

export type AutoOpenOrderLogApiPayload = {
  rows: AutoOpenOrderLogRow[];
  summary: AutoOpenOrderLogSummary;
  /** จำนวน skipped ทั้งหมดของ user (ไม่จำกัดช่วง days ที่โหลด) */
  skippedTotal: number;
  /** ราคา last MEXC perp — key = contract symbol เช่น BTC_USDT */
  markPrices: Record<string, number>;
};

export type AutoOpenOrderLogSummary = {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  bySource: Record<AutoOpenSource, { total: number; success: number; skipped: number; failed: number }>;
  topReasonCodes: { code: string; label: string; count: number }[];
};

const REASON_LABELS: Record<string, string> = {
  user_disabled: "ปิด auto-open ใน Settings",
  grade_off: "เกรดนี้ตั้งเป็น ปิด (legacy)",
  unknown_grade: "ไม่ระบุเกรดสัญญาณ (legacy)",
  action_plan_monitor: "Action Plan = Monitor",
  already_opened_today: "เปิดเหรียญนี้แล้ววันนี้ (BKK)",
  no_mexc_creds: "ยังไม่ใส่ MEXC API",
  invalid_margin_or_leverage: "margin หรือ leverage ไม่ถูกต้อง",
  position_check_failed: "เช็คโพซิชัน MEXC ไม่สำเร็จ",
  existing_position: "มีโพซิชันอยู่แล้ว",
  mexc_order_rejected: "MEXC ปฏิเสธคำสั่ง",
  ema_or_price_unavailable: "ดึง EMA50/mark ไม่ได้",
  entry_gate: "สัญญาณไม่ผ่าน gate (legacy)",
  quality_signal_gate: "สัญญาณไม่ผ่าน Quality Signal (เขียว/Wick/Range)",
  network_error: "ข้อผิดพลาดเครือข่าย/MEXC",
  open_success_market: "เปิดสำเร็จ (Market)",
  open_success_limit: "ตั้ง Limit สำเร็จ",
};

export function autoOpenReasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code;
}

export function autoOpenOutcomeLabel(outcome: AutoOpenOutcome): string {
  if (outcome === "success") return "สำเร็จ";
  if (outcome === "failed") return "ล้มเหลว";
  return "ข้าม";
}

export function autoOpenSourceLabel(source: AutoOpenSource): string {
  return source === "snowball" ? "Snowball" : "Reversal";
}

function emptyBySource(): AutoOpenOrderLogSummary["bySource"] {
  return {
    snowball: { total: 0, success: 0, skipped: 0, failed: 0 },
    reversal: { total: 0, success: 0, skipped: 0, failed: 0 },
  };
}

export function summarizeAutoOpenOrderLogs(rows: AutoOpenOrderLogRow[]): AutoOpenOrderLogSummary {
  const bySource = emptyBySource();
  const reasonCounts = new Map<string, number>();
  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    if (r.outcome === "success") success += 1;
    else if (r.outcome === "failed") failed += 1;
    else skipped += 1;

    const src = r.source;
    if (src === "snowball" || src === "reversal") {
      bySource[src].total += 1;
      if (r.outcome === "success") bySource[src].success += 1;
      else if (r.outcome === "failed") bySource[src].failed += 1;
      else bySource[src].skipped += 1;
    }

    if (r.outcome !== "success") {
      reasonCounts.set(r.reasonCode, (reasonCounts.get(r.reasonCode) ?? 0) + 1);
    }
  }

  const topReasonCodes = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ code, label: autoOpenReasonLabel(code), count }));

  return {
    total: rows.length,
    success,
    skipped,
    failed,
    bySource,
    topReasonCodes,
  };
}

export function filterAutoOpenLogsByDays(
  rows: AutoOpenOrderLogRow[],
  days: number,
  nowMs = Date.now(),
): AutoOpenOrderLogRow[] {
  if (!(days > 0)) return rows;
  const cutoff = nowMs - days * 24 * 3600 * 1000;
  return rows.filter((r) => r.atMs >= cutoff);
}
