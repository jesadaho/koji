import type { BinanceKlinePack } from "./binanceIndicatorKline";

export type SnowballLongBreakout1hConfirmEval = {
  ok: boolean;
  i1h: number;
  barOpenSec: number;
  close: number;
  open: number;
  priorMaxHigh: number;
  bodyRatio: number;
  volRatio: number;
  volRank: number;
  volRankLookback: number;
  cleanCloseOk: boolean;
  /** ผ่านเกณฑ์เนื้อเทียนมาตรฐาน (> bodyMin) */
  bodyStandardOk: boolean;
  /** God Volume Pass: body ≥ godMin และ vol ≥ godVolMult×SMA */
  bodyGodVolOk: boolean;
  bodyOk: boolean;
  bodyPassMode: "standard" | "god_volume" | null;
  volSmaOk: boolean;
  volRankOk: boolean;
  volOk: boolean;
  detail: string;
};

export type SnowballLongBreakout1hGateStep = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(digits);
}

/** High สูงสุดใน [i−lookback, i−1−excludeRecent] */
function maxHighPriorWindow(high: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

/** อันดับค่าใน окน [start,end] — 1 = สูงสุด */
function valueRankInWindow(values: number[], start: number, end: number, i: number): number {
  const vi = values[i]!;
  const eps = Math.max(1e-12, Math.abs(vi) * 1e-10);
  let strictlyHigher = 0;
  for (let j = start; j <= end; j++) {
    if (j !== i && values[j]! > vi + eps) strictlyHigher++;
  }
  return strictlyHigher + 1;
}

function volumeSmaAtIndex(volume: number[], idx: number, period: number): number {
  const start = Math.max(0, idx - (period - 1));
  let sum = 0;
  let n = 0;
  for (let i = start; i <= idx; i++) {
    const v = volume[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : NaN;
}

function snowballVolSmaPeriod(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_VOL_SMA);
  if (Number.isFinite(v) && v >= 3 && v <= 100) return Math.floor(v);
  return 20;
}

export function snowballLongBreakout1hBodyMinRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_BODY_MIN_RATIO);
  if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  return 0.6;
}

export function snowballLongBreakout1hVolMult(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_VOL_MULT);
  if (Number.isFinite(v) && v >= 1 && v <= 10) return v;
  return 1.5;
}

/** God Volume Pass — vol ต้อง ≥ SMA × mult (default 3×) */
export function snowballLongBreakout1hGodVolMult(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_GOD_VOL_MULT);
  if (Number.isFinite(v) && v >= 2 && v <= 10) return v;
  return 3;
}

/** God Volume Pass — ยอม body/range ต่ำสุด (default 25%) */
export function snowballLongBreakout1hGodBodyMinRatio(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_GOD_BODY_MIN_RATIO);
  if (Number.isFinite(v) && v > 0 && v < 1) return v;
  return 0.25;
}

/** อันดับวอลุ่มในรอบ lookback 1H (default 48 แท่ง ≈ 2 วัน) */
export function snowballLongBreakout1hVolRankLookback(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_VOL_RANK_LOOKBACK);
  if (Number.isFinite(v) && v >= 10 && v <= 200) return Math.floor(v);
  return 48;
}

/** วอลุ่มแท่ง confirm ต้องติดอันดับ ≤ ค่านี้ในรอบ lookback (default 2) */
export function snowballLongBreakout1hVolRankMax(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_VOL_RANK_MAX);
  if (Number.isFinite(v) && v >= 1 && v <= 5) return Math.floor(v);
  return 2;
}

/**
 * Long Breakout 1H confirm — Dynamic Body + God Volume + Volume rank ในรอบ lookback
 * แท่งปิดล่าสุด = index n−2 (แท่งกำลัง live = n−1)
 */
export function evaluateSnowballLongBreakout1hConfirm(
  pack1h: BinanceKlinePack | null,
  swingLookback: number,
  excludeRecent: number,
): SnowballLongBreakout1hConfirmEval | null {
  if (!pack1h?.timeSec?.length) return null;

  const lb = swingLookback;
  const ex = excludeRecent;
  const bodyMin = snowballLongBreakout1hBodyMinRatio();
  const godBodyMin = snowballLongBreakout1hGodBodyMinRatio();
  const volMult = snowballLongBreakout1hVolMult();
  const godVolMult = snowballLongBreakout1hGodVolMult();
  const volRankLb = snowballLongBreakout1hVolRankLookback();
  const volRankMax = snowballLongBreakout1hVolRankMax();
  const volPeriod = snowballVolSmaPeriod();

  const { open, high, low, close, volume, timeSec } = pack1h;
  const n = close.length;
  const i1h = n - 2;
  const minBars = Math.max(lb + ex + 3, volRankLb);
  if (i1h < minBars) {
    return {
      ok: false,
      i1h,
      barOpenSec: typeof timeSec[i1h] === "number" ? timeSec[i1h]! : -1,
      close: NaN,
      open: NaN,
      priorMaxHigh: NaN,
      bodyRatio: NaN,
      volRatio: NaN,
      volRank: NaN,
      volRankLookback: volRankLb,
      cleanCloseOk: false,
      bodyStandardOk: false,
      bodyGodVolOk: false,
      bodyOk: false,
      bodyPassMode: null,
      volSmaOk: false,
      volRankOk: false,
      volOk: false,
      detail: `แท่ง 1H ไม่พอ (ต้อง ≥ ${minBars} แท่งปิด)`,
    };
  }

  const o = open[i1h]!;
  const h = high[i1h]!;
  const l = low[i1h]!;
  const c = close[i1h]!;
  const v = volume[i1h]!;
  const barOpenSec = timeSec[i1h]!;
  if (
    !Number.isFinite(o) ||
    !Number.isFinite(h) ||
    !Number.isFinite(l) ||
    !Number.isFinite(c) ||
    !Number.isFinite(v) ||
    !Number.isFinite(barOpenSec)
  ) {
    return null;
  }

  const bullish = c > o;
  const priorMaxHigh = maxHighPriorWindow(high, i1h, lb, ex);
  const cleanCloseOk = Number.isFinite(priorMaxHigh) && c > priorMaxHigh;

  const range = h - l;
  const bodyRatio = range > 0 && bullish ? (c - o) / range : 0;
  const bodyStandardOk = bullish && bodyRatio >= bodyMin;

  const volSma = volumeSmaAtIndex(volume, i1h, volPeriod);
  const volRatio = Number.isFinite(volSma) && volSma > 0 ? v / volSma : NaN;
  const volSmaOk = Number.isFinite(volRatio) && volRatio >= volMult;
  const bodyGodVolOk = bullish && bodyRatio >= godBodyMin && Number.isFinite(volRatio) && volRatio >= godVolMult;

  let bodyPassMode: SnowballLongBreakout1hConfirmEval["bodyPassMode"] = null;
  if (bodyStandardOk) bodyPassMode = "standard";
  else if (bodyGodVolOk) bodyPassMode = "god_volume";
  const bodyOk = bodyStandardOk || bodyGodVolOk;

  const volWinStart = Math.max(0, i1h - volRankLb + 1);
  const volRank = Number.isFinite(v) && v > 0 ? valueRankInWindow(volume, volWinStart, i1h, i1h) : NaN;
  const volRankOk = Number.isFinite(volRank) && volRank <= volRankMax;
  const volOk = volSmaOk && volRankOk;

  const ok = bullish && cleanCloseOk && bodyOk && volOk;

  const bodyDetail = bodyPassMode === "god_volume"
    ? `God Vol: body/range ${(bodyRatio * 100).toFixed(1)}% ≥ ${(godBodyMin * 100).toFixed(0)}% · vol ${Number.isFinite(volRatio) ? `${volRatio.toFixed(2)}x` : "—"} ≥ ${godVolMult}x`
    : bodyPassMode === "standard"
      ? `มาตรฐาน: body/range ${(bodyRatio * 100).toFixed(1)}% ≥ ${(bodyMin * 100).toFixed(0)}%`
      : `body/range ${(bodyRatio * 100).toFixed(1)}% (ต้อง ≥${(bodyMin * 100).toFixed(0)}% หรือ God ≥${(godBodyMin * 100).toFixed(0)}%+vol≥${godVolMult}x)`;

  const detail = [
    `close ${fmtNum(c)} ${cleanCloseOk ? ">" : "≤"} high${lb}_before (ex ${ex}) ${fmtNum(priorMaxHigh)}`,
    bodyDetail,
    `vol ${Number.isFinite(volRatio) ? `${volRatio.toFixed(2)}x` : "—"} SMA(${volPeriod}) ${volSmaOk ? "≥" : "<"} ${volMult}x · อันดับ ${Number.isFinite(volRank) ? volRank : "—"}/${volRankLb}แท่ง ${volRankOk ? `≤${volRankMax}` : `>${volRankMax}`}`,
  ].join(" · ");

  return {
    ok,
    i1h,
    barOpenSec,
    close: c,
    open: o,
    priorMaxHigh,
    bodyRatio,
    volRatio,
    volRank,
    volRankLookback: volRankLb,
    cleanCloseOk,
    bodyStandardOk,
    bodyGodVolOk,
    bodyOk,
    bodyPassMode,
    volSmaOk,
    volRankOk,
    volOk,
    detail,
  };
}

export function buildSnowballLongBreakout1hConfirmGateSteps(
  pack1h: BinanceKlinePack | null,
  swingLookback: number,
  excludeRecent: number,
): SnowballLongBreakout1hGateStep[] {
  const ev = evaluateSnowballLongBreakout1hConfirm(pack1h, swingLookback, excludeRecent);
  if (!ev) {
    return [
      {
        id: "breakout1hPack",
        label: "Breakout 1H confirm",
        ok: false,
        detail: "ไม่มีข้อมูล 1h",
      },
    ];
  }

  const bodyMin = snowballLongBreakout1hBodyMinRatio();
  const godBodyMin = snowballLongBreakout1hGodBodyMinRatio();
  const godVolMult = snowballLongBreakout1hGodVolMult();
  const volMult = snowballLongBreakout1hVolMult();
  const volRankMax = snowballLongBreakout1hVolRankMax();

  const bodyDetail =
    ev.bodyPassMode === "god_volume"
      ? `God Vol Pass · body/range=${(ev.bodyRatio * 100).toFixed(1)}% (≥${(godBodyMin * 100).toFixed(0)}%+vol≥${godVolMult}x)`
      : ev.bodyPassMode === "standard"
        ? `มาตรฐาน · body/range=${(ev.bodyRatio * 100).toFixed(1)}%`
        : `body/range=${(ev.bodyRatio * 100).toFixed(1)}% · แท่งเขียว=${ev.close > ev.open ? "ใช่" : "ไม่"} · ต้อง ≥${(bodyMin * 100).toFixed(0)}% หรือ God ≥${(godBodyMin * 100).toFixed(0)}%+vol≥${godVolMult}x`;

  return [
    {
      id: "breakout1hCleanClose",
      label: "Clean close > high before (1H)",
      ok: ev.cleanCloseOk,
      detail: `close=${fmtNum(ev.close)} vs priorMaxHigh=${fmtNum(ev.priorMaxHigh)} (lb=${swingLookback} ex=${excludeRecent})`,
    },
    {
      id: "breakout1hBody",
      label: `Dynamic body (มาตรฐาน ≥${(bodyMin * 100).toFixed(0)}% หรือ God Vol ≥${(godBodyMin * 100).toFixed(0)}%+${godVolMult}x)`,
      ok: ev.bodyOk,
      detail: bodyDetail,
    },
    {
      id: "breakout1hVolSma",
      label: `Volume > SMA×${volMult}`,
      ok: ev.volSmaOk,
      detail: `vol/SMA=${Number.isFinite(ev.volRatio) ? `${ev.volRatio.toFixed(2)}x` : "—"}`,
    },
    {
      id: "breakout1hVolRank",
      label: `Volume อันดับ 1–${volRankMax} ในรอบ ${ev.volRankLookback} แท่ง 1H`,
      ok: ev.volRankOk,
      detail: `อันดับ ${Number.isFinite(ev.volRank) ? ev.volRank : "—"} (vol ${Number.isFinite(ev.volRatio) ? `${ev.volRatio.toFixed(2)}x` : "—"} SMA)`,
    },
  ];
}

export function formatSnowballLongBreakout1hCriteriaSummary(excludeRecent: number): string {
  const bodyMin = snowballLongBreakout1hBodyMinRatio();
  const godBodyMin = snowballLongBreakout1hGodBodyMinRatio();
  const godVolMult = snowballLongBreakout1hGodVolMult();
  const volMult = snowballLongBreakout1hVolMult();
  const volRankLb = snowballLongBreakout1hVolRankLookback();
  const volRankMax = snowballLongBreakout1hVolRankMax();
  return (
    `close > high ก่อนหน้า (ex ${excludeRecent} แท่ง) · ` +
    `body ≥${(bodyMin * 100).toFixed(0)}% หรือ God ≥${(godBodyMin * 100).toFixed(0)}%+vol≥${godVolMult}x · ` +
    `vol > SMA×${volMult} · อันดับ vol ≤${volRankMax} ใน ${volRankLb} แท่ง 1H`
  );
}
