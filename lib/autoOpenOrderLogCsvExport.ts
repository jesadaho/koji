import { autoOpenOrderPeriodLabel, resolveAutoOpenEntryPrice } from "@/lib/autoOpenFollowUp";
import {
  autoOpenStrategyOutcomeLabel,
  type AutoOpenStrategyOutcome,
} from "@/lib/autoOpenStrategyOutcome";
import {
  autoOpenOutcomeLabel,
  autoOpenReasonLabel,
  autoOpenSignalSideLabel,
  autoOpenSourceLabel,
  type AutoOpenOrderLogRow,
} from "@/lib/autoOpenOrderLogClient";
import { buildCsv, statsCoinLabel, statsFmtBkk } from "@/lib/statsCsv";

const HEADERS = [
  "atMs",
  "เวลา (BKK)",
  "เปิดมา",
  "แหล่ง",
  "ผลลัพธ์",
  "เหตุผล",
  "รายละเอียด",
  "เหรียญ",
  "ทิศ",
  "สัญญาณ",
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
  "maxRoiPct",
  "maxDrawdownPct",
  "strategyOutcome24h",
  "strategyPct24h",
  "strategyExitReason24h",
  "strategyOutcome",
  "strategyPct",
  "strategyExitReason",
  "mexcRealisedPnlUsdt",
  "mexcClosedAtMs",
];

function fmtPctCsv(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

export function autoOpenOrderLogToCsv(rows: AutoOpenOrderLogRow[]): string {
  const body = rows.map((r) => {
    const signalLabel = autoOpenSignalSideLabel(r);
    return [
    String(r.atMs),
    statsFmtBkk(new Date(r.atMs).toISOString()),
    autoOpenOrderPeriodLabel(r, undefined),
    autoOpenSourceLabel(r.source),
    autoOpenOutcomeLabel(r.outcome),
    autoOpenReasonLabel(r.reasonCode),
    r.reasonDetail ?? "",
    statsCoinLabel(r.binanceSymbol || r.contractSymbol),
    r.side?.toUpperCase() ?? "",
    signalLabel === "—" ? "" : signalLabel,
    (() => {
      const e = resolveAutoOpenEntryPrice(r);
      return e != null ? String(e) : "";
    })(),
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
    r.maxRoiPct != null && Number.isFinite(r.maxRoiPct) ? `${r.maxRoiPct.toFixed(2)}%` : "",
    r.maxDrawdownPct != null && Number.isFinite(r.maxDrawdownPct)
      ? `${r.maxDrawdownPct.toFixed(2)}%`
      : "",
    r.strategyOutcome24h
      ? autoOpenStrategyOutcomeLabel(r.strategyOutcome24h as AutoOpenStrategyOutcome)
      : "",
    fmtPctCsv(r.strategyPct24h),
    r.strategyExitReason24h ?? "",
    r.strategyOutcome
      ? autoOpenStrategyOutcomeLabel(r.strategyOutcome as AutoOpenStrategyOutcome)
      : "",
    fmtPctCsv(r.strategyPct),
    r.strategyExitReason ?? "",
    r.mexcRealisedPnlUsdt != null && Number.isFinite(r.mexcRealisedPnlUsdt)
      ? String(r.mexcRealisedPnlUsdt)
      : "",
    r.mexcClosedAtMs != null && Number.isFinite(r.mexcClosedAtMs) ? String(r.mexcClosedAtMs) : "",
  ];
  });
  return buildCsv(HEADERS, body);
}
