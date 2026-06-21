import { emaLine } from "./indicatorMath";
import type { BinanceKlinePack } from "./binanceIndicatorKline";
import { statsRangeRankInWindow } from "@/lib/statsLenPercentile";
import {
  candleReversalBarVolVsSma,
  candleReversalModelLabelTh,
  fmtReversalPrice,
  invertedDoji1hTierPasses,
  isLongestGreenBody1hEmaZoneOk,
  isLongestRedBody1hEmaZoneOk,
  longestGreenBody1hEmaDistancePct,
  longestRedBody1hEmaDistancePct,
  longestRedBody1hHighRankMaxForBar,
  longestRedBody1hHighRankPass,
  type CandleReversal1dDetectEnv,
  type CandleReversal1hDetectEnv,
  type CandleReversal1hLongDetectEnv,
  type CandleReversalInvertedDojiVolTier,
  type CandleReversalModel,
  type CandleReversalSignal,
  type CandleReversalTf,
} from "./candleReversalDetect";

export type CandleReversalDebugCheckItem = {
  ok: boolean;
  label: string;
  detail: string;
};

export type CandleReversalDebugModelSection = {
  emoji: string;
  title: string;
  pass: boolean;
  items: CandleReversalDebugCheckItem[];
};

function maxHighInWindowInclusive(high: number[], start: number, end: number): number {
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

function maxHighPriorWindow(high: number[], i: number, lookback: number, excludeRecentTrailing: number): number {
  const end = i - 1 - excludeRecentTrailing;
  const start = Math.max(0, i - lookback);
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) m = Math.max(m, high[j]!);
  return m;
}

function maxRedBodyInWindow(open: number[], close: number[], start: number, end: number): number {
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) {
    if (close[j]! < open[j]!) {
      const body = open[j]! - close[j]!;
      if (body > m) m = body;
    }
  }
  return m;
}

function maxGreenBodyInWindow(open: number[], close: number[], start: number, end: number): number {
  if (end < start) return -Infinity;
  let m = -Infinity;
  for (let j = start; j <= end; j++) {
    if (close[j]! > open[j]!) {
      const body = close[j]! - open[j]!;
      if (body > m) m = body;
    }
  }
  return m;
}

function valueRankInWindow(values: number[], start: number, end: number, i: number): number {
  const vi = values[i]!;
  const eps = Math.max(1e-12, Math.abs(vi) * 1e-10);
  let strictlyHigher = 0;
  for (let j = start; j <= end; j++) {
    if (values[j]! > vi + eps) strictlyHigher += 1;
  }
  return strictlyHigher + 1;
}

function highRankInWindow(high: number[], start: number, end: number, i: number): number {
  return valueRankInWindow(high, start, end, i);
}

function lowRankInWindow(low: number[], start: number, end: number, i: number): number {
  return valueRankInWindow(low, start, end, i);
}

function volumeRankInWindow(vol: number[], start: number, end: number, i: number): number {
  return valueRankInWindow(vol, start, end, i);
}

function itemMark(ok: boolean): string {
  return ok ? "[✓]" : "[❌]";
}

function fmtUtcNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function fmtBkkFromSec(sec: number): string {
  const d = new Date(sec * 1000);
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}

function pairSlash(sym: string): string {
  const s = sym.trim().toUpperCase().replace(/^@/, "");
  const base = s.endsWith("USDT") ? s.slice(0, -4) : s;
  return `${base}/USDT`;
}

function emaZoneDetail(
  close: number,
  ema: number,
  emaDist: number | null,
  belowMax: number,
  aboveMax: number,
): string {
  if (emaDist == null || !Number.isFinite(ema)) {
    return "คำนวณ EMA ไม่ได้";
  }
  const zoneOk =
    emaDist >= -belowMax && emaDist <= aboveMax;
  const rel =
    emaDist > 0.01 ? "เหนือ" : emaDist < -0.01 ? "ใต้" : "แนบ";
  if (zoneOk) {
    return `${rel} EMA ${emaDist >= 0 ? "+" : ""}${emaDist.toFixed(2)}% (ยอม ${-belowMax}%..+${aboveMax}%)`;
  }
  if (emaDist > aboveMax) {
    return `ตกเกณฑ์! อยู่เหนือไป +${emaDist.toFixed(2)}% (เกณฑ์ยอม +${aboveMax}%)`;
  }
  return `ตกเกณฑ์! อยู่ใต้ไป ${emaDist.toFixed(2)}% (เกณฑ์ยอม -${belowMax}%)`;
}

function allItemsOk(items: CandleReversalDebugCheckItem[]): boolean {
  return items.length > 0 && items.every((x) => x.ok);
}

export function analyzeCandleReversal1hLongestRedBody(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hDetectEnv,
): CandleReversalDebugModelSection {
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const red = c[i]! < o[i]!;
  const body = o[i]! - c[i]!;
  const range = h[i]! - l[i]!;
  const start = Math.max(0, i - env.longestRedBodyLookback + 1);
  const maxRedBody = maxRedBodyInWindow(o, c, start, i);
  const need = maxRedBody * env.longestRedBodyMinRatio;
  const longestOk = Number.isFinite(maxRedBody) && maxRedBody > eps && body > need;
  const highRank = highRankInWindow(h, start, i, i);
  const rangeRank = statsRangeRankInWindow(h, l, start, i, i);
  const highRankMax = longestRedBody1hHighRankMaxForBar(rangeRank, env);
  const highRankOk = longestRedBody1hHighRankPass(highRank, rangeRank, env);
  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, start, i, i) : NaN;
  const ema = emaLine(c, env.emaPeriod);
  const eNow = ema[i];
  const emaDist = Number.isFinite(eNow) ? longestRedBody1hEmaDistancePct(c[i]!, eNow as number) : null;
  const emaZoneOk =
    emaDist != null && isLongestRedBody1hEmaZoneOk(c[i]!, eNow as number, env);

  const items: CandleReversalDebugCheckItem[] = [
    {
      ok: red,
      label: "Candle Color",
      detail: red
        ? `แท่งแดง (C < O)`
        : `ไม่ใช่แท่งแดง (C ${fmtReversalPrice(c[i]!)} ≥ O ${fmtReversalPrice(o[i]!)})`,
    },
    {
      ok: highRankOk,
      label: "High Rank",
      detail: highRankOk
        ? `อันดับ ${highRank} (Len# ${rangeRank} · ผ่านเกณฑ์ ≤ ${highRankMax})`
        : `อันดับ ${highRank} (Len# ${rangeRank} · เกณฑ์ต้อง ≤ ${highRankMax})`,
    },
    {
      ok: Number.isFinite(volRank),
      label: "Volume Rank",
      detail: Number.isFinite(volRank)
        ? `อันดับ ${volRank} (ข้อมูลอ้างอิง — ไม่ใช่ gate หลัก)`
        : "ไม่มี volume",
    },
    {
      ok: longestOk,
      label: "Body Length",
      detail: longestOk
        ? `เนื้อ ${fmtReversalPrice(body)} > เกณฑ์ ${fmtReversalPrice(need)} (${(env.longestRedBodyMinRatio * 100).toFixed(0)}%×max)`
        : `ตกเกณฑ์! (เนื้อ ${fmtReversalPrice(body)} < เกณฑ์ขั้นต่ำ ${fmtReversalPrice(need)})`,
    },
    {
      ok: emaZoneOk,
      label: `EMA${env.emaPeriod} Zone`,
      detail: emaZoneDetail(
        c[i]!,
        eNow as number,
        emaDist,
        env.longestRedBodyEmaDistBelowMaxPct,
        env.longestRedBodyEmaDistAboveMaxPct,
      ),
    },
  ];

  return {
    emoji: "🔴",
    title: `Longest Red Body (Lookback ${env.longestRedBodyLookback})`,
    pass: allItemsOk(items.filter((x) => x.label !== "Volume Rank")),
    items,
  };
}

export function analyzeCandleReversal1hLongestGreenBody(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hLongDetectEnv,
): CandleReversalDebugModelSection {
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const green = c[i]! > o[i]!;
  const body = c[i]! - o[i]!;
  const start = Math.max(0, i - env.longestGreenBodyLookback + 1);
  const maxGreenBody = maxGreenBodyInWindow(o, c, start, i);
  const need = maxGreenBody * env.longestGreenBodyMinRatio;
  const longestOk = Number.isFinite(maxGreenBody) && maxGreenBody > eps && body > need;
  const lowRank = lowRankInWindow(l, start, i, i);
  const lowRankOk = lowRank <= env.longestGreenBodyLowRankMax;
  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, start, i, i) : NaN;
  const ema = emaLine(c, env.emaPeriod);
  const eNow = ema[i];
  const emaDist = Number.isFinite(eNow) ? longestGreenBody1hEmaDistancePct(c[i]!, eNow as number) : null;
  const emaZoneOk =
    emaDist != null && isLongestGreenBody1hEmaZoneOk(c[i]!, eNow as number, env);

  const items: CandleReversalDebugCheckItem[] = [
    {
      ok: green,
      label: "Candle Color",
      detail: green ? `แท่งเขียว (C > O)` : "ไม่ใช่แท่งเขียว",
    },
    {
      ok: longestOk,
      label: "Body Length",
      detail: longestOk
        ? `เนื้อ ${fmtReversalPrice(body)} > เกณฑ์ ${fmtReversalPrice(need)}`
        : "ตกเกณฑ์ (เนื้อสั้นกว่าเกณฑ์ในรอบ)",
    },
    {
      ok: lowRankOk,
      label: "Low Rank",
      detail: lowRankOk
        ? `อันดับ ${lowRank} (ผ่านเกณฑ์ ≤ ${env.longestGreenBodyLowRankMax})`
        : `อันดับ ${lowRank} (เกณฑ์ต้อง ≤ ${env.longestGreenBodyLowRankMax})`,
    },
    {
      ok: Number.isFinite(volRank),
      label: "Volume Rank",
      detail: Number.isFinite(volRank)
        ? `อันดับ ${volRank} (ข้อมูลอ้างอิง)`
        : "ไม่มี volume",
    },
    {
      ok: emaZoneOk,
      label: `EMA${env.emaPeriod} Zone`,
      detail: emaZoneDetail(
        c[i]!,
        eNow as number,
        emaDist,
        env.longestGreenBodyEmaDistBelowMaxPct,
        env.longestGreenBodyEmaDistAboveMaxPct,
      ),
    },
  ];

  return {
    emoji: "🟢",
    title: `Longest Green Body (Lookback ${env.longestGreenBodyLookback})`,
    pass: allItemsOk(items.filter((x) => x.label !== "Volume Rank")),
    items,
  };
}

export function analyzeCandleReversalInvertedDoji1h(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1hDetectEnv,
): CandleReversalDebugModelSection {
  const { open: o, high: h, low: l, close: c } = pack;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const red = c[i]! < o[i]!;
  const range = h[i]! - l[i]!;
  const rangeOk = Number.isFinite(range) && range > eps;
  const body = Math.abs(c[i]! - o[i]!);
  const upperWick = h[i]! - Math.max(o[i]!, c[i]!);
  const wickRatio = rangeOk ? upperWick / range : NaN;
  const bodyRatio = rangeOk ? body / range : NaN;
  const volVsSma = candleReversalBarVolVsSma(pack, i, env.invertedDojiVolSmaPeriod);
  const volLabel = volVsSma != null ? `${volVsSma.toFixed(2)}×` : "—";
  const start = Math.max(0, i - env.highestHighLookback + 1);
  const windowMax = maxHighInWindowInclusive(h, start, i);
  const highOk = Number.isFinite(windowMax) && h[i]! >= windowMax - eps;

  const tierItem = (label: string, tier: CandleReversalInvertedDojiVolTier): CandleReversalDebugCheckItem => {
    const ok = invertedDoji1hTierPasses(bodyRatio, wickRatio, volVsSma, tier);
    return {
      ok,
      label,
      detail: ok
        ? `เนื้อ ${((bodyRatio ?? 0) * 100).toFixed(1)}% · ไส้ ${((wickRatio ?? 0) * 100).toFixed(1)}% · Vol×SMA ${volLabel}`
        : `ต้อง เนื้อ≤${(tier.bodyMaxRatio * 100).toFixed(0)}% · ไส้≥${(tier.wickMinRatio * 100).toFixed(0)}% · Vol×SMA >${tier.volVsSmaMin}× (ได้ เนื้อ ${Number.isFinite(bodyRatio) ? `${(bodyRatio * 100).toFixed(1)}%` : "—"} · ไส้ ${Number.isFinite(wickRatio) ? `${(wickRatio * 100).toFixed(1)}%` : "—"} · Vol ${volLabel})`,
    };
  };

  const items: CandleReversalDebugCheckItem[] = [
    {
      ok: red,
      label: "Candle Color",
      detail: red ? "แท่งแดง" : "ไม่ใช่แท่งแดง (ต้อง C < O)",
    },
    {
      ok: highOk,
      label: "Highest High",
      detail: highOk
        ? `High ${fmtReversalPrice(h[i]!)} = จุดสูงสุดในรอบ ${env.highestHighLookback} แท่ง`
        : `ไม่ใช่จุดสูงสุด (High ${fmtReversalPrice(h[i]!)} vs Max ${fmtReversalPrice(windowMax)})`,
    },
    tierItem("Path A (Body/Shadow/Vol)", env.invertedDojiVolTiers[0]),
    tierItem("Path B (Body/Shadow/Vol)", env.invertedDojiVolTiers[1]),
  ];

  const shapeVolOk = items.slice(2).some((x) => x.ok);

  return {
    emoji: "📍",
    title: `Inverted Doji (Lookback ${env.highestHighLookback})`,
    pass: red && highOk && shapeVolOk,
    items,
  };
}

export function analyzeCandleReversalInvertedDoji1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
): CandleReversalDebugModelSection {
  const { open: o, high: h, low: l, close: c } = pack;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const red = c[i]! < o[i]!;
  const range = h[i]! - l[i]!;
  const rangeOk = Number.isFinite(range) && range > eps;
  const body = Math.abs(c[i]! - o[i]!);
  const upperWick = h[i]! - Math.max(o[i]!, c[i]!);
  const wickRatio = rangeOk ? upperWick / range : NaN;
  const bodyRatio = rangeOk ? body / range : NaN;
  const wickOk = Number.isFinite(wickRatio) && wickRatio >= env.wickMinRatio;
  const bodySmallOk = Number.isFinite(bodyRatio) && bodyRatio <= env.bodyMaxRatio;
  const hh200 = maxHighPriorWindow(h, i, env.hh200Lookback, env.hh200ExcludeRecent);
  const priorTailMax = maxHighPriorWindow(h, i, env.highestTailLookback, 0);
  const athContext =
    (Number.isFinite(hh200) && h[i]! > hh200 - eps) ||
    (Number.isFinite(priorTailMax) && h[i]! >= priorTailMax - eps);
  const allTimePriorMax = maxHighPriorWindow(h, i, Math.max(env.hh200Lookback, i), 0);
  const highestTail =
    (Number.isFinite(priorTailMax) && h[i]! >= priorTailMax) ||
    (Number.isFinite(allTimePriorMax) && h[i]! >= allTimePriorMax);

  const items: CandleReversalDebugCheckItem[] = [
    { ok: red, label: "Candle Color", detail: red ? "แท่งแดง" : "ไม่ใช่แท่งแดง" },
    {
      ok: wickOk,
      label: "Upper Shadow",
      detail: wickOk
        ? `ไส้บน ${((wickRatio ?? 0) * 100).toFixed(1)}%`
        : `ไส้บน ${Number.isFinite(wickRatio) ? `${(wickRatio * 100).toFixed(1)}%` : "—"} (ต้อง ≥ ${(env.wickMinRatio * 100).toFixed(0)}%)`,
    },
    {
      ok: bodySmallOk,
      label: "Body Size",
      detail: bodySmallOk
        ? `เนื้อ ${((bodyRatio ?? 0) * 100).toFixed(1)}%`
        : `เนื้อ ${Number.isFinite(bodyRatio) ? `${(bodyRatio * 100).toFixed(1)}%` : "—"} (ต้อง ≤ ${(env.bodyMaxRatio * 100).toFixed(0)}%)`,
    },
    {
      ok: athContext,
      label: "ATH / Tail Context",
      detail: athContext
        ? `H อยู่ในโซน HH${env.hh200Lookback} หรือ tail ${env.highestTailLookback}D`
        : "ไม่อยู่ในโซนยอดสูงตามเกณฑ์",
    },
    {
      ok: highestTail,
      label: "Highest Tail",
      detail: highestTail ? "High ≥ tail ในรอบ" : "High ไม่ใช่ tail สูงสุด",
    },
  ];

  return {
    emoji: "📍",
    title: `Inverted Doji 1D (HH${env.hh200Lookback} / tail ${env.highestTailLookback}D)`,
    pass: allItemsOk(items),
    items,
  };
}

export function analyzeCandleReversalMarubozu1d(
  pack: BinanceKlinePack,
  i: number,
  env: CandleReversal1dDetectEnv,
): CandleReversalDebugModelSection {
  const { open: o, high: h, low: l, close: c, volume: vol } = pack;
  const eps = Math.max(1e-12, Math.abs(h[i]!) * 1e-10);
  const lb = env.marubozuBodyLookback;
  const red = c[i]! < o[i]!;
  const body = o[i]! - c[i]!;
  const winStart = Math.max(0, i - lb + 1);
  const windowHighMax = maxHighInWindowInclusive(h, winStart, i);
  const highOk = Number.isFinite(windowHighMax) && h[i]! >= windowHighMax - eps;
  const barVol = vol[i];
  const volRank =
    Number.isFinite(barVol) && barVol! > 0 ? volumeRankInWindow(vol, winStart, i, i) : NaN;
  const volRankOk = Number.isFinite(volRank) && volRank <= env.marubozuVolRankMax;
  const maxRedBody = maxRedBodyInWindow(o, c, winStart, i);
  const bodyLongestOk = Number.isFinite(maxRedBody) && body >= maxRedBody - eps;
  const prevGreen = i >= 1 && c[i - 1]! > o[i - 1]!;
  const prevBody = i >= 1 ? c[i - 1]! - o[i - 1]! : 0;
  const standardEngulf = i >= 1 && prevBody > eps && body >= prevBody * env.marubozuEngulfMinRatio;
  const engulfOk = prevGreen && (standardEngulf || bodyLongestOk);

  const items: CandleReversalDebugCheckItem[] = [
    { ok: red, label: "Candle Color", detail: red ? "แท่งแดง" : "ไม่ใช่แท่งแดง" },
    {
      ok: highOk,
      label: "Highest High",
      detail: highOk
        ? `High สูงสุดใน ${lb} แท่ง`
        : `High ${fmtReversalPrice(h[i]!)} vs max ${fmtReversalPrice(windowHighMax)}`,
    },
    {
      ok: volRankOk,
      label: "Volume Rank",
      detail: volRankOk
        ? `อันดับ ${volRank} (ผ่าน ≤ ${env.marubozuVolRankMax})`
        : `อันดับ ${Number.isFinite(volRank) ? volRank : "—"} (ต้อง ≤ ${env.marubozuVolRankMax})`,
    },
    {
      ok: bodyLongestOk,
      label: "Longest Red Body",
      detail: bodyLongestOk
        ? `เนื้อแดงยาวสุดในรอบ ${fmtReversalPrice(body)}`
        : `เนื้อ ${fmtReversalPrice(body)} vs max ${fmtReversalPrice(maxRedBody)}`,
    },
    {
      ok: engulfOk,
      label: "Engulf / Monster",
      detail: engulfOk
        ? standardEngulf
          ? "กลืนแท่งเขียวก่อนหน้า"
          : "monster bypass (เนื้อแดงยาวสุดในรอบ)"
        : "ไม่กลืนแท่งเขียวก่อนหน้า",
    },
  ];

  return {
    emoji: "🔴",
    title: `Marubozu 1D (Lookback ${lb})`,
    pass: allItemsOk(items),
    items,
  };
}

function formatModelSection(index: number, section: CandleReversalDebugModelSection): string[] {
  const lines = [
    `${section.emoji} ${index}. ${section.title} → ${section.pass ? "✅ PASS" : "❌ FAIL"}`,
  ];
  for (const it of section.items) {
    lines.push(`${itemMark(it.ok)} ${it.label}: ${it.detail}`);
  }
  lines.push("");
  return lines;
}

export function formatCandleReversalTfDebugBlock(input: {
  sym: string;
  tf: CandleReversalTf;
  pack: BinanceKlinePack;
  barIndex: number;
  barsAgo: number;
  latestClosed: number;
  hadDoji: boolean;
  env1d: CandleReversal1dDetectEnv;
  env1h: CandleReversal1hDetectEnv;
  env1hLong: CandleReversal1hLongDetectEnv;
  alerts1dOn: boolean;
  alerts1hShortOn: boolean;
  alerts1hLongOn: boolean;
  sig: CandleReversalSignal | null;
  modelPass: Partial<Record<CandleReversalModel, boolean>>;
}): string[] {
  const {
    sym,
    tf,
    pack,
    barIndex: i,
    barsAgo,
    latestClosed,
    hadDoji,
    env1d,
    env1h,
    env1hLong,
    alerts1dOn,
    alerts1hShortOn,
    alerts1hLongOn,
    sig,
    modelPass,
  } = input;

  const lines: string[] = [];
  const tfLabel = tf.toUpperCase();
  const barOpenSec = pack.timeSec[i]!;

  lines.push(`🎯 Candle Reversal — Debug [${tfLabel}] · ${pairSlash(sym)}`);
  lines.push(`UTC: ${fmtUtcNow()} | BKK bar open: ${fmtBkkFromSec(barOpenSec)}`);
  lines.push(
    `Status: 1D [${alerts1dOn ? "ON" : "OFF"}] • 1H Short [${alerts1hShortOn ? "ON" : "OFF"}] • 1H Long [${alerts1hLongOn ? "ON" : "OFF"}]`,
  );
  if (barsAgo > 0) {
    lines.push(`Bar offset: ย้อนหลัง ${barsAgo} แท่งจากปิดล่าสุด (index ${i} / latest ${latestClosed})`);
  } else {
    lines.push(`Bar offset: แท่งปิดล่าสุด (index ${i})`);
  }
  lines.push("");

  if (i < 0) {
    lines.push("❌ ข้อมูลไม่พอ — ลด barsAgo");
    return lines;
  }

  const o = pack.open[i]!;
  const h = pack.high[i]!;
  const l = pack.low[i]!;
  const c = pack.close[i]!;

  lines.push(`Price Action (Bar ${i}):`);
  lines.push(`O: ${fmtReversalPrice(o)} • H: ${fmtReversalPrice(h)} • L: ${fmtReversalPrice(l)} • C: ${fmtReversalPrice(c)}`);
  lines.push(`hadRecentInvertedDoji: ${hadDoji ? "yes" : "no"}`);
  lines.push("");

  lines.push("📊 สรุปผลลัพธ์ (Final Verdict)");
  if (sig) {
    lines.push(`✅ STATUS: PASSED → ส่งแจ้งเตือน (${candleReversalModelLabelTh(sig.model)} / ${sig.tradeSide})`);
    lines.push(
      `wick ${(sig.wickRatio * 100).toFixed(1)}% · body ${(sig.bodyRatio * 100).toFixed(1)}% · retest ${fmtReversalPrice(sig.retestPrice)} · SL ${fmtReversalPrice(sig.slPrice)}`,
    );
  } else {
    lines.push("❌ STATUS: FAILED (ไม่ผ่านเงื่อนไข ส่งแจ้งเตือน)");
  }
  lines.push("");

  lines.push("🔍 แยกวิเคราะห์รายโมเดล (Deep Dive)");
  const sections: CandleReversalDebugModelSection[] = [];

  if (tf === "1h") {
    const red = analyzeCandleReversal1hLongestRedBody(pack, i, env1h);
    red.pass = modelPass.longest_red_body === true;
    sections.push(red);
    const green = analyzeCandleReversal1hLongestGreenBody(pack, i, env1hLong);
    green.pass = modelPass.longest_green_body === true;
    sections.push(green);
    const inv = analyzeCandleReversalInvertedDoji1h(pack, i, env1h);
    inv.pass = modelPass.inverted_doji === true;
    sections.push(inv);
  } else {
    const inv = analyzeCandleReversalInvertedDoji1d(pack, i, env1d);
    inv.pass = modelPass.inverted_doji === true;
    sections.push(inv);
    const maru = analyzeCandleReversalMarubozu1d(pack, i, env1d);
    maru.pass = modelPass.marubozu === true;
    sections.push(maru);
  }

  let n = 1;
  for (const sec of sections) {
    lines.push(...formatModelSection(n, sec));
    n += 1;
  }

  return lines;
}
