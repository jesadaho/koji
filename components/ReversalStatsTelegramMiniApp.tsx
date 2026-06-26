"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MiniAppMainNav } from "@/components/MiniAppMainNav";
import { MiniAppStatsNav } from "@/components/MiniAppStatsNav";
import { PendingConflictBadge } from "@/components/PendingConflictBadge";
import { ObserveBadge } from "@/components/ObserveBadge";
import { StatsStrategyProfitCell } from "@/components/StatsStrategyProfitCell";
import { StatsMonthPager } from "@/components/StatsMonthPager";
import {
  StatsSplitByWeekCheckbox,
  StatsWeekSectionTitle,
  StatsWeekSplitHint,
  StatsWeekStrategyProfitBlock,
} from "@/components/StatsWeekGroupUi";
import { useStatsMonthFilter } from "@/lib/useStatsMonthFilter";
import { groupRowsByBkkWeek, statsRowAlertedAtMs } from "@/lib/autoOpenWeekGroup";
import { excludePendingConflictRows } from "@/lib/signalPendingConflict";
import { excludeObserveStatsRows, reversalStatsObserveBadgeTitle, reversalStatsRowIsObserve } from "@/lib/reversalStatsPlayMode";
import {
  reversalStatsPriceDiffFromPrevLabel,
  reversalStatsWeeklyAlertNoLabel,
} from "@/lib/reversalStatsWeeklyAlert";
import { statsAtrPct14dLabel } from "@/lib/statsAtrPct14d";
import { statsLenPercentileLabel } from "@/lib/statsLenPercentile";
import {
  pumpCycleAgeHoursLabel,
  pumpCycleSwingLowSourceLabel,
  pumpCycleSwingLowTimeIso,
  pumpCycleTrendGainPctLabel,
  pumpCycleTrendVelocityLabel,
} from "@/lib/pumpCycleSwingLow";
import {
  statsPsar4hDistPctLabel,
  statsPsar4hTrendLabel,
} from "@/lib/statsPsar4h";
import { resolveReversalStatsRowLeverage } from "@/lib/reversalLongDynamicLeverage";
import {
  STATS_STRATEGY_PROFIT_COLUMN_TITLE,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
  formatStatsStrategyProfitSummaryText,
  statsStrategyProfitColumnTitle,
  summarizeStatsStrategyProfit,
  type StatsStrategyProfitRowSlice,
} from "@/lib/statsStrategyProfitClient";
import {
  reversalStatsStrategyProfitLongResolvedForCell,
  reversalStatsStrategyProfitLongResolvedForHorizon,
  reversalStatsStrategyProfitResolvedForHorizon,
} from "@/lib/reversalTpStrategy";
import {
  getTelegramInitData,
  loadTelegramWebApp,
  prepareTelegramMiniAppShell,
} from "@/lib/kojiTelegramWebApp";
import {
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
  snowballStatsBarRangePctLabel,
} from "@/lib/snowballStatsClient";
import {
  candleReversalDayOfWeekBkk,
  candleReversalEma1hSlopeLabel,
  candleReversalEma20_4hSlopeLabel,
  candleReversalEma4hSlopeLabel,
  candleReversalEma1dSlopeLabel,
  candleReversalPriceVsEma20_1hLabel,
  candleReversalPriceVsEma20_4hLabel,
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
  reversalBarRangePctSignalResolved,
  sortCandleReversalStatsRows,
  candleReversalSignalVolVsSmaLabel,
  candleReversalVolScoreLabel,
  candleReversalWickRatioPctLabel,
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
import {
  clearStatsClientStaleCache,
  formatStatsStaleCacheAge,
  readStatsClientStaleCache,
  writeStatsClientStaleCache,
} from "@/lib/statsClientStaleCache";
import { copyCsvToClipboard, downloadCsv, statsCsvFilename } from "@/lib/statsCsv";
import {
  buildReversalStatsCsvSearchParams,
  BTC_EMA4H_FILTER_OPTIONS,
  REVERSAL_DAY_FILTER_OPTIONS,
  REVERSAL_DOW_FILTER_OPTIONS,
  REVERSAL_LEN_RANK_FILTER_OPTIONS,
  reversalBtcEma4hFilterTitle,
  reversalDayFilterLabel,
  reversalDowFilterLabel,
  REVERSAL_EMA4H_FILTER_OPTIONS,
  REVERSAL_EMA1H_FILTER_OPTIONS,
  REVERSAL_EMA1D_FILTER_OPTIONS,
  reversalEma4hFilterLabel,
  reversalEma1hFilterLabel,
  reversalEma1hFilterTitle,
  reversalEma1dFilterLabel,
  reversalEma1dFilterTitle,
  reversalLenRankFilterLabel,
  REVERSAL_BAR_RANGE_SIGNAL_FILTER_OPTIONS,
  REVERSAL_OBSERVE_FILTER_OPTIONS,
  reversalBarRangeSignalFilterLabel,
  reversalBarRangeSignalFilterTitle,
  reversalObserveFilterDetail,
  reversalObserveFilterLabel,
  reversalObserveFilterTitle,
  reversalRowMatchesAtrPct14dFilter,
  reversalRowMatchesBarRangeSignalFilter,
  reversalRowMatchesBtcEma4hFilter,
  reversalRowMatchesDayFilter,
  reversalRowMatchesDowFilter,
  reversalRowMatchesEma1hFilter,
  reversalRowMatchesEma1dFilter,
  reversalRowMatchesLenRankFilter,
  reversalRowMatchesShapeFilter,
  reversalRowMatchesVolVsSmaFilter,
  reversalStatsRowMatchesObserveFilter,
  reversalShapeFilterLabel,
  STATS_ATR_PCT14D_FILTER_OPTIONS,
  statsAtrPct14dFilterLabel,
  statsAtrPct14dFilterTitle,
  type BtcEma4hFilter,
  type StatsAtrPct14dFilter,
  type ReversalBarRangeSignalFilter,
  type ReversalDayFilter,
  type ReversalDowFilter,
  type ReversalEma1hFilter,
  type ReversalEma1dFilter,
  type ReversalLenRankFilter,
  type ReversalObserveFilter,
  type ReversalShapeFilter,
  type ReversalStatsFilterQuery,
} from "@/lib/candleReversalStatsFilters";
import {
  REVERSAL_LONG_CANDIDATE_CRITERIA,
  REVERSAL_MATRIX_FILTER_OPTIONS,
  REVERSAL_SUGGESTED_SIDE_FILTER_OPTIONS,
  reversalLongCandidateDebugTitle,
  reversalMatrixFilterLabel,
  reversalMatrixFilterTitle,
  reversalRowIsLongCandidate,
  reversalRowMatchesSuggestedSideFilter,
  reversalStatsPlaySidesLabel,
  reversalStatsPlaySubtitle,
  reversalStatsDefaultSuggestedSideFilter,
  reversalStatsPlaySidesFromSettings,
  reversalStatsRowMatchesMatrixFilter,
  reversalSuggestedSideFilterLabel,
  reversalSuggestedSideFilterTitle,
  reversalSuggestedTradeSideLabel,
  type ReversalMatrixFilter,
  type ReversalQualitySignalProfile,
  type ReversalStatsPlaySides,
  type ReversalStatsPlaySide,
  type ReversalSuggestedSideFilter,
} from "@/lib/reversalMatrixFilters";
import { REVERSAL_TP_STRATEGY_SUMMARY } from "@/lib/reversalTpStrategy";
import {
  SNOWBALL_TREND_GAIN_FILTER_OPTIONS,
  snowballTrendGainFilterLabel,
  snowballTrendGainFilterTitle,
  snowballStatsRowMatchesTrendGainFilter,
  type SnowballTrendGainFilter,
} from "@/lib/snowballTrendGainFilter";
import {
  SNOWBALL_TREND_VELOCITY_FILTER_OPTIONS,
  snowballTrendVelocityFilterLabel,
  snowballTrendVelocityFilterTitle,
  snowballStatsRowMatchesTrendVelocityFilter,
  type SnowballTrendVelocityFilter,
} from "@/lib/snowballTrendVelocityFilter";

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const FOOTNOTE_1D =
  "Binance USDT-M · Short bias · 1D: follow-up 1d/3d/7d (ปิด Day) · ผลที่ 7d · ไม่ส่ง Telegram follow-up";
const FOOTNOTE_1H_SHORT =
  `Binance USDT-M · Short · 1H: follow-up 4h/12h/24h/48h (ปิด 15m) · MFE แท่ง 1H · ผลที่ 24h · winrate แยก 12h/24h/48h · ทิศแนะนำ Long: ${REVERSAL_LONG_CANDIDATE_CRITERIA} · ไม่ส่ง Telegram follow-up`;

const FOOTNOTE_1H_LONG =
  "Binance USDT-M · สัญญาณ Long · วัดผล fade SHORT · 1H follow-up 4h/12h/24h/48h (ปิด 15m) · MFE/Max DD/Adv max ฝั่ง Short · ผลที่ 24h · winrate/กำไรกลยุทธ์ อิงทิศ SHORT · ไม่ส่ง Telegram follow-up";

type ReversalStatsTabId = "1d" | "1h-short" | "1h-long";

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

type ReversalVolVsSmaFilter = StatsVolVsSmaFilter;

function parseSideFromCsvQuery(csvQuery: string): "long" | "short" | undefined {
  const m = csvQuery.match(/(?:^|&)side=(long|short)/i);
  if (!m) return undefined;
  const s = m[1]!.toLowerCase();
  return s === "long" || s === "short" ? s : undefined;
}

function reversalWinrateSummary(rows: CandleReversalStatsRow[]): string {
  const scoped = excludeObserveStatsRows(excludePendingConflictRows(rows));
  const done = scoped.filter((r) => r.outcome !== "pending");
  const wins = done.filter((r) => r.outcome === "win").length;
  const losses = done.filter((r) => r.outcome === "loss").length;
  const decisive = wins + losses;
  const flats = done.length - decisive;
  const pending = scoped.length - done.length;

  const pendingTag = pending > 0 ? ` · Pending ${pending}` : "";
  const flatTag = flats > 0 ? ` +${flats}f` : "";

  if (decisive === 0) {
    if (flats > 0) {
      return `Winrate: — (0/0${flatTag}) · ปิดผล ${done.length}/${scoped.length}${pendingTag}`;
    }
    return `Winrate: — · ปิดผล 0/${scoped.length}${pendingTag}`;
  }
  const winrate = (wins / decisive) * 100;
  return `Winrate: ${winrate.toFixed(1)}% (${wins}/${decisive}${flatTag}) · ปิดผล ${done.length}/${scoped.length}${pendingTag}`;
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
  strategyPlanTitle?: string;
  strategyMarginUsdt?: number | null;
  strategyLeverage?: number | null;
  strategyLongDynamicLeverageEnabled?: boolean;
  strategyTpSlPlan?: import("@/lib/tpSlStrategySimulate").StatsTpSlPlan;
  /** เกณฑ์ ✨ Quality Signal ในตารางนี้ (ค่าเริ่มต้น = Short) */
  qualitySignalProfile?: ReversalQualitySignalProfile;
  /** tooltip คอลัมน์ผล */
  outcomeColumnTitle?: string;
  /** คอลัมน์ทิศแนะนำ + ตัวกรอง Long candidate (ตาราง 1H Short) */
  showSuggestedSideColumn?: boolean;
  /** ทิศที่เล่น — จาก Settings */
  statsPlaySides?: ReversalStatsPlaySides;
  /** อยู่ในแท็บย่อย — ไม่เว้น margin ด้านบน */
  embedded?: boolean;
};

function ReversalStatsSection({
  tf,
  title,
  subtitle,
  emptyHint,
  footnote,
  csvPrefix,
  csvQuery = "",
  qualitySignalProfile = "short",
  rows: rawRows,
  showHighRank = true,
  showLowRank = false,
  adverseTitle,
  strategyPlanTitle = REVERSAL_TP_STRATEGY_SUMMARY,
  strategyMarginUsdt,
  strategyLeverage,
  strategyLongDynamicLeverageEnabled = false,
  strategyTpSlPlan,
  outcomeColumnTitle,
  showSuggestedSideColumn = false,
  statsPlaySides = { short: true, long: false },
  embedded = false,
}: ReversalStatsSectionProps) {
  const resolveRowLeverage = useCallback(
    (row: Pick<CandleReversalStatsRow, "tradeSide" | "atrPct14d">) =>
      resolveReversalStatsRowLeverage({
        tradeSide: row.tradeSide ?? "short",
        baseLeverage: strategyLeverage,
        dynamicLeverageEnabled: strategyLongDynamicLeverageEnabled,
        atrPct14d: row.atrPct14d,
      }),
    [strategyLeverage, strategyLongDynamicLeverageEnabled],
  );
  const resolveLongRowLeverage = useCallback(
    (row: Pick<CandleReversalStatsRow, "atrPct14d">) =>
      resolveReversalStatsRowLeverage({
        tradeSide: "long",
        baseLeverage: strategyLeverage,
        dynamicLeverageEnabled: strategyLongDynamicLeverageEnabled,
        atrPct14d: row.atrPct14d,
      }),
    [strategyLeverage, strategyLongDynamicLeverageEnabled],
  );
  const strategySizing = useMemo(
    () => ({
      marginUsdt: strategyMarginUsdt,
      leverage: strategyLeverage,
      leverageForRow: strategyLongDynamicLeverageEnabled
        ? (row: StatsStrategyProfitRowSlice) => resolveRowLeverage(row as CandleReversalStatsRow)
        : undefined,
    }),
    [strategyMarginUsdt, strategyLeverage, strategyLongDynamicLeverageEnabled, resolveRowLeverage],
  );
  const longStrategySizing = useMemo(
    () => ({
      marginUsdt: strategyMarginUsdt,
      leverage: strategyLeverage,
      leverageForRow: strategyLongDynamicLeverageEnabled
        ? (row: StatsStrategyProfitRowSlice) => resolveLongRowLeverage(row as CandleReversalStatsRow)
        : undefined,
    }),
    [strategyMarginUsdt, strategyLeverage, strategyLongDynamicLeverageEnabled, resolveLongRowLeverage],
  );
  const [sort, setSort] = useState<CandleReversalStatsSort>(CANDLE_REVERSAL_STATS_DEFAULT_SORT);
  const [shapeFilter, setShapeFilter] = useState<ReversalShapeFilter>("all");
  const [dayFilter, setDayFilter] = useState<ReversalDayFilter>("all");
  const [dowFilter, setDowFilter] = useState<ReversalDowFilter>("all");
  const [lenRankFilter, setLenRankFilter] = useState<ReversalLenRankFilter>("all");
  const [volVsSmaFilter, setVolVsSmaFilter] = useState<ReversalVolVsSmaFilter>("all");
  const [matrixFilter, setMatrixFilter] = useState<ReversalMatrixFilter>("all");
  const [observeFilter, setObserveFilter] = useState<ReversalObserveFilter>("all");
  const [ema1hFilter, setEma1hFilter] = useState<ReversalEma1hFilter>("all");
  const [ema1dFilter, setEma1dFilter] = useState<ReversalEma1dFilter>("all");
  const [btcEma4hFilter, setBtcEma4hFilter] = useState<BtcEma4hFilter>("all");
  const [atrFilter, setAtrFilter] = useState<StatsAtrPct14dFilter>("all");
  const [barRangeSignalFilter, setBarRangeSignalFilter] =
    useState<ReversalBarRangeSignalFilter>("all");
  const [trendGainFilter, setTrendGainFilter] = useState<SnowballTrendGainFilter>("all");
  const [trendVelocityFilter, setTrendVelocityFilter] = useState<SnowballTrendVelocityFilter>("all");
  const [suggestedSideFilter, setSuggestedSideFilter] = useState<ReversalSuggestedSideFilter>(
    () => reversalStatsDefaultSuggestedSideFilter(statsPlaySides),
  );
  useEffect(() => {
    setSuggestedSideFilter(reversalStatsDefaultSuggestedSideFilter(statsPlaySides));
  }, [statsPlaySides]);
  const showPumpCycleFilters = qualitySignalProfile === "long1h";

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
          reversalRowMatchesDowFilter(r, dowFilter) &&
          reversalRowMatchesLenRankFilter(r, lenRankFilter) &&
          reversalRowMatchesVolVsSmaFilter(r, volVsSmaFilter) &&
          reversalRowMatchesEma1hFilter(r, ema1hFilter) &&
          reversalRowMatchesEma1dFilter(r, ema1dFilter) &&
          reversalRowMatchesBtcEma4hFilter(r, btcEma4hFilter) &&
          reversalRowMatchesAtrPct14dFilter(r, atrFilter) &&
          reversalRowMatchesBarRangeSignalFilter(r, barRangeSignalFilter) &&
          reversalStatsRowMatchesMatrixFilter(r, matrixFilter) &&
          reversalStatsRowMatchesObserveFilter(r, observeFilter) &&
          (!showSuggestedSideColumn || reversalRowMatchesSuggestedSideFilter(r, suggestedSideFilter)) &&
          (!showPumpCycleFilters || snowballStatsRowMatchesTrendGainFilter(r, trendGainFilter)) &&
          (!showPumpCycleFilters || snowballStatsRowMatchesTrendVelocityFilter(r, trendVelocityFilter)),
      ),
    [rawRows, shapeFilter, dayFilter, dowFilter, lenRankFilter, volVsSmaFilter, ema1hFilter, ema1dFilter, btcEma4hFilter, atrFilter, barRangeSignalFilter, matrixFilter, observeFilter, showSuggestedSideColumn, suggestedSideFilter, showPumpCycleFilters, trendGainFilter, trendVelocityFilter],
  );
  const { monthFilter, setMonthFilter, monthKeys, scopedRows } = useStatsMonthFilter(
    filteredRows,
    statsRowAlertedAtMs,
  );
  const rows = useMemo(() => sortCandleReversalStatsRows(scopedRows, sort), [scopedRows, sort]);
  const playScopedRows = useMemo(
    () => excludeObserveStatsRows(excludePendingConflictRows(scopedRows)),
    [scopedRows],
  );
  const strategyProfitScopedRows = useMemo(
    () => (observeFilter === "observe" ? scopedRows : playScopedRows),
    [observeFilter, playScopedRows, scopedRows],
  );
  const [splitByWeek, setSplitByWeek] = useState(false);
  const weekGroups = useMemo(
    () => groupRowsByBkkWeek(scopedRows, statsRowAlertedAtMs),
    [scopedRows],
  );
  const winrateText = useMemo(() => reversalWinrateSummary(scopedRows), [scopedRows]);
  const horizonWinrateText = useMemo(
    () =>
      tf === "1h"
        ? candleReversalHorizonWinrateSummary(playScopedRows, [
            { label: "12h", pctKey: "pct12h" },
            { label: "24h", pctKey: "pct24h" },
            { label: "48h", pctKey: "pct48h" },
          ])
        : null,
    [playScopedRows, tf],
  );
  const strategyProfitSummaryText48h = useMemo(() => {
    if (tf !== "1h") return null;
    return formatStatsStrategyProfitSummaryText(
      summarizeStatsStrategyProfit(
        strategyProfitScopedRows,
        strategySizing,
        STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
        STATS_STRATEGY_PROFIT_HOLD_48H,
        reversalStatsStrategyProfitResolvedForHorizon,
      ),
      STATS_STRATEGY_PROFIT_HOLD_48H,
      { strategyLabel: showSuggestedSideColumn ? "กลยุทธ์ Short" : "กลยุทธ์" },
    );
  }, [strategyProfitScopedRows, strategySizing, tf, showSuggestedSideColumn]);

  const strategyProfitSummaryText24h = useMemo(() => {
    if (tf !== "1h") return null;
    return formatStatsStrategyProfitSummaryText(
      summarizeStatsStrategyProfit(
        strategyProfitScopedRows,
        strategySizing,
        STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
        STATS_STRATEGY_PROFIT_HOLD_24H,
        reversalStatsStrategyProfitResolvedForHorizon,
      ),
      STATS_STRATEGY_PROFIT_HOLD_24H,
      { strategyLabel: showSuggestedSideColumn ? "กลยุทธ์ Short" : "กลยุทธ์" },
    );
  }, [strategyProfitScopedRows, strategySizing, tf, showSuggestedSideColumn]);

  const longCandidateRows = useMemo(
    () =>
      showSuggestedSideColumn ? strategyProfitScopedRows.filter(reversalRowIsLongCandidate) : [],
    [strategyProfitScopedRows, showSuggestedSideColumn],
  );

  const strategyProfitLongSummaryText48h = useMemo(() => {
    if (tf !== "1h" || !showSuggestedSideColumn) return null;
    return formatStatsStrategyProfitSummaryText(
      summarizeStatsStrategyProfit(
        longCandidateRows,
        longStrategySizing,
        STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
        STATS_STRATEGY_PROFIT_HOLD_48H,
        reversalStatsStrategyProfitLongResolvedForHorizon,
      ),
      STATS_STRATEGY_PROFIT_HOLD_48H,
      { strategyLabel: "กลยุทธ์ Long" },
    );
  }, [longCandidateRows, longStrategySizing, tf, showSuggestedSideColumn]);

  const strategyProfitLongSummaryText24h = useMemo(() => {
    if (tf !== "1h" || !showSuggestedSideColumn) return null;
    return formatStatsStrategyProfitSummaryText(
      summarizeStatsStrategyProfit(
        longCandidateRows,
        longStrategySizing,
        STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND,
        STATS_STRATEGY_PROFIT_HOLD_24H,
        reversalStatsStrategyProfitLongResolvedForHorizon,
      ),
      STATS_STRATEGY_PROFIT_HOLD_24H,
      { strategyLabel: "กลยุทธ์ Long" },
    );
  }, [longCandidateRows, longStrategySizing, tf, showSuggestedSideColumn]);

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
  const playingLongOnly = showSuggestedSideColumn && statsPlaySides.long && !statsPlaySides.short;
  const has48h = tf === "1h";
  const extraRankCols = (showHighRank ? 1 : 0) + (showLowRank ? 1 : 0);
  const emptyColSpan = (has48h ? 26 : 23) + extraRankCols + 22 + (showSuggestedSideColumn ? 3 : 0);
  const followUpAdverseTitle =
    adverseTitle ??
    (showLowRank
      ? "Max adverse ตลอดช่วง follow-up (long: low ต่ำสุดจาก entry)"
      : "Max adverse ตลอดช่วง follow-up (short: high สูงสุดจาก entry)");

  const exportFilterQuery = useMemo((): ReversalStatsFilterQuery => {
    const side = parseSideFromCsvQuery(csvQuery);
    return {
      tf,
      ...(side ? { side } : {}),
      days: dayFilter,
      dow: dowFilter,
      shape: shapeFilter,
      lenRank: lenRankFilter,
      vol: volVsSmaFilter,
      ema1h: ema1hFilter,
      ema1d: ema1dFilter,
      btcEma4h: btcEma4hFilter,
      atr: atrFilter,
      rSignal: barRangeSignalFilter,
      matrix: matrixFilter,
      observe: observeFilter,
    };
  }, [csvQuery, dayFilter, dowFilter, ema1hFilter, ema1dFilter, btcEma4hFilter, atrFilter, barRangeSignalFilter, lenRankFilter, matrixFilter, observeFilter, shapeFilter, tf, volVsSmaFilter]);

  const exportCsv = useCallback(async () => {
    if (rows.length === 0) {
      window.alert("ยังไม่มีแถวให้ export");
      return;
    }
    const csv = candleReversalStatsToCsv(rows, strategySizing);
    await downloadCsv(statsCsvFilename(csvPrefix), csv, {
      telegramExportPath: `/api/tma/reversal-stats.csv${buildReversalStatsCsvSearchParams(exportFilterQuery)}`,
      preferClientCsvInTma: true,
      stagedReversalFilters: exportFilterQuery,
    });
  }, [csvPrefix, exportFilterQuery, rows, strategySizing]);

  const copyCsv = useCallback(async () => {
    if (rows.length === 0) {
      window.alert("ยังไม่มีแถวให้คัดลอก");
      return;
    }
    await copyCsvToClipboard(candleReversalStatsToCsv(rows, strategySizing));
  }, [rows, strategySizing]);

  const renderTable = (tableRows: CandleReversalStatsRow[]) => (
    <div className="sparkMatrixScroll">
      <table className="sparkMatrixTable sparkMatrixTable--compact">
        <thead>
          <tr>
            <SortTh label="เหรียญ" sortKey="symbol" activeSort={sort} onSort={onSortColumn} />
            {showSuggestedSideColumn ? (
              <th
                scope="col"
                title={`ทิศแนะนำจากเกณฑ์ Long candidate — ${REVERSAL_LONG_CANDIDATE_CRITERIA}`}
              >
                ทิศแนะนำ
              </th>
            ) : null}
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
            <th
              scope="col"
              title="เขียวตามวันปฏิทิน BKK (เพื่อให้ตรงกับกราฟผู้ใช้) — แท่ง Day1 เขียวติดก่อนวันสัญญาณ"
            >
              เขียว(BKK)
            </th>
            <SortTh label="วัน" sortKey="day" title="วันในสัปดาห์ (BKK)" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="เวลา" sortKey="time" title="เวลาแจ้ง (BKK)" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="#/สั."
              sortKey="weeklyAlertNo"
              title="ลำดับการแจ้งในรอบสัปดาห์ BKK (symbol+TF+side)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Δ ครั้งก่อน"
              sortKey="priceDiffPrev"
              title="(Entry − entry ครั้งก่อน) / entry ครั้งก่อน × 100 — symbol+TF+side"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="Entry" sortKey="entry" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="SL Time"
              sortKey="swingLowTime"
              title="Swing Low Time — เวลาเปิดแท่ง 1H ของจุดเริ่มรอบปั๊ม"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="SL Price"
              sortKey="swingLowPrice"
              title="Swing Low Price — ราคา Low ของแท่ง 1H"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Age(h)"
              sortKey="ageOfTrend"
              title="Age of Trend (Hours) — จาก Swing Low ถึงปิดแท่งสัญญาณ (Entry)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Trend%"
              sortKey="trendGain"
              title="Trend Gain % — (Entry − Swing Low) / Swing Low × 100"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="Vel"
              sortKey="trendVelocity"
              title="Trend Velocity — Trend Gain % ÷ Age of Trend (Hours) (%/h)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="SL Src"
              sortKey="swingLowSource"
              title="Swing Low Source — STRICT_20 / FALLBACK_10 / LOWEST_7D / LOWEST_72H / NOT_FOUND"
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
              label="EMA20∠1h"
              sortKey="ema1h"
              title="EMA20 1h slope % ย้อนหลัง 7 วัน (168 แท่ง)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="EMA20Δ1h"
              sortKey="ema20_1hDist"
              title="(close − EMA20) / EMA20 × 100 บน 1h — บวก = เหนือเส้น"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="EMA20∠4h"
              sortKey="ema20_4h"
              title="EMA20 4h slope % ย้อนหลัง 7 วัน (42 แท่ง)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="EMA20Δ4h"
              sortKey="ema20_4hDist"
              title="(close − EMA20) / EMA20 × 100 บน 4h — บวก = เหนือเส้น"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="EMA1d∠7d"
              sortKey="ema1d"
              title="EMA(12) 1d slope % ย้อนหลัง 7 แท่ง — (EMAวันนี้−EMA7แท่งก่อน)/EMA7แท่งก่อน×100"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="BTC EMA20∠4h"
              sortKey="btcEma4h"
              title="BTC EMA20 4h slope % ย้อนหลัง 7 วัน (42 แท่ง)"
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
              title="Parabolic SAR 4h ของคู่สัญญาณ — ↑ = bullish · ↓ = bearish"
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
              label="ATR%14D"
              sortKey="atr14d"
              title="Wilder ATR(14) บนแท่ง 1d ÷ close × 100 — สูง = แกว่งเร็วข้ามเหรียญ"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="Retest" sortKey="retest" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="SL" sortKey="sl" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="ไส้บน%"
              sortKey="wickPct"
              title="Short: ไส้บน ÷ ช่วงแท่ง · Long: —"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh
              label="ไส้ล่าง%"
              sortKey="lowerWickPct"
              title="Short: ไส้ล่าง ÷ ช่วงแท่ง · Long: ไส้ล่าง (wick หลัก)"
              activeSort={sort}
              onSort={onSortColumn}
            />
            <SortTh label="เนื้อ%" sortKey="bodyPct" title="เนื้อ ÷ ช่วงแท่ง" activeSort={sort} onSort={onSortColumn} />
            <SortTh
              label="Len#"
              sortKey="rangeRank"
              title="อันดับความยาวแท่ง (high-low) ในรอบ lookback"
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
            <SortTh
              label="R% สัญญาณ"
              sortKey="barRangeSignal"
              title="(High − Low) / Close × 100 ของแท่งสัญญาณ"
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
                title="อันดับ low ในรอบ lookback"
                activeSort={sort}
                onSort={onSortColumn}
              />
            ) : null}
            <SortTh label="Range" sortKey="range" title="ช่วงแท่ง ÷ ATR100" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="Wick" sortKey="wick" title="ไส้ ÷ ATR100" activeSort={sort} onSort={onSortColumn} />
            {horizonLabels[0] ? (
              <SortTh
                label={horizonLabels[0]!}
                sortKey="h1"
                title={horizonTitles[0] ?? undefined}
                activeSort={sort}
                onSort={onSortColumn}
              />
            ) : null}
            {horizonLabels[1] ? (
              <SortTh
                label={horizonLabels[1]!}
                sortKey="h2"
                title={horizonTitles[1] ?? undefined}
                activeSort={sort}
                onSort={onSortColumn}
              />
            ) : null}
            {horizonLabels[2] ? (
              <SortTh
                label={horizonLabels[2]!}
                sortKey="h3"
                title={horizonTitles[2] ?? undefined}
                activeSort={sort}
                onSort={onSortColumn}
              />
            ) : null}
            {horizonLabels[3] && has48h ? (
              <SortTh
                label={horizonLabels[3]!}
                sortKey="h4"
                title={horizonTitles[3] ?? undefined}
                activeSort={sort}
                onSort={onSortColumn}
              />
            ) : null}
            <SortTh label="Max ROI" sortKey="roi" title="Max favorable excursion" activeSort={sort} onSort={onSortColumn} />
            <SortTh label="Max DD" sortKey="dd" title="Max drawdown ถึง MFE" activeSort={sort} onSort={onSortColumn} />
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
            {has48h ? (
              <th
                scope="col"
                title={
                  showSuggestedSideColumn
                    ? `กำไรกลยุทธ์ฝั่ง Short (สัญญาณจริง) — ${REVERSAL_TP_STRATEGY_SUMMARY}`
                    : REVERSAL_TP_STRATEGY_SUMMARY
                }
              >
                {showSuggestedSideColumn ? "กำไร Short 24h" : "กำไรกลยุทธ์ 24h"}
              </th>
            ) : null}
            {has48h ? (
              <th
                scope="col"
                title={
                  showSuggestedSideColumn
                    ? `กำไรกลยุทธ์ฝั่ง Short (สัญญาณจริง) — ${strategyPlanTitle}`
                    : strategyPlanTitle
                }
              >
                {showSuggestedSideColumn ? "กำไร Short 48h" : "กำไรกลยุทธ์ 48h"}
              </th>
            ) : null}
            {has48h && showSuggestedSideColumn ? (
              <th
                scope="col"
                title={`กำไรกลยุทธ์ฝั่ง Long (fade) — แถว 🟢 Long เท่านั้น · ${REVERSAL_TP_STRATEGY_SUMMARY}`}
              >
                กำไร Long 24h
              </th>
            ) : null}
            {has48h && showSuggestedSideColumn ? (
              <th
                scope="col"
                title={`กำไรกลยุทธ์ฝั่ง Long (fade) — แถว 🟢 Long เท่านั้น · ${strategyPlanTitle}`}
              >
                กำไร Long 48h
              </th>
            ) : null}
            <SortTh
              label="ผล"
              sortKey="outcome"
              title={
                outcomeColumnTitle ??
                (tf === "1h"
                  ? "ผลที่ 24h (ปิดเร็ว) · winrate ราย horizon ดูด้านบน"
                  : "ผลหลังครบ horizon")
              }
              activeSort={sort}
              onSort={onSortColumn}
            />
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 ? (
            <tr>
              <td colSpan={emptyColSpan} className="sub">
                {rawRows.length > 0
                  ? `ไม่มีแถวที่ตรงตัวกรอง — ${reversalDayFilterLabel(dayFilter)} · วัน ${reversalDowFilterLabel(dowFilter)} · ${reversalShapeFilterLabel(shapeFilter)} · Len# ${reversalLenRankFilterLabel(lenRankFilter)} · Vol×SMA ${statsVolVsSmaFilterLabel(volVsSmaFilter)} · EMA20∠1h ${reversalEma1hFilterLabel(ema1hFilter)} · EMA1d ${reversalEma1dFilterLabel(ema1dFilter)} · BTC EMA20∠4h ${reversalEma4hFilterLabel(btcEma4hFilter)} · ATR ${statsAtrPct14dFilterLabel(atrFilter)} · R% ${reversalBarRangeSignalFilterLabel(barRangeSignalFilter)}${showPumpCycleFilters ? ` · Trend Gain ${snowballTrendGainFilterLabel(trendGainFilter)} · Velocity ${snowballTrendVelocityFilterLabel(trendVelocityFilter)}` : ""}${showSuggestedSideColumn && suggestedSideFilter !== "all" ? ` · ทิศแนะนำ ${reversalSuggestedSideFilterLabel(suggestedSideFilter)}` : ""} · Matrix ${reversalMatrixFilterLabel(matrixFilter)} · Observe ${reversalObserveFilterLabel(observeFilter)}`
                  : emptyHint}
              </td>
            </tr>
          ) : (
            tableRows.map((r) => {
              const horizons = reversalHorizonCells(r);
              return (
                <tr key={r.id}>
                  <td>
                    {coinLabel(r.symbol)}
                    {reversalStatsRowIsObserve(r) ? (
                      <ObserveBadge title={reversalStatsObserveBadgeTitle(r)} />
                    ) : null}
                    <PendingConflictBadge conflictWith={r.conflictWith} />
                  </td>
                  {showSuggestedSideColumn ? (
                    <td
                      title={
                        reversalRowIsLongCandidate(r)
                          ? `Long candidate — ${REVERSAL_LONG_CANDIDATE_CRITERIA}`
                          : `แนะนำ Short — ${reversalLongCandidateDebugTitle(r)}`
                      }
                    >
                      {reversalSuggestedTradeSideLabel(r)}
                    </td>
                  ) : null}
                  <td title={candleReversalModelLabel(r.model)}>
                    {candleReversalModelShortLabel(r.model)}
                  </td>
                  <td title="แท่ง Day1 เขียวติดก่อนสัญญาณ">
                    {candleReversalGreenDaysLabel(r.greenDaysBeforeSignal)}
                  </td>
                  <td title="เขียวตามวันปฏิทิน BKK (เพื่อให้ตรงกับกราฟผู้ใช้)">
                    {candleReversalGreenDaysLabel(r.greenDaysBeforeSignalBkk)}
                  </td>
                  <td>{candleReversalDayOfWeekBkk(r.alertedAtIso, r.alertedAtMs)}</td>
                  <td>
                    <span style={{ whiteSpace: "nowrap" }}>{formatBkk(r.alertedAtIso)}</span>
                  </td>
                  <td title="ลำดับการแจ้งในรอบสัปดาห์ BKK">
                    {reversalStatsWeeklyAlertNoLabel(r.weeklyAlertNo)}
                  </td>
                  <td title="Entry diff จากครั้งก่อน (symbol+TF+side)">
                    {reversalStatsPriceDiffFromPrevLabel(r.priceDiffFromPrevAlertPct)}
                  </td>
                  <td>{fmtPrice(r.entryPrice)}</td>
                  <td>
                    {(() => {
                      const iso = pumpCycleSwingLowTimeIso(r.swingLowOpenSec);
                      return iso ? formatBkk(iso) : "—";
                    })()}
                  </td>
                  <td>{fmtPrice(r.swingLowPrice)}</td>
                  <td>{pumpCycleAgeHoursLabel(r.ageOfTrendHours)}</td>
                  <td>{pumpCycleTrendGainPctLabel(r.trendGainPct)}</td>
                  <td title="Trend Gain % ÷ Age of Trend (Hours)">
                    {pumpCycleTrendVelocityLabel(r.trendGainPct, r.ageOfTrendHours)}
                  </td>
                  <td>{pumpCycleSwingLowSourceLabel(r.swingLowSource)}</td>
                  <td>{snowballStatsQuoteVol24hLabel(r.quoteVol24hUsdt)}</td>
                  <td>{snowballStatsMarketCapUsdLabel(r.marketCapUsd)}</td>
                  <td title="EMA20 1h slope 7d">{candleReversalEma1hSlopeLabel(r.ema20_1hSlopePct7d)}</td>
                  <td title="(close − EMA20) / EMA20 × 100 บน 1h">{candleReversalPriceVsEma20_1hLabel(r.priceVsEma20_1hPct)}</td>
                  <td title="EMA20 4h slope 7d">{candleReversalEma20_4hSlopeLabel(r.ema20_4hSlopePct7d)}</td>
                  <td title="(close − EMA20) / EMA20 × 100 บน 4h">{candleReversalPriceVsEma20_4hLabel(r.priceVsEma20_4hPct)}</td>
                  <td title="EMA(12) 1d slope 7d">{candleReversalEma1dSlopeLabel(r.ema1dSlopePct7d)}</td>
                  <td title="BTC EMA20 4h slope 7d">{candleReversalEma4hSlopeLabel(r.btcEma20_4hSlopePct7d)}</td>
                  <td title="BTC EMA(12) 1d slope 7d">{candleReversalEma1dSlopeLabel(r.btcEma1dSlopePct7d)}</td>
                  <td title="PSAR 4h trend">{statsPsar4hTrendLabel(r.psar4hTrend)}</td>
                  <td title="PSAR 4h distance">{statsPsar4hDistPctLabel(r.psar4hDistPct)}</td>
                  <td title="ATR(14) 1d ÷ close">{statsAtrPct14dLabel(r.atrPct14d)}</td>
                  <td>{fmtPrice(r.retestPrice)}</td>
                  <td>{fmtPrice(r.slPrice)}</td>
                  <td title="ไส้บน (Short)">
                    {(r.tradeSide ?? "short") === "short"
                      ? candleReversalWickRatioPctLabel(r.wickRatioPct)
                      : "—"}
                  </td>
                  <td title={(r.tradeSide ?? "short") === "short" ? "ไส้ล่าง (Short)" : "ไส้ล่าง (Long)"}>
                    {(r.tradeSide ?? "short") === "short"
                      ? candleReversalWickRatioPctLabel(r.lowerWickRatioPct)
                      : candleReversalWickRatioPctLabel(r.wickRatioPct)}
                  </td>
                  <td>{r.bodyPct != null ? `${r.bodyPct.toFixed(1)}%` : "—"}</td>
                  <td>{candleReversalLookbackRankCell(r.rangeRankInLookback, r.lookbackBars)}</td>
                  <td title="Len percentile">{statsLenPercentileLabel(r.lenPercentilePct)}</td>
                  <td title="(High − Low) / Close × 100">
                    {snowballStatsBarRangePctLabel(reversalBarRangePctSignalResolved(r))}
                  </td>
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
                  {has48h ? (
                    <>
                      <td>
                        <StatsStrategyProfitCell
                          holdHours={STATS_STRATEGY_PROFIT_HOLD_24H}
                          pct24h={r.pct24h}
                          pct48h={r.pct48h}
                          strategyProfitPct24h={r.strategyProfitPct24h}
                          strategyExitReason24h={r.strategyExitReason24h}
                          marginUsdt={strategyMarginUsdt}
                          leverage={resolveRowLeverage(r)}
                          tpSlPlan={strategyTpSlPlan}
                          maxDrawdownPct={r.maxDrawdownPct}
                          followUpMaxAdversePct={r.followUpMaxAdversePct}
                          resolveProfit={reversalStatsStrategyProfitResolvedForHorizon}
                        />
                      </td>
                      <td>
                        <StatsStrategyProfitCell
                          holdHours={STATS_STRATEGY_PROFIT_HOLD_48H}
                          pct24h={r.pct24h}
                          pct48h={r.pct48h}
                          strategyProfitPct={r.strategyProfitPct}
                          strategyExitReason={r.strategyExitReason}
                          marginUsdt={strategyMarginUsdt}
                          leverage={resolveRowLeverage(r)}
                          tpSlPlan={strategyTpSlPlan}
                          maxDrawdownPct={r.maxDrawdownPct}
                          followUpMaxAdversePct={r.followUpMaxAdversePct}
                          resolveProfit={reversalStatsStrategyProfitResolvedForHorizon}
                        />
                      </td>
                      {showSuggestedSideColumn ? (
                        <td>
                          {reversalRowIsLongCandidate(r) ? (
                            <StatsStrategyProfitCell
                              holdHours={STATS_STRATEGY_PROFIT_HOLD_24H}
                              pct24h={r.pct24h}
                              pct48h={r.pct48h}
                              strategyProfitPct24h={r.strategyProfitPctLong24h}
                              strategyExitReason24h={r.strategyExitReasonLong24h}
                              marginUsdt={strategyMarginUsdt}
                              leverage={resolveLongRowLeverage(r)}
                              tpSlPlan={strategyTpSlPlan}
                              maxDrawdownPct={r.maxDrawdownPct}
                              followUpMaxAdversePct={r.followUpMaxAdversePct}
                              resolveProfit={reversalStatsStrategyProfitLongResolvedForCell}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                      {showSuggestedSideColumn ? (
                        <td>
                          {reversalRowIsLongCandidate(r) ? (
                            <StatsStrategyProfitCell
                              holdHours={STATS_STRATEGY_PROFIT_HOLD_48H}
                              pct24h={r.pct24h}
                              pct48h={r.pct48h}
                              strategyProfitPct={r.strategyProfitPctLong}
                              strategyExitReason={r.strategyExitReasonLong}
                              marginUsdt={strategyMarginUsdt}
                              leverage={resolveLongRowLeverage(r)}
                              tpSlPlan={strategyTpSlPlan}
                              maxDrawdownPct={r.maxDrawdownPct}
                              followUpMaxAdversePct={r.followUpMaxAdversePct}
                              resolveProfit={reversalStatsStrategyProfitLongResolvedForCell}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                    </>
                  ) : null}
                  <td>{candleReversalOutcomeLabel(r.outcome)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <section
      className="sparkStatsMatrixSection"
      style={{ marginTop: embedded ? 0 : "1.5rem" }}
    >
      <h2 className="sparkStatsMatrixSectionTitle" style={{ marginTop: 0 }}>
        {title}
        <span
          className="tmaTabEn"
          style={{ display: "block", fontWeight: "normal", marginTop: "0.15rem" }}
        >
          {subtitle}
        </span>
        {showSuggestedSideColumn ? (
          <span
            className="tmaTabEn"
            style={{
              display: "block",
              fontWeight: playingLongOnly ? 600 : "normal",
              marginTop: "0.15rem",
              color: playingLongOnly ? "var(--accent, #2e7d32)" : undefined,
            }}
            title="ตั้งค่าได้ที่ Settings → Reversal TP/SL"
          >
            ทิศที่เล่น: {reversalStatsPlaySidesLabel(statsPlaySides)}
          </span>
        ) : null}
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
          วัน
          <select
            value={dowFilter}
            onChange={(e) => setDowFilter(e.currentTarget.value as ReversalDowFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "7rem" }}
            title="วันในสัปดาห์ที่ส่งสัญญาณ (อิง BKK timezone)"
          >
            {REVERSAL_DOW_FILTER_OPTIONS.map((opt) => (
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
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          EMA20∠1h
          <select
            value={ema1hFilter}
            onChange={(e) => setEma1hFilter(e.currentTarget.value as ReversalEma1hFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "5.5rem" }}
            title={reversalEma1hFilterTitle(ema1hFilter)}
          >
            {REVERSAL_EMA1H_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
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
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          BTC EMA20∠4h
          <select
            value={btcEma4hFilter}
            onChange={(e) => setBtcEma4hFilter(e.currentTarget.value as BtcEma4hFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "5.5rem" }}
            title={reversalBtcEma4hFilterTitle(btcEma4hFilter)}
          >
            {BTC_EMA4H_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          R% สัญญาณ
          <select
            value={barRangeSignalFilter}
            onChange={(e) =>
              setBarRangeSignalFilter(e.currentTarget.value as ReversalBarRangeSignalFilter)
            }
            className="tmaInput"
            style={{ width: "auto", minWidth: "7rem" }}
            title={reversalBarRangeSignalFilterTitle(barRangeSignalFilter)}
          >
            {REVERSAL_BAR_RANGE_SIGNAL_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          ATR%14D
          <select
            value={atrFilter}
            onChange={(e) => setAtrFilter(e.currentTarget.value as StatsAtrPct14dFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "5.5rem" }}
            title={statsAtrPct14dFilterTitle(atrFilter)}
          >
            {STATS_ATR_PCT14D_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {showPumpCycleFilters ? (
          <>
            <label
              className="sub"
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              Trend Gain
              <select
                value={trendGainFilter}
                onChange={(e) => setTrendGainFilter(e.currentTarget.value as SnowballTrendGainFilter)}
                className="tmaInput"
                style={{ width: "auto", minWidth: "7rem" }}
                title={snowballTrendGainFilterTitle(trendGainFilter)}
              >
                {SNOWBALL_TREND_GAIN_FILTER_OPTIONS.map((opt) => (
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
              Velocity
              <select
                value={trendVelocityFilter}
                onChange={(e) =>
                  setTrendVelocityFilter(e.currentTarget.value as SnowballTrendVelocityFilter)
                }
                className="tmaInput"
                style={{ width: "auto", minWidth: "7.5rem" }}
                title={snowballTrendVelocityFilterTitle(trendVelocityFilter)}
              >
                {SNOWBALL_TREND_VELOCITY_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {showSuggestedSideColumn ? (
          <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            ทิศแนะนำ
            <select
              value={suggestedSideFilter}
              onChange={(e) =>
                setSuggestedSideFilter(e.currentTarget.value as ReversalSuggestedSideFilter)
              }
              className="tmaInput"
              style={{ width: "auto", minWidth: "8rem" }}
              title={reversalSuggestedSideFilterTitle(suggestedSideFilter)}
            >
              {REVERSAL_SUGGESTED_SIDE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          Observe
          <select
            value={observeFilter}
            onChange={(e) => setObserveFilter(e.currentTarget.value as ReversalObserveFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "8rem" }}
            title={reversalObserveFilterTitle(observeFilter)}
          >
            {REVERSAL_OBSERVE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          Matrix
          <select
            value={matrixFilter}
            onChange={(e) => setMatrixFilter(e.currentTarget.value as ReversalMatrixFilter)}
            className="tmaInput"
            style={{ width: "auto", minWidth: "10rem" }}
            title={reversalMatrixFilterTitle(matrixFilter, qualitySignalProfile)}
          >
            {REVERSAL_MATRIX_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <StatsMonthPager
          monthKeys={monthKeys}
          value={monthFilter}
          onChange={setMonthFilter}
        />
        <StatsSplitByWeekCheckbox checked={splitByWeek} onChange={setSplitByWeek} />
        {observeFilter !== "all" ? (
          <p
            className="sub"
            style={{ width: "100%", margin: 0 }}
            title={reversalObserveFilterDetail(observeFilter) ?? reversalObserveFilterTitle(observeFilter)}
          >
            {reversalObserveFilterDetail(observeFilter) ?? reversalObserveFilterTitle(observeFilter)}
          </p>
        ) : null}
        {barRangeSignalFilter === "lt3" ? (
          <p
            className="sub"
            style={{ width: "100%", margin: 0 }}
            title={reversalBarRangeSignalFilterTitle(barRangeSignalFilter)}
          >
            {reversalBarRangeSignalFilterTitle(barRangeSignalFilter)}
          </p>
        ) : null}
        {matrixFilter !== "all" ? (
          <p
            className="sub"
            style={{ width: "100%", margin: 0 }}
            title={reversalMatrixFilterTitle(matrixFilter, qualitySignalProfile)}
          >
            {reversalMatrixFilterTitle(matrixFilter, qualitySignalProfile)}
          </p>
        ) : null}
        {showSuggestedSideColumn && suggestedSideFilter !== "all" ? (
          <p
            className="sub"
            style={{ width: "100%", margin: 0 }}
            title={reversalSuggestedSideFilterTitle(suggestedSideFilter)}
          >
            {reversalSuggestedSideFilterTitle(suggestedSideFilter)}
          </p>
        ) : null}
        <span className="sub">
          แสดง {scopedRows.length}/{filteredRows.length}
          {filteredRows.length !== rawRows.length ? ` (รวม ${rawRows.length})` : ""} · {winrateText}
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
        <StatsWeekSplitHint splitByWeek={splitByWeek}>
          {strategyProfitSummaryText24h ||
          strategyProfitSummaryText48h ||
          strategyProfitLongSummaryText24h ||
          strategyProfitLongSummaryText48h ? (
            <>
              {playingLongOnly ? (
                <>
                  {strategyProfitLongSummaryText24h ? (
                    <span
                      className="sub"
                      title="สรุปคอลัมน์กำไร Long 24h — เฉพาะแถว 🟢 Long · ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR"
                      style={{ display: "block", marginTop: "0.15rem", fontWeight: 600 }}
                    >
                      {strategyProfitLongSummaryText24h}
                    </span>
                  ) : null}
                  {strategyProfitLongSummaryText48h ? (
                    <span
                      className="sub"
                      title="สรุปคอลัมน์กำไร Long 48h — เฉพาะแถว 🟢 Long · ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR"
                      style={{ display: "block", marginTop: "0.15rem", fontWeight: 600 }}
                    >
                      {strategyProfitLongSummaryText48h}
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  {strategyProfitSummaryText24h ? (
                    <span
                      className="sub"
                      title="สรุปคอลัมน์กำไรกลยุทธ์ Short 24h — ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR (Win ≥ +2% · Loss ≤ −2%)"
                      style={{ display: "block", marginTop: "0.15rem", fontWeight: 600 }}
                    >
                      {strategyProfitSummaryText24h}
                    </span>
                  ) : null}
                  {strategyProfitSummaryText48h ? (
                    <span
                      className="sub"
                      title="สรุปคอลัมน์กำไรกลยุทธ์ Short 48h — ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR (Win ≥ +2% · Loss ≤ −2%)"
                      style={{ display: "block", marginTop: "0.15rem", fontWeight: 600 }}
                    >
                      {strategyProfitSummaryText48h}
                    </span>
                  ) : null}
                  {strategyProfitLongSummaryText24h ? (
                    <span
                      className="sub"
                      title="สรุปคอลัมน์กำไร Long 24h — เฉพาะแถว 🟢 Long · ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR"
                      style={{ display: "block", marginTop: "0.15rem", fontWeight: 600 }}
                    >
                      {strategyProfitLongSummaryText24h}
                    </span>
                  ) : null}
                  {strategyProfitLongSummaryText48h ? (
                    <span
                      className="sub"
                      title="สรุปคอลัมน์กำไร Long 48h — เฉพาะแถว 🟢 Long · ชนะ/แพ้/เสมอ ใช้เกณฑ์เดียวกับ WR"
                      style={{ display: "block", marginTop: "0.15rem", fontWeight: 600 }}
                    >
                      {strategyProfitLongSummaryText48h}
                    </span>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </StatsWeekSplitHint>
      </div>
      {splitByWeek ? (
        weekGroups.length === 0 ? (
          <p className="sub" style={{ marginTop: "0.5rem" }}>
            {rawRows.length > 0
              ? "ไม่มีแถวที่ตรงตัวกรองในช่วงที่เลือก"
              : emptyHint}
          </p>
        ) : (
          weekGroups.map((g) => (
            <div key={g.weekKey} style={{ marginBottom: "1.25rem" }}>
              <StatsWeekSectionTitle
                weekLabel={g.weekLabel}
                rowCount={g.rows.length}
                extra={reversalWinrateSummary(g.rows)}
              />
              {tf === "1h" ? (
                <>
                  {playingLongOnly ? (
                    <StatsWeekStrategyProfitBlock
                      rows={g.rows.filter(reversalRowIsLongCandidate)}
                      sizing={longStrategySizing}
                      band={STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND}
                      resolveProfit={reversalStatsStrategyProfitLongResolvedForHorizon}
                      strategyLabel="กลยุทธ์ Long"
                    />
                  ) : (
                    <>
                      <StatsWeekStrategyProfitBlock
                        rows={g.rows}
                        sizing={strategySizing}
                        band={STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND}
                        resolveProfit={reversalStatsStrategyProfitResolvedForHorizon}
                        strategyLabel={showSuggestedSideColumn ? "กลยุทธ์ Short" : undefined}
                      />
                      {showSuggestedSideColumn ? (
                        <StatsWeekStrategyProfitBlock
                          rows={g.rows.filter(reversalRowIsLongCandidate)}
                          sizing={longStrategySizing}
                          band={STATS_STRATEGY_REVERSAL_WIN_LOSS_BAND}
                          resolveProfit={reversalStatsStrategyProfitLongResolvedForHorizon}
                          strategyLabel="กลยุทธ์ Long"
                        />
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
              {renderTable(sortCandleReversalStatsRows(g.rows, sort))}
            </div>
          ))
        )
      ) : (
        renderTable(rows)
      )}
      <p className="sparkStatsMatrixSectionIntro" style={{ marginTop: "0.75rem" }}>
        {footnote}
      </p>
      <p className="sparkStatsActionRow" style={{ marginTop: "0.5rem", gap: "0.5rem" }}>
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
      </p>
    </section>
  );
}

const REVERSAL_STATS_STALE_CACHE_SCOPE = "reversal-stats-v1";

function readReversalStatsStaleCache():
  | { data: CandleReversalStatsApiPayload; cachedAtMs: number }
  | null {
  if (typeof window === "undefined") return null;
  return readStatsClientStaleCache<CandleReversalStatsApiPayload>(REVERSAL_STATS_STALE_CACHE_SCOPE);
}

export default function ReversalStatsTelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>(() => (readReversalStatsStaleCache() ? "ready" : "loading"));
  const [setupBody, setSetupBody] = useState<ReactNode>(null);
  const [payload, setPayload] = useState<CandleReversalStatsApiPayload | null>(
    () => readReversalStatsStaleCache()?.data ?? null,
  );
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsCachedAtMs, setStatsCachedAtMs] = useState<number | null>(
    () => readReversalStatsStaleCache()?.cachedAtMs ?? null,
  );
  const [statsRefreshError, setStatsRefreshError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<ReversalStatsTabId>("1d");

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
    () => allRows.filter((r) => (r.signalBarTf ?? "1d") === "1h" && r.tradeSide === "long"),
    [allRows],
  );

  const viewerPlaySides = useMemo(
    () =>
      reversalStatsPlaySidesFromSettings({
        reversalStatsPlaySide: payload?.viewerReversalStatsPlaySide,
        reversalStatsPlayShortEnabled: payload?.viewerReversalStatsPlayShortEnabled,
        reversalStatsPlayLongEnabled: payload?.viewerReversalStatsPlayLongEnabled,
      }),
    [
      payload?.viewerReversalStatsPlaySide,
      payload?.viewerReversalStatsPlayShortEnabled,
      payload?.viewerReversalStatsPlayLongEnabled,
    ],
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

  const fetchStatsPayload = useCallback(async () => {
    return await api("/reversal-stats");
  }, [api]);

  const applyStatsPayload = useCallback((data: CandleReversalStatsApiPayload) => {
    setPayload(data);
    setResetError(null);
  }, []);

  const loadStats = useCallback(
    async (opts?: { mode?: "default" | "background" | "force" }) => {
      const mode = opts?.mode ?? "default";
      if (mode !== "default") setStatsRefreshing(true);

      try {
        const data = await fetchStatsPayload();
        writeStatsClientStaleCache(REVERSAL_STATS_STALE_CACHE_SCOPE, data);
        applyStatsPayload(data);
        setStatsCachedAtMs(Date.now());
        setStatsRefreshError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mode === "background" || mode === "force") {
          setStatsRefreshError(msg);
        } else {
          throw e;
        }
      } finally {
        if (mode !== "default") setStatsRefreshing(false);
      }
    },
    [applyStatsPayload, fetchStatsPayload],
  );

  const loadStatsInitial = useCallback(async () => {
    if (readReversalStatsStaleCache()) {
      await loadStats({ mode: "background" });
      return;
    }
    await loadStats({ mode: "default" });
  }, [loadStats]);

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
      await loadStats({ mode: "force" });
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
      clearStatsClientStaleCache(REVERSAL_STATS_STALE_CACHE_SCOPE);
      setStatsCachedAtMs(null);
      await loadStats({ mode: "force" });
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
        await loadStatsInitial();
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
  }, [loadStatsInitial]);

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
          แท็บ 1D · 1H Short · Long 1H (fade SHORT) · โดจิ · ทุบ · แดงยาว · เขียวยาว
        </span>
      </h1>

      <MiniAppMainNav showHome style={{ marginTop: "0.75rem" }} />
      <MiniAppStatsNav style={{ marginTop: "0.35rem" }} />

      <p className="sparkStatsActionRow" style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="sparkStatsRefreshBtn"
          disabled={statsRefreshing}
          onClick={() => void loadStats({ mode: "force" })}
        >
          {statsRefreshing ? "กำลังอัปเดต…" : "รีเฟรช"}
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
      {statsCachedAtMs != null ? (
        <p className="sub" style={{ marginTop: "0.35rem" }}>
          {statsRefreshing
            ? `แสดงข้อมูลในเครื่อง (${formatStatsStaleCacheAge(statsCachedAtMs)}) — กำลังดึงข้อมูลใหม่…`
            : `อัปเดตล่าสุด: ${formatStatsStaleCacheAge(statsCachedAtMs)}`}
        </p>
      ) : null}
      {statsRefreshError ? (
        <p className="sub" style={{ marginTop: "0.35rem", color: "var(--danger)" }}>
          อัปเดตจากเซิร์ฟเวอร์ไม่สำเร็จ (ยังแสดงข้อมูลในเครื่อง): {statsRefreshError}
        </p>
      ) : null}
      {resetError ? (
        <p className="sub" style={{ marginTop: "0.5rem", color: "var(--danger)" }}>
          {resetError}
        </p>
      ) : null}

      <div
        className="tmaTabList"
        role="tablist"
        aria-label="ตารางสถิติ Reversal"
        style={{ marginTop: "1rem" }}
      >
        <button
          type="button"
          className="tmaTab"
          id="reversal-tab-1d"
          role="tab"
          aria-selected={activeTab === "1d"}
          aria-controls="reversal-panel-1d"
          tabIndex={activeTab === "1d" ? 0 : -1}
          onClick={() => setActiveTab("1d")}
        >
          <span>1D</span>
          <span className="tmaTabEn">{dayRows.length} แถว</span>
        </button>
        <button
          type="button"
          className="tmaTab"
          id="reversal-tab-1h-short"
          role="tab"
          aria-selected={activeTab === "1h-short"}
          aria-controls="reversal-panel-1h-short"
          tabIndex={activeTab === "1h-short" ? 0 : -1}
          onClick={() => setActiveTab("1h-short")}
        >
          <span>1H Short</span>
          <span className="tmaTabEn">{hourShortRows.length} แถว</span>
        </button>
        <button
          type="button"
          className="tmaTab"
          id="reversal-tab-1h-long"
          role="tab"
          aria-selected={activeTab === "1h-long"}
          aria-controls="reversal-panel-1h-long"
          tabIndex={activeTab === "1h-long" ? 0 : -1}
          onClick={() => setActiveTab("1h-long")}
        >
          <span>Long 1H</span>
          <span className="tmaTabEn">fade SHORT · {hourLongRows.length}</span>
        </button>
      </div>

      <div
        className="tmaTabPanel"
        id="reversal-panel-1d"
        role="tabpanel"
        aria-labelledby="reversal-tab-1d"
        hidden={activeTab !== "1d"}
      >
        <ReversalStatsSection
          embedded
          tf="1d"
          title="สถิติ Reversal · 1D"
          subtitle="Day candle · follow-up 1d / 3d / 7d (ผลที่ 7d)"
          emptyHint="ยังไม่มีแถว 1D — รอสัญญาณ Reversal ส่งสำเร็จ (CANDLE_REVERSAL_1D_ALERTS_ENABLED)"
          footnote={`${CANDLE_REVERSAL_MODEL_SHORT_LEGEND} · ${FOOTNOTE_1D}`}
          csvPrefix="reversal-stats-1d"
          rows={dayRows}
        />
      </div>

      <div
        className="tmaTabPanel"
        id="reversal-panel-1h-short"
        role="tabpanel"
        aria-labelledby="reversal-tab-1h-short"
        hidden={activeTab !== "1h-short"}
      >
        <ReversalStatsSection
          embedded
          tf="1h"
          title="สถิติ Reversal · 1H Short"
          subtitle={reversalStatsPlaySubtitle(viewerPlaySides)}
          strategyPlanTitle={payload?.viewerTpSlPlanSummary ?? REVERSAL_TP_STRATEGY_SUMMARY}
          strategyMarginUsdt={payload?.viewerStrategyMarginUsdt}
          strategyLeverage={payload?.viewerStrategyLeverage}
          strategyLongDynamicLeverageEnabled={payload?.viewerStrategyLongDynamicLeverageEnabled}
          strategyTpSlPlan={payload?.viewerTpSlPlan}
          emptyHint="ยังไม่มีแถว 1H Short — รอสัญญาณ Reversal ส่งสำเร็จ (CANDLE_REVERSAL_1H_ALERTS_ENABLED)"
          footnote={`${CANDLE_REVERSAL_MODEL_SHORT_LEGEND} · ${FOOTNOTE_1H_SHORT}`}
          csvPrefix="reversal-stats-1h-short"
          csvQuery="&side=short"
          rows={hourShortRows}
          showSuggestedSideColumn
          statsPlaySides={viewerPlaySides}
        />
      </div>

      <div
        className="tmaTabPanel"
        id="reversal-panel-1h-long"
        role="tabpanel"
        aria-labelledby="reversal-tab-1h-long"
        hidden={activeTab !== "1h-long"}
      >
        <ReversalStatsSection
          embedded
          tf="1h"
          title="สถิติ Reversal · Long 1H (fade SHORT)"
          subtitle="สัญญาณ Long · วัดผลฝั่ง Short (fade) · follow-up 4h/12h/24h/48h (ผลที่ 24h)"
          strategyPlanTitle={payload?.viewerTpSlPlanSummary ?? REVERSAL_TP_STRATEGY_SUMMARY}
          strategyMarginUsdt={payload?.viewerStrategyMarginUsdt}
          strategyLeverage={payload?.viewerStrategyLeverage}
          strategyLongDynamicLeverageEnabled={payload?.viewerStrategyLongDynamicLeverageEnabled}
          strategyTpSlPlan={payload?.viewerTpSlPlan}
          emptyHint="ยังไม่มีแถว Long 1H — รอสัญญาณ Reversal Long ส่งสำเร็จ (CANDLE_REVERSAL_1H_LONG_ALERTS_ENABLED)"
          footnote={`${CANDLE_REVERSAL_MODEL_SHORT_LEGEND} · ${FOOTNOTE_1H_LONG}`}
          csvPrefix="reversal-stats-1h-long"
          csvQuery="&side=long"
          qualitySignalProfile="long1h"
          outcomeColumnTitle="ผล fade SHORT @24h (ปิดเร็ว) · winrate/กำไรกลยุทธ์ ฝั่ง Short"
          rows={hourLongRows}
          showHighRank={false}
          showLowRank
        />
      </div>
    </div>
  );
}
