import {
  autoOpenOutcomeLabel,
  autoOpenReasonLabel,
  autoOpenSourceLabel,
  type AutoOpenOrderLogRow,
} from "@/lib/autoOpenOrderLogClient";
import { buildCsv, statsCoinLabel, statsFmtBkk } from "@/lib/statsCsv";

const HEADERS = [
  "atMs",
  "เวลา (BKK)",
  "แหล่ง",
  "ผลลัพธ์",
  "เหตุผล",
  "รายละเอียด",
  "เหรียญ",
  "ทิศ",
  "entryPrice",
  "เกรด",
  "TF",
  "model",
  "margin",
  "leverage",
  "orderKind",
  "pct4h",
  "pct12h",
  "pct24h",
  "pct48h",
];

function fmtPctCsv(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

export function autoOpenOrderLogToCsv(rows: AutoOpenOrderLogRow[]): string {
  const body = rows.map((r) => [
    String(r.atMs),
    statsFmtBkk(new Date(r.atMs).toISOString()),
    autoOpenSourceLabel(r.source),
    autoOpenOutcomeLabel(r.outcome),
    autoOpenReasonLabel(r.reasonCode),
    r.reasonDetail ?? "",
    statsCoinLabel(r.binanceSymbol || r.contractSymbol),
    r.side?.toUpperCase() ?? "",
    r.entryPrice != null ? String(r.entryPrice) : "",
    r.gradeKey ?? "",
    r.signalBarTf ?? "",
    r.model ?? "",
    r.marginUsdt != null ? String(r.marginUsdt) : "",
    r.leverage != null ? String(r.leverage) : "",
    r.orderKind ?? "",
    fmtPctCsv(r.pct4h),
    fmtPctCsv(r.pct12h),
    fmtPctCsv(r.pct24h),
    fmtPctCsv(r.pct48h),
  ]);
  return buildCsv(HEADERS, body);
}
