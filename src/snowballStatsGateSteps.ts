/**
 * ขั้น gate confirm สำหรับบันทึกสถิติ (server-side append)
 */

import type { BinanceIndicatorTf, BinanceKlinePack } from "./binanceIndicatorKline";
import { snowballTfBarDurationSec } from "./snowballLongBreakoutGrade";
import {
  evaluateSnowballTwoBarInlineLong,
  snowballConfirmVolMinRatio,
  snowballMinLow1hBetweenClosedBars,
  snowballTwoBarInlinePullbackMaxFrac,
} from "./snowballTwoBarInline";

export type SnowballStatsGateStep = {
  label: string;
  ok: boolean;
  detail: string;
};

function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toFixed(digits);
}

/** Two-bar inline — ขั้น confirm LONG (4h) */
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
  const ev = evaluateSnowballTwoBarInlineLong({
    close,
    high,
    low,
    volume,
    timeSec,
    iSig,
    iConf,
    snowTf,
    pack1h,
  });
  const frac = snowballTwoBarInlinePullbackMaxFrac();
  const sigH = high[iSig]!;
  const sigL = low[iSig]!;
  const sigC = close[iSig]!;
  const confC = close[iConf]!;
  const sigV = volume[iSig]!;
  const confV = volume[iConf]!;
  const dur = snowballTfBarDurationSec(snowTf);
  const sigOpen = timeSec[iSig]!;
  const confEnd = timeSec[iConf]! + dur;
  let minL: number | null = null;
  if (pack1h?.timeSec?.length) {
    minL = snowballMinLow1hBetweenClosedBars(pack1h.timeSec, pack1h.low, sigOpen, confEnd);
  }
  const range = sigH - sigL;
  const vr = snowballConfirmVolMinRatio();

  return [
    {
      label: "Pullback แท่ง confirm (LONG)",
      ok: ev.pullbackOk,
      detail:
        range > 0
          ? `close confirm ≥ close สัญญาณ − ${(frac * 100).toFixed(0)}%×range (${fmtNum(sigC - frac * range)})`
          : "ช่วงแท่งสัญญาณไม่ถูกต้อง",
    },
    {
      label: "Vol แท่ง confirm / แท่งสัญญาณ",
      ok: ev.volRatioOk,
      detail: `อัตราส่วน ${sigV > 0 ? fmtNum(confV / sigV, 4) : "—"} (ต้อง ≥ ${vr})`,
    },
    {
      label: "Low 1H ในช่วงสองแท่ง ≥ Low สัญญาณ",
      ok: ev.minLow1hOk,
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
  _swingExcludeRecent: number,
  _asOfSec?: number,
): SnowballStatsGateStep[] {
  if (snowTf === "4h" && twoBarInput) {
    return buildSnowballTwoBarLongConfirmGateSteps(twoBarInput);
  }
  return [];
}
