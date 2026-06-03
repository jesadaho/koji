"use client";

import type { ReactNode } from "react";

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
