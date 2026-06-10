"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppBacktestNav } from "@/components/MiniAppBacktestNav";
import { MiniAppMainNav } from "@/components/MiniAppMainNav";
import {
  filterSnowballStatsRows,
  snowballStatsEmptyFilterLabels,
  SnowballStatsFilters,
  type SnowballDowFilter,
  type SnowballGradeFilter,
  type SnowballStatsFilterState,
} from "@/components/SnowballStatsFilters";
import { SNOWBALL_HORIZON_WR, SnowballStatsSummary } from "@/components/SnowballStatsSummary";
import { SnowballStatsTable } from "@/components/SnowballStatsTable";
import {
  StatsWeekSectionTitle,
  StatsWeekStrategyProfitBlock,
} from "@/components/StatsWeekGroupUi";
import { useStatsMonthFilter } from "@/lib/useStatsMonthFilter";
import { groupRowsByBkkWeek, statsRowAlertedAtMs } from "@/lib/autoOpenWeekGroup";
import {
  runSnowballBacktestBatched,
  SNOWBALL_BACKTEST_BATCH_DELAY_SEC_OPTIONS,
  SNOWBALL_BACKTEST_BATCH_SIZE,
  SNOWBALL_BACKTEST_UNIVERSE_OPTIONS,
  SnowballBacktestApiError,
  snowballBacktestErrorHeadline,
  truncateSnowballBacktestDebugBody,
  type SnowballBacktestApiPayload,
  type SnowballBacktestBatchDelaySec,
  type SnowballBacktestUniverseSize,
} from "@/lib/snowballBacktestClient";
import {
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import type { StatsAtrPct14dFilter } from "@/lib/statsAtrPct14dFilter";
import type { BtcEma4hFilter, ReversalEma1hFilter, ReversalEma4hFilter, ReversalEma1dFilter } from "@/lib/reversalEma4hFilter";
import type { SnowballMatrixFilter } from "@/lib/snowballMatrixFilters";
import type { SnowballBtcPsarFilter } from "@/lib/snowballBtcPsarFilter";
import type { SnowballEfficiencyScoreFilter } from "@/lib/snowballEfficiencyScoreFilter";
import type { SnowballSignalMaxDdFilter } from "@/lib/snowballSignalMaxDdFilter";
import {
  STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
} from "@/lib/statsStrategyProfitClient";
import {
  SNOWBALL_STATS_DEFAULT_SORT,
  sortSnowballStatsRows,
  snowballStatsSortDefaultDir,
  snowballHorizonWinrateSummary,
  snowballGradeChecklistMark,
  snowballStatsGradeChecklist,
  snowballStatsGradeChecklistFooter,
  snowballStatsStagedPopupText,
  snowballStatsGradeDisplayLabel,
  snowballStatsGradeCellClass,
  snowballStatsSideLabel,
  type SnowballStatsRow,
  type SnowballStatsSort,
  type SnowballStatsSortKey,
} from "@/lib/snowballStatsClient";
import type {
  SnowballGreenDaysFilter,
  SnowballFundingFilter,
  SnowballSideFilter,
  SnowballVolRankFilter,
  SnowballVolVsSmaFilter,
} from "@/lib/snowballStatsClient";
import { snowballStatsToCsv } from "@/lib/snowballStatsCsvExport";
import { downloadCsv, statsCsvFilename } from "@/lib/statsCsv";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const FOOTNOTE =
  "จำลอง · ทิศ = ทิศสัญญาณ Snowball · ผล = ปิดที่ 48h (pct48h) · Grade = เกรดสุทธิ · คลิกดู HH48/VAH";

type Phase = "loading" | "setup" | "ready";

function SnowballBacktestApiDebugBlock({ error }: { error: SnowballBacktestApiError }) {
  const batch =
    error.batchIndex != null && error.batchCount != null
      ? ` · รอบ ${error.batchIndex}/${error.batchCount}`
      : "";
  return (
    <>
      <p className="sub" style={{ marginTop: "0.75rem" }}>
        <strong>
          {error.phase === "universe" ? "GET universe" : "POST backtest"}
          {error.status > 0 ? ` · HTTP ${error.status}` : " · เครือข่าย"}
          {batch}
        </strong>
      </p>
      <p className="sub" style={{ marginTop: "0.35rem" }}>
        <code style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>{error.url}</code>
      </p>
      {error.bodyText.trim() ? (
        <>
          <p className="sub" style={{ marginTop: "0.5rem" }}>
            Response body (ดิบ):
          </p>
          <pre
            style={{
              marginTop: "0.25rem",
              padding: "0.75rem",
              fontSize: "0.72rem",
              overflow: "auto",
              maxHeight: "45vh",
              background: "rgba(0,0,0,0.2)",
              borderRadius: "6px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {truncateSnowballBacktestDebugBody(error.bodyText)}
          </pre>
        </>
      ) : (
        <p className="sub" style={{ marginTop: "0.5rem" }}>
          ไม่มี response body — มักเกิดจาก timeout, server หลุด, หรือ URL/API base ผิด
          {apiBase ? "" : " (NEXT_PUBLIC_API_BASE_URL ยังว่าง)"}
        </p>
      )}
    </>
  );
}

function snowballBacktestErrorDebug(err: unknown): ReactNode {
  if (err instanceof SnowballBacktestApiError) {
    return <SnowballBacktestApiDebugBlock error={err} />;
  }
  return null;
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  return { start: isoDateLocal(start), end: isoDateLocal(end) };
}

type TmaConfig = {
  mode: string;
  botTokenConfigured: boolean;
};

export default function SnowballBacktestTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [totalSymbols, setTotalSymbols] = useState<SnowballBacktestUniverseSize>(40);
  const [batchDelaySec, setBatchDelaySec] = useState<SnowballBacktestBatchDelaySec>(30);
  const [runBusy, setRunBusy] = useState(false);
  const [runErr, setRunErr] = useState<ReactNode | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [payload, setPayload] = useState<SnowballBacktestApiPayload | null>(null);
  const [gradeDetailRow, setGradeDetailRow] = useState<SnowballStatsRow | null>(null);

  const [gradeFilter, setGradeFilter] = useState<SnowballGradeFilter>("all");
  const [sideFilter, setSideFilter] = useState<SnowballSideFilter>("all");
  const [dowFilter, setDowFilter] = useState<SnowballDowFilter>("all");
  const [volVsSmaFilter, setVolVsSmaFilter] = useState<SnowballVolVsSmaFilter>("all");
  const [efficiencyFilter, setEfficiencyFilter] = useState<SnowballEfficiencyScoreFilter>("all");
  const [signalMaxDdFilter, setSignalMaxDdFilter] = useState<SnowballSignalMaxDdFilter>("all");
  const [volRankFilter, setVolRankFilter] = useState<SnowballVolRankFilter>("all");
  const [ema1hFilter, setEma1hFilter] = useState<ReversalEma1hFilter>("all");
  const [ema4hFilter, setEma4hFilter] = useState<ReversalEma4hFilter>("all");
  const [ema1dFilter, setEma1dFilter] = useState<ReversalEma1dFilter>("all");
  const [btcEma4hFilter, setBtcEma4hFilter] = useState<BtcEma4hFilter>("all");
  const [atrFilter, setAtrFilter] = useState<StatsAtrPct14dFilter>("all");
  const [matrixFilter, setMatrixFilter] = useState<SnowballMatrixFilter>("all");
  const [fundingFilter, setFundingFilter] = useState<SnowballFundingFilter>("all");
  const [btcPsarFilter, setBtcPsarFilter] = useState<SnowballBtcPsarFilter>("all");
  const [greenDaysFilter, setGreenDaysFilter] = useState<SnowballGreenDaysFilter>("all");
  const [sort, setSort] = useState<SnowballStatsSort>(SNOWBALL_STATS_DEFAULT_SORT);
  const [splitByWeek, setSplitByWeek] = useState(false);

  const filters: SnowballStatsFilterState = useMemo(
    () => ({
      dayFilter: "all",
      sideFilter,
      gradeFilter,
      dowFilter,
      volVsSmaFilter,
      efficiencyFilter,
      signalMaxDdFilter,
      volRankFilter,
      ema1hFilter,
      ema4hFilter,
      ema1dFilter,
      btcEma4hFilter,
      atrFilter,
      matrixFilter,
      fundingFilter,
      btcPsarFilter,
      greenDaysFilter,
    }),
    [
      sideFilter,
      gradeFilter,
      dowFilter,
      volVsSmaFilter,
      efficiencyFilter,
      signalMaxDdFilter,
      volRankFilter,
      ema1hFilter,
      ema4hFilter,
      ema1dFilter,
      btcEma4hFilter,
      atrFilter,
      matrixFilter,
      fundingFilter,
      btcPsarFilter,
      greenDaysFilter,
    ],
  );

  const emptyFilterLabels = useMemo(() => snowballStatsEmptyFilterLabels(filters), [filters]);

  const onSortColumn = useCallback((key: SnowballStatsSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: snowballStatsSortDefaultDir(key) },
    );
  }, []);

  const runBacktest = useCallback(async () => {
    setRunBusy(true);
    setRunErr(null);
    const batchCount = Math.ceil(totalSymbols / SNOWBALL_BACKTEST_BATCH_SIZE);
    setRunStatus(
      batchCount > 1
        ? `กำลังรัน backtest · ${totalSymbols} เหรียญ · ${batchCount} batch`
        : "กำลังรัน backtest…",
    );
    try {
      const data = await runSnowballBacktestBatched({
        startDate,
        endDate,
        totalSymbols,
        batchDelaySec,
        onProgress: (p) => {
          if (p.phase === "running") {
            setRunStatus(
              `รอบ ${p.batchIndex}/${p.batchCount} · ${p.symbols.length} เหรียญ · สัญญาณรวม ${p.signalsSoFar}`,
            );
          } else if (p.waitSecRemaining != null) {
            setRunStatus(
              `รอ ${p.waitSecRemaining}s ก่อนรอบ ${p.batchIndex + 1}/${p.batchCount} · สัญญาณรวม ${p.signalsSoFar}`,
            );
          }
        },
      });
      setPayload(data);
      const sec = ((data.meta.elapsedMs ?? 0) / 1000).toFixed(1);
      const batchNote =
        (data.meta.batchCount ?? 1) > 1
          ? ` · ${data.meta.batchCount} batch × ${data.meta.batchSize ?? SNOWBALL_BACKTEST_BATCH_SIZE}`
          : "";
      setRunStatus(
        `เสร็จ ${sec}s${batchNote} · ${data.meta.signalCount} สัญญาณ · ${data.meta.symbols.length} เหรียญ (${data.meta.startDate} → ${data.meta.endDate})`,
      );
    } catch (e) {
      setRunErr(
        <>
          <span>{snowballBacktestErrorHeadline(e)}</span>
          {snowballBacktestErrorDebug(e)}
        </>,
      );
      setRunStatus(null);
    } finally {
      setRunBusy(false);
    }
  }, [startDate, endDate, totalSymbols, batchDelaySec]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await loadTelegramWebApp();
        prepareTelegramMiniAppShell();
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <p>โหลด Telegram Web App ไม่ได้: {e instanceof Error ? e.message : String(e)}</p>
          );
          setPhase("setup");
        }
        return;
      }

      let cfg: TmaConfig;
      try {
        const configUrl = `${apiBase}/api/tma/config`;
        const res = await fetch(configUrl);
        const text = await res.text();
        let parsed: unknown = null;
        if (text) {
          try {
            parsed = JSON.parse(text) as unknown;
          } catch {
            parsed = null;
          }
        }
        if (!res.ok) {
          if (!cancelled) {
            const errMsg =
              parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
                ? String((parsed as { error: unknown }).error)
                : res.statusText;
            setSetupBody(
              <>
                <p>โหลด config ไม่สำเร็จ: {errMsg}</p>
                <p className="sub" style={{ marginTop: "0.5rem" }}>
                  <strong>HTTP {res.status}</strong>{" "}
                  <code style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>{configUrl}</code>
                </p>
                {text.trim() ? (
                  <pre
                    style={{
                      marginTop: "0.35rem",
                      padding: "0.75rem",
                      fontSize: "0.72rem",
                      overflow: "auto",
                      maxHeight: "30vh",
                      background: "rgba(0,0,0,0.2)",
                      borderRadius: "6px",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {truncateSnowballBacktestDebugBody(text)}
                  </pre>
                ) : null}
              </>
            );
            setPhase("setup");
          }
          return;
        }
        cfg = parsed as TmaConfig;
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setSetupBody(
            <>
              <p>โหลด config ไม่ได้: {msg}</p>
              <p className="sub" style={{ marginTop: "0.5rem" }}>
                <code style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>
                  {`${apiBase}/api/tma/config`}
                </code>
              </p>
              <p className="sub" style={{ marginTop: "0.35rem" }}>
                ถ้าเห็น “Load failed” — เช็คเน็ตหรือ NEXT_PUBLIC_API_BASE_URL
                {apiBase ? "" : " (ยังไม่ได้ตั้ง)"}
              </p>
            </>
          );
          setPhase("setup");
        }
        return;
      }

      if (!cfg.botTokenConfigured) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>
                <strong>ยังไม่ตั้ง TELEGRAM_BOT_TOKEN</strong>
              </p>
              <p className="sub">ใส่ bot token ใน env เพื่อยืนยัน initData ของ Mini App</p>
            </>
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

  const allRows = payload?.rows ?? [];
  const rows = useMemo(() => filterSnowballStatsRows(allRows, filters), [allRows, filters]);
  const { monthFilter, setMonthFilter, monthKeys, scopedRows } = useStatsMonthFilter(
    rows,
    statsRowAlertedAtMs,
  );
  const sortedRows = useMemo(() => sortSnowballStatsRows(scopedRows, sort), [scopedRows, sort]);
  const weekGroups = useMemo(
    () => groupRowsByBkkWeek(scopedRows, statsRowAlertedAtMs),
    [scopedRows],
  );

  const strategySizing = useMemo(
    () => ({
      marginUsdt: payload?.viewerStrategyMarginUsdt,
      leverage: payload?.viewerStrategyLeverage,
    }),
    [payload?.viewerStrategyMarginUsdt, payload?.viewerStrategyLeverage],
  );

  const exportCsv = useCallback(async () => {
    if (scopedRows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    const prefix = payload?.meta
      ? `snowball-backtest-${payload.meta.startDate}-${payload.meta.endDate}`
      : "snowball-backtest";
    await downloadCsv(statsCsvFilename(prefix), snowballStatsToCsv(sortedRows, strategySizing), {
      preferClientCsvInTma: true,
    });
  }, [scopedRows.length, sortedRows, strategySizing, payload?.meta]);

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
        <h1 className="sparkStatsMatrixSectionTitle">
          Backtest Snowball
          <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
            จำลองสัญญาณย้อนหลัง
          </span>
        </h1>
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
        Backtest Snowball
        <span
          style={{
            marginLeft: "0.5rem",
            fontSize: "0.72rem",
            fontWeight: 600,
            padding: "0.1rem 0.45rem",
            borderRadius: "4px",
            background: "rgba(255, 180, 50, 0.2)",
            color: "#e6a817",
            verticalAlign: "middle",
          }}
        >
          จำลอง
        </span>
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          จำลองสัญญาณย้อนหลัง · Binance USDT-M
        </span>
      </h1>

      <MiniAppMainNav showHome style={{ marginTop: "0.75rem" }} />
      <MiniAppBacktestNav style={{ marginTop: "0.35rem" }} />

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2 className="sparkStatsMatrixSectionTitle" style={{ fontSize: "1rem", marginTop: 0 }}>
          รัน Backtest
        </h2>
        <div
          className="sparkStatsActionRow"
          style={{ alignItems: "flex-end", flexWrap: "wrap", rowGap: "0.5rem" }}
        >
          <label className="sub" style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
            จาก
            <input
              type="date"
              className="tmaInput"
              value={startDate}
              onChange={(e) => setStartDate(e.currentTarget.value)}
              disabled={runBusy}
            />
          </label>
          <label className="sub" style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
            ถึง
            <input
              type="date"
              className="tmaInput"
              value={endDate}
              onChange={(e) => setEndDate(e.currentTarget.value)}
              disabled={runBusy}
            />
          </label>
          <label className="sub" style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
            เหรียญรวม
            <select
              className="tmaInput"
              value={totalSymbols}
              onChange={(e) =>
                setTotalSymbols(Number(e.currentTarget.value) as SnowballBacktestUniverseSize)
              }
              disabled={runBusy}
              style={{ minWidth: "5.5rem" }}
              title="BTC + ETH + top alts จาก quote volume · เกิน 20 แบ่ง batch ละ 20"
            >
              {SNOWBALL_BACKTEST_UNIVERSE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n > SNOWBALL_BACKTEST_BATCH_SIZE
                    ? ` (${Math.ceil(n / SNOWBALL_BACKTEST_BATCH_SIZE)} batch)`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="sub" style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
            เว้นระหว่าง batch
            <select
              className="tmaInput"
              value={batchDelaySec}
              onChange={(e) =>
                setBatchDelaySec(Number(e.currentTarget.value) as SnowballBacktestBatchDelaySec)
              }
              disabled={runBusy || totalSymbols <= SNOWBALL_BACKTEST_BATCH_SIZE}
              style={{ minWidth: "5.5rem" }}
              title="หน่วงก่อนเริ่ม batch ถัดไป (ลด rate limit Binance)"
            >
              {SNOWBALL_BACKTEST_BATCH_DELAY_SEC_OPTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {sec === 0 ? "ไม่เว้น" : `${sec}s`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="sparkStatsRefreshBtn"
            disabled={runBusy}
            onClick={() => void runBacktest()}
          >
            {runBusy ? "กำลังรัน…" : "รัน Backtest"}
          </button>
        </div>
        {runStatus ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "#2a9d6a" }} role="status">
            {runStatus}
          </p>
        ) : null}
        {runErr ? (
          <div className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }} role="alert">
            {runErr}
          </div>
        ) : null}
      </section>

      {payload ? (
        <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
          <SnowballStatsFilters
            filters={filters}
            onDayFilterChange={() => {}}
            onSideFilterChange={setSideFilter}
            onGradeFilterChange={setGradeFilter}
            onDowFilterChange={setDowFilter}
            onVolVsSmaFilterChange={setVolVsSmaFilter}
            onEfficiencyFilterChange={setEfficiencyFilter}
            onSignalMaxDdFilterChange={setSignalMaxDdFilter}
            onVolRankFilterChange={setVolRankFilter}
            onEma1hFilterChange={setEma1hFilter}
            onEma4hFilterChange={setEma4hFilter}
            onEma1dFilterChange={setEma1dFilter}
            onBtcEma4hFilterChange={setBtcEma4hFilter}
            onAtrFilterChange={setAtrFilter}
            onMatrixFilterChange={setMatrixFilter}
            onFundingFilterChange={setFundingFilter}
            onBtcPsarFilterChange={setBtcPsarFilter}
            onGreenDaysFilterChange={setGreenDaysFilter}
            monthKeys={monthKeys}
            monthFilter={monthFilter}
            onMonthFilterChange={setMonthFilter}
            splitByWeek={splitByWeek}
            onSplitByWeekChange={setSplitByWeek}
            scopedCount={scopedRows.length}
            filteredCount={rows.length}
            totalCount={allRows.length}
            showDayFilter={false}
          />
          <SnowballStatsSummary
            scopedRows={scopedRows}
            strategySizing={strategySizing}
            gradeFilter={gradeFilter}
            matrixFilter={matrixFilter}
            splitByWeek={splitByWeek}
          />
          {splitByWeek ? (
            weekGroups.length === 0 ? (
              <p className="sub" style={{ marginTop: "0.5rem" }}>
                ไม่มีแถวที่ตรงกับ filter
              </p>
            ) : (
              weekGroups.map((g) => (
                <div key={g.weekKey} style={{ marginBottom: "1.25rem" }}>
                  <StatsWeekSectionTitle
                    weekLabel={g.weekLabel}
                    rowCount={g.rows.length}
                    extra={`WR · ${snowballHorizonWinrateSummary(g.rows, SNOWBALL_HORIZON_WR)}`}
                  />
                  <StatsWeekStrategyProfitBlock
                    rows={g.rows}
                    sizing={strategySizing}
                    band={STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND}
                  />
                  <SnowballStatsTable
                    tableRows={sortSnowballStatsRows(g.rows, sort)}
                    allRowsCount={allRows.length}
                    sort={sort}
                    onSort={onSortColumn}
                    onGradeDetail={setGradeDetailRow}
                    payload={payload}
                    showDeleteColumn={false}
                    emptyFilterLabels={emptyFilterLabels}
                    emptyMessageNoRows="ไม่มีสัญญาณในช่วงที่เลือก"
                  />
                </div>
              ))
            )
          ) : (
            <SnowballStatsTable
              tableRows={sortedRows}
              allRowsCount={allRows.length}
              sort={sort}
              onSort={onSortColumn}
              onGradeDetail={setGradeDetailRow}
              payload={payload}
              showDeleteColumn={false}
              emptyFilterLabels={emptyFilterLabels}
              emptyMessageNoRows="ไม่มีสัญญาณในช่วงที่เลือก"
            />
          )}
          <p className="sparkStatsMatrixSectionIntro" style={{ marginTop: "0.75rem" }}>
            {FOOTNOTE}
          </p>
          {gradeDetailRow ? (
            <div
              className="snowGradeDetailBackdrop"
              role="presentation"
              onClick={() => setGradeDetailRow(null)}
            >
              <div
                className="snowGradeDetailCard"
                role="dialog"
                aria-labelledby="snowBacktestGradeDetailTitle"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="snowGradeDetailCard__head">
                  <h2 id="snowBacktestGradeDetailTitle" className="snowGradeDetailCard__title">
                    {gradeDetailRow.symbol} · {snowballStatsSideLabel(gradeDetailRow)}
                  </h2>
                  <button
                    type="button"
                    className="snowGradeDetailCard__close"
                    aria-label="ปิด"
                    onClick={() => setGradeDetailRow(null)}
                  >
                    ×
                  </button>
                </div>
                <p className={`snowGradeDetailCard__grade ${snowballStatsGradeCellClass(gradeDetailRow)}`}>
                  {snowballStatsGradeDisplayLabel(gradeDetailRow)}
                </p>
                {(() => {
                  const staged = snowballStatsStagedPopupText(gradeDetailRow);
                  if (staged) {
                    return <pre className="snowGradeStagedPre">{staged}</pre>;
                  }
                  return (
                    <>
                      <ol className="snowGradeChecklist">
                        {snowballStatsGradeChecklist(gradeDetailRow).map((item) => (
                          <li
                            key={item.id}
                            className={`snowGradeChecklist__item snowGradeChecklist__item--${item.status}`}
                          >
                            <span className="snowGradeChecklist__mark" aria-hidden>
                              {snowballGradeChecklistMark(item.status)}
                            </span>
                            <div className="snowGradeChecklist__body">
                              <span className="snowGradeChecklist__title">{item.title}</span>
                              <span className="snowGradeChecklist__detail">{item.detail}</span>
                            </div>
                          </li>
                        ))}
                      </ol>
                      {snowballStatsGradeChecklistFooter(gradeDetailRow).length > 0 ? (
                        <ul className="snowGradeDetailCard__list snowGradeDetailCard__list--footer">
                          {snowballStatsGradeChecklistFooter(gradeDetailRow).map((line, i) => (
                            <li key={`f-${i}-${line}`}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </div>
          ) : null}
          <p className="sparkStatsActionRow" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="sparkStatsRefreshBtn"
              disabled={scopedRows.length === 0}
              onClick={() => void exportCsv()}
            >
              Export CSV
            </button>
          </p>
        </section>
      ) : (
        <p className="sub" style={{ marginTop: "1rem" }}>
          เลือกช่วงวันที่แล้วกด รัน Backtest — ผลจะแสดงในตารางด้านล่าง
        </p>
      )}
    </div>
  );
}
