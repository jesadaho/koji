"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import { PendingConflictBadge } from "@/components/PendingConflictBadge";
import {
  autoOpenOutcomeLabel,
  autoOpenReasonLabel,
  autoOpenSourceLabel,
  filterAutoOpenLogsByDays,
  summarizeAutoOpenOrderLogs,
  type AutoOpenOrderLogApiPayload,
  type AutoOpenOrderLogRow,
  type AutoOpenSource,
} from "@/lib/autoOpenOrderLogClient";
import { groupAutoOpenLogsByBkkWeek } from "@/lib/autoOpenWeekGroup";
import { excludePendingConflictRows } from "@/lib/signalPendingConflict";
import {
  autoOpenHorizonDue,
  autoOpenLimitPriceNotTouchedYet,
  resolveAutoOpenEntryPrice,
  pctVsEntrySide,
} from "@/lib/autoOpenFollowUp";
import {
  autoOpenStrategyFinalized,
  autoOpenStrategyOutcomeLabel,
  formatAutoOpenStrategy48hSummaryText,
  summarizeAutoOpenStrategy48h,
  summarizeAutoOpenUnrealizedPnl,
  type AutoOpenPnlUsdtBucket,
  type AutoOpenStrategy48hSummary,
  type AutoOpenStrategyOutcome,
} from "@/lib/autoOpenStrategyOutcome";
import { autoOpenOrderLogToCsv } from "@/lib/autoOpenOrderLogCsvExport";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import { downloadCsv, statsCsvFilename } from "@/lib/statsCsv";
import {
  formatStatsStrategyProfitDollarAmount,
  formatStatsStrategyProfitUsdt,
  resolveStatsStrategyDisplayPct,
} from "@/lib/statsStrategyProfitClient";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

type Phase = "loading" | "setup" | "ready";
type SourceFilter = "all" | AutoOpenSource;
type DayFilter = "7" | "30" | "90" | "all";

function coinLabel(symbol: string): string {
  const u = symbol.toUpperCase();
  return u.endsWith("USDT") ? u.slice(0, -4) : u.replace(/_USDT$/i, "");
}

function formatBkk(atMs: number): string {
  return new Date(atMs).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function outcomeStyle(outcome: AutoOpenOrderLogRow["outcome"]): { color: string } {
  if (outcome === "success") return { color: "var(--ok, #3a8)" };
  if (outcome === "failed") return { color: "var(--danger, #c44)" };
  return { color: "inherit" };
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

function pnlStyle(pct: number): { color: string } {
  if (pct > 0) return { color: "var(--ok, #3a8)" };
  if (pct < 0) return { color: "var(--danger, #c44)" };
  return { color: "inherit" };
}

const PNL_OK = "var(--ok, #3a8)";
const PNL_DANGER = "var(--danger, #c44)";
const PNL_MUTED = "var(--muted, #888)";

function pnlAmountStyle(amount: number): { color: string; fontWeight: number } {
  if (amount > 0) return { color: PNL_OK, fontWeight: 600 };
  if (amount < 0) return { color: PNL_DANGER, fontWeight: 600 };
  return { color: "inherit", fontWeight: 600 };
}

function renderPnlBucketSplit(
  bucket: Pick<AutoOpenPnlUsdtBucket, "sumUsdtSuccess" | "sumUsdtFailed">,
  successTrades: number,
  failedTrades: number,
): ReactNode | null {
  if (failedTrades <= 0 || (bucket.sumUsdtSuccess == null && bucket.sumUsdtFailed == null)) {
    return null;
  }
  return (
    <span style={{ color: PNL_MUTED }}>
      {" ("}
      {successTrades > 0 && bucket.sumUsdtSuccess != null ? (
        <>
          สำเร็จ{" "}
          <span style={pnlAmountStyle(bucket.sumUsdtSuccess)}>
            {formatStatsStrategyProfitDollarAmount(bucket.sumUsdtSuccess)}
          </span>
        </>
      ) : null}
      {successTrades > 0 &&
      bucket.sumUsdtSuccess != null &&
      failedTrades > 0 &&
      bucket.sumUsdtFailed != null
        ? " · "
        : null}
      {failedTrades > 0 && bucket.sumUsdtFailed != null ? (
        <>
          <span style={{ color: "var(--warn, #b86)" }}>ล้มเหลว(สมมติ)</span>{" "}
          <span style={pnlAmountStyle(bucket.sumUsdtFailed)}>
            {formatStatsStrategyProfitDollarAmount(bucket.sumUsdtFailed)}
          </span>
        </>
      ) : null}
      {")"}
    </span>
  );
}

function renderPnlBucketRow(
  label: string,
  bucket: AutoOpenPnlUsdtBucket,
  opts?: { showTradeCount?: boolean },
): ReactNode | null {
  if (bucket.sumUsdt == null) return null;
  return (
    <div style={{ marginTop: "0.35rem" }}>
      <span>{label} </span>
      <span style={pnlAmountStyle(bucket.sumUsdt)}>
        {formatStatsStrategyProfitDollarAmount(bucket.sumUsdt)}
      </span>
      {renderPnlBucketSplit(bucket, bucket.successTrades, bucket.failedTrades)}
      {opts?.showTradeCount && bucket.trades > 0 ? (
        <span style={{ color: PNL_MUTED }}> ({bucket.trades} ไม้)</span>
      ) : null}
    </div>
  );
}

function shouldShowAutoOpenPnlSummary(
  closed: AutoOpenStrategy48hSummary,
  unrealised: AutoOpenPnlUsdtBucket,
): boolean {
  return (
    closed.trades > 0 ||
    closed.pending > 0 ||
    unrealised.trades > 0 ||
    unrealised.sumUsdt != null
  );
}

function renderAutoOpenStrategy48hSummary(
  closed: AutoOpenStrategy48hSummary,
  unrealised: AutoOpenPnlUsdtBucket,
): ReactNode | null {
  if (!shouldShowAutoOpenPnlSummary(closed, unrealised)) return null;

  const closedBucket: AutoOpenPnlUsdtBucket = {
    trades: closed.trades,
    successTrades: closed.successTrades,
    failedTrades: closed.failedTrades,
    sumUsdt: closed.sumUsdt,
    sumUsdtSuccess: closed.sumUsdtSuccess,
    sumUsdtFailed: closed.sumUsdtFailed,
  };

  if (closed.trades === 0) {
    return (
      <div>
        <div>
          <span>ผล@48h: </span>
          {closed.pending > 0 ? (
            <span style={{ color: PNL_MUTED }}>
              รอผล {closed.pending} ไม้ (ยังไม่ครบ 48h)
            </span>
          ) : null}
        </div>
        {renderPnlBucketRow("Unrealised", unrealised, { showTradeCount: true })}
      </div>
    );
  }

  const wrNode =
    closed.decisive > 0 && closed.winratePct != null ? (
      <>
        {" · "}
        <span style={pnlAmountStyle(closed.winratePct - 50)}>
          WR {closed.winratePct.toFixed(1)}% ({closed.wins}/{closed.decisive})
        </span>
      </>
    ) : null;

  const pendingNode =
    closed.pending > 0 ? (
      <>
        {" · "}
        <span style={{ color: PNL_MUTED }}>รอผล {closed.pending}</span>
      </>
    ) : null;

  return (
    <div>
      <div>
        <span>ผล@48h: </span>
        <span style={{ color: PNL_OK, fontWeight: 600 }}>ชนะ {closed.wins} ไม้</span>
        <span> · </span>
        <span style={{ color: PNL_DANGER, fontWeight: 600 }}>แพ้ {closed.losses} ไม้</span>
        {closed.flats > 0 ? (
          <>
            <span> · </span>
            <span style={{ color: PNL_MUTED }}>เสมอ {closed.flats}</span>
          </>
        ) : null}
        <span> · รวม {closed.trades} ไม้ </span>
        <span style={{ color: PNL_MUTED }}>
          (สำเร็จ {closed.successTrades}
          {closed.failedTrades > 0 ? (
            <>
              {" · "}
              <span style={{ color: "var(--warn, #b86)" }}>ล้มเหลว(สมมติ) {closed.failedTrades}</span>
            </>
          ) : null}
          )
        </span>
        {wrNode}
        {pendingNode}
      </div>
      {renderPnlBucketRow("Realised", closedBucket)}
      {renderPnlBucketRow("Unrealised", unrealised, { showTradeCount: true })}
    </div>
  );
}

function fmtPnlUsdt(marginUsdt: number, leverage: number, pct: number): string {
  const line = formatStatsStrategyProfitUsdt(marginUsdt, leverage, pct);
  return line ?? "—";
}

function contractKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function fmtMarginUsdt(marginUsdt: number | null | undefined): string {
  if (marginUsdt == null || !Number.isFinite(marginUsdt) || marginUsdt <= 0) return "—";
  const n = Number.isInteger(marginUsdt) ? String(marginUsdt) : marginUsdt.toFixed(2).replace(/\.?0+$/, "");
  return `${n} USDT`;
}

function fmtLeverage(leverage: number | null | undefined): string {
  if (leverage == null || !Number.isFinite(leverage) || leverage < 1) return "—";
  return `${Math.floor(leverage)}x`;
}

function fmtEntryCell(row: AutoOpenOrderLogRow, markPrice: number | undefined): ReactNode {
  const entry = resolveAutoOpenEntryPrice(row);
  const priceStr = fmtPrice(entry);
  if (priceStr === "—") return priceStr;
  if (!autoOpenLimitPriceNotTouchedYet(row, markPrice)) return priceStr;
  return (
    <span
      style={{ whiteSpace: "nowrap" }}
      title="Limit ยังไม่แตะราคา order — รอรีเทสต์"
    >
      {priceStr}
      <span style={{ marginLeft: "0.2em", opacity: 0.9 }} aria-hidden>
        ⏳
      </span>
    </span>
  );
}

function fmtMarginCell(row: AutoOpenOrderLogRow): ReactNode {
  const main = fmtMarginUsdt(row.marginUsdt);
  if (main === "—") return main;
  const scale =
    row.source === "snowball" &&
    row.marginScale != null &&
    Number.isFinite(row.marginScale) &&
    row.marginScale > 0 &&
    row.marginScale !== 1
      ? `scale ${row.marginScale}×`
      : null;
  if (!scale) return main;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {main}
      <span className="sub" style={{ display: "block", fontSize: "0.88em", opacity: 0.85 }}>
        {scale}
      </span>
    </span>
  );
}

function fmtStrategyPnlCell(row: AutoOpenOrderLogRow): ReactNode {
  if (!autoOpenHorizonDue(row, 48) || !autoOpenStrategyFinalized(row)) return "—";
  const pct = row.strategyPct!;
  const displayPct = resolveStatsStrategyDisplayPct(pct, row.leverage);
  const usdtLine =
    row.marginUsdt != null &&
    row.leverage != null &&
    row.marginUsdt > 0 &&
    row.leverage > 0
      ? fmtPnlUsdt(row.marginUsdt, row.leverage, pct)
      : null;
  return (
    <span style={{ whiteSpace: "nowrap", ...pnlStyle(displayPct) }} title="ผล @48h ตามกติกา Snowball/Reversal stats">
      <span className="sub" style={{ display: "block", fontSize: "0.88em", opacity: 0.85 }}>
        {autoOpenStrategyOutcomeLabel(row.strategyOutcome as AutoOpenStrategyOutcome)}
      </span>
      {fmtPct(displayPct)}
      {usdtLine ? (
        <span className="sub" style={{ display: "block", fontSize: "0.88em", opacity: 0.85 }}>
          {usdtLine}
        </span>
      ) : null}
    </span>
  );
}

function fmtPnlCell(
  row: AutoOpenOrderLogRow,
  markPrice: number | undefined,
): ReactNode {
  const entry = resolveAutoOpenEntryPrice(row);
  if (
    entry == null ||
    (row.side !== "long" && row.side !== "short") ||
    markPrice == null ||
    !Number.isFinite(markPrice) ||
    autoOpenLimitPriceNotTouchedYet(row, markPrice)
  ) {
    return "—";
  }
  const pct = pctVsEntrySide(row.side, entry, markPrice);
  const displayPct = resolveStatsStrategyDisplayPct(pct, row.leverage);
  const usdtLine =
    row.marginUsdt != null &&
    row.leverage != null &&
    row.marginUsdt > 0 &&
    row.leverage > 0
      ? fmtPnlUsdt(row.marginUsdt, row.leverage, pct)
      : null;
  return (
    <span style={{ whiteSpace: "nowrap", ...pnlStyle(displayPct) }}>
      {fmtPct(displayPct)}
      {usdtLine ? (
        <span className="sub" style={{ display: "block", fontSize: "0.88em", opacity: 0.85 }}>
          {usdtLine}
        </span>
      ) : null}
    </span>
  );
}

function fmtHorizonCell(
  row: AutoOpenOrderLogRow,
  hours: number,
  price: number | null | undefined,
  pct: number | null | undefined,
): ReactNode {
  if (!autoOpenHorizonDue(row, hours)) return "-";
  if (price == null || !Number.isFinite(price)) return "—";
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {fmtPrice(price)} ({fmtPct(pct)})
    </span>
  );
}

function fmtMaxDdCell(row: AutoOpenOrderLogRow): ReactNode {
  if (!autoOpenHorizonDue(row, 48)) return "-";
  const dd = row.maxDrawdownPct;
  if (dd == null || !Number.isFinite(dd)) return "—";
  return <span style={{ whiteSpace: "nowrap" }}>{dd.toFixed(2)}%</span>;
}

function renderAutoOpenHistoryTableBody(
  rows: AutoOpenOrderLogRow[],
  markPrices: Record<string, number>,
  emptyMessage: string,
): ReactNode {
  if (rows.length === 0) {
    return (
      <tr>
        <td colSpan={18} className="sub">
          {emptyMessage}
        </td>
      </tr>
    );
  }
  return rows.map((r) => {
    const nowPx = markPrices[contractKey(r.contractSymbol)];
    return (
      <tr key={r.id}>
        <td>
          <code className="marketsFundingHistTime">{formatBkk(r.atMs)}</code>
        </td>
        <td>{autoOpenSourceLabel(r.source)}</td>
        <td>
          {coinLabel(r.binanceSymbol || r.contractSymbol)}
          <PendingConflictBadge conflictWith={r.conflictWith} />
        </td>
        <td>{r.side ? r.side.toUpperCase() : "—"}</td>
        <td>{fmtMarginCell(r)}</td>
        <td>{fmtLeverage(r.leverage)}</td>
        <td>{fmtEntryCell(r, nowPx)}</td>
        <td>{fmtPrice(nowPx)}</td>
        <td>{fmtPnlCell(r, nowPx)}</td>
        <td>{fmtStrategyPnlCell(r)}</td>
        <td>{r.gradeKey ?? r.model ?? "—"}</td>
        <td>
          <span style={outcomeStyle(r.outcome)}>{autoOpenOutcomeLabel(r.outcome)}</span>
        </td>
        <td>
          {autoOpenReasonLabel(r.reasonCode)}
          {r.reasonDetail ? (
            <span className="sub" style={{ display: "block", fontSize: "0.88em", opacity: 0.85 }}>
              {r.reasonDetail}
            </span>
          ) : null}
        </td>
        <td>{fmtHorizonCell(r, 4, r.price4h, r.pct4h)}</td>
        <td>{fmtHorizonCell(r, 12, r.price12h, r.pct12h)}</td>
        <td>{fmtHorizonCell(r, 24, r.price24h, r.pct24h)}</td>
        <td>{fmtHorizonCell(r, 48, r.price48h, r.pct48h)}</td>
        <td title="Max drawdown % ถึง MFE ในกรอบ 48h (15m)">{fmtMaxDdCell(r)}</td>
      </tr>
    );
  });
}

const AUTO_OPEN_HISTORY_EMPTY_MSG =
  "ยังไม่มีบันทึก — จะมีเมื่อมีสัญญาณและระบบประเมิน auto-open ของบัญชีคุณ";

function AutoOpenHistoryTable({
  rows,
  markPrices,
  emptyMessage = "ยังไม่มีบันทึกในช่วงนี้",
}: {
  rows: AutoOpenOrderLogRow[];
  markPrices: Record<string, number>;
  emptyMessage?: string;
}) {
  return (
    <div className="marketsFundingHistTableWrap" style={{ overflowX: "auto" }}>
      <table className="marketsFundingHistTable sparkStatsTable">
        <thead>
          <tr>
            <th>เวลา (BKK)</th>
            <th>แหล่ง</th>
            <th>เหรียญ</th>
            <th>ทิศ</th>
            <th>Margin</th>
            <th>Lev</th>
            <th title="⏳ = Limit วางแล้ว แต่ราคายังไม่แตะราคา order">Entry</th>
            <th>ปัจจุบัน</th>
            <th>P/L</th>
            <th title="หลังครบ 48h — Win/Loss/Flat ตาม pct48h (Snowball: Trend)">
              ผล@48h
            </th>
            <th>เกรด/โมเดล</th>
            <th>ผล</th>
            <th>เหตุผล</th>
            <th>4h</th>
            <th>12h</th>
            <th>24h</th>
            <th>48h</th>
            <th title="Max drawdown % ถึง MFE ในกรอบ 48h">Max DD</th>
          </tr>
        </thead>
        <tbody>{renderAutoOpenHistoryTableBody(rows, markPrices, emptyMessage)}</tbody>
      </table>
    </div>
  );
}

function AutoOpenWeekSection({
  weekLabel,
  rows,
  markPrices,
}: {
  weekLabel: string;
  rows: AutoOpenOrderLogRow[];
  markPrices: Record<string, number>;
}) {
  const summaryRows = useMemo(() => excludePendingConflictRows(rows), [rows]);
  const orderSummary = useMemo(() => summarizeAutoOpenOrderLogs(summaryRows), [summaryRows]);
  const closed = useMemo(
    () => summarizeAutoOpenStrategy48h(summaryRows, markPrices),
    [summaryRows, markPrices],
  );
  const unrealised = useMemo(
    () => summarizeAutoOpenUnrealizedPnl(summaryRows, markPrices),
    [summaryRows, markPrices],
  );
  const summaryNode = useMemo(
    () => renderAutoOpenStrategy48hSummary(closed, unrealised),
    [closed, unrealised],
  );
  const successRate =
    orderSummary.total > 0
      ? `${((orderSummary.success / orderSummary.total) * 100).toFixed(1)}%`
      : "—";

  return (
    <section style={{ marginBottom: "1.25rem" }}>
      <h2
        className="sparkStatsMatrixSectionTitle"
        style={{ fontSize: "1rem", marginTop: 0, marginBottom: "0.4rem" }}
      >
        สัปดาห์ {weekLabel}
        <span className="sub" style={{ fontWeight: "normal", marginLeft: "0.35rem" }}>
          · {rows.length} รายการ · เปิดสำเร็จ {successRate}
        </span>
      </h2>
      {summaryNode ? (
        <div className="sub" style={{ marginBottom: "0.5rem", lineHeight: 1.45 }}>
          {summaryNode}
        </div>
      ) : null}
      <AutoOpenHistoryTable rows={rows} markPrices={markPrices} />
    </section>
  );
}

export default function AutoOpenHistoryTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<AutoOpenOrderLogApiPayload | null>(null);
  const [markPrices, setMarkPrices] = useState<Record<string, number>>({});
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [dayFilter, setDayFilter] = useState<DayFilter>("30");
  const [splitByWeek, setSplitByWeek] = useState(false);
  const [clearingSkipped, setClearingSkipped] = useState(false);

  const apiGet = useCallback(async (path: string) => {
    const initData = getTelegramInitData();
    const url = `${apiBase}/api/tma${path}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(initData ? { Authorization: `tma ${initData}` } : {}),
      },
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : res.statusText;
      throw new Error(msg);
    }
    return parsed;
  }, []);

  const apiPost = useCallback(
    async (path: string, body?: unknown) => {
      const initData = getTelegramInitData();
      const url = `${apiBase}/api/tma${path}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(initData ? { Authorization: `tma ${initData}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        const msg =
          parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
            ? String((parsed as { error: unknown }).error)
            : res.statusText;
        throw new Error(msg);
      }
      return parsed;
    },
    [],
  );

  const loadHistory = useCallback(async () => {
    const q = new URLSearchParams();
    if (dayFilter !== "all") q.set("days", dayFilter);
    if (sourceFilter !== "all") q.set("source", sourceFilter);
    const qs = q.toString();
    const data = (await apiGet(`/auto-open-history${qs ? `?${qs}` : ""}`)) as AutoOpenOrderLogApiPayload;
    setPayload(data);
    setMarkPrices(data.markPrices ?? {});
  }, [apiGet, dayFilter, sourceFilter]);

  const clearSkipped = useCallback(async () => {
    const total = payload?.skippedTotal ?? 0;
    if (total <= 0) {
      window.alert("ไม่มีรายการข้ามให้ลบ");
      return;
    }
    const scope =
      sourceFilter === "all"
        ? "Snowball + Reversal"
        : sourceFilter === "snowball"
          ? "Snowball"
          : "Reversal";
    const ok = window.confirm(
      `ลบรายการข้ามทั้งหมด ${total} รายการ (${scope}) ออกจากประวัติ?\n\nการลบไม่สามารถย้อนกลับได้`,
    );
    if (!ok) return;
    setClearingSkipped(true);
    try {
      const body = sourceFilter !== "all" ? { source: sourceFilter } : undefined;
      const r = (await apiPost("/auto-open-history/clear-skipped", body)) as { removed?: number };
      await loadHistory();
      window.alert(`ลบแล้ว ${r.removed ?? 0} รายการ`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingSkipped(false);
    }
  }, [apiPost, loadHistory, payload?.skippedTotal, sourceFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadTelegramWebApp();
        prepareTelegramMiniAppShell();
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>โหลด Telegram WebApp ไม่สำเร็จ</p>
              <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
            </>,
          );
          setPhase("setup");
        }
        return;
      }

      const initData = getTelegramInitData();
      if (!initData) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>
                <strong>เปิดจาก Telegram Mini App</strong>
              </p>
              <p className="sub">หน้านี้ต้องยืนยันตัวตนด้วย initData ของ Telegram</p>
            </>,
          );
          setPhase("setup");
        }
        return;
      }

      if (!cancelled) setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    void (async () => {
      try {
        await loadHistory();
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>โหลดประวัติ auto-open ไม่สำเร็จ</p>
              <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
            </>,
          );
          setPhase("setup");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, loadHistory]);

  const rows = payload?.rows ?? [];
  const summary = payload?.summary;

  const contractSymbols = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const sym = contractKey(r.contractSymbol);
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      out.push(sym);
    }
    return out;
  }, [rows]);

  useEffect(() => {
    if (phase !== "ready" || contractSymbols.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const q = `?symbols=${encodeURIComponent(contractSymbols.join(","))}`;
        const data = (await apiGet(`/auto-open-history/mark-prices${q}`)) as {
          markPrices?: Record<string, number>;
        };
        if (!cancelled) setMarkPrices(data.markPrices ?? {});
      } catch {
        /* ignore poll errors */
      }
    };
    const id = setInterval(() => void poll(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, contractSymbols, apiGet]);

  const tableRows = useMemo(() => {
    if (dayFilter === "all") return rows;
    return filterAutoOpenLogsByDays(rows, Number(dayFilter));
  }, [rows, dayFilter]);

  /** สรุป WR/P/L — ไม่รวมแถว conflict (สอดคล้องสถิติ Snowball/Reversal) */
  const summaryRows = useMemo(() => excludePendingConflictRows(tableRows), [tableRows]);

  const strategy48hSummary = useMemo(
    () => summarizeAutoOpenStrategy48h(summaryRows, markPrices),
    [summaryRows, markPrices],
  );
  const unrealisedPnlSummary = useMemo(
    () => summarizeAutoOpenUnrealizedPnl(summaryRows, markPrices),
    [summaryRows, markPrices],
  );
  const strategy48hSummaryNode = useMemo(
    () => renderAutoOpenStrategy48hSummary(strategy48hSummary, unrealisedPnlSummary),
    [strategy48hSummary, unrealisedPnlSummary],
  );
  const strategy48hSummaryTitle = useMemo(
    () => formatAutoOpenStrategy48hSummaryText(strategy48hSummary, unrealisedPnlSummary),
    [strategy48hSummary, unrealisedPnlSummary],
  );

  const weekGroups = useMemo(() => groupAutoOpenLogsByBkkWeek(tableRows), [tableRows]);

  const conflictHiddenFromSummary = tableRows.length - summaryRows.length;

  const successRate =
    summary && summary.total > 0
      ? `${((summary.success / summary.total) * 100).toFixed(1)}%`
      : "—";

  const exportCsv = useCallback(async () => {
    if (tableRows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    const q = new URLSearchParams();
    if (dayFilter !== "all") q.set("days", dayFilter);
    if (sourceFilter !== "all") q.set("source", sourceFilter);
    const qs = q.toString();
    await downloadCsv(statsCsvFilename("auto-open-history"), autoOpenOrderLogToCsv(tableRows), {
      telegramExportPath: `/api/tma/auto-open-history.csv${qs ? `?${qs}` : ""}`,
    });
  }, [tableRows, dayFilter, sourceFilter]);

  if (phase === "loading") {
    return (
      <main className="sparkStatsPage sparkStatsPage--wide">
        <p className="sub">กำลังโหลด…</p>
      </main>
    );
  }

  if (phase === "setup") {
    return (
      <main className="sparkStatsPage sparkStatsPage--wide">
        <h1 className="sparkStatsMatrixSectionTitle" style={{ marginTop: 0 }}>
          ประวัติ Auto-open
        </h1>
        <div className="card">{setupBody}</div>
        <p className="sub" style={{ marginTop: "1rem" }}>
          <Link href="/settings">ตั้งค่า auto-open</Link>
          {" · "}
          <Link href="/stats">Stats</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="sparkStatsPage sparkStatsPage--wide">
      <h1 className="sparkStatsMatrixSectionTitle" style={{ marginTop: 0 }}>
        ประวัติ Auto-open
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          Snowball + Reversal · บันทึกทุกครั้งที่ระบบพยายามสั่ง MEXC
        </span>
      </h1>

      <MiniAppStatsNav showHome style={{ marginTop: "0.5rem" }} />

      <div className="card" style={{ marginTop: "0.75rem" }}>
        <p className="sub" style={{ marginTop: 0 }}>
          อัตราเปิดสำเร็จ (ในช่วงที่เลือก): <strong>{successRate}</strong>
          {summary ? (
            <>
              {" "}
              · สำเร็จ {summary.success} · ข้าม {summary.skipped} · ล้มเหลว {summary.failed} · รวม{" "}
              {summary.total}
            </>
          ) : null}
        </p>
        {summary ? (
          <div className="sub" style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <span>
              Snowball: {summary.bySource.snowball.success}/{summary.bySource.snowball.total} สำเร็จ
            </span>
            <span>
              Reversal: {summary.bySource.reversal.success}/{summary.bySource.reversal.total} สำเร็จ
            </span>
          </div>
        ) : null}
        {summary && summary.topReasonCodes.length > 0 ? (
          <p className="sub" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
            เหตุผลที่ข้าม/ล้มเหลวบ่อย:{" "}
            {summary.topReasonCodes.map((r) => `${r.label} (${r.count})`).join(" · ")}
          </p>
        ) : null}
      </div>

      <div
        className="sparkStatsActionRow"
        style={{ marginTop: "0.75rem", alignItems: "center", flexWrap: "wrap", rowGap: "0.4rem" }}
      >
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          แหล่ง
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
          >
            <option value="all">ทั้งหมด</option>
            <option value="snowball">Snowball</option>
            <option value="reversal">Reversal</option>
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          ย้อนหลัง
          <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value as DayFilter)}>
            <option value="7">7 วัน</option>
            <option value="30">30 วัน</option>
            <option value="90">90 วัน</option>
            <option value="all">ทั้งหมด</option>
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={splitByWeek}
            onChange={(e) => setSplitByWeek(e.target.checked)}
          />
          แยกรายสัปดาห์
        </label>
        <button type="button" className="btn" onClick={() => void loadHistory()}>
          รีเฟรช
        </button>
        <button type="button" className="btn" onClick={() => void exportCsv()}>
          Export CSV
        </button>
        <button
          type="button"
          className="btn"
          disabled={clearingSkipped || (payload?.skippedTotal ?? 0) <= 0}
          onClick={() => void clearSkipped()}
        >
          {clearingSkipped
            ? "กำลังลบ…"
            : `ลบรายการข้าม${(payload?.skippedTotal ?? 0) > 0 ? ` (${payload!.skippedTotal})` : ""}`}
        </button>
      </div>

      <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
        <p className="sub" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
          {splitByWeek ? (
            <>
              สรุปรวมทั้งช่วงที่เลือก
              <span className="tmaTabEn" style={{ marginLeft: "0.35rem" }}>
                (สัปดาห์จันทร์–อาทิตย์ BKK)
              </span>
            </>
          ) : (
            "สรุป P/L"
          )}
        </p>
        {strategy48hSummaryNode ? (
          <div
            className="sub"
            title={
              strategy48hSummaryTitle ??
              "ชนะ/แพ้@48h = ไม้ครบ 48h · Realised = P/L ตามกติกาสถิติ · Unrealised = mark สดไม้ที่ยังไม่ครบ 48h (ไม่รวม Limit ⏳ ที่ยังไม่แตะ order) · ล้มเหลว(สมมติ) = สั่งไม่สำเร็จแต่มี entry อ้างอิง"
            }
            style={{ marginTop: 0, marginBottom: "0.65rem", lineHeight: 1.45 }}
          >
            {strategy48hSummaryNode}
          </div>
        ) : null}
        {conflictHiddenFromSummary > 0 ? (
          <p className="sub" style={{ marginTop: 0, marginBottom: "0.65rem", opacity: 0.9 }}>
            แสดงในตาราง {tableRows.length} รายการ (รวม conflict {conflictHiddenFromSummary} ไม้ที่เปิดจริงแล้ว) ·
            สรุป WR/P/L ด้านบนไม่รวมไม้ที่มี{" "}
            <code>conflict w/</code>
          </p>
        ) : null}

        {splitByWeek ? (
          weekGroups.length === 0 ? (
            <p className="sub">ยังไม่มีบันทึก — จะมีเมื่อมีสัญญาณและระบบประเมิน auto-open ของบัญชีคุณ</p>
          ) : (
            weekGroups.map((g) => (
              <AutoOpenWeekSection
                key={g.weekKey}
                weekLabel={g.weekLabel}
                rows={g.rows}
                markPrices={markPrices}
              />
            ))
          )
        ) : (
          <AutoOpenHistoryTable
            rows={tableRows}
            markPrices={markPrices}
            emptyMessage={AUTO_OPEN_HISTORY_EMPTY_MSG}
          />
        )}
      </section>

      <p className="sub" style={{ marginTop: "0.5rem" }}>
        ราคาปัจจุบัน = MEXC perp last · Entry ⏳ = Limit วางแล้วแต่ราคายังไม่แตะ order (ไม่นับ P/L รวม / คอลัมน์ P/L) · Max DD = drawdown สูงสุดถึง MFE ใน 48h · แยกรายสัปดาห์ = จันทร์–อาทิตย์ (BKK) · cron อัปเดต follow-up
      </p>

      <p className="sub" style={{ marginTop: "1rem" }}>
        <Link href="/settings">ตั้งค่า Snowball / Reversal auto-open</Link>
      </p>
    </main>
  );
}
