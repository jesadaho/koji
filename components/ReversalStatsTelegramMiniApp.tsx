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
  candleReversalDayOfWeekBkk,
  candleReversalGreenDaysLabel,
  candleReversalHorizonWinrateSummary,
  CANDLE_REVERSAL_MODEL_SHORT_LEGEND,
  CANDLE_REVERSAL_STATS_DEFAULT_SORT,
  candleReversalModelLabel,
  candleReversalModelShortLabel,
  candleReversalOutcomeLabel,
  candleReversalLookbackRankCell,
  candleReversalLowLookbackRankCell,
  candleReversalStatsSortDefaultDir,
  sortCandleReversalStatsRows,
  candleReversalSignalVolVsSmaLabel,
  candleReversalVolScoreLabel,
  type CandleReversalSignalBarTf,
  type CandleReversalStatsApiPayload,
  type CandleReversalStatsRow,
  type CandleReversalStatsSort,
  type CandleReversalStatsSortKey,
} from "@/lib/candleReversalStatsClient";
import {
  marketSentimentFngLabel,
  marketSentimentSentimentLabel,
} from "@/lib/marketSentiment";
import { candleReversalStatsToCsv } from "@/lib/candleReversalStatsCsvExport";
import {
  STATS_VOL_VS_SMA_FILTER_OPTIONS,
  statsRowMatchesVolVsSmaFilter,
  statsVolVsSmaFilterLabel,
  type StatsVolVsSmaFilter,
} from "@/lib/statsVolVsSmaFilter";
import { downloadCsv, statsCsvFilename } from "@/lib/statsCsv";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const FOOTNOTE_1D =
  "Binance USDT-M · Short bias · 1D: follow-up 1d/3d/7d (ปิด Day) · ผลที่ 7d · ไม่ส่ง Telegram follow-up";
const FOOTNOTE_1H_SHORT =
  "Binance USDT-M · Short · 1H: follow-up 4h/12h/24h/48h (ปิด 15m) · MFE แท่ง 1H · ผลที่ 24h · winrate แยก 12h/24h/48h · ไม่ส่ง Telegram follow-up";

const FOOTNOTE_1H_LONG =
  "Binance USDT-M · Long · 1H: follow-up 4h/12h/24h/48h (ปิด 15m) · MFE แท่ง 1H · ผลที่ 24h · winrate แยก 12h/24h/48h · ไม่ส่ง Telegram follow-up";

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

function reversalHorizonCells(r: CandleReversalStatsRow): ReactNode[] {
  const tf = r.signalBarTf ?? "1d";
  if (tf === "1h") {
    return [
      fmtPctCell(r.price4h, r.pct4h),
      fmtPctCell(r.price12h, r.pct12h),
      fmtPctCell(r.price24h, r.pct24h),
      fmtPctCell(r.price48h, r.pct48h),
    ];
  }
  return [fmtPctCell(r.price1d, r.pct1d), fmtPctCell(r.price3d, r.pct3d), fmtPctCell(r.price7d, r.pct7d)];
}

type Phase = "loading" | "setup" | "ready";

function sortMark(active: boolean, dir: CandleReversalStatsSort["dir"]): string {
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
  sortKey: CandleReversalStatsSortKey;
  title?: string;
  activeSort: CandleReversalStatsSort;
  onSort: (key: CandleReversalStatsSortKey) => void;
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

type ReversalShapeFilter = "all" | "wick80" | "body80" | "wickOrBody80";
type ReversalDayFilter = "all" | "3" | "7" | "30" | "90";
type ReversalLenRankFilter = "all" | "rank3to15";
type ReversalVolVsSmaFilter = StatsVolVsSmaFilter;

const REVERSAL_LEN_RANK_FILTER_OPTIONS: ReadonlyArray<{ value: ReversalLenRankFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "rank3to15", label: "อันดับ 3–15" },
];

const REVERSAL_DAY_FILTER_OPTIONS: ReadonlyArray<{ value: ReversalDayFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "3", label: "3 วัน" },
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
];

function reversalShapeFilterLabel(filter: ReversalShapeFilter): string {
  if (filter === "wick80") return "ไส้ >= 80%";
  if (filter === "body80") return "เนื้อ >= 80%";
  if (filter === "wickOrBody80") return "ไส้หรือเนื้อ >= 80%";
  return "ทั้งหมด";
}

function reversalRowMatchesShapeFilter(row: CandleReversalStatsRow, filter: ReversalShapeFilter): boolean {
  if (filter === "all") return true;
  const wickOk = row.wickRatioPct != null && Number.isFinite(row.wickRatioPct) && row.wickRatioPct >= 80;
  const bodyOk = row.bodyPct != null && Number.isFinite(row.bodyPct) && row.bodyPct >= 80;
  if (filter === "wick80") return wickOk;
  if (filter === "body80") return bodyOk;
  return wickOk || bodyOk;
}

function reversalAlertedAtMs(row: CandleReversalStatsRow): number {
  return row.alertedAtMs != null && Number.isFinite(row.alertedAtMs)
    ? row.alertedAtMs
    : Date.parse(row.alertedAtIso);
}

function reversalRowMatchesDayFilter(row: CandleReversalStatsRow, filter: ReversalDayFilter): boolean {
  if (filter === "all") return true;
  const days = Number(filter);
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const ms = reversalAlertedAtMs(row);
  return Number.isFinite(ms) && ms >= cutoffMs;
}

function reversalDayFilterLabel(filter: ReversalDayFilter): string {
  return REVERSAL_DAY_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

function reversalLenRankFilterLabel(filter: ReversalLenRankFilter): string {
  return REVERSAL_LEN_RANK_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

function reversalRowMatchesLenRankFilter(row: CandleReversalStatsRow, filter: ReversalLenRankFilter): boolean {
  if (filter === "all") return true;
  const rank = row.rangeRankInLookback;
  if (rank == null || !Number.isFinite(rank)) return false;
  const r = Math.floor(rank);
  return r >= 3 && r <= 15;
}

function reversalRowMatchesVolVsSmaFilter(row: CandleReversalStatsRow, filter: ReversalVolVsSmaFilter): boolean {
  return statsRowMatchesVolVsSmaFilter(row.signalVolVsSma, filter);
}

function reversalWinrateSummary(rows: CandleReversalStatsRow[]): string {
  const done = rows.filter((r) => r.outcome !== "pending");
  const wins = done.filter((r) => r.outcome === "win").length;
  const losses = done.filter((r) => r.outcome === "loss").length;
  const decisive = wins + losses;
  const flats = done.length - decisive;
  const pending = rows.length - done.length;

  const pendingTag = pending > 0 ? ` · Pending ${pending}` : "";
  const flatTag = flats > 0 ? ` +${flats}f` : "";

  if (decisive === 0) {
    if (flats > 0) {
      return `Winrate: — (0/0${flatTag}) · ปิดผล ${done.length}/${rows.length}${pendingTag}`;
    }
    return `Winrate: — · ปิดผล 0/${rows.length}${pendingTag}`;
  }
  const winrate = (wins / decisive) * 100;
  return `Winrate: ${winrate.toFixed(1)}% (${wins}/${decisive}${flatTag}) · ปิดผล ${done.length}/${rows.length}${pendingTag}`;
}

type ReversalStatsSectionProps = {
  tf: CandleReversalSignalBarTf;
  title: string;
  subtitle: string;
  emptyHint: string;
  footnote: string;
  csvPrefix: string;
  csvQuery?: string;
  rows: CandleReversalStatsRow[];
  showHighRank?: boolean;
  showLowRank?: boolean;
  adverseTitle?: string;
};

function ReversalStatsSection({
  tf,
  title,
  subtitle,
  emptyHint,
  footnote,
  csvPrefix,
  csvQuery = "",
  rows: rawRows,
  showHighRank = true,
  showLowRank = false,
  adverseTitle,
}: ReversalStatsSectionProps) {
  const [sort, setSort] = useState<CandleReversalStatsSort>(CANDLE_REVERSAL_STATS_DEFAULT_SORT);
  const [shapeFilter, setShapeFilter] = useState<ReversalShapeFilter>("all");
  const [dayFilter, setDayFilter] = useState<ReversalDayFilter>("all");
  const [lenRankFilter, setLenRankFilter] = useState<ReversalLenRankFilter>("all");
  const [volVsSmaFilter, setVolVsSmaFilter] = useState<ReversalVolVsSmaFilter>("all");

  const onSortColumn = useCallback((key: CandleReversalStatsSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: candleReversalStatsSortDefaultDir(key) },
    );
  }, []);

  const filteredRows = useMemo(
    () =>
      rawRows.filter(
        (r) =>
          reversalRowMatchesShapeFilter(r, shapeFilter) &&
          reversalRowMatchesDayFilter(r, dayFilter) &&
          reversalRowMatchesLenRankFilter(r, lenRankFilter) &&
          reversalRowMatchesVolVsSmaFilter(r, volVsSmaFilter),
      ),
    [rawRows, shapeFilter, dayFilter, lenRankFilter, volVsSmaFilter],
  );
  const rows = useMemo(() => sortCandleReversalStatsRows(filteredRows, sort), [filteredRows, sort]);
  const winrateText = useMemo(() => reversalWinrateSummary(filteredRows), [filteredRows]);
  const horizonWinrateText = useMemo(
    () =>
      tf === "1h"
        ? candleReversalHorizonWinrateSummary(filteredRows, [
            { label: "12h", pctKey: "pct12h" },
            { label: "24h", pctKey: "pct24h" },
            { label: "48h", pctKey: "pct48h" },
          ])
        : null,
    [filteredRows, tf],
  );

  const horizonLabels = useMemo<[string, string, string, string | null]>(
    () => (tf === "1h" ? ["4h", "12h", "24h", "48h"] : ["1d", "3d", "7d", null]),
    [tf],
  );
  const horizonTitles = useMemo<[string, string, string, string | null]>(
    () =>
      tf === "1h"
        ? ["1H follow-up 4h (%)", "1H follow-up 12h (%)", "1H follow-up 24h (%)", "1H follow-up 48h (%)"]
        : ["1D follow-up 1d (%)", "1D follow-up 3d (%)", "1D follow-up 7d (%)", null],
    [tf],
  );
  const has48h = tf === "1h";
  const extraRankCols = (showHighRank ? 1 : 0) + (showLowRank ? 1 : 0);
  const emptyColSpan = (has48h ? 23 : 22) + extraRankCols + 2;
  const followUpAdverseTitle =
    adverseTitle ??
    (showLowRank
      ? "Max adverse ตลอดช่วง follow-up (long: low ต่ำสุดจาก entry)"
      : "Max adverse ตลอดช่วง follow-up (short: high สูงสุดจาก entry)");

  const exportCsv = useCallback(async () => {
    if (rows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    await downloadCsv(statsCsvFilename(csvPrefix), candleReversalStatsToCsv(rows), {
      telegramExportPath: `/api/tma/reversal-stats.csv?tf=${tf}${csvQuery}`,
    });
  }, [csvPrefix, csvQuery, rows, tf]);

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
      <div
        className="sparkStatsActionRow"
        style={{ marginTop: "0.75rem", alignItems: "center", flexWrap: "wrap", rowGap: "0.4rem" }}
      >
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          ย้อนหลัง
          <select
            value={dayFilter}
            onChange={(e) => setDayFilter(e.currentTarget.value as ReversalDayFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "7rem" }}
          >
            {REVERSAL_DAY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          กรองแท่ง
          <select
            value={shapeFilter}
            onChange={(e) => setShapeFilter(e.currentTarget.value as ReversalShapeFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "11rem" }}
          >
            <option value="all">{reversalShapeFilterLabel("all")}</option>
            <option value="wick80">{reversalShapeFilterLabel("wick80")}</option>
            <option value="body80">{reversalShapeFilterLabel("body80")}</option>
            <option value="wickOrBody80">{reversalShapeFilterLabel("wickOrBody80")}</option>
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          Len#
          <select
            value={lenRankFilter}
            onChange={(e) => setLenRankFilter(e.currentTarget.value as ReversalLenRankFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "7.5rem" }}
            title="อันดับความยาวแท่ง (high-low) ในรอบ lookback — 1 = ยาวสุด"
          >
            {REVERSAL_LEN_RANK_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          Vol×SMA
          <select
            value={volVsSmaFilter}
            onChange={(e) => setVolVsSmaFilter(e.currentTarget.value as ReversalVolVsSmaFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "7.5rem" }}
            title="Vol แท่งสัญญาณ ÷ SMA(volume) ณ แท่งปิด"
          >
            {STATS_VOL_VS_SMA_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <span className="sub">
          แสดง {filteredRows.length}/{rawRows.length} · {winrateText}
        </span>
        {horizonWinrateText ? (
          <span
            className="sub"
            title="Winrate ราย horizon — นับเฉพาะแถวที่มี follow-up ครบ horizon นั้น · เกณฑ์ Win ≥ +2% · Loss ≤ -2% · WR ไม่นับ flat (decisive = wins + losses), +Nf = จำนวน flat"
            style={{ display: "block", marginTop: "0.15rem" }}
          >
            WR · {horizonWinrateText}
          </span>
        ) : null}
      </div>
      <div className="sparkMatrixScroll">
        <table className="sparkMatrixTable sparkMatrixTable--compact">
          <thead>
            <tr>
              <SortTh label="เหรียญ" sortKey="symbol" activeSort={sort} onSort={onSortColumn} />
              <SortTh
                label="โมเดล"
                sortKey="model"
                title={CANDLE_REVERSAL_MODEL_SHORT_LEGEND}
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh
                label="เขียว"
                sortKey="greenDays"
                title="แท่ง Day1 เขียว (close>open) ติดกันก่อนแท่งสัญญาณ"
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh label="วัน" sortKey="day" title="วันในสัปดาห์ (BKK)" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="เวลา" sortKey="time" title="เวลาแจ้ง (BKK)" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="Entry" sortKey="entry" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="Retest" sortKey="retest" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="SL" sortKey="sl" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="ไส้%" sortKey="wickPct" title="ไส้บน ÷ ช่วงแท่ง" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="เนื้อ%" sortKey="bodyPct" title="เนื้อ ÷ ช่วงแท่ง" activeSort={sort} onSort={onSortColumn} />
              <SortTh
                label="Len#"
                sortKey="rangeRank"
                title="อันดับความยาวแท่ง (high-low) ในรอบ lookback"
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh
                label="Vol#"
                sortKey="volRank"
                title="อันดับ volume ในรอบ lookback"
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh
                label="Vol×SMA"
                sortKey="volVsSma"
                title="Vol แท่งสัญญาณ ÷ SMA(volume) ณ แท่งปิด"
                activeSort={sort}
                onSort={onSortColumn}
              />
              {showHighRank ? (
                <SortTh
                  label="High#"
                  sortKey="highRank"
                  title="อันดับ high ในรอบ lookback"
                  activeSort={sort}
                  onSort={onSortColumn}
                />
              ) : null}
              {showLowRank ? (
                <SortTh
                  label="Low#"
                  sortKey="lowRank"
                  title="อันดับ low ในรอบ lookback (1 = ต่ำสุด)"
                  activeSort={sort}
                  onSort={onSortColumn}
                />
              ) : null}
              <SortTh label="Range" sortKey="range" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="Wick" sortKey="wick" activeSort={sort} onSort={onSortColumn} />
              <SortTh
                label={horizonLabels[0]}
                sortKey="h1"
                title={horizonTitles[0]}
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh
                label={horizonLabels[1]}
                sortKey="h2"
                title={horizonTitles[1]}
                activeSort={sort}
                onSort={onSortColumn}
              />
              <SortTh
                label={horizonLabels[2]}
                sortKey="h3"
                title={horizonTitles[2]}
                activeSort={sort}
                onSort={onSortColumn}
              />
              {has48h && horizonLabels[3] && horizonTitles[3] ? (
                <SortTh
                  label={horizonLabels[3]}
                  sortKey="h4"
                  title={horizonTitles[3]}
                  activeSort={sort}
                  onSort={onSortColumn}
                />
              ) : null}
              <SortTh label="ROI" sortKey="roi" title="Max ROI ถึง MFE" activeSort={sort} onSort={onSortColumn} />
              <SortTh label="DD" sortKey="dd" title="Max drawdown ถึง MFE" activeSort={sort} onSort={onSortColumn} />
              <SortTh
                label="สวน max"
                sortKey="followUpAdverse"
                title={followUpAdverseTitle}
                activeSort={sort}
                onSort={onSortColumn}
              />
              <th scope="col" title="Fear & Greed (Market Pulse snapshot ณ เวลาแจ้ง)">
                F&G
              </th>
              <th scope="col" title="Sentiment จาก F&G — Bullish / Neutral / Bearish">
                Sentiment
              </th>
              <SortTh
                label="ผล"
                sortKey="outcome"
                title={tf === "1h" ? "ผลที่ 24h (ปิดเร็ว) · winrate ราย horizon ดูด้านบน" : "ผลหลังครบ horizon"}
                activeSort={sort}
                onSort={onSortColumn}
              />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={emptyColSpan} className="sub">
                  {rawRows.length > 0
                    ? `ไม่มีแถวที่ตรงตัวกรอง — ${reversalDayFilterLabel(dayFilter)} · ${reversalShapeFilterLabel(shapeFilter)} · Len# ${reversalLenRankFilterLabel(lenRankFilter)} · Vol×SMA ${statsVolVsSmaFilterLabel(volVsSmaFilter)}`
                    : emptyHint}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const horizons = reversalHorizonCells(r);
                return (
                  <tr key={r.id}>
                    <td>{coinLabel(r.symbol)}</td>
                    <td title={candleReversalModelLabel(r.model)}>
                      {candleReversalModelShortLabel(r.model)}
                    </td>
                    <td title="แท่ง Day1 เขียวติดก่อนสัญญาณ">
                      {candleReversalGreenDaysLabel(r.greenDaysBeforeSignal)}
                    </td>
                    <td>{candleReversalDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs)}</td>
                    <td>
                      <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                    </td>
                    <td>{fmtPrice(r.entryPrice)}</td>
                    <td>{fmtPrice(r.retestPrice)}</td>
                    <td>{fmtPrice(r.slPrice)}</td>
                    <td>{r.wickRatioPct != null ? `${r.wickRatioPct.toFixed(1)}%` : "—"}</td>
                    <td>{r.bodyPct != null ? `${r.bodyPct.toFixed(1)}%` : "—"}</td>
                    <td>{candleReversalLookbackRankCell(r.rangeRankInLookback, r.lookbackBars)}</td>
                    <td>{candleReversalLookbackRankCell(r.volRankInLookback, r.lookbackBars)}</td>
                    <td>{candleReversalSignalVolVsSmaLabel(r.signalVolVsSma)}</td>
                    {showHighRank ? (
                      <td>{candleReversalLookbackRankCell(r.highRankInLookback, r.lookbackBars)}</td>
                    ) : null}
                    {showLowRank ? (
                      <td>{candleReversalLowLookbackRankCell(r.lowRankInLookback, r.lookbackBars)}</td>
                    ) : null}
                    <td>{candleReversalVolScoreLabel(r.rangeScore)}</td>
                    <td>{candleReversalVolScoreLabel(r.wickScore)}</td>
                    <td>{horizons[0]}</td>
                    <td>{horizons[1]}</td>
                    <td>{horizons[2]}</td>
                    {has48h ? <td>{horizons[3]}</td> : null}
                    <td>{r.maxRoiPct != null ? `${r.maxRoiPct.toFixed(2)}%` : "—"}</td>
                    <td>{r.maxDrawdownPct != null ? `${r.maxDrawdownPct.toFixed(2)}%` : "—"}</td>
                    <td>
                      {r.followUpMaxAdversePct != null ? `${r.followUpMaxAdversePct.toFixed(2)}%` : "—"}
                    </td>
                    <td>{marketSentimentFngLabel(r.marketSentiment)}</td>
                    <td>{marketSentimentSentimentLabel(r.marketSentiment)}</td>
                    <td>{candleReversalOutcomeLabel(r.outcome)}</td>
                  </tr>
                );
              })
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

export default function ReversalStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<CandleReversalStatsApiPayload | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const allRows = payload?.rows ?? [];

  const dayRows = useMemo(
    () => allRows.filter((r) => (r.signalBarTf ?? "1d") === "1d"),
    [allRows],
  );
  const hourShortRows = useMemo(
    () =>
      allRows.filter(
        (r) => (r.signalBarTf ?? "1d") === "1h" && (r.tradeSide ?? "short") === "short",
      ),
    [allRows],
  );
  const hourLongRows = useMemo(
    () =>
      allRows.filter((r) => (r.signalBarTf ?? "1d") === "1h" && r.tradeSide === "long"),
    [allRows],
  );

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
    return parsed as CandleReversalStatsApiPayload;
  }, []);

  const loadStats = useCallback(async () => {
    const data = await api("/reversal-stats");
    setPayload(data);
    setResetError(null);
  }, [api]);

  const backfillStats = useCallback(async () => {
    if (
      !window.confirm(
        "ปรับ result และ backfill Reversal stats?\n\n" +
          "1) ลบแถว pending ซ้ำ (คงสัญญาณแรกต่อเหรียญ+TF)\n" +
          "2) Refetch pct horizons จาก Binance + auto-finalize แถวที่ครบเวลา\n" +
          "3) Recompute outcome ทุกแถวจาก pct (1H→pct24h · 1D→pct7d) — ทับของเดิม โดยไม่สนใจ pending guard\n\n" +
          "อาจใช้เวลาหลายวินาทีขึ้นกับจำนวนแถว",
      )
    ) {
      return;
    }
    setBackfillBusy(true);
    setBackfillMsg(null);
    try {
      const res = (await api("/reversal-stats/backfill", { method: "POST" })) as unknown as {
        ok?: boolean;
        updated?: number;
        scanned?: number;
        changedOutcome?: number;
        removedDupes?: number;
      };
      const updated = typeof res?.updated === "number" ? res.updated : 0;
      const scanned = typeof res?.scanned === "number" ? res.scanned : 0;
      const changedOutcome = typeof res?.changedOutcome === "number" ? res.changedOutcome : 0;
      const removedDupes = typeof res?.removedDupes === "number" ? res.removedDupes : 0;
      setBackfillMsg({
        kind: "ok",
        text: `ปรับเสร็จ — ลบซ้ำ ${removedDupes} · backfill ${updated} แถว · สแกน ${scanned} · เปลี่ยน outcome ${changedOutcome}`,
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
        "ล้างสถิติ Reversal ทั้งหมด?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้ — แถวในตารางจะหายจนมีสัญญาณใหม่",
      )
    ) {
      return;
    }
    setResetBusy(true);
    setResetError(null);
    try {
      await api("/reversal-stats", { method: "POST" });
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
            <p>โหลดสถิติ Reversal ไม่สำเร็จ: {e instanceof Error ? e.message : String(e)}</p>,
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
        <h1 className="sparkStatsMatrixSectionTitle">สถิติ Reversal</h1>
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
        สถิติ Reversal
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          1D + 1H Short/Long · โดจิ · ทุบ · แดงยาว · เขียวยาว
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
            title="Refetch pct จาก Binance + recompute outcome ทุกแถวจาก horizon pct (1H→pct24h · 1D→pct7d) — ข้าม pending guard"
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

      <ReversalStatsSection
        tf="1d"
        title="สถิติ Reversal · 1D"
        subtitle="Day candle · follow-up 1d / 3d / 7d (ผลที่ 7d)"
        emptyHint="ยังไม่มีแถว 1D — รอสัญญาณ Reversal ส่งสำเร็จ (CANDLE_REVERSAL_1D_ALERTS_ENABLED)"
        footnote={`${CANDLE_REVERSAL_MODEL_SHORT_LEGEND} · ${FOOTNOTE_1D}`}
        csvPrefix="reversal-stats-1d"
        rows={dayRows}
      />

      <ReversalStatsSection
        tf="1h"
        title="สถิติ Reversal · 1H Short"
        subtitle="Short · follow-up 4h / 12h / 24h / 48h (ผลที่ 24h)"
        emptyHint="ยังไม่มีแถว 1H Short — รอสัญญาณ Reversal ส่งสำเร็จ (CANDLE_REVERSAL_1H_ALERTS_ENABLED)"
        footnote={`${CANDLE_REVERSAL_MODEL_SHORT_LEGEND} · ${FOOTNOTE_1H_SHORT}`}
        csvPrefix="reversal-stats-1h-short"
        csvQuery="&side=short"
        rows={hourShortRows}
      />

      <ReversalStatsSection
        tf="1h"
        title="สถิติ Reversal · Long 1H"
        subtitle="Long · แท่งเขียวยาว + low ต่ำสุด 24 แท่ง · follow-up 4h/12h/24h/48h (ผลที่ 24h)"
        emptyHint="ยังไม่มีแถว Long 1H — รอสัญญาณ Reversal Long ส่งสำเร็จ (CANDLE_REVERSAL_1H_LONG_ALERTS_ENABLED)"
        footnote={`${CANDLE_REVERSAL_MODEL_SHORT_LEGEND} · ${FOOTNOTE_1H_LONG}`}
        csvPrefix="reversal-stats-1h-long"
        csvQuery="&side=long"
        rows={hourLongRows}
        showHighRank={false}
        showLowRank
      />
    </div>
  );
}
