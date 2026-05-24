import type { BinanceIndicatorTf, BinanceKlinePack } from "./binanceIndicatorKline";
import { snowballTfBarDurationSec } from "./snowballLongBreakoutGrade";

export type SnowballTwoBarInlineEval = {
  ok: boolean;
  pullbackOk: boolean;
  volRatioOk: boolean;
  minLow1hOk: boolean;
  detail: string;
};

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

/** Two-bar inline บนแท่ง Snowball TF (4h) — Pullback · Vol ratio · Min-Low 1H */
export function evaluateSnowballTwoBarInlineLong(input: {
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
  const { close, high, low, volume, timeSec, iSig, iConf, snowTf, pack1h } = input;
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

  const ok = pullbackOk && volRatioOk && minLow1hOk;
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

  return { ok, pullbackOk, volRatioOk, minLow1hOk, detail: parts.join(" · ") };
}
