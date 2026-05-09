import { orderSideEffective, type TradingViewMexcUserSettings } from "./tradingViewCloseSettingsStore";
import type { SparkVolBand } from "./sparkTierContext";

/** จาก resolve — ว่าจะควรเล่นหรือไม่ + พารามิเตอร์ */
export type SparkAutoTradeResolved = {
  marginUsdt: number;
  leverage: number;
  tpPct: number;
};

function sparkVolBandLabelTh(b: SparkVolBand): string {
  if (b === "high") return "Vol สูง";
  if (b === "mid") return "Vol กลาง";
  if (b === "low") return "Vol ต่ำ";
  return "Vol ไม่ระบุ";
}

function fmtNumOrUnset(n: unknown): string {
  if (typeof n === "number" && Number.isFinite(n)) return String(n);
  return "ไม่ได้ตั้ง (ว่าง)";
}

/** บรรทัดอธิบายว่า tier จะเล่นหรือไม่ และใช้ margin/lev เท่าไรหลัง merge (สำหรับ error Thai ตอนบันทึก Settings) */
export function sparkAutoTradeTierExplainTh(row: TradingViewMexcUserSettings, volBand: SparkVolBand): string {
  const label = sparkVolBandLabelTh(volBand);
  const preset = row.sparkAutoTradeByVol?.[volBand];
  const effMargin = preset?.marginUsdt ?? row.sparkAutoTradeMarginUsdt;
  const effLev = preset?.leverage ?? row.sparkAutoTradeLeverage;

  const res = sparkAutoTradeParamsForVolBand(row, volBand);
  if (res.ok) {
    return `${label}: พร้อม auto-open — margin ${res.value.marginUsdt} USDT · lev ${res.value.leverage}`;
  }

  switch (res.reason) {
    case "spark_auto_trade_disabled":
      return `${label}: ปิดใช้ Spark auto-open`;
    default:
      break;
  }
  if (res.reason.startsWith("spark_auto_trade_vol_band_off:")) {
    return `${label}: ระงับ tier นี้ (ติ๊ก “ไม่ auto-open”) — จะไม่นับ tier นี้`;
  }
  if (res.reason === "spark_auto_trade_bad_margin") {
    return `${label}: ยังไม่มี Margin ที่ใช้ได้ — ค่าที่คำนวณหลังรวมคำสั่งบันทึก = ${fmtNumOrUnset(effMargin)} USDT (ต้องเป็นตัวเลข > 0) · ใช้ margin ของ tier ถ้ามีระบุ ไม่งั้นใช้ default ช่อง “Margin (USDT)”`;
  }
  if (res.reason === "spark_auto_trade_bad_leverage") {
    return `${label}: Leverage ไม่ผ่าน — ค่าหลังรวม = ${fmtNumOrUnset(effLev)} (ต้องเป็นตัวเลข ≥ 1) · ใช้ lev ของ tier ถ้ามีระบุ ไม่งั้นใช้ default ช่อง “Leverage”`;
  }
  return `${label}: ไม่พร้อม (${res.reason})`;
}

/** สรุป margin/lev/TP ที่แถวนี้มีหลัง merge — ไม่ใช่ยอดในกระเป๋า */
export function sparkAutoTradeMergedDefaultsExplainTh(row: TradingViewMexcUserSettings): string {
  const t = row.sparkAutoTradeTpPct;
  const tpStr =
    t === undefined ? "ไม่ตั้ง TP" : typeof t === "number" && Number.isFinite(t) ? String(t) : "ไม่ตั้ง TP";
  return `ค่า default ที่เซิร์ฟใช้ร่วมกับ tier (หลังรวมกับของเดิม): Margin USDT = ${fmtNumOrUnset(row.sparkAutoTradeMarginUsdt)} · Leverage = ${fmtNumOrUnset(row.sparkAutoTradeLeverage)} · TP % = ${tpStr}`;
}

export type SparkSaveValidationExplain = {
  summaryTh: string;
  mergedDefaultsTh: string;
  detailsTh: string[];
};

/** เรียกเมื่อเปิด Spark แต่ไม่มี tier ไหน resolve — ให้ผู้ใช้รู้ว่า “ว่างตรงไหน” */
export function sparkAutoTradeExplainSaveBlocked(row: TradingViewMexcUserSettings): SparkSaveValidationExplain {
  const bandsAll: SparkVolBand[] = ["high", "mid", "low", "unknown"];
  const summaryTh =
    "ยังไม่มีระดับ Vol ชั้นใดที่พร้อม auto-open เลย เซิร์ฟจึงไม่ยอมบันทึก • อย่างน้อยชั้นหนึ่งต้องไม่ถูกระงับ และต้องมี Margin default > 0 กับ Leverage default ≥ 1 (หมายเหตุ: เป็นการตั้งค่าใน Settings ไม่ใช่เช็กยอดกระเป๋า)";
  return {
    summaryTh,
    mergedDefaultsTh: sparkAutoTradeMergedDefaultsExplainTh(row),
    detailsTh: bandsAll.map((b) => sparkAutoTradeTierExplainTh(row, b)),
  };
}

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
