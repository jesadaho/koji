/** Client-safe Open Interest helpers for stats tables / CSV */

export const STATS_OPEN_INTEREST_VERSION = 1;

/** Binance openInterestHist ย้อนหลังได้สูงสุด ~30 วัน */
export const STATS_OPEN_INTEREST_HIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function statsOpenInterestUsdtLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}
