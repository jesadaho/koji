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
  "เกรด",
  "TF",
  "model",
  "margin",
  "leverage",
  "orderKind",
];

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
    r.gradeKey ?? "",
    r.signalBarTf ?? "",
    r.model ?? "",
    r.marginUsdt != null ? String(r.marginUsdt) : "",
    r.leverage != null ? String(r.leverage) : "",
    r.orderKind ?? "",
  ]);
  return buildCsv(HEADERS, body);
}
