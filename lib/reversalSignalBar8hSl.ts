import type { CandleReversalSignalBarTf } from "@/lib/candleReversalStatsClient";

/** 8 ชม. หลังปิดแท่งสัญญาณ — checkpoint กฎ SL ยอดแท่ง (Reversal Short) */
export const REVERSAL_SHORT_8H_SIGNAL_BAR_SL_MS = 8 * 3600 * 1000;

export const REVERSAL_SHORT_8H_SIGNAL_BAR_SL_SUMMARY =
  "ครบ 8 ชม. หลังปิดแท่ง: ราคา > ยอดแท่ง → ปิดทันที · ราคา ≤ ยอดแท่ง → SL ที่ยอดแท่ง";

export function reversalSignalBarCloseMs(
  signalBarOpenSec: number,
  signalBarTf: CandleReversalSignalBarTf,
): number {
  const durSec = signalBarTf === "1d" ? 24 * 3600 : 3600;
  return (signalBarOpenSec + durSec) * 1000;
}

export function reversalShort8hCheckpointMs(
  signalBarOpenSec: number,
  signalBarTf: CandleReversalSignalBarTf,
): number {
  return reversalSignalBarCloseMs(signalBarOpenSec, signalBarTf) + REVERSAL_SHORT_8H_SIGNAL_BAR_SL_MS;
}

export type ReversalSignalBar8hSlFields = {
  signalBarHigh?: number;
  signalCheckpoint8hMs?: number;
};

export function reversalAutoTradeSignalBar8hFields(input: {
  signalBarOpenSec: number;
  signalBarTf: CandleReversalSignalBarTf;
  signalBarHigh?: number | null;
}): ReversalSignalBar8hSlFields {
  const high =
    input.signalBarHigh != null && Number.isFinite(input.signalBarHigh) && input.signalBarHigh > 0
      ? input.signalBarHigh
      : undefined;
  if (high == null) return {};
  if (!Number.isFinite(input.signalBarOpenSec) || input.signalBarOpenSec <= 0) {
    return { signalBarHigh: high };
  }
  const tf = input.signalBarTf === "1d" ? "1d" : "1h";
  return {
    signalBarHigh: high,
    signalCheckpoint8hMs: reversalShort8hCheckpointMs(input.signalBarOpenSec, tf),
  };
}
