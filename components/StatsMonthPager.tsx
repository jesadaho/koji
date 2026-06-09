"use client";

import {
  adjacentStatsBkkMonth,
  formatStatsBkkMonthLabel,
  type StatsMonthFilter,
} from "@/lib/statsMonthGroup";

type Props = {
  monthKeys: string[];
  value: StatsMonthFilter;
  onChange: (value: StatsMonthFilter) => void;
};

/** เลือกเดือน (BKK) + ปุ่มเลื่อนเดือนก่อน/ถัดไป */
export function StatsMonthPager({ monthKeys, value, onChange }: Props) {
  const { prev, next } =
    value !== "all" ? adjacentStatsBkkMonth(monthKeys, value) : { prev: null, next: null };

  if (monthKeys.length === 0) return null;

  return (
    <span
      className="statsMonthPager"
      style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}
    >
      <label className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
        เดือน
        <select
          value={value}
          onChange={(e) => onChange(e.currentTarget.value as StatsMonthFilter)}
          className="tmaInput"
          style={{ width: "auto", minWidth: "8.5rem" }}
          title="แสดงเฉพาะแถวในเดือนที่เลือก (เวลาไทย)"
        >
          <option value="all">ทั้งหมด</option>
          {monthKeys.map((key) => (
            <option key={key} value={key}>
              {formatStatsBkkMonthLabel(key)}
            </option>
          ))}
        </select>
      </label>
      {value !== "all" ? (
        <>
          <button
            type="button"
            className="btn"
            disabled={prev == null}
            title={prev ? `เดือนก่อน: ${formatStatsBkkMonthLabel(prev)}` : undefined}
            onClick={() => prev && onChange(prev)}
            aria-label="เดือนก่อน"
          >
            ‹
          </button>
          <button
            type="button"
            className="btn"
            disabled={next == null}
            title={next ? `เดือนถัดไป: ${formatStatsBkkMonthLabel(next)}` : undefined}
            onClick={() => next && onChange(next)}
            aria-label="เดือนถัดไป"
          >
            ›
          </button>
        </>
      ) : null}
    </span>
  );
}
