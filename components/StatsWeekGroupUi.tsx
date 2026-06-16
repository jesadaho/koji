"use client";

import type { ReactNode } from "react";
import {
  formatStatsStrategyProfitSummaryText,
  STATS_STRATEGY_PROFIT_HOLD_24H,
  STATS_STRATEGY_PROFIT_HOLD_48H,
  summarizeStatsStrategyProfit,
  type StatsStrategyCsvSizing,
  type StatsStrategyProfitRowSlice,
  type StatsStrategyWinLossBand,
  type StatsStrategyProfitResolveFn,
} from "@/lib/statsStrategyProfitClient";

/** ตัวเลือกแยกตารางรายสัปดาห์ (จันทร์–อาทิตย์ BKK) */
export function StatsSplitByWeekCheckbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      แยกรายสัปดาห์
    </label>
  );
}

export function StatsWeekSectionTitle(props: {
  weekLabel: string;
  rowCount: number;
  extra?: string | null;
}) {
  return (
    <h3
      className="sparkStatsMatrixSectionTitle"
      style={{ fontSize: "1rem", marginTop: "1rem", marginBottom: "0.4rem" }}
    >
      สัปดาห์ {props.weekLabel}
      <span className="sub" style={{ fontWeight: "normal", marginLeft: "0.35rem" }}>
        · {props.rowCount} รายการ
        {props.extra ? ` · ${props.extra}` : ""}
      </span>
    </h3>
  );
}

/** สรุปกำไรกลยุทธ์ 24h/48h ต่อสัปดาห์ (ใต้หัวข้อสัปดาห์) */
export function StatsWeekStrategyProfitBlock(props: {
  rows: StatsStrategyProfitRowSlice[];
  sizing?: StatsStrategyCsvSizing;
  band: StatsStrategyWinLossBand;
  show24h?: boolean;
  show48h?: boolean;
  resolveProfit?: StatsStrategyProfitResolveFn;
}) {
  const text24h =
    props.show24h !== false
      ? formatStatsStrategyProfitSummaryText(
          summarizeStatsStrategyProfit(
            props.rows,
            props.sizing,
            props.band,
            STATS_STRATEGY_PROFIT_HOLD_24H,
            props.resolveProfit,
          ),
          STATS_STRATEGY_PROFIT_HOLD_24H,
        )
      : null;
  const text48h =
    props.show48h !== false
      ? formatStatsStrategyProfitSummaryText(
          summarizeStatsStrategyProfit(
            props.rows,
            props.sizing,
            props.band,
            STATS_STRATEGY_PROFIT_HOLD_48H,
            props.resolveProfit,
          ),
          STATS_STRATEGY_PROFIT_HOLD_48H,
        )
      : null;
  if (!text24h && !text48h) return null;
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      {text24h ? (
        <p className="sub" style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>
          {text24h}
        </p>
      ) : null}
      {text48h ? (
        <p className="sub" style={{ margin: 0, fontWeight: 600 }}>
          {text48h}
        </p>
      ) : null}
    </div>
  );
}

export function StatsWeekSplitHint(props: { splitByWeek: boolean; children: ReactNode }) {
  if (!props.splitByWeek) return <>{props.children}</>;
  return (
    <>
      <p className="sub" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
        สรุปรวมทั้งช่วงที่เลือก
        <span className="tmaTabEn" style={{ marginLeft: "0.35rem" }}>
          (สัปดาห์จันทร์–อาทิตย์ BKK)
        </span>
      </p>
      {props.children}
    </>
  );
}
