import { excludePendingConflictRows } from "@/lib/signalPendingConflict";
import type { CandleReversalTradeSide } from "@/lib/candleReversalStatsClient";
import {
  type ReversalSuggestedSideFilter,
} from "@/lib/reversalMatrixFilters";

export type AutoOpenSource = "snowball" | "reversal";
export type AutoOpenOutcome = "success" | "skipped" | "failed";
/** ทิศสัญญาณ Reversal ที่ยิง alert — long = fade เปิด SHORT */
export type ReversalAutoOpenAlertSide = "short" | "long";

/** ฟิลเตอร์แหล่งในหน้าประวัติ Bot Trade */
export type AutoOpenSourceFilter = "all" | "snowball" | "reversal";

/** ฟิลเตอร์ทิศสัญญาณ Reversal — Short 1H vs Long 1H (fade) */
export type AutoOpenReversalAlertSideFilter = "all" | "short" | "long";

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
  /** Snowball — ทิศสัญญาณ long / bear */
  alertSide?: "long" | "bear";
  /** Reversal — ทิศสัญญาณ short หรือ long (fade SHORT) */
  reversalAlertSide?: ReversalAutoOpenAlertSide;
  /** Reversal — ทิศแนะนำจาก Long candidate (Short 1H) · long signal = short fade */
  suggestedTradeSide?: CandleReversalTradeSide;
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
  /** Reversal entry mode ตอนเปิด */
  entryMode?: "hybrid_ema" | "market";
  /** EMA period บน TF 15m ตอนเปิด (Reversal hybrid) */
  entryEmaPeriod?: number;
  /** ค่า EMA บน TF 15m ตอนเปิด (Reversal) */
  entryEma15m?: number;
  /** ค่า EMA บน TF 1h ตอนเปิด (Snowball) */
  entryEma1h?: number;
  /** @deprecated แถวเก่า — ใช้ entryEma15m แทน */
  ema25_15m?: number;
  /** @deprecated แถวเก่า — ใช้ entryEma15m แทน */
  ema20_15m?: number;
  /** @deprecated แถวเก่า — ใช้ entryEma15m แทน */
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
  /** ผล strategy หลังครบ 24h — ดู AutoOpenStrategyOutcome */
  strategyOutcome24h?: string | null;
  /** P/L % จำลอง TP/SL strategy @24h (ไม่ใช่ pct24h ดิบ) */
  strategyPct24h?: number | null;
  /** เหตุผลปิดจำลอง @24h — tp1_tp2 / time_48h ฯลฯ */
  strategyExitReason24h?: import("@/lib/tpSlStrategySimulate").StatsTpSlExitReason | null;
  /** ผล strategy หลังครบ 48h — ดู AutoOpenStrategyOutcome */
  strategyOutcome?: string | null;
  /** P/L % จำลอง TP/SL strategy @48h (ไม่ใช่ pct48h ดิบ) */
  strategyPct?: number | null;
  /** เหตุผลปิดจำลอง @48h */
  strategyExitReason?: import("@/lib/tpSlStrategySimulate").StatsTpSlExitReason | null;
  /** cache กำไรกลยุทธ์ตามแผน TP/SL (key = statsTpSlPlanCacheKey) */
  strategyProfitByPlan?: import("@/lib/statsStrategyProfitClient").StrategyProfitByPlanMap | null;
  /** มีสัญญาณอีกฝั่ง pending คู่กัน — แสดงในตาราง */
  conflictWith?: string | null;
  /** Realised P/L จาก MEXC เมื่อปิด position (รวม funding) */
  mexcRealisedPnlUsdt?: number | null;
  /** เวลาปิด position บน MEXC */
  mexcClosedAtMs?: number | null;
  /** EMA20 1h slope 7d % ณ เปิด — Reversal TP strategy sim */
  ema20_1hSlopePct7d?: number | null;
  /** positionId จาก MEXC history — กันจับคู่ซ้ำ */
  mexcPositionId?: number | null;
  /** ค่าธรรมเนียมสะสมจาก MEXC เมื่อปิด position */
  mexcTotalFeeUsdt?: number | null;
  /** ยังมี position เปิดอยู่บน MEXC (แถว success ล่าสุดของเหรียญ+ทิศ) */
  mexcActive?: boolean;
  /** Snapshot จาก MEXC open position — ใช้คำนวณ live P/L (ไม่ persist) */
  mexcOpenPnlSnapshot?: import("@/lib/autoOpenMexcLivePnl").AutoOpenMexcOpenPnlSnapshot | null;
  /** Limit บน MEXC fill แล้ว (จาก limit tick) — ไม่แสดง ⏳ รอแตะ */
  limitFilledAtMs?: number | null;
};

export type AutoOpenOrderLogApiPayload = {
  rows: AutoOpenOrderLogRow[];
  summary: AutoOpenOrderLogSummary;
  /** จำนวน skipped ทั้งหมดของ user (ไม่จำกัดช่วง days ที่โหลด) */
  skippedTotal: number;
  /** ราคา last MEXC perp — key = contract symbol เช่น BTC_USDT */
  markPrices: Record<string, number>;
  /** ยอด USDT ปัจจุบันจาก MEXC futures (equity / available) */
  mexcBalance?: import("@/src/mexcFuturesClient").MexcUsdtBalanceSnapshot | null;
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
  grade_rule_no_match: "เกรดนี้ตั้งเป็น ปิด หรือไม่ตรง rule",
  already_opened_today: "เปิดเหรียญนี้แล้ววันนี้ (BKK)",
  no_mexc_creds: "ยังไม่ใส่ MEXC API",
  invalid_margin_or_leverage: "margin หรือ leverage ไม่ถูกต้อง",
  position_check_failed: "เช็คโพซิชัน MEXC ไม่สำเร็จ",
  existing_position: "มีโพซิชันอยู่แล้ว",
  mexc_order_rejected: "MEXC ปฏิเสธคำสั่ง",
  ema_or_price_unavailable: "ดึง EMA20/mark ไม่ได้",
  mark_unavailable: "ดึงราคาตลาดไม่ได้",
  entry_gate: "สัญญาณไม่ผ่าน gate (legacy)",
  quality_signal_gate: `สัญญาณไม่ผ่าน Quality Signal (Reversal Short)`,
  quality_filter_no_match: "ไม่ตรงเกณฑ์ Quality Signal / fade SHORT เกรด F / Snowball SHORT ที่เปิดไว้",
  network_error: "ข้อผิดพลาดเครือข่าย/MEXC",
  open_success_market: "เปิดสำเร็จ (Market)",
  open_success_limit: "ตั้ง Limit สำเร็จ",
  open_success_limit_filled: "Limit fill แล้ว (MEXC)",
  play_short_disabled: "เลือกเล่น Long-only — ไม่เปิด SHORT",
  not_long_candidate: "เลือก Long-only แต่ไม่ใช่ Long candidate",
  play_long_requires_1h: "เลือก Long-only — สัญญาณ 1D ไม่เปิด",
  long_fade_disabled: "ปิด auto-open สำหรับสัญญาณ Long (fade)",
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

export function reversalAutoOpenAlertSideLabel(side: ReversalAutoOpenAlertSide): string {
  return side === "long" ? "Long (fade)" : "Short";
}

/** แถวเก่าไม่มี reversalAlertSide — ถือเป็น Short */
export function resolveReversalAutoOpenAlertSide(
  row: Pick<AutoOpenOrderLogRow, "source" | "reversalAlertSide">,
): ReversalAutoOpenAlertSide | null {
  if (row.source !== "reversal") return null;
  if (row.reversalAlertSide === "short" || row.reversalAlertSide === "long") {
    return row.reversalAlertSide;
  }
  return "short";
}

export function matchesAutoOpenSourceFilter(
  row: AutoOpenOrderLogRow,
  filter: AutoOpenSourceFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "snowball") return row.source === "snowball";
  if (filter === "reversal") return row.source === "reversal";
  return true;
}

export function matchesAutoOpenReversalAlertSideFilter(
  row: AutoOpenOrderLogRow,
  filter: AutoOpenReversalAlertSideFilter,
): boolean {
  if (filter === "all") return true;
  if (row.source !== "reversal") return true;
  return resolveReversalAutoOpenAlertSide(row) === filter;
}

/** ทิศแนะนำ — ตาราง Reversal Short 1H · แถวเก่า infer จากทิศ MEXC */
export function resolveAutoOpenReversalSuggestedTradeSide(
  row: Pick<
    AutoOpenOrderLogRow,
    "source" | "reversalAlertSide" | "suggestedTradeSide" | "side"
  >,
): CandleReversalTradeSide | null {
  if (row.source !== "reversal") return null;
  if (row.suggestedTradeSide === "long" || row.suggestedTradeSide === "short") {
    return row.suggestedTradeSide;
  }
  const alertSide = resolveReversalAutoOpenAlertSide(row);
  if (alertSide === "long") return "short";
  if (row.side === "long") return "long";
  if (row.side === "short") return "short";
  return null;
}

export function matchesAutoOpenReversalSuggestedSideFilter(
  row: AutoOpenOrderLogRow,
  filter: ReversalSuggestedSideFilter,
): boolean {
  if (filter === "all") return true;
  if (row.source !== "reversal") return true;
  const suggested = resolveAutoOpenReversalSuggestedTradeSide(row);
  return suggested === filter;
}

export type AutoOpenHistoryFilters = {
  source: AutoOpenSourceFilter;
  reversalAlertSide: AutoOpenReversalAlertSideFilter;
  suggestedSide: ReversalSuggestedSideFilter;
};

export function matchesAutoOpenHistoryFilters(
  row: AutoOpenOrderLogRow,
  filters: AutoOpenHistoryFilters,
): boolean {
  if (!matchesAutoOpenSourceFilter(row, filters.source)) return false;
  if (!matchesAutoOpenReversalAlertSideFilter(row, filters.reversalAlertSide)) return false;
  if (!matchesAutoOpenReversalSuggestedSideFilter(row, filters.suggestedSide)) return false;
  return true;
}

export function filterAutoOpenLogsByHistoryFilters(
  rows: AutoOpenOrderLogRow[],
  filters: AutoOpenHistoryFilters,
): AutoOpenOrderLogRow[] {
  return rows.filter((r) => matchesAutoOpenHistoryFilters(r, filters));
}

export function filterAutoOpenLogsBySourceFilter(
  rows: AutoOpenOrderLogRow[],
  filter: AutoOpenSourceFilter,
): AutoOpenOrderLogRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => matchesAutoOpenSourceFilter(r, filter));
}

export function autoOpenHistoryFiltersToApiQuery(
  source: AutoOpenSourceFilter,
  reversalAlertSide: AutoOpenReversalAlertSideFilter = "all",
): {
  source?: AutoOpenSource;
  reversalAlertSide?: ReversalAutoOpenAlertSide;
} {
  if (source === "snowball") return { source: "snowball" };
  if (source === "reversal") {
    if (reversalAlertSide === "short" || reversalAlertSide === "long") {
      return { source: "reversal", reversalAlertSide };
    }
    return { source: "reversal" };
  }
  return {};
}

/** @deprecated — ใช้ autoOpenHistoryFiltersToApiQuery */
export function autoOpenSourceFilterToApiQuery(filter: AutoOpenSourceFilter): {
  source?: AutoOpenSource;
  reversalAlertSide?: ReversalAutoOpenAlertSide;
} {
  if (filter === "snowball") return { source: "snowball" };
  if (filter === "reversal") return { source: "reversal" };
  return {};
}

export function autoOpenHistoryFilterLabel(
  source: AutoOpenSourceFilter,
  reversalAlertSide: AutoOpenReversalAlertSideFilter = "all",
): string {
  let label: string;
  switch (source) {
    case "all":
      label = "Snowball + Reversal";
      break;
    case "snowball":
      label = "Snowball";
      break;
    case "reversal":
      label = "Reversal";
      break;
  }
  if (source !== "snowball" && reversalAlertSide !== "all") {
    label += reversalAlertSide === "short" ? " · Short" : " · Long (fade)";
  }
  return label;
}

export function autoOpenSourceFilterLabel(filter: AutoOpenSourceFilter): string {
  return autoOpenHistoryFilterLabel(filter, "all");
}

export function autoOpenReversalSuggestedTradeSideLabel(
  row: Pick<
    AutoOpenOrderLogRow,
    "source" | "reversalAlertSide" | "suggestedTradeSide" | "side"
  >,
): string {
  const suggested = resolveAutoOpenReversalSuggestedTradeSide(row);
  if (!suggested) return "—";
  return suggested === "long" ? "🟢 Long" : "🔴 Short";
}

export function parseReversalAutoOpenAlertSide(
  raw: string | null | undefined,
): ReversalAutoOpenAlertSide | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === "short" || v === "long") return v;
  return undefined;
}

export function autoOpenHistoryQueryFromSearchParams(params: {
  get(name: string): string | null;
}): {
  days?: number;
  source?: AutoOpenSource;
  reversalAlertSide?: ReversalAutoOpenAlertSide;
} {
  const daysRaw = params.get("days");
  const days = daysRaw != null ? Number(daysRaw) : undefined;
  const srcRaw = params.get("source")?.toLowerCase();
  const source: AutoOpenSource | undefined =
    srcRaw === "snowball" || srcRaw === "reversal" ? srcRaw : undefined;
  const reversalAlertSide = parseReversalAutoOpenAlertSide(params.get("reversalSide"));
  return {
    days: Number.isFinite(days) && days! > 0 ? days : undefined,
    source,
    reversalAlertSide,
  };
}

export function autoOpenHistoryQueryToSearchParams(query: {
  days?: number;
  source?: AutoOpenSource;
  reversalAlertSide?: ReversalAutoOpenAlertSide;
}): URLSearchParams {
  const q = new URLSearchParams();
  if (query.days != null && query.days > 0) q.set("days", String(query.days));
  if (query.source) q.set("source", query.source);
  if (query.reversalAlertSide) q.set("reversalSide", query.reversalAlertSide);
  return q;
}

/** ทิศสัญญาณที่ยิง alert — แยกตามแหล่ง */
export function autoOpenSignalSideLabel(row: AutoOpenOrderLogRow): string {
  if (row.source === "reversal" && row.reversalAlertSide) {
    return reversalAutoOpenAlertSideLabel(row.reversalAlertSide);
  }
  if (row.source === "snowball" && row.alertSide) {
    return row.alertSide === "bear" ? "Bear" : "Long";
  }
  return "—";
}

function emptyBySource(): AutoOpenOrderLogSummary["bySource"] {
  return {
    snowball: { total: 0, success: 0, skipped: 0, failed: 0 },
    reversal: { total: 0, success: 0, skipped: 0, failed: 0 },
  };
}

export function summarizeAutoOpenOrderLogs(rows: AutoOpenOrderLogRow[]): AutoOpenOrderLogSummary {
  rows = excludePendingConflictRows(rows);
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

  const topReasonCodes: { code: string; label: string; count: number }[] = [];
  reasonCounts.forEach((count, code) => {
    topReasonCodes.push({ code, label: autoOpenReasonLabel(code), count });
  });
  topReasonCodes.sort((a, b) => b.count - a.count);
  const topReasonCodesTop5 = topReasonCodes.slice(0, 5);

  return {
    total: rows.length,
    success,
    skipped,
    failed,
    bySource,
    topReasonCodes: topReasonCodesTop5,
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

/** เฉพาะแถวที่ยังมี position เปิดบน MEXC (mexcActive) */
export function filterAutoOpenLogsMexcLiveOnly(rows: AutoOpenOrderLogRow[]): AutoOpenOrderLogRow[] {
  return rows.filter((r) => r.mexcActive === true);
}
