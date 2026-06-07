/** ตัวกรอง BTC PSAR (4h + 1h) — Snowball stats Mini App */

import type { SnowballStatsRow } from "@/lib/snowballStatsClient";

export type SnowballBtcPsarFilter =
  | "all"
  | "4hUp"
  | "4hDown"
  | "1hUp"
  | "1hDown"
  | "bothUp"
  | "bothDown"
  | "4hUp1hDown"
  | "4hDown1hUp";

export const SNOWBALL_BTC_PSAR_FILTER_OPTIONS: ReadonlyArray<{
  value: SnowballBtcPsarFilter;
  label: string;
}> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "4hUp", label: "4h ↑" },
  { value: "4hDown", label: "4h ↓" },
  { value: "1hUp", label: "1h ↑" },
  { value: "1hDown", label: "1h ↓" },
  { value: "bothUp", label: "4h↑·1h↑" },
  { value: "bothDown", label: "4h↓·1h↓" },
  { value: "4hUp1hDown", label: "4h↑·1h↓" },
  { value: "4hDown1hUp", label: "4h↓·1h↑" },
];

export function snowballBtcPsarFilterLabel(filter: SnowballBtcPsarFilter): string {
  return SNOWBALL_BTC_PSAR_FILTER_OPTIONS.find((o) => o.value === filter)?.label ?? filter;
}

export function snowballBtcPsarFilterTitle(filter: SnowballBtcPsarFilter): string {
  if (filter === "all") return "ไม่กรอง BTC PSAR";
  if (filter === "bothUp") return "BTC PSAR 4h ↑ และ 1h ↑ (bullish ทั้งคู่)";
  if (filter === "bothDown") return "BTC PSAR 4h ↓ และ 1h ↓ (bearish ทั้งคู่)";
  if (filter === "4hUp1hDown") return "BTC PSAR 4h ↑ · 1h ↓";
  if (filter === "4hDown1hUp") return "BTC PSAR 4h ↓ · 1h ↑";
  if (filter === "4hUp") return "BTC PSAR 4h ↑ (bullish)";
  if (filter === "4hDown") return "BTC PSAR 4h ↓ (bearish)";
  if (filter === "1hUp") return "BTC PSAR 1h ↑ (bullish)";
  return "BTC PSAR 1h ↓ (bearish)";
}

export function snowballStatsRowMatchesBtcPsarFilter(
  row: Pick<SnowballStatsRow, "btcPsar4hTrend" | "btcPsar1hTrend">,
  filter: SnowballBtcPsarFilter,
): boolean {
  if (filter === "all") return true;
  const t4 = row.btcPsar4hTrend;
  const t1 = row.btcPsar1hTrend;
  switch (filter) {
    case "4hUp":
      return t4 === "up";
    case "4hDown":
      return t4 === "down";
    case "1hUp":
      return t1 === "up";
    case "1hDown":
      return t1 === "down";
    case "bothUp":
      return t4 === "up" && t1 === "up";
    case "bothDown":
      return t4 === "down" && t1 === "down";
    case "4hUp1hDown":
      return t4 === "up" && t1 === "down";
    case "4hDown1hUp":
      return t4 === "down" && t1 === "up";
    default:
      return true;
  }
}
