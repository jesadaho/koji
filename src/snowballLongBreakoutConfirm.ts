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
  /** โหมด 2 แท่ง 1H ปิดล่าสุด — แท่งล่าสุดใช้เป็น entry/anchor */
  twoBarMode?: "single" | "split" | "strict";
  /** index แท่งที่ให้ bodyOk (ถ้ามี) */
  bodyFromBarIndex?: number | null;
  /** index แท่งที่ให้ volOk (ถ้ามี) */
  volFromBarIndex?: number | null;
};

export type SnowballLongBreakout1hGateStep = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}

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

/** Swing HH/LL บน 1H — ดีฟอลต์เท่า INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK (48 แท่ง) */
function snowballSwingLookbackBarsDefault(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 400) return Math.floor(v);
  return 48;
}

/** ไม่นับ high แท่งล่าสุด N แท่งบน 1H ก่อนแท่ง confirm — ค่าเริ่ม 3 */
export function snowballLongBreakout1hExcludeRecent(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_EXCLUDE_RECENT);
  if (Number.isFinite(v) && v >= 3 && v <= 4) return Math.floor(v);
  const ex = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_SWING_EXCLUDE_RECENT_BARS);
  if (Number.isFinite(ex) && ex >= 3 && ex <= 4) return Math.floor(ex);
  return 3;
}

/** Lookback สำหรับ high24h_before บน 1H — ค่าเริ่มเท่า Swing HH48 */
export function snowballLongBreakout1hSwingLookback(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_SWING_LOOKBACK);
  if (Number.isFinite(v) && v >= 5 && v <= 400) return Math.floor(v);
  return snowballSwingLookbackBarsDefault();
}

/** อันดับวอลุ่มในรอบ lookback 1H (default 48 แท่ง ≈ 2 วัน) */
export function snowballLongBreakout1hVolRankLookback(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_VOL_RANK_LOOKBACK);
  if (Number.isFinite(v) && v >= 10 && v <= 200) return Math.floor(v);
  return 48;
}

/** วอลุ่มแท่ง confirm ต้องติดอันดับ ≤ ค่านี้ในรอบ lookback (default 5, env สูงสุด 8) */
export function snowballLongBreakout1hVolRankMax(): number {
  const v = Number(process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_VOL_RANK_MAX);
  if (Number.isFinite(v) && v >= 1 && v <= 8) return Math.floor(v);
  return 5;
}

/** ดู 2 แท่ง 1H ปิดล่าสุด (n−2, n−3) แทนรอ pending — ค่าเริ่มเปิด */
export function snowballLongBreakout1hTwoBarEnabled(): boolean {
  return envFlagOn("INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_TWO_BAR_ENABLED", true);
}

export type SnowballLongBreakout1hTwoBarMode = "split" | "strict";

export function snowballLongBreakout1hTwoBarMode(): SnowballLongBreakout1hTwoBarMode {
  const raw = process.env.INDICATOR_PUBLIC_SNOWBALL_LONG_BREAKOUT_1H_TWO_BAR_MODE?.trim().toLowerCase();
  if (raw === "strict") return "strict";
  return "split";
}

type BarEvalParams = {
  bodyMin: number;
  godBodyMin: number;
  volMult: number;
  godVolMult: number;
  volRankLb: number;
  volRankMax: number;
  volPeriod: number;
};

function evaluateSnowballLongBreakout1hAtIndex(
  pack1h: BinanceKlinePack,
  i1h: number,
  swingLookback: number,
  excludeRecent: number,
  params: BarEvalParams,
): SnowballLongBreakout1hConfirmEval | null {
  const { open, high, low, close, volume, timeSec } = pack1h;
  const { bodyMin, godBodyMin, volMult, godVolMult, volRankLb, volRankMax, volPeriod } = params;
  const lb = swingLookback;
  const ex = excludeRecent;

  const o = open[i1h];
  const h = high[i1h];
  const l = low[i1h];
  const c = close[i1h];
  const v = volume[i1h];
  const barOpenSec = timeSec[i1h];
  if (
    typeof o !== "number" ||
    typeof h !== "number" ||
    typeof l !== "number" ||
    typeof c !== "number" ||
    typeof v !== "number" ||
    typeof barOpenSec !== "number" ||
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
    `[i=${i1h}] close ${fmtNum(c)} ${cleanCloseOk ? ">" : "≤"} high${lb}_before (ex ${ex}) ${fmtNum(priorMaxHigh)}`,
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

function pickBarEval(
  latest: SnowballLongBreakout1hConfirmEval,
  prev: SnowballLongBreakout1hConfirmEval | null,
  i: number | null,
): SnowballLongBreakout1hConfirmEval {
  if (i == null) return latest;
  if (prev && prev.i1h === i) return prev;
  if (latest.i1h === i) return latest;
  return latest;
}

function mergeTwoBarSplit(
  latest: SnowballLongBreakout1hConfirmEval,
  prev: SnowballLongBreakout1hConfirmEval | null,
): SnowballLongBreakout1hConfirmEval {
  const structOk = latest.cleanCloseOk && latest.close > latest.open;
  const bodyFrom = latest.bodyOk ? latest.i1h : prev?.bodyOk ? prev.i1h : null;
  const volFrom = latest.volOk ? latest.i1h : prev?.volOk ? prev.i1h : null;
  const momentumOk = bodyFrom != null || volFrom != null;
  const ok = structOk && momentumOk;

  const bodyBar = pickBarEval(latest, prev, bodyFrom);
  const volBar = pickBarEval(latest, prev, volFrom);

  const parts: string[] = [
    `2-bar split: โครงสร้างแท่งล่าสุด [i=${latest.i1h}] ${structOk ? "ผ่าน" : "ไม่ผ่าน"}`,
    `body จากแท่ง ${bodyFrom != null ? `[i=${bodyFrom}]` : "—"}`,
    `vol จากแท่ง ${volFrom != null ? `[i=${volFrom}]` : "—"}`,
  ];
  if (prev) parts.push(`แท่งก่อน: ${prev.detail}`);
  parts.push(`แท่งล่าสุด: ${latest.detail}`);

  return {
    ...latest,
    ok,
    cleanCloseOk: structOk,
    bodyOk: bodyFrom != null,
    bodyStandardOk: bodyBar.bodyStandardOk,
    bodyGodVolOk: bodyBar.bodyGodVolOk,
    bodyPassMode: bodyBar.bodyPassMode,
    bodyRatio: bodyBar.bodyRatio,
    volOk: volFrom != null,
    volSmaOk: volBar.volSmaOk,
    volRankOk: volBar.volRankOk,
    volRatio: volBar.volRatio,
    volRank: volBar.volRank,
    bodyFromBarIndex: bodyFrom,
    volFromBarIndex: volFrom,
    twoBarMode: "split",
    detail: parts.join(" | "),
  };
}

function mergeTwoBarStrict(
  latest: SnowballLongBreakout1hConfirmEval,
  prev: SnowballLongBreakout1hConfirmEval | null,
): SnowballLongBreakout1hConfirmEval {
  const ok = latest.ok || Boolean(prev?.ok);
  const winner = prev?.ok ? prev : latest.ok ? latest : latest;
  const detail = prev
    ? `2-bar strict: ${ok ? "ผ่าน" : "ไม่ผ่าน"} · แท่งก่อน ${prev.ok ? "✓" : "✗"} · แท่งล่าสุด ${latest.ok ? "✓" : "✗"} | ${winner.detail}`
    : `2-bar strict (แท่งเดียว): ${latest.detail}`;

  return {
    ...latest,
    ok,
    twoBarMode: "strict",
    detail,
  };
}

/** แท่ง 1H ปิดล่าสุดที่ close time ≤ asOfSec */
export function latestSnowball1hClosedIndexAtOrBefore(timeSec: number[], asOfSec: number): number {
  let best = -1;
  for (let i = 0; i < timeSec.length; i++) {
    const t = timeSec[i]!;
    if (Number.isFinite(t) && t + 3600 <= asOfSec) best = i;
  }
  return best;
}

function evaluateSnowballLongBreakout1hAtLatestIndex(
  pack1h: BinanceKlinePack,
  iLatest: number,
  swingLookback: number,
  excludeRecent: number,
): SnowballLongBreakout1hConfirmEval | null {
  const lb = swingLookback;
  const ex = excludeRecent;
  const params: BarEvalParams = {
    bodyMin: snowballLongBreakout1hBodyMinRatio(),
    godBodyMin: snowballLongBreakout1hGodBodyMinRatio(),
    volMult: snowballLongBreakout1hVolMult(),
    godVolMult: snowballLongBreakout1hGodVolMult(),
    volRankLb: snowballLongBreakout1hVolRankLookback(),
    volRankMax: snowballLongBreakout1hVolRankMax(),
    volPeriod: snowballVolSmaPeriod(),
  };

  const minBars = Math.max(lb + ex + 3, params.volRankLb);
  const { timeSec } = pack1h;

  if (iLatest < minBars) {
    return {
      ok: false,
      i1h: iLatest,
      barOpenSec: typeof timeSec[iLatest] === "number" ? timeSec[iLatest]! : -1,
      close: NaN,
      open: NaN,
      priorMaxHigh: NaN,
      bodyRatio: NaN,
      volRatio: NaN,
      volRank: NaN,
      volRankLookback: params.volRankLb,
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

  const latest = evaluateSnowballLongBreakout1hAtIndex(pack1h, iLatest, lb, ex, params);
  if (!latest) return null;

  if (!snowballLongBreakout1hTwoBarEnabled() || iLatest < 1) {
    return { ...latest, twoBarMode: "single" };
  }

  const iPrev = iLatest - 1;
  const prev =
    iPrev >= minBars ? evaluateSnowballLongBreakout1hAtIndex(pack1h, iPrev, lb, ex, params) : null;

  if (snowballLongBreakout1hTwoBarMode() === "strict") {
    return mergeTwoBarStrict(latest, prev);
  }

  return mergeTwoBarSplit(latest, prev);
}

/**
 * Long Breakout 1H confirm — Dynamic Body + God Volume + Volume rank
 * แท่งปิดล่าสุด = index n−2; โหมด 2-bar ดู n−2 และ n−3
 */
export function evaluateSnowballLongBreakout1hConfirm(
  pack1h: BinanceKlinePack | null,
  swingLookback: number,
  excludeRecent: number,
): SnowballLongBreakout1hConfirmEval | null {
  if (!pack1h?.timeSec?.length) return null;
  const iLatest = pack1h.timeSec.length - 2;
  return evaluateSnowballLongBreakout1hAtLatestIndex(pack1h, iLatest, swingLookback, excludeRecent);
}

/** ยืนยัน 2 แท่ง 1H ณ เวลา asOfSec (ใช้ follow-up สถิติ +4h) */
export function evaluateSnowballLongBreakout1hConfirmAsOf(
  pack1h: BinanceKlinePack | null,
  asOfSec: number,
  swingLookback: number,
  excludeRecent: number,
): SnowballLongBreakout1hConfirmEval | null {
  if (!pack1h?.timeSec?.length) return null;
  const iLatest = latestSnowball1hClosedIndexAtOrBefore(pack1h.timeSec, asOfSec);
  if (iLatest < 0) return null;
  return evaluateSnowballLongBreakout1hAtLatestIndex(pack1h, iLatest, swingLookback, excludeRecent);
}

export function buildSnowballLongBreakout1hConfirmGateSteps(
  pack1h: BinanceKlinePack | null,
  swingLookback: number,
  excludeRecent: number,
  /** Unix sec — ยืนยัน 1H ณ เวลาแจ้ง (backfill สถิติ); ไม่ใส่ = แท่งปิดล่าสุด */
  asOfSec?: number,
): SnowballLongBreakout1hGateStep[] {
  const ev =
    asOfSec != null && Number.isFinite(asOfSec)
      ? evaluateSnowballLongBreakout1hConfirmAsOf(pack1h, asOfSec, swingLookback, excludeRecent)
      : evaluateSnowballLongBreakout1hConfirm(pack1h, swingLookback, excludeRecent);
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
  const twoBar = ev.twoBarMode === "split" || ev.twoBarMode === "strict";

  const bodyDetail =
    ev.bodyPassMode === "god_volume"
      ? `God Vol Pass · body/range=${(ev.bodyRatio * 100).toFixed(1)}% (≥${(godBodyMin * 100).toFixed(0)}%+vol≥${godVolMult}x)`
      : ev.bodyPassMode === "standard"
        ? `มาตรฐาน · body/range=${(ev.bodyRatio * 100).toFixed(1)}%`
        : `body/range=${(ev.bodyRatio * 100).toFixed(1)}% · แท่งเขียว=${ev.close > ev.open ? "ใช่" : "ไม่"} · ต้อง ≥${(bodyMin * 100).toFixed(0)}% หรือ God ≥${(godBodyMin * 100).toFixed(0)}%+vol≥${godVolMult}x`;

  const bodyExtra =
    twoBar && ev.bodyFromBarIndex != null ? ` · จากแท่ง i=${ev.bodyFromBarIndex}` : "";
  const volExtra = twoBar && ev.volFromBarIndex != null ? ` · จากแท่ง i=${ev.volFromBarIndex}` : "";

  const steps: SnowballLongBreakout1hGateStep[] = [
    {
      id: "breakout1hCleanClose",
      label: twoBar ? "Clean close > high before (แท่ง 1H ล่าสุด)" : "Clean close > high before (1H)",
      ok: ev.cleanCloseOk,
      detail: `close=${fmtNum(ev.close)} vs priorMaxHigh=${fmtNum(ev.priorMaxHigh)} (lb=${swingLookback} ex=${excludeRecent})`,
    },
    {
      id: "breakout1hBody",
      label: twoBar
        ? `Dynamic body — ผ่านที่แท่งใดแท่งหนึ่งใน 2 แท่งล่าสุด (มาตรฐาน ≥${(bodyMin * 100).toFixed(0)}% หรือ God Vol)`
        : `Dynamic body (มาตรฐาน ≥${(bodyMin * 100).toFixed(0)}% หรือ God Vol ≥${(godBodyMin * 100).toFixed(0)}%+${godVolMult}x)`,
      ok: ev.bodyOk,
      detail: bodyDetail + bodyExtra,
    },
    {
      id: "breakout1hVolSma",
      label: twoBar ? `Volume > SMA×${volMult} (2-bar)` : `Volume > SMA×${volMult}`,
      ok: ev.volSmaOk,
      detail: `vol/SMA=${Number.isFinite(ev.volRatio) ? `${ev.volRatio.toFixed(2)}x` : "—"}${volExtra}`,
    },
    {
      id: "breakout1hVolRank",
      label: `Volume อันดับ 1–${volRankMax} ในรอบ ${ev.volRankLookback} แท่ง 1H`,
      ok: ev.volRankOk,
      detail: `อันดับ ${Number.isFinite(ev.volRank) ? ev.volRank : "—"} (vol ${Number.isFinite(ev.volRatio) ? `${ev.volRatio.toFixed(2)}x` : "—"} SMA)${volExtra}`,
    },
  ];

  if (twoBar) {
    steps.unshift({
      id: "breakout1hTwoBar",
      label: `โหมด 2-bar 1H (${ev.twoBarMode})`,
      ok: ev.ok,
      detail: ev.detail.length > 200 ? `${ev.detail.slice(0, 197)}…` : ev.detail,
    });
  }

  return steps;
}

export function formatSnowballLongBreakout1hCriteriaSummary(excludeRecent: number): string {
  const bodyMin = snowballLongBreakout1hBodyMinRatio();
  const godBodyMin = snowballLongBreakout1hGodBodyMinRatio();
  const godVolMult = snowballLongBreakout1hGodVolMult();
  const volMult = snowballLongBreakout1hVolMult();
  const volRankLb = snowballLongBreakout1hVolRankLookback();
  const volRankMax = snowballLongBreakout1hVolRankMax();
  const twoBar = snowballLongBreakout1hTwoBarEnabled();
  const mode = snowballLongBreakout1hTwoBarMode();
  const twoBarNote = twoBar
    ? mode === "strict"
      ? " · 2-bar strict: แท่งใดแท่งหนึ่งผ่านครบ 4 ข้อ"
      : " · 2-bar split: โครงสร้างแท่งล่าสุด + body/vol จาก 2 แท่งปิดล่าสุด"
    : "";
  return (
    `close > high ก่อนหน้า (ex ${excludeRecent} แท่ง) · ` +
    `body ≥${(bodyMin * 100).toFixed(0)}% หรือ God ≥${(godBodyMin * 100).toFixed(0)}%+vol≥${godVolMult}x · ` +
    `vol > SMA×${volMult} · อันดับ vol ≤${volRankMax} ใน ${volRankLb} แท่ง 1H` +
    twoBarNote
  );
}
