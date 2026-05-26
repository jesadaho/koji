"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import {
  rsiDivergenceDayOfWeekBkk,
  rsiDivergenceKindBadge,
  rsiDivergenceOutcomeLabel,
  RSI_DIVERGENCE_STATS_DEFAULT_SORT,
  rsiDivergenceStatsSortDefaultDir,
  rsiDivergenceTfLabel,
  rsiDivergenceTriggerLabel,
  rsiDivergenceTriggerShort,
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  sortRsiDivergenceStatsRows,
  type RsiDivergenceKind,
  type RsiDivergenceStatsApiPayload,
  type RsiDivergenceStatsRow,
  type RsiDivergenceStatsSort,
  type RsiDivergenceStatsSortKey,
} from "@/lib/rsiDivergenceStatsClient";
import { rsiDivergenceStatsToCsv } from "@/lib/rsiDivergenceStatsCsvExport";
import { downloadCsv, statsCsvFilename } from "@/lib/statsCsv";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const FOOTNOTE =
  "Binance USDT-M · 2 Waves + Confirm (RSI cross / Price break) · follow-up 1d/3d/7d · ผลที่ 7d · ไม่ส่ง Telegram follow-up";

function coinLabel(symbol: string): string {
  const u = symbol.toUpperCase();
  return u.endsWith("USDT") ? u.slice(0, -4) : u;
}

function formatBkk(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toFixed(2);
  if (abs >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}

function fmtPctCell(price: number | null, pct: number | null): ReactNode {
  if (price == null || !Number.isFinite(price)) return "—";
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {fmtPrice(price)} ({fmtPct(pct)})
    </span>
  );
}

function fmtRsi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(1);
}

function fmtRsiDelta(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

type Phase = "loading" | "setup" | "ready";

function sortMark(active: boolean, dir: RsiDivergenceStatsSort["dir"]): string {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

function SortTh({
  label,
  sortKey,
  title,
  activeSort,
  onSort,
}: {
  label: string;
  sortKey: RsiDivergenceStatsSortKey;
  title?: string;
  activeSort: RsiDivergenceStatsSort;
  onSort: (key: RsiDivergenceStatsSortKey) => void;
}) {
  const active = activeSort.key === sortKey;
  return (
    <th
      scope="col"
      title={title ? `${title} · กดเรียง` : "กดเรียง"}
      className={`sparkStatsSortTh${active ? " sparkStatsSortTh--active" : ""}`}
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(sortKey);
        }
      }}
      tabIndex={0}
      role="columnheader"
      aria-sort={active ? (activeSort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {sortMark(active, activeSort.dir)}
    </th>
  );
}

type DivergenceStatsSectionProps = {
  kind: RsiDivergenceKind;
  title: string;
  subtitle: string;
  emptyHint: string;
  footnote: string;
  csvPrefix: string;
  rows: RsiDivergenceStatsRow[];
};

function DivergenceStatsSection({
  kind,
  title,
  subtitle,
  emptyHint,
  footnote,
  csvPrefix,
  rows: rawRows,
}: DivergenceStatsSectionProps) {
  const [sort, setSort] = useState<RsiDivergenceStatsSort>(RSI_DIVERGENCE_STATS_DEFAULT_SORT);

  const onSortColumn = useCallback((key: RsiDivergenceStatsSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: rsiDivergenceStatsSortDefaultDir(key) },
    );
  }, []);

  const rows = useMemo(() => sortRsiDivergenceStatsRows(rawRows, sort), [rawRows, sort]);

  const exportCsv = useCallback(async () => {
    if (rows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    await downloadCsv(statsCsvFilename(csvPrefix), rsiDivergenceStatsToCsv(rows), {
      telegramExportPath: `/api/tma/divergence-stats.csv?kind=${kind}`,
    });
  }, [csvPrefix, rows, kind]);

  return (
    <section className="sparkStatsMatrixSection" style={{ marginTop: "1.5rem" }}>
      <h2 className="sparkStatsMatrixSectionTitle" style={{ marginTop: 0 }}>
        {title}
        <span
          className="tmaTabEn"
          style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}
        >
          {subtitle}
        </span>
      </h2>
      <div className="sparkMatrixScroll">
        <table className="sparkMatrixTable sparkMatrixTable--compact">
          <thead>
            <tr>
              <SortTh label="เหรียญ" sortKey="symbol" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="TF" sortKey="tf" activeSort={sort} onSort={onSortColumn} />
              <SortTh
                label="Trigger"
                sortKey="trigger"
                title="X = RSI ตัด SMA · PB = ราคา break แท่งก่อน"
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh label="วัน" sortKey="day" title="วันในสัปดาห์ (BKK)" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="เวลา" sortKey="time" title="เวลาแจ้ง (BKK)" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="Entry" sortKey="entry" activeSort={sort} onSort={onSortColumn} />
              <SortTh
                label="Ref"
                sortKey="ref"
                title={kind === "bullish" ? "Resistance สูงสุดระหว่าง W1↔W2" : "Support ต่ำสุดระหว่าง W1↔W2"}
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh label="RSI W1" sortKey="rsiW1" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="RSI W2" sortKey="rsiW2" activeSort={sort} onSort={onSortColumn} />
              <SortTh
                label="ΔRSI"
                sortKey="rsiDelta"
                title="|rsiW2 − rsiW1| (★ = strong)"
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh
                label="Vol 24h"
                sortKey="vol24h"
                title="Binance USDT-M quote volume 24h ณ แจ้ง"
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh
                label="MCap"
                sortKey="mcap"
                title="Market cap USD (CoinGecko) ณ แจ้ง"
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh label="1d" sortKey="h1" title="follow-up 1d (%)" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="3d" sortKey="h2" title="follow-up 3d (%)" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="7d" sortKey="h3" title="follow-up 7d (%)" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="ROI" sortKey="roi" title="Max ROI ถึง MFE" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="DD" sortKey="dd" title="Max drawdown ถึง MFE" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="ผล" sortKey="outcome" title="ผลที่ครบ 7d" activeSort={sort} onSort={onSortColumn} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={18} className="sub">
                  {emptyHint}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{coinLabel(r.symbol)}</td>
                  <td>{rsiDivergenceTfLabel(r.tf)}</td>
                  <td title={rsiDivergenceTriggerLabel(r.trigger)}>
                    {rsiDivergenceTriggerShort(r.trigger)}
                  </td>
                  <td>{rsiDivergenceDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs)}</td>
                  <td>
                    <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                  </td>
                  <td>{fmtPrice(r.entryPrice)}</td>
                  <td>{fmtPrice(r.refLevel)}</td>
                  <td>{fmtRsi(r.rsiW1)}</td>
                  <td>{fmtRsi(r.rsiW2)}</td>
                  <td title={r.strong ? "Strong (≥ STRONG_RSI_DELTA)" : undefined}>
                    {fmtRsiDelta(r.rsiDelta)}
                    {r.strong ? " ★" : ""}
                  </td>
                  <td>{snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt)}</td>
                  <td>{snowballStatsMarketCapUsdLabel(r.marketCapUsd)}</td>
                  <td>{fmtPctCell(r.price1d, r.pct1d)}</td>
                  <td>{fmtPctCell(r.price3d, r.pct3d)}</td>
                  <td>{fmtPctCell(r.price7d, r.pct7d)}</td>
                  <td>{r.maxRoiPct != null ? `${r.maxRoiPct.toFixed(2)}%` : "—"}</td>
                  <td>{r.maxDrawdownPct != null ? `${r.maxDrawdownPct.toFixed(2)}%` : "—"}</td>
                  <td>{rsiDivergenceOutcomeLabel(r.outcome)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="sparkStatsMatrixSectionIntro" style={{ marginTop: "0.75rem" }}>
        {footnote}
      </p>
      <p className="sparkStatsActionRow" style={{ marginTop: "0.5rem" }}>
        <button
          type="button"
          className="sparkStatsRefreshBtn"
          disabled={rows.length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </p>
    </section>
  );
}

export default function DivergenceStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<RsiDivergenceStatsApiPayload | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const allRows = payload?.rows ?? [];

  const bullRows = useMemo(() => allRows.filter((r) => r.kind === "bullish"), [allRows]);
  const bearRows = useMemo(() => allRows.filter((r) => r.kind === "bearish"), [allRows]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const initData = getTelegramInitData();
    const url = `${apiBase}/api/tma${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(initData ? { Authorization: `tma ${initData}` } : {}),
        ...(init?.headers ?? {}),
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
    return parsed as RsiDivergenceStatsApiPayload;
  }, []);

  const loadStats = useCallback(async () => {
    const data = await api("/divergence-stats");
    setPayload(data);
    setResetError(null);
  }, [api]);

  const backfillStats = useCallback(async () => {
    if (
      !window.confirm(
        "ปรับ result และ backfill RSI Divergence stats?\n\n" +
          "1) Refetch horizon (1d/3d/7d) จาก Binance + auto-finalize แถวที่ครบเวลา\n" +
          "2) Recompute outcome ทุกแถวจาก pct7d — ทับของเดิม โดยไม่สนใจ pending guard\n\n" +
          "อาจใช้เวลาหลายวินาทีขึ้นกับจำนวนแถว",
      )
    ) {
      return;
    }
    setBackfillBusy(true);
    setBackfillMsg(null);
    try {
      const res = (await api("/divergence-stats/backfill", {
        method: "POST",
      })) as unknown as {
        ok?: boolean;
        updated?: number;
        scanned?: number;
        changedOutcome?: number;
      };
      const updated = typeof res?.updated === "number" ? res.updated : 0;
      const scanned = typeof res?.scanned === "number" ? res.scanned : 0;
      const changedOutcome = typeof res?.changedOutcome === "number" ? res.changedOutcome : 0;
      setBackfillMsg({
        kind: "ok",
        text: `ปรับเสร็จ — backfill ${updated} แถว · สแกน ${scanned} · เปลี่ยน outcome ${changedOutcome}`,
      });
      await loadStats();
    } catch (e) {
      setBackfillMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBackfillBusy(false);
    }
  }, [api, loadStats]);

  const resetStats = useCallback(async () => {
    if (
      !window.confirm(
        "ล้างสถิติ RSI Divergence ทั้งหมด?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้ — แถวในตารางจะหายจนมีสัญญาณใหม่",
      )
    ) {
      return;
    }
    setResetBusy(true);
    setResetError(null);
    try {
      await api("/divergence-stats", { method: "POST" });
      await loadStats();
    } catch (e) {
      setResetError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetBusy(false);
    }
  }, [api, loadStats]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadTelegramWebApp();
        prepareTelegramMiniAppShell();
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <p>โหลด Telegram Web App ไม่ได้: {e instanceof Error ? e.message : String(e)}</p>,
          );
          setPhase("setup");
        }
        return;
      }

      try {
        const configUrl = `${apiBase}/api/tma/config`;
        const res = await fetch(configUrl);
        const cfg = (await res.json()) as { botTokenConfigured?: boolean };
        if (!cfg.botTokenConfigured) {
          if (!cancelled) {
            setSetupBody(<p>ยังไม่ตั้ง TELEGRAM_BOT_TOKEN</p>);
            setPhase("setup");
          }
          return;
        }
        await loadStats();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <p>โหลดสถิติ RSI Divergence ไม่สำเร็จ: {e instanceof Error ? e.message : String(e)}</p>,
          );
          setPhase("setup");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStats]);

  if (phase === "loading") {
    return (
      <div className="sparkStatsPage sparkStatsPage--wide">
        <div className="tmaLoadingRow">
          <span className="tmaLoadingSpinner" aria-hidden />
          <span className="tmaLoadingLabel">กำลังโหลด…</span>
        </div>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="sparkStatsPage sparkStatsPage--wide">
        <h1 className="sparkStatsMatrixSectionTitle">สถิติ RSI Divergence</h1>
        {setupBody}
        <p className="sub" style={{ marginTop: "1rem" }}>
          <Link href="/">กลับหน้าแรก</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="sparkStatsPage sparkStatsPage--wide">
      <h1 className="sparkStatsMatrixSectionTitle">
        สถิติ RSI Divergence
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          Bullish + Bearish · 1H/4H · 2 Waves + Confirm
        </span>
      </h1>

      <MiniAppStatsNav showHome style={{ marginTop: "0.75rem" }} />

      <p className="sparkStatsActionRow" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="sparkStatsRefreshBtn" onClick={() => void loadStats()}>
          รีเฟรช
        </button>
        {payload?.isAdmin ? (
          <button
            type="button"
            className="sparkStatsRefreshBtn"
            disabled={backfillBusy}
            title="Refetch horizon (1d/3d/7d) จาก Binance + recompute outcome ทุกแถวจาก pct7d — ข้าม pending guard"
            onClick={() => void backfillStats()}
          >
            {backfillBusy ? "กำลังปรับ…" : "ปรับ result และ backfill"}
          </button>
        ) : null}
        {payload?.isAdmin ? (
          <button
            type="button"
            className="sparkStatsRefreshBtn danger"
            disabled={resetBusy}
            onClick={() => void resetStats()}
          >
            {resetBusy ? "กำลังล้าง…" : "ล้างสถิติ"}
          </button>
        ) : null}
      </p>
      {backfillMsg ? (
        <p
          className="sub"
          style={{
            marginTop: "0.5rem",
            color: backfillMsg.kind === "error" ? "var(--danger)" : undefined,
          }}
        >
          {backfillMsg.text}
        </p>
      ) : null}
      {resetError ? (
        <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
          {resetError}
        </p>
      ) : null}

      <DivergenceStatsSection
        kind="bullish"
        title={`${rsiDivergenceKindBadge("bullish")} Divergence`}
        subtitle="Price LL vs RSI HL — long bias · follow-up 1d / 3d / 7d (ผลที่ 7d)"
        emptyHint="ยังไม่มีแถว Bullish — รอสัญญาณยิงสำเร็จ (INDICATOR_PUBLIC_RSI_DIVERGENCE_ENABLED)"
        footnote={FOOTNOTE}
        csvPrefix="divergence-stats-bullish"
        rows={bullRows}
      />

      <DivergenceStatsSection
        kind="bearish"
        title={`${rsiDivergenceKindBadge("bearish")} Divergence`}
        subtitle="Price HH vs RSI LH — short bias · follow-up 1d / 3d / 7d (ผลที่ 7d)"
        emptyHint="ยังไม่มีแถว Bearish — รอสัญญาณยิงสำเร็จ (INDICATOR_PUBLIC_RSI_DIVERGENCE_ENABLED)"
        footnote={FOOTNOTE}
        csvPrefix="divergence-stats-bearish"
        rows={bearRows}
      />
    </div>
  );
}
