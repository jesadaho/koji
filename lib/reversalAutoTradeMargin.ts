import type { TradingViewMexcUserSettings } from "@/src/tradingViewCloseSettingsStore";

function positiveNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Margin USDT สำหรับเปิด SHORT บน MEXC */
export function reversalAutoTradeShortMarginUsdt(
  row: Pick<TradingViewMexcUserSettings, "reversalAutoTradeMarginUsdt">,
): number | undefined {
  return positiveNum(row.reversalAutoTradeMarginUsdt);
}

/** Margin USDT สำหรับเปิด LONG บน MEXC — ว่าง = fallback Short */
export function reversalAutoTradeLongMarginUsdt(
  row: Pick<
    TradingViewMexcUserSettings,
    "reversalAutoTradeMarginUsdt" | "reversalAutoTradeLongMarginUsdt"
  >,
): number | undefined {
  return positiveNum(row.reversalAutoTradeLongMarginUsdt) ?? reversalAutoTradeShortMarginUsdt(row);
}

/** Margin ตามทิศที่ส่งออเดอร์จริงบน MEXC */
export function reversalAutoTradeMarginUsdtForMexcSide(
  row: Pick<
    TradingViewMexcUserSettings,
    "reversalAutoTradeMarginUsdt" | "reversalAutoTradeLongMarginUsdt"
  >,
  mexcSide: "short" | "long",
): number | undefined {
  return mexcSide === "long"
    ? reversalAutoTradeLongMarginUsdt(row)
    : reversalAutoTradeShortMarginUsdt(row);
}
