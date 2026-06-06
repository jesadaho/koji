import type { TradingViewMexcUserSettings } from "@/src/tradingViewCloseSettingsStore";

export type SnowballAutoTradeEntryMode = "hybrid_ema" | "market";

export const SNOWBALL_ENTRY_EMA_PERIOD_DEFAULT = 20;
export const SNOWBALL_ENTRY_EMA_PERIOD_MIN = 5;
export const SNOWBALL_ENTRY_EMA_PERIOD_MAX = 200;
export const SNOWBALL_LIMIT_EXPIRE_MS = 8 * 3600 * 1000;

export function snowballEma1hLabel(period: number): string {
  return `EMA${period} 1h`;
}

export function parseSnowballAutoTradeEntryMode(
  raw: unknown,
  fallback: SnowballAutoTradeEntryMode = "market",
): SnowballAutoTradeEntryMode {
  if (raw === "market") return "market";
  if (raw === "hybrid_ema" || raw === "hybrid") return "hybrid_ema";
  return fallback;
}

export function parseSnowballAutoTradeEntryEmaPeriod(
  raw: unknown,
  fallback = SNOWBALL_ENTRY_EMA_PERIOD_DEFAULT,
): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  const p = Math.floor(n);
  if (p < SNOWBALL_ENTRY_EMA_PERIOD_MIN || p > SNOWBALL_ENTRY_EMA_PERIOD_MAX) return fallback;
  return p;
}

export function snowballEntrySettingsFromRow(row: TradingViewMexcUserSettings): {
  mode: SnowballAutoTradeEntryMode;
  emaPeriod: number;
} {
  return {
    mode: parseSnowballAutoTradeEntryMode(row.snowballAutoTradeEntryMode),
    emaPeriod: parseSnowballAutoTradeEntryEmaPeriod(row.snowballAutoTradeEntryEmaPeriod),
  };
}

/** LONG/SHORT: ราคา > EMA → Market · ≤ EMA → Limit ที่ EMA */
export function snowballEntryUseMarket(input: {
  mode: SnowballAutoTradeEntryMode;
  mark: number;
  entryEma: number | null;
}): { useMarket: boolean; aboveEma: boolean; emaFallbackMarket: boolean } {
  if (input.mode === "market") {
    return { useMarket: true, aboveEma: true, emaFallbackMarket: input.entryEma == null };
  }
  const emaFallbackMarket = input.entryEma == null;
  const aboveEma = emaFallbackMarket ? true : input.mark > (input.entryEma as number);
  return { useMarket: aboveEma, aboveEma, emaFallbackMarket };
}
