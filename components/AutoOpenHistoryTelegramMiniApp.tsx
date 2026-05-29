"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import {
  autoOpenOutcomeLabel,
  autoOpenReasonLabel,
  autoOpenSourceLabel,
  filterAutoOpenLogsByDays,
  type AutoOpenOrderLogApiPayload,
  type AutoOpenOrderLogRow,
  type AutoOpenSource,
} from "@/lib/autoOpenOrderLogClient";
import { autoOpenHorizonDue } from "@/lib/autoOpenFollowUp";
import { autoOpenOrderLogToCsv } from "@/lib/autoOpenOrderLogCsvExport";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import { downloadCsv, statsCsvFilename } from "@/lib/statsCsv";

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

export default function AutoOpenHistoryTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<AutoOpenOrderLogApiPayload | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [dayFilter, setDayFilter] = useState<DayFilter>("30");

  const api = useCallback(async (path: string) => {
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
    return parsed as AutoOpenOrderLogApiPayload;
  }, []);

  const loadHistory = useCallback(async () => {
    const q = new URLSearchParams();
    if (dayFilter !== "all") q.set("days", dayFilter);
    if (sourceFilter !== "all") q.set("source", sourceFilter);
    const qs = q.toString();
    const data = await api(`/auto-open-history${qs ? `?${qs}` : ""}`);
    setPayload(data);
  }, [api, dayFilter, sourceFilter]);

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

  const displayRows = useMemo(() => {
    if (dayFilter === "all") return rows;
    return filterAutoOpenLogsByDays(rows, Number(dayFilter));
  }, [rows, dayFilter]);

  const successRate =
    summary && summary.total > 0
      ? `${((summary.success / summary.total) * 100).toFixed(1)}%`
      : "—";

  const exportCsv = useCallback(async () => {
    if (displayRows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    const q = new URLSearchParams();
    if (dayFilter !== "all") q.set("days", dayFilter);
    if (sourceFilter !== "all") q.set("source", sourceFilter);
    const qs = q.toString();
    await downloadCsv(statsCsvFilename("auto-open-history"), autoOpenOrderLogToCsv(displayRows), {
      telegramExportPath: `/api/tma/auto-open-history.csv${qs ? `?${qs}` : ""}`,
    });
  }, [displayRows, dayFilter, sourceFilter]);

  if (phase === "loading") {
    return (
      <main className="sparkStatsPage">
        <p className="sub">กำลังโหลด…</p>
      </main>
    );
  }

  if (phase === "setup") {
    return (
      <main className="sparkStatsPage">
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
    <main className="sparkStatsPage">
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
        <button type="button" className="btn" onClick={() => void loadHistory()}>
          รีเฟรช
        </button>
        <button type="button" className="btn" onClick={() => void exportCsv()}>
          Export CSV
        </button>
      </div>

      <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
        <div className="marketsFundingHistTableWrap" style={{ overflowX: "auto" }}>
          <table className="marketsFundingHistTable sparkStatsTable">
            <thead>
              <tr>
                <th>เวลา (BKK)</th>
                <th>แหล่ง</th>
                <th>เหรียญ</th>
                <th>ทิศ</th>
                <th>Entry</th>
                <th>เกรด/โมเดล</th>
                <th>ผล</th>
                <th>เหตุผล</th>
                <th>4h</th>
                <th>12h</th>
                <th>24h</th>
                <th>48h</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="sub">
                    ยังไม่มีบันทึก — จะมีเมื่อมีสัญญาณและระบบประเมิน auto-open ของบัญชีคุณ
                  </td>
                </tr>
              ) : (
                displayRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code className="marketsFundingHistTime">{formatBkk(r.atMs)}</code>
                    </td>
                    <td>{autoOpenSourceLabel(r.source)}</td>
                    <td>{coinLabel(r.binanceSymbol || r.contractSymbol)}</td>
                    <td>{r.side ? r.side.toUpperCase() : "—"}</td>
                    <td>{fmtPrice(r.entryPrice)}</td>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="sub" style={{ marginTop: "1rem" }}>
        <Link href="/settings">ตั้งค่า Snowball / Reversal auto-open</Link>
      </p>
    </main>
  );
}
