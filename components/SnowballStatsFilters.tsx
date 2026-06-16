"use client";

import { StatsMonthPager } from "@/components/StatsMonthPager";
import { StatsSplitByWeekCheckbox } from "@/components/StatsWeekGroupUi";
import {
  STATS_ATR_PCT14D_FILTER_OPTIONS,
  statsAtrPct14dFilterLabel,
  statsAtrPct14dFilterTitle,
  statsRowMatchesAtrPct14dFilter,
  type StatsAtrPct14dFilter,
} from "@/lib/statsAtrPct14dFilter";
import {
  BTC_EMA4H_FILTER_OPTIONS,
  REVERSAL_EMA1H_FILTER_OPTIONS,
  REVERSAL_EMA4H_FILTER_OPTIONS,
  REVERSAL_EMA1D_FILTER_OPTIONS,
  reversalBtcEma4hFilterTitle,
  reversalEma1hFilterLabel,
  reversalEma1hFilterTitle,
  reversalEma4hFilterLabel,
  reversalEma4hFilterTitle,
  reversalEma1dFilterLabel,
  reversalEma1dFilterTitle,
  reversalRowMatchesBtcEma4hFilter,
  reversalRowMatchesEma1hFilter,
  reversalRowMatchesEma4hFilter,
  reversalRowMatchesEma1dFilter,
  type BtcEma4hFilter,
  type ReversalEma1hFilter,
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
  SNOWBALL_STRUCTURE_FILTER_OPTIONS,
  snowballStructureFilterLabel,
  snowballStructureFilterTitle,
  snowballStatsRowMatchesStructureFilter,
  type SnowballStructureFilter,
} from "@/lib/snowballStructureFilter";
import {
  SNOWBALL_BAR_RANGE2_FILTER_OPTIONS,
  snowballBarRange2FilterLabel,
  snowballBarRange2FilterTitle,
  snowballStatsRowMatchesBarRange2Filter,
  type SnowballBarRange2Filter,
} from "@/lib/snowballBarRange2Filter";
import {
  SNOWBALL_BAR_RANGE_PREV_FILTER_OPTIONS,
  snowballBarRangePrevFilterLabel,
  snowballBarRangePrevFilterTitle,
  snowballStatsRowMatchesBarRangePrevFilter,
  type SnowballBarRangePrevFilter,
} from "@/lib/snowballBarRangePrevFilter";
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
  snowballStatsRowMatchesFundingFilter,
  snowballStatsRowMatchesGreenDaysFilter,
  snowballStatsRowMatchesSideFilter,
  snowballStatsRowMatchesVolRankFilter,
  SNOWBALL_GREEN_DAYS_FILTER_OPTIONS,
  SNOWBALL_SIDE_FILTER_OPTIONS,
  snowballSideFilterLabel,
  snowballStatsGreenDaysFilterLabel,
  type SnowballGreenDaysFilter,
  type SnowballSideFilter,
  snowballStatsRowMatchesVolVsSmaFilter,
  SNOWBALL_FUNDING_FILTER_OPTIONS,
  snowballStatsFundingFilterLabel,
  type SnowballFundingFilter,
  SNOWBALL_VOL_RANK_FILTER_OPTIONS,
  SNOWBALL_VOL_VS_SMA_FILTER_OPTIONS,
  snowballStatsVolRankFilterLabel,
  snowballStatsVolVsSmaFilterLabel,
  type SnowballVolRankFilter,
  type SnowballVolVsSmaFilter,
  snowballStatsGradeMatchesFilter,
  type SnowballStatsRow,
} from "@/lib/snowballStatsClient";
import {
  STATS_CONFLICT_FILTER_OPTIONS,
  statsConflictFilterLabel,
  statsConflictFilterTitle,
  statsRowMatchesConflictFilter,
  type StatsConflictFilter,
} from "@/lib/signalPendingConflict";
import {
  snowballTrendGradeFilterTitle,
  type SnowballTrendGradeFilter,
} from "@/src/snowballTrendGrade";

export type SnowballDayFilter = "all" | "7" | "30" | "90";
export type SnowballGradeFilter = SnowballTrendGradeFilter;
export type SnowballDowFilter = "all" | "0" | "1" | "2" | "3" | "4" | "5" | "6";

export const SNOWBALL_DAY_FILTER_OPTIONS: ReadonlyArray<{ value: SnowballDayFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "90", label: "90 วัน" },
];

export const SNOWBALL_GRADE_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballGradeFilter;
  label: string;
}> = [
  { value: "all", label: "ทุก grade" },
  { value: "SAB", label: "S / A / B (รวม +)" },
  { value: "SABplus", label: "S+ / A+ / B+" },
  { value: "S+", label: "S+" },
  { value: "S", label: "S" },
  { value: "A+", label: "A+" },
  { value: "A", label: "A" },
  { value: "B+", label: "B+" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "F", label: "F" },
];

export const SNOWBALL_DOW_FILTER_OPTIONS: ReadonlyArray<{ value: SnowballDowFilter; label: string }> = [
  { value: "all", label: "ทุกวัน" },
  { value: "1", label: "จันทร์" },
  { value: "2", label: "อังคาร" },
  { value: "3", label: "พุธ" },
  { value: "4", label: "พฤหัส" },
  { value: "5", label: "ศุกร์" },
  { value: "6", label: "เสาร์" },
  { value: "0", label: "อาทิตย์" },
];

export type SnowballStatsFilterState = {
  dayFilter: SnowballDayFilter;
  sideFilter: SnowballSideFilter;
  gradeFilter: SnowballGradeFilter;
  dowFilter: SnowballDowFilter;
  volVsSmaFilter: SnowballVolVsSmaFilter;
  barRangePrevFilter: SnowballBarRangePrevFilter;
  barRange2Filter: SnowballBarRange2Filter;
  efficiencyFilter: SnowballEfficiencyScoreFilter;
  signalMaxDdFilter: SnowballSignalMaxDdFilter;
  volRankFilter: SnowballVolRankFilter;
  ema1hFilter: ReversalEma1hFilter;
  ema4hFilter: ReversalEma4hFilter;
  ema1dFilter: ReversalEma1dFilter;
  btcEma4hFilter: BtcEma4hFilter;
  atrFilter: StatsAtrPct14dFilter;
  matrixFilter: SnowballMatrixFilter;
  fundingFilter: SnowballFundingFilter;
  btcPsarFilter: SnowballBtcPsarFilter;
  structureFilter: SnowballStructureFilter;
  greenDaysFilter: SnowballGreenDaysFilter;
  conflictFilter: StatsConflictFilter;
};

/** BKK = UTC+7 (no DST) — 0 = Sunday, 1 = Monday, ..., 6 = Saturday */
function bkkDayOfWeekIndex(ms: number): number {
  if (!Number.isFinite(ms)) return -1;
  return new Date(ms + 7 * 3600 * 1000).getUTCDay();
}

export function filterSnowballStatsRows(
  allRows: SnowballStatsRow[],
  filters: SnowballStatsFilterState,
): SnowballStatsRow[] {
  let result = allRows;

  if (filters.dayFilter !== "all") {
    const days = Number(filters.dayFilter);
    const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
    result = result.filter((r) => {
      const ms =
        r.alertedAtMs != null && Number.isFinite(r.alertedAtMs)
          ? r.alertedAtMs
          : Date.parse(r.alertedAtIso);
      return Number.isFinite(ms) && ms >= cutoffMs;
    });
  }

  if (filters.gradeFilter !== "all") {
    result = result.filter((r) => snowballStatsGradeMatchesFilter(r, filters.gradeFilter));
  }

  if (filters.sideFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesSideFilter(r, filters.sideFilter));
  }

  if (filters.dowFilter !== "all") {
    const targetDow = Number(filters.dowFilter);
    result = result.filter((r) => {
      const ms =
        r.alertedAtMs != null && Number.isFinite(r.alertedAtMs)
          ? r.alertedAtMs
          : Date.parse(r.alertedAtIso);
      return Number.isFinite(ms) && bkkDayOfWeekIndex(ms) === targetDow;
    });
  }

  if (filters.volVsSmaFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesVolVsSmaFilter(r, filters.volVsSmaFilter));
  }

  if (filters.barRangePrevFilter !== "all") {
    result = result.filter((r) =>
      snowballStatsRowMatchesBarRangePrevFilter(r, filters.barRangePrevFilter),
    );
  }

  if (filters.barRange2Filter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesBarRange2Filter(r, filters.barRange2Filter));
  }

  if (filters.efficiencyFilter !== "all") {
    result = result.filter((r) =>
      snowballStatsRowMatchesEfficiencyScoreFilter(r, filters.efficiencyFilter),
    );
  }

  if (filters.signalMaxDdFilter !== "all") {
    result = result.filter((r) =>
      snowballStatsRowMatchesSignalMaxDdFilter(r, filters.signalMaxDdFilter),
    );
  }

  if (filters.volRankFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesVolRankFilter(r, filters.volRankFilter));
  }

  if (filters.ema1hFilter !== "all") {
    result = result.filter((r) => reversalRowMatchesEma1hFilter(r, filters.ema1hFilter));
  }

  if (filters.ema4hFilter !== "all") {
    result = result.filter((r) => reversalRowMatchesEma4hFilter(r, filters.ema4hFilter));
  }

  if (filters.ema1dFilter !== "all") {
    result = result.filter((r) => reversalRowMatchesEma1dFilter(r, filters.ema1dFilter));
  }

  if (filters.btcEma4hFilter !== "all") {
    result = result.filter((r) => reversalRowMatchesBtcEma4hFilter(r, filters.btcEma4hFilter));
  }

  if (filters.atrFilter !== "all") {
    result = result.filter((r) => statsRowMatchesAtrPct14dFilter(r.atrPct14d, filters.atrFilter));
  }

  if (filters.matrixFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesMatrixFilter(r, filters.matrixFilter));
  }

  if (filters.fundingFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesFundingFilter(r, filters.fundingFilter));
  }

  if (filters.btcPsarFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesBtcPsarFilter(r, filters.btcPsarFilter));
  }

  if (filters.structureFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesStructureFilter(r, filters.structureFilter));
  }

  if (filters.greenDaysFilter !== "all") {
    result = result.filter((r) => snowballStatsRowMatchesGreenDaysFilter(r, filters.greenDaysFilter));
  }

  if (filters.conflictFilter !== "all") {
    result = result.filter((r) => statsRowMatchesConflictFilter(r, filters.conflictFilter));
  }

  return result;
}

export type SnowballStatsEmptyFilterLabels = {
  side: string;
  greenDays: string;
  funding: string;
  btcPsar: string;
  structure: string;
  matrix: string;
  ema1h: string;
  ema4h: string;
  ema1d: string;
  btcEma4h: string;
  atr: string;
  volVsSma: string;
  barRangePrev: string;
  barRange2: string;
  efficiency: string;
  signalMaxDd: string;
  volRank: string;
  conflict: string;
};

export function snowballStatsEmptyFilterLabels(filters: SnowballStatsFilterState): SnowballStatsEmptyFilterLabels {
  return {
    side: snowballSideFilterLabel(filters.sideFilter),
    greenDays: snowballStatsGreenDaysFilterLabel(filters.greenDaysFilter),
    funding: snowballStatsFundingFilterLabel(filters.fundingFilter),
    btcPsar: snowballBtcPsarFilterLabel(filters.btcPsarFilter),
    structure: snowballStructureFilterLabel(filters.structureFilter),
    matrix: snowballMatrixFilterLabel(filters.matrixFilter),
    ema1h: reversalEma1hFilterLabel(filters.ema1hFilter),
    ema4h: reversalEma4hFilterLabel(filters.ema4hFilter),
    ema1d: reversalEma1dFilterLabel(filters.ema1dFilter),
    btcEma4h: reversalEma4hFilterLabel(filters.btcEma4hFilter),
    atr: statsAtrPct14dFilterLabel(filters.atrFilter),
    volVsSma: snowballStatsVolVsSmaFilterLabel(filters.volVsSmaFilter),
    barRangePrev: snowballBarRangePrevFilterLabel(filters.barRangePrevFilter),
    barRange2: snowballBarRange2FilterLabel(filters.barRange2Filter),
    efficiency: snowballEfficiencyScoreFilterLabel(filters.efficiencyFilter),
    signalMaxDd: snowballSignalMaxDdFilterLabel(filters.signalMaxDdFilter),
    volRank: snowballStatsVolRankFilterLabel(filters.volRankFilter),
    conflict: statsConflictFilterLabel(filters.conflictFilter),
  };
}

type Props = {
  filters: SnowballStatsFilterState;
  onDayFilterChange: (v: SnowballDayFilter) => void;
  onSideFilterChange: (v: SnowballSideFilter) => void;
  onGradeFilterChange: (v: SnowballGradeFilter) => void;
  onDowFilterChange: (v: SnowballDowFilter) => void;
  onVolVsSmaFilterChange: (v: SnowballVolVsSmaFilter) => void;
  onBarRangePrevFilterChange: (v: SnowballBarRangePrevFilter) => void;
  onBarRange2FilterChange: (v: SnowballBarRange2Filter) => void;
  onEfficiencyFilterChange: (v: SnowballEfficiencyScoreFilter) => void;
  onSignalMaxDdFilterChange: (v: SnowballSignalMaxDdFilter) => void;
  onVolRankFilterChange: (v: SnowballVolRankFilter) => void;
  onEma1hFilterChange: (v: ReversalEma1hFilter) => void;
  onEma4hFilterChange: (v: ReversalEma4hFilter) => void;
  onEma1dFilterChange: (v: ReversalEma1dFilter) => void;
  onBtcEma4hFilterChange: (v: BtcEma4hFilter) => void;
  onAtrFilterChange: (v: StatsAtrPct14dFilter) => void;
  onMatrixFilterChange: (v: SnowballMatrixFilter) => void;
  onFundingFilterChange: (v: SnowballFundingFilter) => void;
  onBtcPsarFilterChange: (v: SnowballBtcPsarFilter) => void;
  onStructureFilterChange: (v: SnowballStructureFilter) => void;
  onGreenDaysFilterChange: (v: SnowballGreenDaysFilter) => void;
  onConflictFilterChange: (v: StatsConflictFilter) => void;
  monthKeys: string[];
  monthFilter: string;
  onMonthFilterChange: (v: string) => void;
  splitByWeek: boolean;
  onSplitByWeekChange: (v: boolean) => void;
  scopedCount: number;
  filteredCount: number;
  totalCount: number;
  showDayFilter?: boolean;
};

export function SnowballStatsFilters({
  filters,
  onDayFilterChange,
  onSideFilterChange,
  onGradeFilterChange,
  onDowFilterChange,
  onVolVsSmaFilterChange,
  onBarRangePrevFilterChange,
  onBarRange2FilterChange,
  onEfficiencyFilterChange,
  onSignalMaxDdFilterChange,
  onVolRankFilterChange,
  onEma1hFilterChange,
  onEma4hFilterChange,
  onEma1dFilterChange,
  onBtcEma4hFilterChange,
  onAtrFilterChange,
  onMatrixFilterChange,
  onFundingFilterChange,
  onBtcPsarFilterChange,
  onStructureFilterChange,
  onGreenDaysFilterChange,
  onConflictFilterChange,
  monthKeys,
  monthFilter,
  onMonthFilterChange,
  splitByWeek,
  onSplitByWeekChange,
  scopedCount,
  filteredCount,
  totalCount,
  showDayFilter = true,
}: Props) {
  return (
    <div
      className="sparkStatsActionRow"
      style={{
        marginBottom: "0.5rem",
        alignItems: "center",
        flexWrap: "wrap",
        rowGap: "0.4rem",
      }}
    >
      {showDayFilter ? (
        <label
          className="sub"
          style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
        >
          ย้อนหลัง
          <select
            value={filters.dayFilter}
            onChange={(e) => onDayFilterChange(e.currentTarget.value as SnowballDayFilter)}
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
      ) : null}
      <label
        className="sub"
        style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
      >
        ทิศ
        <select
          value={filters.sideFilter}
          onChange={(e) => onSideFilterChange(e.currentTarget.value as SnowballSideFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "6.5rem" }}
          title="ทิศสัญญาณ Snowball ตอนแจ้ง — Long / Bear"
        >
          {SNOWBALL_SIDE_FILTER_OPTIONS.map((opt) => (
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
          value={filters.gradeFilter}
          onChange={(e) => onGradeFilterChange(e.currentTarget.value as SnowballGradeFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "7rem" }}
          title={snowballTrendGradeFilterTitle(filters.gradeFilter)}
        >
          {SNOWBALL_GRADE_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} title={snowballTrendGradeFilterTitle(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label
        className="sub"
        style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
      >
        Conflict
        <select
          value={filters.conflictFilter}
          onChange={(e) => onConflictFilterChange(e.currentTarget.value as StatsConflictFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "7.5rem" }}
          title={statsConflictFilterTitle(filters.conflictFilter)}
        >
          {STATS_CONFLICT_FILTER_OPTIONS.map((opt) => (
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
          value={filters.dowFilter}
          onChange={(e) => onDowFilterChange(e.currentTarget.value as SnowballDowFilter)}
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
          value={filters.volVsSmaFilter}
          onChange={(e) => onVolVsSmaFilterChange(e.currentTarget.value as SnowballVolVsSmaFilter)}
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
        R% ก่อน
        <select
          value={filters.barRangePrevFilter}
          onChange={(e) =>
            onBarRangePrevFilterChange(e.currentTarget.value as SnowballBarRangePrevFilter)
          }
          className="tmaInput"
          style={{ width: "auto", minWidth: "7rem" }}
          title={snowballBarRangePrevFilterTitle(filters.barRangePrevFilter)}
        >
          {SNOWBALL_BAR_RANGE_PREV_FILTER_OPTIONS.map((opt) => (
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
        R% 2แท่ง
        <select
          value={filters.barRange2Filter}
          onChange={(e) => onBarRange2FilterChange(e.currentTarget.value as SnowballBarRange2Filter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "7rem" }}
          title={snowballBarRange2FilterTitle(filters.barRange2Filter)}
        >
          {SNOWBALL_BAR_RANGE2_FILTER_OPTIONS.map((opt) => (
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
          value={filters.efficiencyFilter}
          onChange={(e) =>
            onEfficiencyFilterChange(e.currentTarget.value as SnowballEfficiencyScoreFilter)
          }
          className="tmaInput"
          style={{ width: "auto", minWidth: "7rem" }}
          title={snowballEfficiencyScoreFilterTitle(filters.efficiencyFilter)}
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
          value={filters.signalMaxDdFilter}
          onChange={(e) =>
            onSignalMaxDdFilterChange(e.currentTarget.value as SnowballSignalMaxDdFilter)
          }
          className="tmaInput"
          style={{ width: "auto", minWidth: "7.5rem" }}
          title={snowballSignalMaxDdFilterTitle(filters.signalMaxDdFilter)}
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
          value={filters.volRankFilter}
          onChange={(e) => onVolRankFilterChange(e.currentTarget.value as SnowballVolRankFilter)}
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
        EMA1h∠7d
        <select
          value={filters.ema1hFilter}
          onChange={(e) => onEma1hFilterChange(e.currentTarget.value as ReversalEma1hFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "5.5rem" }}
          title={reversalEma1hFilterTitle(filters.ema1hFilter)}
        >
          {REVERSAL_EMA1H_FILTER_OPTIONS.map((opt) => (
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
          value={filters.ema4hFilter}
          onChange={(e) => onEma4hFilterChange(e.currentTarget.value as ReversalEma4hFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "5.5rem" }}
          title={reversalEma4hFilterTitle(filters.ema4hFilter)}
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
          value={filters.ema1dFilter}
          onChange={(e) => onEma1dFilterChange(e.currentTarget.value as ReversalEma1dFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "5.5rem" }}
          title={reversalEma1dFilterTitle(filters.ema1dFilter)}
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
        BTC∠4h
        <select
          value={filters.btcEma4hFilter}
          onChange={(e) => onBtcEma4hFilterChange(e.currentTarget.value as BtcEma4hFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "5.5rem" }}
          title={reversalBtcEma4hFilterTitle(filters.btcEma4hFilter)}
        >
          {BTC_EMA4H_FILTER_OPTIONS.map((opt) => (
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
        ATR%14D
        <select
          value={filters.atrFilter}
          onChange={(e) => onAtrFilterChange(e.currentTarget.value as StatsAtrPct14dFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "5.5rem" }}
          title={statsAtrPct14dFilterTitle(filters.atrFilter)}
        >
          {STATS_ATR_PCT14D_FILTER_OPTIONS.map((opt) => (
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
          value={filters.fundingFilter}
          onChange={(e) => onFundingFilterChange(e.currentTarget.value as SnowballFundingFilter)}
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
          value={filters.greenDaysFilter}
          onChange={(e) => onGreenDaysFilterChange(e.currentTarget.value as SnowballGreenDaysFilter)}
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
        โครงสร้าง
        <select
          value={filters.structureFilter}
          onChange={(e) => onStructureFilterChange(e.currentTarget.value as SnowballStructureFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "7.5rem" }}
          title={snowballStructureFilterTitle(filters.structureFilter)}
        >
          {SNOWBALL_STRUCTURE_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} title={snowballStructureFilterTitle(opt.value)}>
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
          value={filters.btcPsarFilter}
          onChange={(e) => onBtcPsarFilterChange(e.currentTarget.value as SnowballBtcPsarFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "7.5rem" }}
          title={snowballBtcPsarFilterTitle(filters.btcPsarFilter)}
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
          value={filters.matrixFilter}
          onChange={(e) => onMatrixFilterChange(e.currentTarget.value as SnowballMatrixFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "9rem" }}
          title={snowballMatrixFilterTitle(filters.matrixFilter)}
        >
          {SNOWBALL_MATRIX_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <StatsMonthPager monthKeys={monthKeys} value={monthFilter} onChange={onMonthFilterChange} />
      <StatsSplitByWeekCheckbox checked={splitByWeek} onChange={onSplitByWeekChange} />
      <span className="sub">
        แสดง {scopedCount}/{filteredCount}
        {filteredCount !== totalCount ? ` (รวม ${totalCount})` : ""}
      </span>
    </div>
  );
}
