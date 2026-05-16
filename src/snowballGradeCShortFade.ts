/** Grade C LONG → Short fade: นับ rejection บน 1h ในกรอบ 4h ก่อน auto-open */

import { fetchBinanceUsdmKlines, type BinanceKlinePack } from "./binanceIndicatorKline";
import { emaLine } from "./indicatorMath";
import type { SnowballLongAlertGrade } from "./snowballAutoTradeExecutor";
import type { SnowballAutoTradeSide } from "./snowballAutoTradeStateStore";

const SEC_1H = 3600;
const SEC_4H = 4 * SEC_1H;

export function snowballGradeCShortMin1hRejections(): number {
  const v = Number(process.env.SNOWBALL_GRADE_C_SHORT_MIN_1H_REJECTIONS?.trim());
  if (Number.isFinite(v) && v >= 1 && v <= 4) return Math.floor(v);
  return 2;
}

export function snowballGradeCShortUpperWickPctThreshold(): number {
  const v = Number(process.env.SNOWBALL_GRADE_C_SHORT_UPPER_WICK_PCT?.trim());
  if (Number.isFinite(v) && v > 0 && v <= 100) return v;
  return 50;
}

export function snowballGradeCShortEmaPeriod(): number {
  const v = Number(process.env.SNOWBALL_GRADE_C_SHORT_EMA_PERIOD?.trim());
  if (Number.isFinite(v) && v >= 5 && v <= 200) return Math.floor(v);
  return 20;
}

/** แท่งแดงทุบกลืนเนื้อเขียวก่อนหน้า — reversal depth ≥ ratio × body เขียว (ดีฟอลต์ 0.5) */
export function snowballGradeCShortVTopEngulfRatio(): number {
  const v = Number(process.env.SNOWBALL_GRADE_C_SHORT_VTOP_ENGULF_RATIO?.trim());
  if (Number.isFinite(v) && v > 0 && v <= 2) return v;
  return 0.5;
}

/** ไส้บน ÷ ช่วงแท่ง × 100 */
export function upperWickRangePct(
  high: number,
  low: number,
  open: number,
  close: number
): number | null {
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(open) || !Number.isFinite(close)) {
    return null;
  }
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return null;
  const upperWick = Math.max(0, high - Math.max(open, close));
  return (upperWick / span) * 100;
}

/** open time (sec) ของแท่ง 4h ที่ครอบ `barOpenSec` (UTC ตาม Binance) */
export function containing4hBarOpenSec(barOpenSec: number): number {
  if (!Number.isFinite(barOpenSec) || barOpenSec <= 0) return 0;
  return Math.floor(barOpenSec / SEC_4H) * SEC_4H;
}

function find1hIndexByOpenSec(pack: BinanceKlinePack, openSec: number): number {
  const { timeSec } = pack;
  for (let i = 0; i < timeSec.length; i++) {
    if (timeSec[i] === openSec) return i;
  }
  return -1;
}

/** V-Top: แท่งก่อนเขียวแน่น · แท่งล่าสุดแดง · ทุบลงจาก close ก่อนหน้า ≥ ratio × เนื้อเขียว */
export function detectSnowballGradeCVTopEngulfing(
  prevOpen: number,
  prevClose: number,
  curOpen: number,
  curClose: number,
  engulfRatio = snowballGradeCShortVTopEngulfRatio()
): boolean {
  if (
    !Number.isFinite(prevOpen) ||
    !Number.isFinite(prevClose) ||
    !Number.isFinite(curOpen) ||
    !Number.isFinite(curClose)
  ) {
    return false;
  }
  if (prevClose <= prevOpen || curClose >= curOpen) return false;
  const prevBody = Math.abs(prevClose - prevOpen);
  if (prevBody <= 0) return false;
  const reversalDepth = prevClose - curClose;
  return reversalDepth >= prevBody * engulfRatio;
}

/** Limit Short ดัก retest ไส้บน: close + ไส้บน/2 */
export function wickRejectionRetestLimitPrice(
  high: number,
  low: number,
  open: number,
  close: number
): number | null {
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(open) || !Number.isFinite(close)) {
    return null;
  }
  const upperWick = Math.max(0, high - Math.max(open, close));
  if (!(upperWick > 0)) return null;
  const px = close + upperWick / 2;
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** ราคาทริกเกอร์ V-Top แบบ intrabar: close แท่งก่อนหน้า − ratio×เนื้อเขียว */
export function vTopEngulfTriggerPrice(prevOpen: number, prevClose: number, engulfRatio?: number): number | null {
  const ratio = engulfRatio ?? snowballGradeCShortVTopEngulfRatio();
  if (!Number.isFinite(prevOpen) || !Number.isFinite(prevClose) || prevClose <= prevOpen) return null;
  const prevBody = Math.abs(prevClose - prevOpen);
  if (prevBody <= 0) return null;
  const px = prevClose - prevBody * ratio;
  return Number.isFinite(px) && px > 0 ? px : null;
}

export type SnowballGradeCShortEntryStrategy = "wick_limit_retest" | "vtop_market";

export type SnowballGradeCShortFadeResult = {
  ok: boolean;
  rejectionCount: number;
  minRejections: number;
  wickPctThreshold: number;
  wickGateOk: boolean;
  vTopEngulfing: boolean;
  vTopEngulfRatio: number;
  emaPeriod: number;
  fourHourOpenSec: number;
  latest1hOpenSec: number | null;
  latest1hClose: number | null;
  latest1hEma: number | null;
  closeBelowEma: boolean;
  /** ท่าเข้าเมื่อผ่าน gate */
  entryStrategy: SnowballGradeCShortEntryStrategy | null;
  /** Limit ดัก retest ไส้ (สายไส้) */
  limitEntryPrice: number | null;
  /** จุดอ้างอิง ROI / แจ้งเตือน */
  referenceEntryPrice: number | null;
  /** ทริกเกอร์ทุบ V-Top (สายเนื้อ) */
  vTopTriggerPrice: number | null;
  detail: string;
};

/**
 * นับ rejection บน 1h ในกรอบ 4h · Short เมื่อ close 1h ล่าสุด < EMA และ (reject ≥ 2 หรือ V-Top engulf)
 */
export function evaluateSnowballGradeCShortFade(
  pack1h: BinanceKlinePack | null,
  signalBarOpenSec: number
): SnowballGradeCShortFadeResult {
  const minRejections = snowballGradeCShortMin1hRejections();
  const wickPctThreshold = snowballGradeCShortUpperWickPctThreshold();
  const vTopEngulfRatio = snowballGradeCShortVTopEngulfRatio();
  const emaPeriod = snowballGradeCShortEmaPeriod();
  const fourHourOpenSec = containing4hBarOpenSec(signalBarOpenSec);

  const emptyEntry = {
    entryStrategy: null as SnowballGradeCShortEntryStrategy | null,
    limitEntryPrice: null as number | null,
    referenceEntryPrice: null as number | null,
    vTopTriggerPrice: null as number | null,
  };

  const fail = (detail: string, partial: Partial<SnowballGradeCShortFadeResult> = {}): SnowballGradeCShortFadeResult => ({
    ok: false,
    rejectionCount: 0,
    minRejections,
    wickPctThreshold,
    wickGateOk: false,
    vTopEngulfing: false,
    vTopEngulfRatio,
    emaPeriod,
    fourHourOpenSec,
    latest1hOpenSec: null,
    latest1hClose: null,
    latest1hEma: null,
    closeBelowEma: false,
    ...emptyEntry,
    detail,
    ...partial,
  });

  if (!pack1h || pack1h.close.length < emaPeriod + 2) {
    return fail("1h klines ไม่พอสำหรับ EMA + กรอบ 4h");
  }

  const { open, high, low, close, timeSec } = pack1h;
  const emaArr = emaLine(close, emaPeriod);

  let rejectionCount = 0;
  let latestIdx = -1;
  let latestWickRejectionIdx = -1;

  for (let h = 0; h < 4; h++) {
    const slotOpen = fourHourOpenSec + h * SEC_1H;
    const j = find1hIndexByOpenSec(pack1h, slotOpen);
    if (j < 0) continue;
    if (j > latestIdx) latestIdx = j;
    const wickPct = upperWickRangePct(high[j]!, low[j]!, open[j]!, close[j]!);
    if (wickPct != null && wickPct > wickPctThreshold) {
      rejectionCount += 1;
      latestWickRejectionIdx = j;
    }
  }

  if (latestIdx < 0) {
    return fail("ไม่พบแท่ง 1h ครบในกรอบ 4h ของสัญญาณ", { rejectionCount });
  }

  const latest1hOpenSec = timeSec[latestIdx]!;
  const latest1hClose = close[latestIdx]!;
  const latest1hEma = emaArr[latestIdx];
  const closeBelowEma =
    typeof latest1hEma === "number" &&
    Number.isFinite(latest1hEma) &&
    Number.isFinite(latest1hClose) &&
    latest1hClose < latest1hEma;

  const prev1hOpenSec = latest1hOpenSec - SEC_1H;
  const prevIdx =
    prev1hOpenSec >= fourHourOpenSec ? find1hIndexByOpenSec(pack1h, prev1hOpenSec) : -1;
  const vTopEngulfing =
    prevIdx >= 0 &&
    detectSnowballGradeCVTopEngulfing(
      open[prevIdx]!,
      close[prevIdx]!,
      open[latestIdx]!,
      close[latestIdx]!,
      vTopEngulfRatio
    );

  const wickGateOk = rejectionCount >= minRejections;
  const triggerOk = wickGateOk || vTopEngulfing;

  const partialLatest = {
    rejectionCount,
    wickGateOk,
    latest1hOpenSec,
    latest1hClose,
    latest1hEma: typeof latest1hEma === "number" ? latest1hEma : null,
    closeBelowEma,
    vTopEngulfing,
    vTopEngulfRatio,
  };

  if (!closeBelowEma) {
    return fail(
      `close 1h ล่าสุดในกรอบ (${latest1hClose.toFixed(6)}) ไม่ต่ำกว่า EMA${emaPeriod} (${typeof latest1hEma === "number" ? latest1hEma.toFixed(6) : "—"})`,
      { ...partialLatest, closeBelowEma: false }
    );
  }

  if (!triggerOk) {
    return fail(
      `rejection=${rejectionCount}/${minRejections} (ไส้บน>${wickPctThreshold}%) · ไม่ใช่ V-Top engulf (แท่งก่อนเขียว+แท่งล่าสุดแดงทุบ≥${(vTopEngulfRatio * 100).toFixed(0)}% เนื้อเขียว)`,
      partialLatest
    );
  }

  const triggerDetail = vTopEngulfing
    ? wickGateOk
      ? `rejection=${rejectionCount} + V-Top engulf`
      : `V-Top engulf (แท่งก่อนเขียว · แท่งล่าสุดแดงทุบ≥${(vTopEngulfRatio * 100).toFixed(0)}% เนื้อเขียว)`
    : `rejection=${rejectionCount} (ไส้บน>${wickPctThreshold}%)`;

  let entryStrategy: SnowballGradeCShortEntryStrategy;
  let limitEntryPrice: number | null = null;
  let referenceEntryPrice: number = latest1hClose;
  let vTopTriggerPrice: number | null = null;

  if (wickGateOk) {
    entryStrategy = "wick_limit_retest";
    if (latestWickRejectionIdx >= 0) {
      limitEntryPrice = wickRejectionRetestLimitPrice(
        high[latestWickRejectionIdx]!,
        low[latestWickRejectionIdx]!,
        open[latestWickRejectionIdx]!,
        close[latestWickRejectionIdx]!
      );
    }
    if (limitEntryPrice != null) referenceEntryPrice = limitEntryPrice;
  } else {
    entryStrategy = "vtop_market";
    referenceEntryPrice = latest1hClose;
    if (prevIdx >= 0) {
      vTopTriggerPrice = vTopEngulfTriggerPrice(open[prevIdx]!, close[prevIdx]!, vTopEngulfRatio);
    }
  }

  const entryDetail =
    entryStrategy === "wick_limit_retest"
      ? `entry=Limit retest ไส้บน ~${referenceEntryPrice.toFixed(6)}`
      : `entry=Market V-Top (trigger≤${vTopTriggerPrice != null ? vTopTriggerPrice.toFixed(6) : "—"})`;

  return {
    ok: true,
    rejectionCount,
    minRejections,
    wickPctThreshold,
    wickGateOk,
    vTopEngulfing,
    vTopEngulfRatio,
    emaPeriod,
    fourHourOpenSec,
    latest1hOpenSec,
    latest1hClose,
    latest1hEma: typeof latest1hEma === "number" ? latest1hEma : null,
    closeBelowEma: true,
    entryStrategy,
    limitEntryPrice,
    referenceEntryPrice,
    vTopTriggerPrice,
    detail: `${triggerDetail} · close<EMA${emaPeriod} · ${entryDetail}`,
  };
}

export function formatGradeCShortFadeAutotradeLine(
  fade: SnowballGradeCShortFadeResult | null | undefined
): string {
  if (!fade) {
    return "📎 Auto-open Short (fade): close 1h ล่าสุดในกรอบ 4h < EMA20 และ (rejection ≥2 ไส้บน>50% หรือ V-Top engulf แท่งก่อนเขียว+แท่งล่าสุดแดงทุบ)";
  }
  return fade.ok
    ? `📎 Auto-open Short (fade): ผ่าน gate 1h — ${fade.detail}`
    : `📎 Auto-open Short (fade): ยังไม่ผ่าน — ${fade.detail}`;
}

/** A+ → long ทันที · C → short เมื่อผ่าน fade gate บน 1h ในกรอบ 4h */
export async function resolveSnowballLongAutotradeSide(
  symbol: string,
  grade: SnowballLongAlertGrade | undefined,
  doubleBarrierOn: boolean,
  signalBarOpenSec: number,
  pack1hHint?: BinanceKlinePack | null
): Promise<{ side: SnowballAutoTradeSide | null; fade: SnowballGradeCShortFadeResult | null }> {
  if (doubleBarrierOn && grade === "a_plus") return { side: "long", fade: null };
  if (grade !== "c_plus" || !doubleBarrierOn) return { side: null, fade: null };

  let pack = pack1hHint ?? null;
  if (!pack) pack = await fetchBinanceUsdmKlines(symbol, "1h", 120);
  const fade = evaluateSnowballGradeCShortFade(pack, signalBarOpenSec);
  if (!fade.ok) {
    console.info(`[snowball] Grade C short fade skip ${symbol}: ${fade.detail}`);
  }
  return { side: fade.ok ? "short" : null, fade };
}
