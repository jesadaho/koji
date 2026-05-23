/**
 * ขั้น gate confirm สำหรับบันทึกสถิติ (server-side append)
 */

import type { BinanceIndicatorTf, BinanceKlinePack } from "./binanceIndicatorKline";
import {
  buildSnowballLongBreakout1hConfirmGateSteps,
  snowballLongBreakout1hSwingLookback,
} from "./snowballLongBreakoutConfirm";
import { snowballTfBarDurationSec } from "./snowballLongBreakoutGrade";

export type SnowballStatsGateStep = {
  label: string;
  ok: boolean;
  detail: string;
};

function snowballConfirmVolMinRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_CONFIRM_VOL_MIN_RATIO);
  if (Number.isFinite(v) && v >= 0 && v <= 5) return v;
  return 0.6;
}

function snowballTwoBarInlinePullbackMaxFrac(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_TWO_BAR_INLINE_MAX_PULLBACK_OF_RANGE);
  if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  return 0.3;
}

function snowballMinLow1hBetweenClosedBars(
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

function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toFixed(digits);
}

/** Two-bar inline — ขั้น confirm LONG */
export function buildSnowballTwoBarLongConfirmGateSteps(input: {
  close: number[];
  high: number[];
  low: number[];
  volume: number[];
  timeSec: number[];
  iSig: number;
  iConf: number;
  snowTf: BinanceIndicatorTf;
  pack1h: BinanceKlinePack | null;
}): SnowballStatsGateStep[] {
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
  const pullLongOk = rangeOk && Number.isFinite(confC) && confC >= sigC - frac * range;
  const volOk = sigV > 0 && Number.isFinite(confV) && confV / sigV >= vr;

  let minL: number | null = null;
  if (pack1h?.timeSec?.length) {
    minL = snowballMinLow1hBetweenClosedBars(pack1h.timeSec, pack1h.low, sigOpen, confEnd);
  }
  const h1LongOk = minL != null && minL >= sigL;

  return [
    {
      label: "Pullback แท่ง confirm (LONG)",
      ok: pullLongOk,
      detail: rangeOk
        ? `close confirm ≥ close สัญญาณ − ${(frac * 100).toFixed(0)}%×range (${fmtNum(sigC - frac * range)})`
        : "ช่วงแท่งสัญญาณไม่ถูกต้อง",
    },
    {
      label: "Vol แท่ง confirm / แท่งสัญญาณ",
      ok: volOk,
      detail: `อัตราส่วน ${sigV > 0 ? fmtNum(confV / sigV, 4) : "—"} (ต้อง ≥ ${vr})`,
    },
    {
      label: "Low 1H ในช่วงสองแท่ง ≥ Low สัญญาณ",
      ok: Boolean(pack1h?.timeSec?.length) && h1LongOk,
      detail: pack1h?.timeSec?.length
        ? `min low 1H = ${minL != null ? fmtNum(minL) : "—"} · low สัญญาณ = ${fmtNum(sigL)}`
        : "ไม่มีข้อมูล 1H",
    },
  ];
}

export function buildSnowballLongConfirmGateStepsForStats(
  snowTf: BinanceIndicatorTf,
  twoBarInline: boolean,
  pack1h: BinanceKlinePack | null,
  twoBarInput: Parameters<typeof buildSnowballTwoBarLongConfirmGateSteps>[0] | null,
  swingExcludeRecent: number,
): SnowballStatsGateStep[] {
  if (twoBarInline && twoBarInput) {
    return buildSnowballTwoBarLongConfirmGateSteps(twoBarInput);
  }
  if (snowTf !== "4h" && pack1h) {
    return buildSnowballLongBreakout1hConfirmGateSteps(
      pack1h,
      snowballLongBreakout1hSwingLookback(),
      swingExcludeRecent,
    ).map((s) => ({ label: s.label, ok: s.ok, detail: s.detail }));
  }
  return [];
}
