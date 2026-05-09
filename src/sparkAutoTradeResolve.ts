import { orderSideEffective, type TradingViewMexcUserSettings } from "./tradingViewCloseSettingsStore";
import type { SparkVolBand } from "./sparkTierContext";

/** จาก resolve — ว่าจะควรเล่นหรือไม่ + พารามิเตอร์ */
export type SparkAutoTradeResolved = {
  marginUsdt: number;
  leverage: number;
  tpPct: number;
};

export function sparkAutoTradeParamsForVolBand(
  row: TradingViewMexcUserSettings,
  volBand: SparkVolBand
): { ok: true; value: SparkAutoTradeResolved } | { ok: false; reason: string } {
  if (!row.sparkAutoTradeEnabled) {
    return { ok: false, reason: "spark_auto_trade_disabled" };
  }

  const preset = row.sparkAutoTradeByVol?.[volBand];
  if (preset?.enabledBand === false) {
    return { ok: false, reason: `spark_auto_trade_vol_band_off:${volBand}` };
  }

  const margin = preset?.marginUsdt ?? row.sparkAutoTradeMarginUsdt;
  const levRaw = preset?.leverage ?? row.sparkAutoTradeLeverage;
  const tpRaw = preset?.tpPct ?? row.sparkAutoTradeTpPct ?? 0;

  const marginOk = typeof margin === "number" && Number.isFinite(margin) && margin > 0;
  const levOk = typeof levRaw === "number" && Number.isFinite(levRaw) && levRaw >= 1;
  if (!marginOk || !levOk) {
    return {
      ok: false,
      reason: marginOk ? "spark_auto_trade_bad_leverage" : "spark_auto_trade_bad_margin",
    };
  }

  const lev = Math.floor(levRaw);
  const tpPct =
    typeof tpRaw === "number" && Number.isFinite(tpRaw) && tpRaw >= 0 ? tpRaw : 0;

  return {
    ok: true,
    value: { marginUsdt: margin, leverage: lev, tpPct },
  };
}

/** จากทิศทาง Spark และการตั้งทิศทางผู้ใช้ */
export function sparkAutoTradeDirectionAllowed(
  returnPct: number,
  dir: TradingViewMexcUserSettings["sparkAutoTradeDirection"] | undefined
): boolean {
  const d = dir ?? "both";
  if (d === "both") return returnPct !== 0;
  if (d === "long_only") return returnPct > 0;
  if (d === "short_only") return returnPct < 0;
  return false;
}

/**
 * เลือกฝั่งที่จะเปิดหลังผ่านตัวกรอง Spike (`direction`) — 「long / short» ไม่ผูกกับว่า Spike ขึ้นหรือลงโดยตรง (ยกเว้นโหมด fade ที่สลับจาก momentum)
 */
export function sparkAutoTradeOpenLongFromSpark(returnPct: number, row: TradingViewMexcUserSettings): boolean {
  const side = orderSideEffective(row);
  if (side === "long") return true;
  if (side === "short") return false;
  const momentumLong = returnPct > 0;
  if (side === "fade_spark") return !momentumLong;
  return momentumLong;
}

/** คำนวณ takeProfitPrice ~ จาก mark ประมาณการเข้า (MEXC takeProfitPrice บนคำสั่งเปิด) */
export function computeTakeProfitPriceFromMark(mark: number, long: boolean, tpPct: number): number | null {
  if (!(mark > 0) || !(tpPct > 0)) return null;
  const mul = long ? 1 + tpPct / 100 : 1 - tpPct / 100;
  const px = mark * mul;
  if (!(px > 0)) return null;
  if (!Number.isFinite(px)) return null;
  if (px < 1e-12) return null;
  return roundApproxPrice(px);
}

function roundApproxPrice(p: number): number {
  if (p >= 1000) return Math.round(p * 100) / 100;
  if (p >= 1) return Math.round(p * 10000) / 10000;
  if (p >= 0.0001) return Math.round(p * 1e6) / 1e6;
  return Number(p.toPrecision(8));
}
