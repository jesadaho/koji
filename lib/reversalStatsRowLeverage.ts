import type { CandleReversalTradeSide } from "@/lib/candleReversalStatsClient";
import { resolveReversalLongTradeLeverage } from "@/lib/reversalLongDynamicLeverage";
import { resolveReversalShortTradeLeverage } from "@/lib/reversalShortDynamicLeverage";

function positiveLeverage(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Leverage สำหรับคอลัมน์กำไรกลยุทธ์ / P&L $ ใน Reversal stats (ต่อแถว) */
export function resolveReversalStatsRowLeverage(input: {
  tradeSide: CandleReversalTradeSide;
  baseLeverage: number | null | undefined;
  /** @deprecated ใช้ longDynamicLeverageEnabled */
  dynamicLeverageEnabled?: boolean;
  longDynamicLeverageEnabled?: boolean;
  shortDynamicLeverageEnabled?: boolean;
  atrPct14d?: number | null;
  trendGainPct?: number | null;
  ema20_4hSlopePct7d?: number | null;
  ema4hSlopePct7d?: number | null;
}): number | null {
  const base = positiveLeverage(input.baseLeverage);
  if (base == null) return null;
  const longOn =
    input.longDynamicLeverageEnabled === true || input.dynamicLeverageEnabled === true;
  const shortOn = input.shortDynamicLeverageEnabled === true;

  if (input.tradeSide === "long" && longOn) {
    return resolveReversalLongTradeLeverage({
      alertTradeSide: "long",
      baseLeverage: base,
      dynamicLeverageEnabled: true,
      atrPct14d: input.atrPct14d,
    }).leverage;
  }
  if (input.tradeSide === "short" && shortOn) {
    return resolveReversalShortTradeLeverage({
      baseLeverage: base,
      dynamicLeverageEnabled: true,
      trendGainPct: input.trendGainPct,
      ema20_4hSlopePct7d: input.ema20_4hSlopePct7d,
      ema4hSlopePct7d: input.ema4hSlopePct7d,
    }).leverage;
  }
  return base;
}
