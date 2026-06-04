import type { BinanceKlinePack } from "./binanceIndicatorKline";
import { emaLine } from "./indicatorMath";
import { latestSnowball1hClosedIndexAtOrBefore } from "./snowballLongBreakoutConfirm";

export const SNOWBALL_AUTO_TRADE_REFERENCE_EMA20_1H_PERIOD = 20;

/** EMA20 บนแท่ง 1h ปิดล่าสุด ณ asOfSec (หรือแท่งปิดล่าสุดใน pack) — ใช้เป็นจุดอ้างอิง auto-open */
export function snowballEma20_1hReferencePrice(
  pack1h: BinanceKlinePack | null,
  asOfSec?: number | null,
  period = SNOWBALL_AUTO_TRADE_REFERENCE_EMA20_1H_PERIOD,
): number | null {
  if (!pack1h?.close?.length || pack1h.close.length < period + 2) return null;
  const { close, timeSec } = pack1h;
  const emaArr = emaLine(close, period);
  let i: number;
  if (asOfSec != null && Number.isFinite(asOfSec) && timeSec?.length) {
    i = latestSnowball1hClosedIndexAtOrBefore(timeSec, Math.floor(asOfSec));
    if (i < 0) return null;
  } else {
    i = close.length - 2;
  }
  const v = emaArr[i];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function resolveSnowballAutoTradeReferenceEntryPrice(input: {
  defaultPrice: number;
  ema20_1h: number | null | undefined;
  useEma20_1h: boolean;
}): { price: number; source: "close" | "ema20_1h" } {
  const { defaultPrice, ema20_1h, useEma20_1h } = input;
  if (
    useEma20_1h &&
    typeof ema20_1h === "number" &&
    Number.isFinite(ema20_1h) &&
    ema20_1h > 0
  ) {
    return { price: ema20_1h, source: "ema20_1h" };
  }
  return { price: defaultPrice, source: "close" };
}
