import { resolveAutoOpenOpenedAtMs } from "@/lib/autoOpenFollowUp";
import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";
import { statsStrategyExitReasonShort } from "@/lib/statsStrategyProfitClient";
import type { StatsTpSlExitReason } from "@/lib/tpSlStrategySimulate";

export type AutoOpenMexcCloseState = "open" | "closed" | "na";

export function autoOpenMexcCloseState(row: AutoOpenOrderLogRow): AutoOpenMexcCloseState {
  if (row.outcome !== "success") return "na";
  if (row.mexcActive) return "open";
  if (row.mexcClosedAtMs != null && Number.isFinite(row.mexcClosedAtMs)) return "closed";
  if (row.mexcRealisedPnlUsdt != null && Number.isFinite(row.mexcRealisedPnlUsdt)) return "closed";
  return "na";
}

/** เลือก exit reason จำลอง TP/SL ที่ใกล้ช่วงถือจริงบน MEXC */
export function resolveAutoOpenMexcCloseExitReason(
  row: AutoOpenOrderLogRow,
): StatsTpSlExitReason | null {
  if (autoOpenMexcCloseState(row) !== "closed") return null;

  const openedAt = resolveAutoOpenOpenedAtMs(row);
  const closedAt = row.mexcClosedAtMs;
  if (openedAt != null && closedAt != null && Number.isFinite(closedAt)) {
    const holdH = (closedAt - openedAt) / 3_600_000;
    if (holdH >= 47 && row.strategyExitReason) return row.strategyExitReason;
    if (holdH >= 23 && row.strategyExitReason24h) return row.strategyExitReason24h;
  }
  if (row.strategyExitReason) return row.strategyExitReason;
  if (row.strategyExitReason24h) return row.strategyExitReason24h;
  return null;
}

/** ป้ายสั้นสำหรับ UI ประวัติเทรด */
export function autoOpenMexcCloseReasonShort(
  reason: StatsTpSlExitReason | null | undefined,
): string {
  if (!reason) return "";
  if (reason === "time_24h") return "ครบ 24h";
  if (reason === "time_48h") return "ครบ 48h";
  if (reason === "time_12h") return "ครบ 12h";
  if (reason === "tp2_full") return "TP2 เต็ม";
  if (reason === "tp1_tp2") return "TP1+TP2";
  if (reason === "tp1_be") return "SL@entry";
  if (reason === "tp1_24h") return "TP1+ครบ 24h";
  if (reason === "tp1_48h") return "TP1+ครบ 48h";
  if (reason === "tp1_only") return "TP1";
  if (reason === "liquidated") return "Liquidate";
  return statsStrategyExitReasonShort(reason);
}
