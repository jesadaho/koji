import type { BinanceIndicatorTf, BinanceKlinePack } from "./binanceIndicatorKline";
import { snowballTfBarDurationSec } from "./snowballLongBreakoutGrade";

export type SnowballTwoBarInlineEval = {
  ok: boolean;
  pullbackOk: boolean;
  volRatioOk: boolean;
  minLow1hOk: boolean;
  /** แท่ง confirm ไม่ใช่โดจิกลับหัว / shooting star ที่ยอด */
  confirmNotInvertedDojiOk: boolean;
  detail: string;
};

export type SnowballConfirmInvertedDojiEval = {
  blocked: boolean;
  bodyRatio: number;
  upperWickRatio: number;
  closePositionRatio: number;
  bearish: boolean;
};

/** บล็อกแท่ง confirm LONG ถ้าเป็นโดจิกลับหัว / shooting star — ดีฟอลต์เปิด */
export function snowballTwoBarConfirmInvertedDojiBlockEnabled(): boolean {
  const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_CONFIRM_INVERTED_DOJI_BLOCK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

/** เนื้อเทียน / range สูงสุดบนแท่ง confirm (โดจิ / ไส้ยาว) */
export function snowballTwoBarConfirmInvertedDojiBodyMax(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_CONFIRM_INVERTED_DOJI_BODY_MAX);
  if (Number.isFinite(v) && v > 0 && v <= 0.5) return v;
  return 0.35;
}

/** ไส้บน / range ขั้นต่ำบนแท่ง confirm */
export function snowballTwoBarConfirmInvertedDojiUpperWickMin(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_CONFIRM_INVERTED_DOJI_UPPER_WICK_MIN);
  if (Number.isFinite(v) && v > 0 && v <= 0.95) return v;
  return 0.45;
}

/** shooting star (เขียว): ปิดต้องอยู่ในราว ratio ล่างของแท่ง */
export function snowballTwoBarConfirmInvertedDojiCloseLowMax(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_CONFIRM_INVERTED_DOJI_CLOSE_LOW_MAX);
  if (Number.isFinite(v) && v > 0 && v <= 0.55) return v;
  return 0.45;
}

/**
 * แท่ง confirm LONG — โดจิกลับหัว (แดง + ไส้บนยาว + เนื้อเล็ก) หรือ shooting star (ปิดต่ำในแท่ง + ไส้บนยาว)
 */
export function evaluateSnowballConfirmInvertedDojiLong(
  open: number,
  high: number,
  low: number,
  close: number,
): SnowballConfirmInvertedDojiEval {
  const nan = {
    blocked: false,
    bodyRatio: NaN,
    upperWickRatio: NaN,
    closePositionRatio: NaN,
    bearish: false,
  };
  if (![open, high, low, close].every((x) => Number.isFinite(x))) return nan;
  const eps = Math.max(1e-12, Math.abs(high) * 1e-10);
  const range = high - low;
  if (!(range > eps)) return nan;

  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const bodyRatio = body / range;
  const upperWickRatio = upperWick / range;
  const closePositionRatio = (close - low) / range;
  const bearish = close < open;

  if (!snowballTwoBarConfirmInvertedDojiBlockEnabled()) {
    return { blocked: false, bodyRatio, upperWickRatio, closePositionRatio, bearish };
  }

  const bodyMax = snowballTwoBarConfirmInvertedDojiBodyMax();
  const wickMin = snowballTwoBarConfirmInvertedDojiUpperWickMin();
  const closeLowMax = snowballTwoBarConfirmInvertedDojiCloseLowMax();
  const toppingWick = upperWickRatio >= wickMin && bodyRatio <= bodyMax;
  const bearishInvertedDoji = bearish && toppingWick;
  const shootingStar = toppingWick && closePositionRatio <= closeLowMax;

  return {
    blocked: bearishInvertedDoji || shootingStar,
    bodyRatio,
    upperWickRatio,
    closePositionRatio,
    bearish,
  };
}

export function snowballConfirmVolMinRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_CONFIRM_VOL_MIN_RATIO);
  if (Number.isFinite(v) && v >= 0 && v <= 5) return v;
  return 0.6;
}

export function snowballTwoBarInlinePullbackMaxFrac(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_INLINE_MAX_PULLBACK_OF_RANGE);
  if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  return 0.3;
}

/** Low ต่ำสุดของแท่ง 1h ที่ปิดในช่วง (signalOpenSec, confirmBarEndSec] */
export function snowballMinLow1hBetweenClosedBars(
  timeSec1h: number[],
  low1h: number[],
  signalOpenSec: number,
  confirmBarEndSec: number,
): number | null {
  const H1 = 3600;
  let minL = Infinity;
  let hit = false;
  for (let i = 0; i < timeSec1h.length; i++) {
    const barEnd = timeSec1h[i]! + H1;
    if (barEnd <= signalOpenSec) continue;
    if (barEnd > confirmBarEndSec) continue;
    const lo = low1h[i];
    if (typeof lo === "number" && Number.isFinite(lo)) {
      hit = true;
      minL = Math.min(minL, lo);
    }
  }
  if (!hit || !Number.isFinite(minL)) return null;
  return minL;
}

/** Two-bar inline บนแท่ง Snowball TF (4h) — Pullback · Vol ratio · Min-Low 1H · ห้าม confirm โดจิกลับหัว */
export function evaluateSnowballTwoBarInlineLong(input: {
  open: number[];
  close: number[];
  high: number[];
  low: number[];
  volume: number[];
  timeSec: number[];
  iSig: number;
  iConf: number;
  snowTf: BinanceIndicatorTf;
  pack1h: BinanceKlinePack | null;
}): SnowballTwoBarInlineEval {
  const { open, close, high, low, volume, timeSec, iSig, iConf, snowTf, pack1h } = input;
  const dur = snowballTfBarDurationSec(snowTf);
  const sigOpen = timeSec[iSig]!;
  const confEnd = timeSec[iConf]! + dur;
  const sigH = high[iSig]!;
  const sigL = low[iSig]!;
  const sigC = close[iSig]!;
  const confC = close[iConf]!;
  const sigV = volume[iSig]!;
  const confV = volume[iConf]!;
  const range = sigH - sigL;
  const frac = snowballTwoBarInlinePullbackMaxFrac();
  const vr = snowballConfirmVolMinRatio();

  const rangeOk = Number.isFinite(range) && range > 0;
  const pullbackOk =
    rangeOk &&
    Number.isFinite(confC) &&
    Number.isFinite(sigC) &&
    confC >= sigC - frac * range;
  const volRatioOk = sigV > 0 && Number.isFinite(confV) && confV / sigV >= vr;

  let minL: number | null = null;
  if (pack1h?.timeSec?.length) {
    minL = snowballMinLow1hBetweenClosedBars(pack1h.timeSec, pack1h.low, sigOpen, confEnd);
  }
  const minLow1hOk = minL != null && minL >= sigL;

  const confO = open[iConf]!;
  const confH = high[iConf]!;
  const confL = low[iConf]!;
  const invertedDoji = evaluateSnowballConfirmInvertedDojiLong(confO, confH, confL, confC);
  const confirmNotInvertedDojiOk = !invertedDoji.blocked;

  const ok = pullbackOk && volRatioOk && minLow1hOk && confirmNotInvertedDojiOk;
  const parts: string[] = [];
  parts.push(
    pullbackOk
      ? `Pullback OK (close confirm ≥ close สัญญาณ − ${(frac * 100).toFixed(0)}%×range)`
      : `Pullback fail (ต้อง ≥ close สัญญาณ − ${(frac * 100).toFixed(0)}%×range)`,
  );
  parts.push(
    volRatioOk
      ? `Vol ratio OK (${sigV > 0 ? (confV / sigV).toFixed(2) : "—"} ≥ ${vr})`
      : `Vol ratio fail (ต้อง ≥ ${vr})`,
  );
  parts.push(
    minLow1hOk
      ? `Min-Low 1H OK (${minL != null ? minL : "—"} ≥ low สัญญาณ ${sigL})`
      : pack1h?.timeSec?.length
        ? `Min-Low 1H fail (min ${minL ?? "—"} < low สัญญาณ ${sigL})`
        : "Min-Low 1H fail (ไม่มีข้อมูล 1H)",
  );
  if (confirmNotInvertedDojiOk) {
    parts.push("Confirm ไม่ใช่โดจิกลับหัว");
  } else {
    const wickPct = (invertedDoji.upperWickRatio * 100).toFixed(1);
    const bodyPct = (invertedDoji.bodyRatio * 100).toFixed(1);
    const closePosPct = (invertedDoji.closePositionRatio * 100).toFixed(1);
    parts.push(
      `Confirm โดจิกลับหัว BLOCK (ไส้บน ${wickPct}% · เนื้อ ${bodyPct}% · ปิดที่ ${closePosPct}% ของแท่ง${invertedDoji.bearish ? " · แดง" : ""})`,
    );
  }

  return {
    ok,
    pullbackOk,
    volRatioOk,
    minLow1hOk,
    confirmNotInvertedDojiOk,
    detail: parts.join(" · "),
  };
}
