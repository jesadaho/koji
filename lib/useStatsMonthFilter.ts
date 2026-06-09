"use client";

import { useEffect, useMemo, useState } from "react";
import {
  filterRowsByStatsBkkMonth,
  listStatsBkkMonthKeys,
  type StatsMonthFilter,
} from "@/lib/statsMonthGroup";

/** กรองแถวตามเดือน BKK — dropdown + reset เมื่อเดือนที่เลือกไม่มีในชุดข้อมูล */
export function useStatsMonthFilter<T>(rows: T[], atMs: (row: T) => number) {
  const [monthFilter, setMonthFilter] = useState<StatsMonthFilter>("all");
  const monthKeys = useMemo(() => listStatsBkkMonthKeys(rows, atMs), [rows, atMs]);

  useEffect(() => {
    if (monthFilter !== "all" && !monthKeys.includes(monthFilter)) {
      setMonthFilter("all");
    }
  }, [monthKeys, monthFilter]);

  const scopedRows = useMemo(
    () => filterRowsByStatsBkkMonth(rows, monthFilter, atMs),
    [rows, monthFilter, atMs],
  );

  return { monthFilter, setMonthFilter, monthKeys, scopedRows };
}
