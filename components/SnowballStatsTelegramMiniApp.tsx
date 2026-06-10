"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppMainNav } from "@/components/MiniAppMainNav";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import {
  StatsWeekSectionTitle,
  StatsWeekSplitHint,
  StatsWeekStrategyProfitBlock,
} from "@/components/StatsWeekGroupUi";
import {
  filterSnowballStatsRows,
  snowballStatsEmptyFilterLabels,
  SnowballStatsFilters,
  type SnowballDayFilter,
  type SnowballDowFilter,
  type SnowballGradeFilter,
  type SnowballStatsFilterState,
} from "@/components/SnowballStatsFilters";
import { SNOWBALL_HORIZON_WR, SnowballStatsSummary } from "@/components/SnowballStatsSummary";
import { SnowballStatsTable } from "@/components/SnowballStatsTable";
import { useStatsMonthFilter } from "@/lib/useStatsMonthFilter";
import { groupRowsByBkkWeek, statsRowAlertedAtMs } from "@/lib/autoOpenWeekGroup";
import {
  STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
} from "@/lib/statsStrategyProfitClient";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import type { StatsAtrPct14dFilter } from "@/lib/statsAtrPct14dFilter";
import type { BtcEma4hFilter, ReversalEma1hFilter, ReversalEma4hFilter, ReversalEma1dFilter } from "@/lib/reversalEma4hFilter";
import type { SnowballMatrixFilter } from "@/lib/snowballMatrixFilters";
import type { SnowballBtcPsarFilter } from "@/lib/snowballBtcPsarFilter";
import type { SnowballStructureFilter } from "@/lib/snowballStructureFilter";
import type { SnowballEfficiencyScoreFilter } from "@/lib/snowballEfficiencyScoreFilter";
import type { SnowballSignalMaxDdFilter } from "@/lib/snowballSignalMaxDdFilter";
import type { SnowballGreenDaysFilter, SnowballFundingFilter, SnowballSideFilter, SnowballVolRankFilter, SnowballVolVsSmaFilter } from "@/lib/snowballStatsClient";
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
  type SnowballStatsApiPayload,
  type SnowballStatsRow,
  type SnowballStatsSort,
  type SnowballStatsSortKey,
} from "@/lib/snowballStatsClient";
import { snowballStatsToCsv } from "@/lib/snowballStatsCsvExport";
import { copyCsvToClipboard, downloadCsv, statsCsvFilename } from "@/lib/statsCsv";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const MAX_API_DEBUG_BODY = 12_000;

const FOOTNOTE =
  "ทิศ = ทิศสัญญาณ Snowball · ผล = ปิดที่ 48h (pct48h) · แจ้งซ้ำต่อเหรียญ+TF+ทิศภายใน 48h · Grade = เกรดสุทธิ · คลิกดู HH48/VAH";

function truncateApiBody(s: string, max = MAX_API_DEBUG_BODY): string {
  if (s.length > max) return `${s.slice(0, max)}\n\n… (ตัดเหลือ ${max} ตัวอักษร)`;
  return s;
}

class ApiRequestError extends Error {
  readonly status: number;
  readonly bodyText: string;
  readonly url: string;

  constructor(message: string, status: number, bodyText: string, url: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.bodyText = bodyText;
    this.url = url;
  }
}

async function readApiResponse(res: Response): Promise<{ text: string; parsed: unknown }> {
  const text = await res.text();
  if (!text) return { text: "", parsed: null };
  try {
    return { text, parsed: JSON.parse(text) as unknown };
  } catch {
    return { text, parsed: null };
  }
}

function messageFromParsed(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === "object" && parsed !== null && "error" in parsed) {
    return String((parsed as { error: unknown }).error);
  }
  return fallback;
}

function ApiDebugBlock({ error }: { error: ApiRequestError }) {
  return (
    <>
      <p className="sub" style={{ marginTop: "0.75rem" }}>
        <strong>HTTP {error.status}</strong>{" "}
        <code style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>{error.url}</code>
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
        {truncateApiBody(error.bodyText)}
      </pre>
    </>
  );
}

function apiDebugSection(err: unknown): ReactNode {
  if (err instanceof ApiRequestError) {
    return <ApiDebugBlock error={err} />;
  }
  return null;
}

function reloadIfUnauthorized(status: number, hadInitData: boolean): void {
  if (status !== 401 || !hadInitData) return;
  try {
    window.location.reload();
  } catch {
    /* ignore */
  }
}

type TmaConfig = {
  mode: string;
  botTokenConfigured: boolean;
};

type Phase = "loading" | "setup" | "ready";

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

export default function SnowballStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<SnowballStatsApiPayload | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [gradeDetailRow, setGradeDetailRow] = useState<SnowballStatsRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctErr, setCorrectErr] = useState<string | null>(null);
  const [correctOk, setCorrectOk] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillErr, setBackfillErr] = useState<string | null>(null);
  const [backfillOk, setBackfillOk] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<SnowballDayFilter>("all");
  const [sideFilter, setSideFilter] = useState<SnowballSideFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<SnowballGradeFilter>("all");
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
  const [structureFilter, setStructureFilter] = useState<SnowballStructureFilter>("all");
  const [greenDaysFilter, setGreenDaysFilter] = useState<SnowballGreenDaysFilter>("all");
  const [sort, setSort] = useState<SnowballStatsSort>(SNOWBALL_STATS_DEFAULT_SORT);

  const isAdmin = payload?.isAdmin === true;

  const filters: SnowballStatsFilterState = useMemo(
    () => ({
      dayFilter,
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
      structureFilter,
      greenDaysFilter,
    }),
    [
      dayFilter,
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
      structureFilter,
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

  const api = useCallback(async (path: string, opts: RequestInit = {}) => {
    const initData = getTelegramInitData();
    const headers: HeadersInit = {
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(initData ? { Authorization: `tma ${initData}` } : {}),
      ...((opts.headers as Record<string, string>) ?? {}),
    };
    const url = `${apiBase}/api/tma${path}`;
    const res = await fetch(url, { ...opts, headers });
    const { text, parsed } = await readApiResponse(res);
    if (!res.ok) {
      const msg = messageFromParsed(parsed, res.statusText);
      reloadIfUnauthorized(res.status, Boolean(initData));
      throw new ApiRequestError(msg, res.status, text, url);
    }
    return parsed;
  }, []);

  const loadStats = useCallback(async () => {
    const data = (await api("/snowball-stats")) as SnowballStatsApiPayload;
    setPayload(data);
    setLoadErr("");
    setDeleteErr(null);
    setResetErr(null);
  }, [api]);

  const deleteRow = useCallback(
    async (row: SnowballStatsRow) => {
      const label = `${coinLabel(row.symbol)} · ${snowballStatsGradeDisplayLabel(row)} · ${formatBkk(row.alertedAtIso)}`;
      if (
        !window.confirm(
          `ลบแถวสถิติ Snowball นี้?\n\n${label}\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`,
        )
      ) {
        return;
      }
      setDeleteBusy(true);
      setDeleteErr(null);
      try {
        await api(`/snowball-stats/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        setGradeDetailRow(null);
        await loadStats();
      } catch (e) {
        setDeleteErr(e instanceof Error ? e.message : String(e));
      } finally {
        setDeleteBusy(false);
      }
    },
    [api, loadStats],
  );

  const resetAllStats = useCallback(async () => {
    if (
      !window.confirm(
        "ล้างสถิติ Snowball ทั้งหมด?\n\nแถวในตารางจะหายจนมีสัญญาณใหม่ — การดำเนินการนี้ไม่สามารถย้อนกลับได้",
      )
    ) {
      return;
    }
    setResetBusy(true);
    setResetErr(null);
    try {
      await api("/snowball-stats", { method: "POST" });
      setGradeDetailRow(null);
      await loadStats();
    } catch (e) {
      setResetErr(e instanceof Error ? e.message : String(e));
    } finally {
      setResetBusy(false);
    }
  }, [api, loadStats]);

  const correctOutcomeFromPct48h = useCallback(async () => {
    if (
      !window.confirm(
        "ปรับ result ทุกแถวให้ตรงกับ pct48h?\n\nrecompute outcome/RR จากผล 48 ชม. ที่บันทึกอยู่ — ไม่ดึง Binance",
      )
    ) {
      return;
    }
    setCorrectBusy(true);
    setCorrectErr(null);
    setCorrectOk(null);
    try {
      const r = (await api("/snowball-stats/correct", { method: "POST", body: "{}" })) as {
        scanned?: number;
        changedOutcome?: number;
        changedRr?: number;
      } | null;
      const scanned = typeof r?.scanned === "number" ? r.scanned : 0;
      const changedOutcome = typeof r?.changedOutcome === "number" ? r.changedOutcome : 0;
      const changedRr = typeof r?.changedRr === "number" ? r.changedRr : 0;
      setCorrectOk(
        `ปรับ result (48h) เสร็จ — สแกน ${scanned} แถว · outcome ${changedOutcome} · RR ${changedRr}`,
      );
      await loadStats();
    } catch (e) {
      setCorrectErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCorrectBusy(false);
    }
  }, [api, loadStats]);

  const backfillStats = useCallback(async () => {
    if (
      !window.confirm(
        "Backfill สถิติ Snowball?\n\nดึง Binance — EMA slope · horizon · gate steps · กำไรกลยุทธ์ ฯลฯ\n\nอาจใช้เวลาหลายนาที",
      )
    ) {
      return;
    }
    setBackfillBusy(true);
    setBackfillErr(null);
    setBackfillOk(null);
    try {
      const r = (await api("/snowball-stats/backfill", { method: "POST", body: "{}" })) as {
        durationMs?: number;
        followUp?: {
          dirty?: number;
          emaSlopes?: number;
          trendGrades?: number;
          confirmGateSteps?: number;
          horizonRows?: number;
        };
        strategyProfitEnriched?: number;
        missingHorizon4hBefore?: number;
        missingHorizon4hAfter?: number;
      } | null;
      const sec = ((r?.durationMs ?? 0) / 1000).toFixed(1);
      const dirty = r?.followUp?.dirty ?? 0;
      const ema = r?.followUp?.emaSlopes ?? 0;
      const grades = r?.followUp?.trendGrades ?? 0;
      const gates = r?.followUp?.confirmGateSteps ?? 0;
      const horizons = r?.followUp?.horizonRows ?? 0;
      const strat = r?.strategyProfitEnriched ?? 0;
      const missBefore = r?.missingHorizon4hBefore ?? 0;
      const missAfter = r?.missingHorizon4hAfter ?? 0;
      setBackfillOk(
        `Backfill เสร็จ ${sec}s — อัปเดต ${dirty} แถว · EMA ${ema} · grade ${grades} · gate ${gates} · horizon ${horizons} · กำไรกลยุทธ์ ${strat} · 4h ว่าง ${missBefore}→${missAfter}`,
      );
      await loadStats();
    } catch (e) {
      setBackfillErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBackfillBusy(false);
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
        const { text, parsed } = await readApiResponse(res);
        if (!res.ok) {
          const msg = messageFromParsed(parsed, res.statusText);
          if (!cancelled) {
            setSetupBody(
              <>
                <p>โหลด config ไม่สำเร็จ</p>
                <p className="sub">{msg}</p>
                <ApiDebugBlock error={new ApiRequestError(msg, res.status, text, configUrl)} />
              </>
            );
            setPhase("setup");
          }
          return;
        }
        cfg = parsed as TmaConfig;
      } catch (e) {
        if (!cancelled) {
          setSetupBody(
            <>
              <p>โหลด config ไม่ได้</p>
              <p className="sub">{e instanceof Error ? e.message : String(e)}</p>
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

      try {
        await loadStats();
        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : String(e));
          setSetupBody(
            <>
              <p>โหลดสถิติ Snowball ไม่สำเร็จ</p>
              {apiDebugSection(e)}
            </>
          );
          setPhase("setup");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadStats]);

  const allRows = payload?.rows ?? [];

  const rows = useMemo(() => filterSnowballStatsRows(allRows, filters), [allRows, filters]);

  const { monthFilter, setMonthFilter, monthKeys, scopedRows } = useStatsMonthFilter(
    rows,
    statsRowAlertedAtMs,
  );

  const sortedRows = useMemo(() => sortSnowballStatsRows(scopedRows, sort), [scopedRows, sort]);

  const [splitByWeek, setSplitByWeek] = useState(false);
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
    await downloadCsv(
      statsCsvFilename("snowball-stats"),
      snowballStatsToCsv(sortedRows, strategySizing),
      {
        telegramExportPath: "/api/tma/snowball-stats.csv",
        preferClientCsvInTma: true,
      },
    );
  }, [sortedRows, strategySizing, scopedRows.length]);

  const copyCsv = useCallback(async () => {
    if (scopedRows.length === 0) {
      window.alert("ยังไม่มีแถวให้คัดลอก");
      return;
    }
    await copyCsvToClipboard(snowballStatsToCsv(sortedRows, strategySizing));
  }, [scopedRows.length, sortedRows, strategySizing]);

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
          สถิติ Snowball
          <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
            Snowball alert log
          </span>
        </h1>
        {setupBody}
        {loadErr ? <p className="sub">{loadErr}</p> : null}
        <p className="sub" style={{ marginTop: "1rem" }}>
          <Link href="/">กลับหน้าแรก</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="sparkStatsPage sparkStatsPage--wide">
      <h1 className="sparkStatsMatrixSectionTitle">
        สถิติ Snowball
        <span className="tmaTabEn" style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}>
          Triple-check log · Binance 15m
        </span>
      </h1>

      <MiniAppMainNav showHome style={{ marginTop: "0.75rem" }} />
      <MiniAppStatsNav style={{ marginTop: "0.35rem" }} />

      <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
        <SnowballStatsFilters
          filters={filters}
          onDayFilterChange={setDayFilter}
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
          onStructureFilterChange={setStructureFilter}
          onGreenDaysFilterChange={setGreenDaysFilter}
          monthKeys={monthKeys}
          monthFilter={monthFilter}
          onMonthFilterChange={setMonthFilter}
          splitByWeek={splitByWeek}
          onSplitByWeekChange={setSplitByWeek}
          scopedCount={scopedRows.length}
          filteredCount={rows.length}
          totalCount={allRows.length}
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
              {allRows.length > 0
                ? "ไม่มีแถวที่ตรงกับ filter ในช่วงที่เลือก"
                : "ยังไม่มีแถว — รอสัญญาณ Snowball ส่งสำเร็จและ SNOWBALL_STATS_ENABLED"}
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
                  isAdmin={isAdmin}
                  deleteBusy={deleteBusy}
                  onDeleteRow={deleteRow}
                  emptyFilterLabels={emptyFilterLabels}
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
            isAdmin={isAdmin}
            deleteBusy={deleteBusy}
            onDeleteRow={deleteRow}
            emptyFilterLabels={emptyFilterLabels}
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
              aria-labelledby="snowGradeDetailTitle"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="snowGradeDetailCard__head">
                <h2 id="snowGradeDetailTitle" className="snowGradeDetailCard__title">
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
                            {item.failCriteria && item.failCriteria.length > 0 ? (
                              <ul className="snowGradeChecklist__fails">
                                {item.failCriteria.map((c, j) => (
                                  <li key={`${item.id}-fail-${j}`}>{c}</li>
                                ))}
                              </ul>
                            ) : null}
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
              {isAdmin ? (
                <div className="snowGradeDetailCard__actions">
                  <button
                    type="button"
                    className="sparkStatsRefreshBtn danger"
                    disabled={deleteBusy}
                    onClick={() => void deleteRow(gradeDetailRow)}
                  >
                    {deleteBusy ? "กำลังลบ…" : "ลบแถวนี้"}
                  </button>
                </div>
              ) : null}
              {deleteErr ? (
                <p className="sub" style={{ color: "var(--danger)", marginTop: "0.5rem" }}>
                  {deleteErr}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="sparkStatsActionRow" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="sparkStatsRefreshBtn" onClick={() => void loadStats()}>
            รีเฟรช
          </button>
          <button
            type="button"
            className="sparkStatsRefreshBtn"
            disabled={rows.length === 0}
            onClick={() => void exportCsv()}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="sparkStatsRefreshBtn"
            disabled={rows.length === 0}
            onClick={() => void copyCsv()}
            title="ทางเลือกเมื่อดาวน์โหลดใน Telegram ไม่ขึ้น"
          >
            คัดลอก CSV
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="sparkStatsRefreshBtn"
              disabled={backfillBusy || allRows.length === 0}
              onClick={() => void backfillStats()}
              title="ดึง Binance — EMA · horizon · gate · กำไรกลยุทธ์ (ช้า — กดเมื่อต้องการอัปเดตข้อมูล)"
            >
              {backfillBusy ? "กำลัง backfill…" : "Backfill"}
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              className="sparkStatsRefreshBtn"
              disabled={correctBusy || allRows.length === 0}
              onClick={() => void correctOutcomeFromPct48h()}
              title="Recompute outcome/RR จาก pct48h (ผล 48 ชม.) — ไม่ดึง Binance"
            >
              {correctBusy ? "กำลังปรับ…" : "ปรับ result (48h)"}
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              className="sparkStatsRefreshBtn danger"
              disabled={resetBusy || allRows.length === 0}
              onClick={() => void resetAllStats()}
            >
              {resetBusy ? "กำลังล้าง…" : "ล้างสถิติทั้งหมด"}
            </button>
          ) : null}
        </p>
        {correctErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
            {correctErr}
          </p>
        ) : null}
        {correctOk && !correctErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "#2a9d6a" }} role="status">
            {correctOk}
          </p>
        ) : null}
        {backfillErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
            {backfillErr}
          </p>
        ) : null}
        {backfillOk && !backfillErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "#2a9d6a" }} role="status">
            {backfillOk}
          </p>
        ) : null}
        {resetErr ? (
          <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
            {resetErr}
          </p>
        ) : null}
      </section>
    </div>
  );
}
