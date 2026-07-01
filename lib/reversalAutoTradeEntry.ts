import type { TradingViewMexcUserSettings } from "@/src/tradingViewCloseSettingsStore";
import {
  REVERSAL_LIMIT_EXPIRE_HOURS_DEFAULT,
  REVERSAL_LIMIT_EXPIRE_HOURS_MAX,
  REVERSAL_LIMIT_EXPIRE_HOURS_MIN,
  REVERSAL_LIMIT_EXPIRE_MS,
  parseReversalAutoTradeLimitExpireHours,
  reversalLimitExpireHoursFromRow,
  reversalLimitExpireMsFromHours,
  reversalLimitExpireMsFromRow,
} from "@/lib/reversalLimitExpire";

export {
  REVERSAL_LIMIT_EXPIRE_HOURS_DEFAULT,
  REVERSAL_LIMIT_EXPIRE_HOURS_MAX,
  REVERSAL_LIMIT_EXPIRE_HOURS_MIN,
  REVERSAL_LIMIT_EXPIRE_MS,
  parseReversalAutoTradeLimitExpireHours,
  reversalLimitExpireHoursFromRow,
  reversalLimitExpireMsFromHours,
  reversalLimitExpireMsFromRow,
};

export const REVERSAL_ENTRY_EMA_PERIOD_DEFAULT = 20;
export const REVERSAL_ENTRY_EMA_PERIOD_MIN = 5;
export const REVERSAL_ENTRY_EMA_PERIOD_MAX = 200;

export type ReversalAutoTradeEntryMode = "hybrid_ema" | "market";

/** Hybrid SHORT — EMA20Δ15m ในช่วงนี้ (0 ถึง −2%) → Market ทันที */
export const REVERSAL_SHORT_HYBRID_IMMEDIATE_MARKET_EMA20_15M_DIFF_MAX_PCT = 0;
export const REVERSAL_SHORT_HYBRID_IMMEDIATE_MARKET_EMA20_15M_DIFF_MIN_PCT = -2.0;

export type ReversalShortHybridMarketBypass = "ema20_15m_deep" | "market_entry_matrix";

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
      mode: "market",
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

export function reversalShortHybridImmediateMarketByEma20_15m(
  priceVsEma20_15mPct: number | null | undefined,
): boolean {
  return (
    priceVsEma20_15mPct != null &&
    Number.isFinite(priceVsEma20_15mPct) &&
    priceVsEma20_15mPct <= REVERSAL_SHORT_HYBRID_IMMEDIATE_MARKET_EMA20_15M_DIFF_MAX_PCT &&
    priceVsEma20_15mPct >= REVERSAL_SHORT_HYBRID_IMMEDIATE_MARKET_EMA20_15M_DIFF_MIN_PCT
  );
}

export function reversalEntryUseMarket(input: {
  mode: ReversalAutoTradeEntryMode;
  mark: number;
  entryEma: number | null;
  signalKind?: ReversalEntrySignalKind;
  shortHybrid?: {
    priceVsEma20_15mPct: number | null;
    marketEntryMatrixPass: boolean;
  };
}): {
  useMarket: boolean;
  aboveEma: boolean;
  emaFallbackMarket: boolean;
  hybridMarketBypass?: ReversalShortHybridMarketBypass;
} {
  if (input.mode === "market") {
    return { useMarket: true, aboveEma: true, emaFallbackMarket: input.entryEma == null };
  }
  if (input.signalKind === "short" && input.shortHybrid) {
    if (reversalShortHybridImmediateMarketByEma20_15m(input.shortHybrid.priceVsEma20_15mPct)) {
      return {
        useMarket: true,
        aboveEma: true,
        emaFallbackMarket: false,
        hybridMarketBypass: "ema20_15m_deep",
      };
    }
    if (input.shortHybrid.marketEntryMatrixPass) {
      return {
        useMarket: true,
        aboveEma: true,
        emaFallbackMarket: false,
        hybridMarketBypass: "market_entry_matrix",
      };
    }
  }
  const emaFallbackMarket = input.entryEma == null;
  const aboveEma = emaFallbackMarket ? true : input.mark > (input.entryEma as number);
  return { useMarket: aboveEma, aboveEma, emaFallbackMarket };
}
