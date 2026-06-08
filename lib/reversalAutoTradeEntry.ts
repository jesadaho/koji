import type { TradingViewMexcUserSettings } from "@/src/tradingViewCloseSettingsStore";

export type ReversalAutoTradeEntryMode = "hybrid_ema" | "market";

export const REVERSAL_ENTRY_EMA_PERIOD_DEFAULT = 20;
export const REVERSAL_ENTRY_EMA_PERIOD_MIN = 5;
export const REVERSAL_ENTRY_EMA_PERIOD_MAX = 200;
export const REVERSAL_LIMIT_EXPIRE_MS = 8 * 3600 * 1000;

export function reversalEma15mLabel(period: number): string {
  return `EMA${period} 15m`;
}

export function parseReversalAutoTradeEntryMode(
  raw: unknown,
  fallback: ReversalAutoTradeEntryMode = "hybrid_ema",
): ReversalAutoTradeEntryMode {
  if (raw === "market") return "market";
  if (raw === "hybrid_ema" || raw === "hybrid") return "hybrid_ema";
  return fallback;
}

export function parseReversalAutoTradeEntryEmaPeriod(
  raw: unknown,
  fallback = REVERSAL_ENTRY_EMA_PERIOD_DEFAULT,
): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  const p = Math.floor(n);
  if (p < REVERSAL_ENTRY_EMA_PERIOD_MIN || p > REVERSAL_ENTRY_EMA_PERIOD_MAX) return fallback;
  return p;
}

export type ReversalEntrySignalKind = "short" | "long";

function reversalLegacyEntrySettings(row: TradingViewMexcUserSettings): {
  mode: ReversalAutoTradeEntryMode;
  emaPeriod: number;
} {
  return {
    mode: parseReversalAutoTradeEntryMode(row.reversalAutoTradeEntryMode),
    emaPeriod: parseReversalAutoTradeEntryEmaPeriod(row.reversalAutoTradeEntryEmaPeriod),
  };
}

/** Entry แยก Short signal vs Long (fade SHORT) — fallback ค่า legacy เดิม */
export function reversalEntrySettingsFromRow(
  row: TradingViewMexcUserSettings,
  signalKind: ReversalEntrySignalKind = "short",
): { mode: ReversalAutoTradeEntryMode; emaPeriod: number } {
  const legacy = reversalLegacyEntrySettings(row);
  if (signalKind === "long") {
    return {
      mode: parseReversalAutoTradeEntryMode(row.reversalAutoTradeLongEntryMode, legacy.mode),
      emaPeriod: parseReversalAutoTradeEntryEmaPeriod(
        row.reversalAutoTradeLongEntryEmaPeriod,
        legacy.emaPeriod,
      ),
    };
  }
  const shortModeRaw = row.reversalAutoTradeShortEntryMode ?? row.reversalAutoTradeEntryMode;
  const shortPeriodRaw =
    row.reversalAutoTradeShortEntryEmaPeriod ?? row.reversalAutoTradeEntryEmaPeriod;
  return {
    mode: parseReversalAutoTradeEntryMode(shortModeRaw, legacy.mode),
    emaPeriod: parseReversalAutoTradeEntryEmaPeriod(shortPeriodRaw, legacy.emaPeriod),
  };
}

export function reversalEntryUseMarket(input: {
  mode: ReversalAutoTradeEntryMode;
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
