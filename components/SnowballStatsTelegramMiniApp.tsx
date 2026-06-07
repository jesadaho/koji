"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import { PendingConflictBadge } from "@/components/PendingConflictBadge";
import {
  StatsSplitByWeekCheckbox,
  StatsWeekSectionTitle,
  StatsWeekSplitHint,
  StatsWeekStrategyProfitBlock,
} from "@/components/StatsWeekGroupUi";
import { StatsStrategyProfitCell } from "@/components/StatsStrategyProfitCell";
import { groupRowsByBkkWeek, statsRowAlertedAtMs } from "@/lib/autoOpenWeekGroup";
import { candleReversalLookbackRankCell } from "@/lib/candleReversalStatsClient";
import {
  candleReversalEma4hSlopeLabel,
  candleReversalEma1dSlopeLabel,
} from "@/lib/candleReversalStatsClient";
import { statsAtrPct14dLabel } from "@/lib/statsAtrPct14d";
import { statsLenPercentileLabel } from "@/lib/statsLenPercentile";
import {
  statsPsar4hDistPctLabel,
  statsPsar4hTrendLabel,
} from "@/lib/statsPsar4h";
import {
  STATS_STRATEGY_PROFIT_COLUMN_TITLE,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
  formatStatsStrategyProfitSummaryText,
  statsStrategyProfitColumnTitle,
  summarizeStatsStrategyProfit,
} from "@/lib/statsStrategyProfitClient";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import {
  REVERSAL_EMA4H_FILTER_OPTIONS,
  REVERSAL_EMA1D_FILTER_OPTIONS,
  reversalEma4hFilterLabel,
  reversalEma4hFilterTitle,
  reversalEma1dFilterLabel,
  reversalEma1dFilterTitle,
  reversalRowMatchesEma4hFilter,
  reversalRowMatchesEma1dFilter,
  type ReversalEma4hFilter,
  type ReversalEma1dFilter,
} from "@/lib/reversalEma4hFilter";
import {
  SNOWBALL_MATRIX_FILTER_OPTIONS,
  snowballMatrixFilterLabel,
  snowballMatrixFilterTitle,
  snowballStatsRowMatchesMatrixFilter,
  type SnowballMatrixFilter,
} from "@/lib/snowballMatrixFilters";
import {
  SNOWBALL_BTC_PSAR_FILTER_OPTIONS,
  snowballBtcPsarFilterLabel,
  snowballBtcPsarFilterTitle,
  snowballStatsRowMatchesBtcPsarFilter,
  type SnowballBtcPsarFilter,
} from "@/lib/snowballBtcPsarFilter";
import {
  SNOWBALL_EFFICIENCY_SCORE_FILTER_OPTIONS,
  snowballEfficiencyScoreFilterLabel,
  snowballEfficiencyScoreFilterTitle,
  snowballStatsRowMatchesEfficiencyScoreFilter,
  type SnowballEfficiencyScoreFilter,
} from "@/lib/snowballEfficiencyScoreFilter";
import {
  SNOWBALL_SIGNAL_MAX_DD_FILTER_OPTIONS,
  snowballSignalMaxDdFilterLabel,
  snowballSignalMaxDdFilterTitle,
  snowballStatsRowMatchesSignalMaxDdFilter,
  type SnowballSignalMaxDdFilter,
} from "@/lib/snowballSignalMaxDdFilter";
import {
  snowballHorizonWinrateSummary,
  snowballStatsBarRangePctLabel,
  snowballStatsConfirmVolRankLabel,
  snowballStatsConfirmVolVsSmaLabel,
  snowballStatsEfficiencyScoreLabel,
  snowballStatsRowMatchesFundingFilter,
  snowballStatsRowMatchesGreenDaysFilter,
  snowballStatsRowMatchesVolRankFilter,
  SNOWBALL_GREEN_DAYS_FILTER_OPTIONS,
  snowballStatsGreenDaysFilterLabel,
  type SnowballGreenDaysFilter,
  snowballStatsRowMatchesVolVsSmaFilter,
  SNOWBALL_FUNDING_FILTER_OPTIONS,
  snowballStatsFundingFilterLabel,
  type SnowballFundingFilter,
  SNOWBALL_VOL_RANK_FILTER_OPTIONS,
  SNOWBALL_VOL_VS_SMA_FILTER_OPTIONS,
  snowballStatsVolRankFilterLabel,
  snowballStatsVolVsSmaFilterLabel,
  type SnowballVolRankFilter,
  snowballStatsVolVsSmaDisplay,
  type SnowballVolVsSmaFilter,
  snowballStatsDayOfWeekBkk,
  snowballStatsHorizonDue,
  snowballStatsBtcPsarCombinedLabel,
  snowballStatsGradeCellClass,
  snowballGradeChecklistMark,
  snowballStatsGradeChecklist,
  snowballStatsGradeChecklistFooter,
  snowballStatsStagedPopupText,
  snowballStatsGradeDisplayLabel,
  snowballStatsGradeMatchesFilter,
  snowballStatsGreenDaysLabel,
  snowballStatsSideLabel,
  snowballStatsFundingRateLabel,
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  snowballStatsVolScoreLabel,
  snowballStatsVolumeCascadeLabel,
  SNOWBALL_STATS_DEFAULT_SORT,
  sortSnowballStatsRows,
  snowballStatsSortDefaultDir,
  type SnowballStatsApiPayload,
  type SnowballStatsRow,
  type SnowballStatsSort,
  type SnowballStatsSortKey,
} from "@/lib/snowballStatsClient";
import { snowballStatsToCsv } from "@/lib/snowballStatsCsvExport";
import {
  marketSentimentBtcDominanceLabel,
  marketSentimentFngLabel,
  marketSentimentSentimentLabel,
  marketSentimentVolChange24hLabel,
} from "@/lib/marketSentiment";
import { copyCsvToClipboard, downloadCsv, statsCsvFilename } from "@/lib/statsCsv";
import { fundingRateVisualClass } from "@/src/marketsFormat";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const MAX_API_DEBUG_BODY = 12_000;

const FOOTNOTE =
  "ทิศ = ทิศสัญญาณ Snowball · ผล = ปิดที่ 48h (pct48h) · แจ้งซ้ำต่อเหรียญ+TF+ทิศภายใน 48h · Grade = เกรดสุทธิ · คลิกดู HH48/VAH";

const SNOWBALL_HORIZON_WR = [
  { label: "12h", pctKey: "pct12h" },
  { label: "24h", pctKey: "pct24h" },
  { label: "48h", pctKey: "pct48h" },
] as const;

type SnowballDayFilter = "all" | "7" | "30" | "90";
type SnowballGradeFilter = "all" | "A+" | "B" | "C" | "D+" | "F";
type SnowballDowFilter = "all" | "0" | "1" | "2" | "3" | "4" | "5" | "6";

const SNOWBALL_DAY_FILTER_OPTIONS: ReadonlyArray<{ value: SnowballDayFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
];

const SNOWBALL_GRADE_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballGradeFilter;
  label: string;
}> = [
  { value: "all", label: "ทุก grade" },
  { value: "A+", label: "A+" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "D+", label: "D+" },
  { value: "F", label: "F" },
];

const SNOWBALL_DOW_FILTER_OPTIONS: ReadonlyArray<{ value: SnowballDowFilter; label: string }> = [
  { value: "all", label: "ทุกวัน" },
  { value: "1", label: "จันทร์" },
  { value: "2", label: "อังคาร" },
  { value: "3", label: "พุธ" },
  { value: "4", label: "พฤหัส" },
  { value: "5", label: "ศุกร์" },
  { value: "6", label: "เสาร์" },
  { value: "0", label: "อาทิตย์" },
];

/** BKK = UTC+7 (no DST) — 0 = Sunday, 1 = Monday, ..., 6 = Saturday */
function bkkDayOfWeekIndex(ms: number): number {
  if (!Number.isFinite(ms)) return -1;
  return new Date(ms + 7 * 3600 * 1000).getUTCDay();
}

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

function fmtSnowballHorizonCell(
  row: SnowballStatsRow,
  horizonHours: number,
  price: number | null,
  pct: number | null,
): ReactNode {
  if (!snowballStatsHorizonDue(row, horizonHours)) return "-";
  return fmtPctCell(price, pct);
}

function outcomeLabel(o: SnowballStatsRow["outcome"] | "win_quick_tp30"): string {
  if (o === "pending") return "Pending";
  if (o === "win_trend" || o === "win_quick_tp30") return "Win (Trend)";
  if (o === "loss") return "Loss";
  return "Flat";
}

function sortMark(active: boolean, dir: SnowballStatsSort["dir"]): string {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

function SortTh({
  label,
  sortKey,
  title,
  className,
  activeSort,
  onSort,
}: {
  label: string;
  sortKey: SnowballStatsSortKey;
  title?: string;
  className?: string;
  activeSort: SnowballStatsSort;
  onSort: (key: SnowballStatsSortKey) => void;
}) {
  const active = activeSort.key === sortKey;
  return (
    <th
      scope="col"
      title={title ? `${title} · กดเรียง` : "กดเรียง"}
      className={`sparkStatsSortTh${active ? " sparkStatsSortTh--active" : ""}${className ? ` ${className}` : ""}`}
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
  const [gradeFilter, setGradeFilter] = useState<SnowballGradeFilter>("all");
  const [dowFilter, setDowFilter] = useState<SnowballDowFilter>("all");
  const [volVsSmaFilter, setVolVsSmaFilter] = useState<SnowballVolVsSmaFilter>("all");
  const [efficiencyFilter, setEfficiencyFilter] = useState<SnowballEfficiencyScoreFilter>("all");
  const [signalMaxDdFilter, setSignalMaxDdFilter] = useState<SnowballSignalMaxDdFilter>("all");
  const [volRankFilter, setVolRankFilter] = useState<SnowballVolRankFilter>("all");
  const [ema4hFilter, setEma4hFilter] = useState<ReversalEma4hFilter>("all");
  const [ema1dFilter, setEma1dFilter] = useState<ReversalEma1dFilter>("all");
  const [matrixFilter, setMatrixFilter] = useState<SnowballMatrixFilter>("all");
  const [fundingFilter, setFundingFilter] = useState<SnowballFundingFilter>("all");
  const [btcPsarFilter, setBtcPsarFilter] = useState<SnowballBtcPsarFilter>("all");
  const [greenDaysFilter, setGreenDaysFilter] = useState<SnowballGreenDaysFilter>("all");
  const [sort, setSort] = useState<SnowballStatsSort>(SNOWBALL_STATS_DEFAULT_SORT);

  const isAdmin = payload?.isAdmin === true;

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
      const gates = r?.followUp?.confirmGateSteps ?? 0;
      const horizons = r?.followUp?.horizonRows ?? 0;
      const strat = r?.strategyProfitEnriched ?? 0;
      const missBefore = r?.missingHorizon4hBefore ?? 0;
      const missAfter = r?.missingHorizon4hAfter ?? 0;
      setBackfillOk(
        `Backfill เสร็จ ${sec}s — อัปเดต ${dirty} แถว · EMA ${ema} · gate ${gates} · horizon ${horizons} · กำไรกลยุทธ์ ${strat} · 4h ว่าง ${missBefore}→${missAfter}`,
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

  const rows = useMemo(() => {
    let result = allRows;

    if (dayFilter !== "all") {
      const days = Number(dayFilter);
      const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
      result = result.filter((r) => {
        const ms =
          r.alertedAtMs != null && Number.isFinite(r.alertedAtMs)
            ? r.alertedAtMs
            : Date.parse(r.alertedAtIso);
        return Number.isFinite(ms) && ms >= cutoffMs;
      });
    }

    if (gradeFilter !== "all") {
      result = result.filter((r) => snowballStatsGradeMatchesFilter(r, gradeFilter));
    }

    if (dowFilter !== "all") {
      const targetDow = Number(dowFilter);
      result = result.filter((r) => {
        const ms =
          r.alertedAtMs != null && Number.isFinite(r.alertedAtMs)
            ? r.alertedAtMs
            : Date.parse(r.alertedAtIso);
        return Number.isFinite(ms) && bkkDayOfWeekIndex(ms) === targetDow;
      });
    }

    if (volVsSmaFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesVolVsSmaFilter(r, volVsSmaFilter));
    }

    if (efficiencyFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesEfficiencyScoreFilter(r, efficiencyFilter));
    }

    if (signalMaxDdFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesSignalMaxDdFilter(r, signalMaxDdFilter));
    }

    if (volRankFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesVolRankFilter(r, volRankFilter));
    }

    if (ema4hFilter !== "all") {
      result = result.filter((r) => reversalRowMatchesEma4hFilter(r, ema4hFilter));
    }

    if (ema1dFilter !== "all") {
      result = result.filter((r) => reversalRowMatchesEma1dFilter(r, ema1dFilter));
    }

    if (matrixFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesMatrixFilter(r, matrixFilter));
    }

    if (fundingFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesFundingFilter(r, fundingFilter));
    }

    if (btcPsarFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesBtcPsarFilter(r, btcPsarFilter));
    }

    if (greenDaysFilter !== "all") {
      result = result.filter((r) => snowballStatsRowMatchesGreenDaysFilter(r, greenDaysFilter));
    }

    return result;
  }, [
    allRows,
    dayFilter,
    gradeFilter,
    dowFilter,
    volVsSmaFilter,
    efficiencyFilter,
    signalMaxDdFilter,
    volRankFilter,
    ema4hFilter,
    ema1dFilter,
    matrixFilter,
    fundingFilter,
    btcPsarFilter,
    greenDaysFilter,
  ]);

  const sortedRows = useMemo(() => sortSnowballStatsRows(rows, sort), [rows, sort]);

  const [splitByWeek, setSplitByWeek] = useState(false);
  const weekGroups = useMemo(
    () => groupRowsByBkkWeek(rows, statsRowAlertedAtMs),
    [rows],
  );

  const horizonWinrateText = useMemo(
    () => snowballHorizonWinrateSummary(rows, SNOWBALL_HORIZON_WR),
    [rows],
  );

  const strategySizing = useMemo(
    () => ({
      marginUsdt: payload?.viewerStrategyMarginUsdt,
      leverage: payload?.viewerStrategyLeverage,
    }),
    [payload?.viewerStrategyMarginUsdt, payload?.viewerStrategyLeverage],
  );

  const strategyProfitSummaryText48h = useMemo(
    () =>
      formatStatsStrategyProfitSummaryText(
        summarizeStatsStrategyProfit(
          rows,
          strategySizing,
          STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
          STATS_STRATEGY_PROFIT_HOLD_48H,
        ),
        STATS_STRATEGY_PROFIT_HOLD_48H,
      ),
    [rows, strategySizing],
  );

  const strategyProfitSummaryText24h = useMemo(
    () =>
      formatStatsStrategyProfitSummaryText(
        summarizeStatsStrategyProfit(
          rows,
          strategySizing,
          STATS_STRATEGY_SNOWBALL_WIN_LOSS_BAND,
          STATS_STRATEGY_PROFIT_HOLD_24H,
        ),
        STATS_STRATEGY_PROFIT_HOLD_24H,
      ),
    [rows, strategySizing],
  );

  const exportCsv = useCallback(async () => {
    if (rows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    await downloadCsv(statsCsvFilename("snowball-stats"), snowballStatsToCsv(rows, strategySizing), {
      telegramExportPath: "/api/tma/snowball-stats.csv",
      preferClientCsvInTma: true,
    });
  }, [rows, strategySizing]);

  const copyCsv = useCallback(async () => {
    if (rows.length === 0) {
      window.alert("ยังไม่มีแถวให้คัดลอก");
      return;
    }
    await copyCsvToClipboard(snowballStatsToCsv(rows, strategySizing));
  }, [rows, strategySizing]);

  const renderTable = (tableRows: SnowballStatsRow[]) => (
    <div className="sparkMatrixScroll">
      <table className="sparkMatrixTable sparkMatrixTable--compact">
        <thead>
          <tr>
            <SortTh
              label="เหรียญ"
              sortKey="symbol"
              className="snowStatsStickyCoin"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="ทิศ" sortKey="side" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="Grade"
              sortKey="grade"
              className="snowStatsStickyGrade"
              title="เกรดสุทธิ (A+/B/C/D+/F) — คลิกดูโครงสร้าง HH48/VAH และเหตุผล"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="วัน" sortKey="day" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="เวลา (BKK)" sortKey="time" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="Entry" sortKey="entry" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="Range" sortKey="range" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="Wick" sortKey="wick" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="Len#"
              sortKey="lenRank"
              title="อันดับความยาวแท่ง (high-low) ในรอบ lookback — 1 = ยาวสุด"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Len%"
              sortKey="lenPct"
              title="Len percentile — 100% = ยาวสุดในรอบ lookback"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="R% ก่อน" sortKey="barRangePrev" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="R% สัญญาณ" sortKey="barRangeSignal" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="R% 2แท่ง" sortKey="barRange2Sum" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="BTC SAR"
              sortKey="btcPsar"
              title="BTC PSAR — แท่ง 4h และ 1h ปิดล่าสุด (Binance)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Vol 24h"
              sortKey="vol24"
              title="Quote volume 24h USDT (Binance perp · fallback MEXC amount24) ณ เวลาแจ้ง"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Mcap"
              sortKey="mcap"
              title="Market cap USD (CoinGecko) ณ เวลาแจ้ง"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="ATR%14D"
              sortKey="atr14d"
              title="Wilder ATR(14) บน 1d ÷ close × 100 — สูง = แกว่งเร็ว"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="EMA4h∠7d"
              sortKey="ema4h"
              title="EMA(12) 4h slope % ย้อนหลัง 7 วัน (42 แท่ง)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="EMA1d∠7d"
              sortKey="ema1d"
              title="EMA(12) 1d slope % ย้อนหลัง 7 แท่ง"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="BTC∠4h"
              sortKey="btcEma4h"
              title="BTC EMA(12) 4h slope % ย้อนหลัง 7 วัน (42 แท่ง)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="BTC∠1d"
              sortKey="btcEma1d"
              title="BTC EMA(12) 1d slope % ย้อนหลัง 7 แท่ง"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="SAR 4h"
              sortKey="psar4h"
              title="Parabolic SAR 4h ของคู่สัญญาณ — ↑ = bullish · ↓ = bearish (ไม่ใช่ BTC SAR)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="SAR dist%"
              sortKey="psar4hDist"
              title="(close − SAR) / close × 100 บน 4h — บวก = ราคาเหนือ SAR"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Funding"
              sortKey="funding"
              title="Funding rate สัญญา MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม ×100 = %)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Vol↗"
              sortKey="volCascade"
              title="Vol cascade — volume 5 แท่ง 1H ล่าสุด ยอมไม่ยกฐานได้ 1 ครั้ง"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="เขียว"
              sortKey="greenDays"
              title="แท่ง Day1 เขียว (close>open) ติดกันก่อนแท่งสัญญาณ Snowball"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="เขียว(BKK)"
              sortKey="greenDaysBkk"
              title="เขียวตามวันปฏิทิน BKK — แท่ง Day1 เขียวติดก่อนวันสัญญาณ"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Vol×SMA"
              sortKey="volVsSma"
              title="4h = Vol แท่งสัญญาณ ÷ SMA(4H) · อื่นๆ = 1H confirm หรือ signal"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Eff Score"
              sortKey="efficiencyScore"
              title="Efficiency Score = R% 2แท่ง ÷ Vol×SMA"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Vol rank"
              sortKey="volRank"
              title="อันดับ vol 1H จาก breakout confirm eval"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="4h" sortKey="h4" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="12h" sortKey="h12" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="24h" sortKey="h24" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="48h" sortKey="h48" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="Max ROI" sortKey="maxRoi" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="Duration→MFE" sortKey="durationMfe" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="Max DD ก่อน"
              sortKey="signalMaxDd"
              title="Max DD ก่อนแจ้ง — 15m ย้อนหลัง 32 แท่ง (8 ชม.)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Max DD หลัง"
              sortKey="maxDrawdown"
              title="Max DD หลังแจ้ง — adverse สูงสุดถึง MFE (24h)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Adv max"
              sortKey="followUpAdverse"
              title="Max adverse ตลอดช่วง follow-up 48h"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="SVP Hole" sortKey="svpHole" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="RR" sortKey="resultRr" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="F&G"
              sortKey="fng"
              title="Fear & Greed (Market Pulse snapshot ณ เวลาแจ้ง)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Sentiment"
              sortKey="sentiment"
              title="Sentiment จาก F&G — Bullish / Neutral / Bearish"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="BTC.D"
              sortKey="btcDom"
              title="BTC dominance % ณ เวลาแจ้ง"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="VolΔ24h"
              sortKey="volChange24h"
              title="การเปลี่ยนแปลง vol โดยประมาณ 24h"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="กำไรกลยุทธ์ 24h"
              sortKey="strategyProfit24h"
              title={
                payload?.viewerTpSlPlan
                  ? statsStrategyProfitColumnTitle(STATS_STRATEGY_PROFIT_HOLD_24H, payload.viewerTpSlPlan)
                  : statsStrategyProfitColumnTitle(STATS_STRATEGY_PROFIT_HOLD_24H)
              }
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="กำไรกลยุทธ์ 48h"
              sortKey="strategyProfit48h"
              title={payload?.viewerTpSlPlanSummary ?? STATS_STRATEGY_PROFIT_COLUMN_TITLE}
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="ผล @48h"
              sortKey="outcome"
              title="ปิดผลที่ 48h จาก pct48h (Win ≥ +3% · Loss ≤ -3%)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            {isAdmin ? <th scope="col" className="snowStatsDelCol" aria-label="ลบ" /> : null}
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 ? (
            <tr>
              <td colSpan={isAdmin ? 44 : 43} className="sub">
                {allRows.length === 0
                  ? "ยังไม่มีแถว — รอสัญญาณ Snowball ส่งสำเร็จและ SNOWBALL_STATS_ENABLED"
                  : `ไม่มีแถวที่ตรงกับ filter — ลองเลือก ทั้งหมด / ทุก grade / เขียว ${snowballStatsGreenDaysFilterLabel(greenDaysFilter)} / Funding ${snowballStatsFundingFilterLabel(fundingFilter)} / BTC SAR ${snowballBtcPsarFilterLabel(btcPsarFilter)} / Matrix ${snowballMatrixFilterLabel(matrixFilter)} / EMA4h ${reversalEma4hFilterLabel(ema4hFilter)} / EMA1d ${reversalEma1dFilterLabel(ema1dFilter)} / Vol×SMA ${snowballStatsVolVsSmaFilterLabel(volVsSmaFilter)} / Efficiency ${snowballEfficiencyScoreFilterLabel(efficiencyFilter)} / Max DD ก่อน ${snowballSignalMaxDdFilterLabel(signalMaxDdFilter)} / Vol rank ${snowballStatsVolRankFilterLabel(volRankFilter)}`}
              </td>
            </tr>
          ) : (
            tableRows.map((r) => (
              <tr key={r.id}>
                <td className="snowStatsStickyCoin">
                  {coinLabel(r.symbol)}
                  <PendingConflictBadge conflictWith={r.conflictWith} />
                </td>
                <td>{snowballStatsSideLabel(r)}</td>
                <td className={`snowStatsStickyGrade ${snowballStatsGradeCellClass(r)}`}>
                  <button
                    type="button"
                    className="snowGradeCellBtn"
                    title="ดูโครงสร้างและเหตุผลเกรด"
                    onClick={() => setGradeDetailRow(r)}
                  >
                    {snowballStatsGradeDisplayLabel(r)}
                  </button>
                </td>
                <td>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {snowballStatsDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs)}
                  </span>
                </td>
                <td>
                  <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                </td>
                <td>{fmtPrice(r.entryPrice)}</td>
                <td>{snowballStatsVolScoreLabel(r.rangeScore)}</td>
                <td>{snowballStatsVolScoreLabel(r.wickScore)}</td>
                <td>{candleReversalLookbackRankCell(r.rangeRankInLookback, r.lenLookbackBars)}</td>
                <td title="Len percentile">{statsLenPercentileLabel(r.lenPercentilePct)}</td>
                <td>{snowballStatsBarRangePctLabel(r.barRangePctPrev)}</td>
                <td>{snowballStatsBarRangePctLabel(r.barRangePctSignal)}</td>
                <td>{snowballStatsBarRangePctLabel(r.barRangePct2Sum)}</td>
                <td>{snowballStatsBtcPsarCombinedLabel(r.btcPsar4hTrend, r.btcPsar1hTrend)}</td>
                <td>{snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt)}</td>
                <td>{snowballStatsMarketCapUsdLabel(r.marketCapUsd)}</td>
                <td>{statsAtrPct14dLabel(r.atrPct14d)}</td>
                <td title="EMA(12) 4h slope 7d">{candleReversalEma4hSlopeLabel(r.ema4hSlopePct7d)}</td>
                <td title="EMA(12) 1d slope 7d">{candleReversalEma1dSlopeLabel(r.ema1dSlopePct7d)}</td>
                <td title="BTC EMA(12) 4h slope 7d">{candleReversalEma4hSlopeLabel(r.btcEma4hSlopePct7d)}</td>
                <td title="BTC EMA(12) 1d slope 7d">{candleReversalEma1dSlopeLabel(r.btcEma1dSlopePct7d)}</td>
                <td title="PSAR 4h trend">{statsPsar4hTrendLabel(r.psar4hTrend)}</td>
                <td title="PSAR 4h distance">{statsPsar4hDistPctLabel(r.psar4hDistPct)}</td>
                <td
                  className={
                    r.fundingRate != null && Number.isFinite(r.fundingRate)
                      ? fundingRateVisualClass(r.fundingRate)
                      : undefined
                  }
                >
                  {snowballStatsFundingRateLabel(r.fundingRate)}
                </td>
                <td>{snowballStatsVolumeCascadeLabel(r.volumeCascadeYn)}</td>
                <td>{snowballStatsGreenDaysLabel(r.greenDaysBeforeSignal)}</td>
                <td>{snowballStatsGreenDaysLabel(r.greenDaysBeforeSignalBkk)}</td>
                <td>{snowballStatsConfirmVolVsSmaLabel(snowballStatsVolVsSmaDisplay(r))}</td>
                <td title="Efficiency Score = R% 2แท่ง ÷ Vol×SMA">
                  {snowballStatsEfficiencyScoreLabel(r)}
                </td>
                <td>{snowballStatsConfirmVolRankLabel(r.confirmVolRank, r.confirmVolRankLb)}</td>
                <td>{fmtSnowballHorizonCell(r, 4, r.price4h, r.pct4h)}</td>
                <td>{fmtSnowballHorizonCell(r, 12, r.price12h, r.pct12h)}</td>
                <td>{fmtSnowballHorizonCell(r, 24, r.price24h, r.pct24h)}</td>
                <td>{fmtSnowballHorizonCell(r, 48, r.price48h, r.pct48h)}</td>
                <td>{r.maxRoiPct != null ? `${r.maxRoiPct.toFixed(2)}%` : "—"}</td>
                <td>
                  {r.durationToMfeHours != null && Number.isFinite(r.durationToMfeHours)
                    ? `${r.durationToMfeHours.toFixed(2)}h`
                    : "—"}
                </td>
                <td>
                  {r.signalMaxDdPct != null && Number.isFinite(r.signalMaxDdPct)
                    ? `${r.signalMaxDdPct.toFixed(2)}%`
                    : "—"}
                </td>
                <td>{r.maxDrawdownPct != null ? `${r.maxDrawdownPct.toFixed(2)}%` : "—"}</td>
                <td>
                  {r.followUpMaxAdversePct != null ? `${r.followUpMaxAdversePct.toFixed(2)}%` : "—"}
                </td>
                <td>{r.svpHoleYn}</td>
                <td>{r.resultRr ?? "—"}</td>
                <td>{marketSentimentFngLabel(r.marketSentiment)}</td>
                <td>{marketSentimentSentimentLabel(r.marketSentiment)}</td>
                <td>{marketSentimentBtcDominanceLabel(r.marketSentiment)}</td>
                <td>{marketSentimentVolChange24hLabel(r.marketSentiment)}</td>
                <td>
                  <StatsStrategyProfitCell
                    holdHours={STATS_STRATEGY_PROFIT_HOLD_24H}
                    pct24h={r.pct24h}
                    pct48h={r.pct48h}
                    strategyProfitPct24h={r.strategyProfitPct24h}
                    strategyExitReason24h={r.strategyExitReason24h}
                    marginUsdt={payload?.viewerStrategyMarginUsdt}
                    leverage={payload?.viewerStrategyLeverage}
                    tpSlPlan={payload?.viewerTpSlPlan}
                    maxDrawdownPct={r.maxDrawdownPct}
                    followUpMaxAdversePct={r.followUpMaxAdversePct}
                  />
                </td>
                <td>
                  <StatsStrategyProfitCell
                    holdHours={STATS_STRATEGY_PROFIT_HOLD_48H}
                    pct24h={r.pct24h}
                    pct48h={r.pct48h}
                    strategyProfitPct={r.strategyProfitPct}
                    strategyExitReason={r.strategyExitReason}
                    marginUsdt={payload?.viewerStrategyMarginUsdt}
                    leverage={payload?.viewerStrategyLeverage}
                    tpSlPlan={payload?.viewerTpSlPlan}
                    maxDrawdownPct={r.maxDrawdownPct}
                    followUpMaxAdversePct={r.followUpMaxAdversePct}
                  />
                </td>
                <td>{outcomeLabel(r.outcome)}</td>
                {isAdmin ? (
                  <td className="snowStatsDelCol">
                    <button
                      type="button"
                      className="snowStatsRowDelBtn"
                      title="ลบแถวนี้"
                      disabled={deleteBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteRow(r);
                      }}
                    >
                      ลบ
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

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

      <MiniAppStatsNav showHome style={{ marginTop: "0.75rem" }} />

      <section className="sparkStatsMatrixSection" style={{ marginTop: "1rem" }}>
        <div
          className="sparkStatsActionRow"
          style={{
            marginBottom: "0.5rem",
            alignItems: "center",
            flexWrap: "wrap",
            rowGap: "0.4rem",
          }}
        >
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            ย้อนหลัง
            <select
              value={dayFilter}
              onChange={(e) => setDayFilter(e.currentTarget.value as SnowballDayFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7rem" }}
            >
              {SNOWBALL_DAY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Grade
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.currentTarget.value as SnowballGradeFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7rem" }}
            >
              {SNOWBALL_GRADE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            วัน
            <select
              value={dowFilter}
              onChange={(e) => setDowFilter(e.currentTarget.value as SnowballDowFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7rem" }}
              title="วันในสัปดาห์ที่ส่งสัญญาณ (อิง BKK timezone)"
            >
              {SNOWBALL_DOW_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Vol×SMA
            <select
              value={volVsSmaFilter}
              onChange={(e) => setVolVsSmaFilter(e.currentTarget.value as SnowballVolVsSmaFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7.5rem" }}
              title="4h = Vol แท่งสัญญาณ ÷ SMA(4H) · อื่นๆ = 1H confirm หรือ signal"
            >
              {SNOWBALL_VOL_VS_SMA_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Efficiency
            <select
              value={efficiencyFilter}
              onChange={(e) =>
                setEfficiencyFilter(e.currentTarget.value as SnowballEfficiencyScoreFilter)
              }
              className="tmaInput"
              style={{ width: "auto", minWidth: "7rem" }}
              title={snowballEfficiencyScoreFilterTitle(efficiencyFilter)}
            >
              {SNOWBALL_EFFICIENCY_SCORE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Max DD ก่อน
            <select
              value={signalMaxDdFilter}
              onChange={(e) =>
                setSignalMaxDdFilter(e.currentTarget.value as SnowballSignalMaxDdFilter)
              }
              className="tmaInput"
              style={{ width: "auto", minWidth: "7.5rem" }}
              title={snowballSignalMaxDdFilterTitle(signalMaxDdFilter)}
            >
              {SNOWBALL_SIGNAL_MAX_DD_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Vol rank
            <select
              value={volRankFilter}
              onChange={(e) => setVolRankFilter(e.currentTarget.value as SnowballVolRankFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7.5rem" }}
              title="อันดับ vol 1H จาก breakout confirm eval — 1 = สูงสุดในรอบ lookback"
            >
              {SNOWBALL_VOL_RANK_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            EMA4h∠7d
            <select
              value={ema4hFilter}
              onChange={(e) => setEma4hFilter(e.currentTarget.value as ReversalEma4hFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "5.5rem" }}
              title={reversalEma4hFilterTitle(ema4hFilter)}
            >
              {REVERSAL_EMA4H_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            EMA1d∠7d
            <select
              value={ema1dFilter}
              onChange={(e) => setEma1dFilter(e.currentTarget.value as ReversalEma1dFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "5.5rem" }}
              title={reversalEma1dFilterTitle(ema1dFilter)}
            >
              {REVERSAL_EMA1D_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Funding
            <select
              value={fundingFilter}
              onChange={(e) => setFundingFilter(e.currentTarget.value as SnowballFundingFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7.5rem" }}
              title="Funding rate MEXC USDT-M ณ เวลาแจ้ง (ทศนิยม ×100 = %)"
            >
              {SNOWBALL_FUNDING_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            เขียว
            <select
              value={greenDaysFilter}
              onChange={(e) => setGreenDaysFilter(e.currentTarget.value as SnowballGreenDaysFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7rem" }}
              title="แท่ง Day1 เขียว (close>open) ติดกันก่อนแท่งสัญญาณ — ไม่นับแท่งสัญญาณ"
            >
              {SNOWBALL_GREEN_DAYS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            BTC SAR
            <select
              value={btcPsarFilter}
              onChange={(e) => setBtcPsarFilter(e.currentTarget.value as SnowballBtcPsarFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "7.5rem" }}
              title={snowballBtcPsarFilterTitle(btcPsarFilter)}
            >
              {SNOWBALL_BTC_PSAR_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="sub"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            Matrix
            <select
              value={matrixFilter}
              onChange={(e) => setMatrixFilter(e.currentTarget.value as SnowballMatrixFilter)}
              className="tmaInput"
              style={{ width: "auto", minWidth: "9rem" }}
              title={snowballMatrixFilterTitle(matrixFilter)}
            >
              {SNOWBALL_MATRIX_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <StatsSplitByWeekCheckbox checked={splitByWeek} onChange={setSplitByWeek} />
          <span className="sub">
            แสดง {rows.length}/{allRows.length}
          </span>
        </div>
        {matrixFilter !== "all" ? (
          <p className="sub" style={{ marginBottom: "0.5rem" }} title={snowballMatrixFilterTitle(matrixFilter)}>
            {snowballMatrixFilterTitle(matrixFilter)}
          </p>
        ) : null}
        <p
          className="sub"
          title="Winrate ราย horizon — คอลัมน์ผลใช้ 48h · เกณฑ์ Win ≥ +3% · Loss ≤ -3% · WR ไม่นับ flat (decisive = wins + losses), +Nf = จำนวน flat"
          style={{ marginBottom: "0.5rem" }}
        >
          WR · {horizonWinrateText}
        </p>
        <StatsWeekSplitHint splitByWeek={splitByWeek}>
          {strategyProfitSummaryText24h || strategyProfitSummaryText48h ? (
            <div style={{ marginBottom: "0.5rem" }}>
              {strategyProfitSummaryText24h ? (
                <p
                  className="sub"
                  title="สรุปคอลัมน์กำไรกลยุทธ์ 24h — ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR (Win ≥ +3% · Loss ≤ −3%)"
                  style={{ margin: "0 0 0.25rem", fontWeight: 600 }}
                >
                  {strategyProfitSummaryText24h}
                </p>
              ) : null}
              {strategyProfitSummaryText48h ? (
                <p
                  className="sub"
                  title="สรุปคอลัมน์กำไรกลยุทธ์ 48h — ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR (Win ≥ +3% · Loss ≤ −3%)"
                  style={{ margin: 0, fontWeight: 600 }}
                >
                  {strategyProfitSummaryText48h}
                </p>
              ) : null}
            </div>
          ) : null}
        </StatsWeekSplitHint>
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
                {renderTable(sortSnowballStatsRows(g.rows, sort))}
              </div>
            ))
          )
        ) : (
          renderTable(sortedRows)
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
