import type { SparkFollowUpHistoryRow, SparkFollowUpState } from "./sparkFollowUpStore";
import { loadSparkFollowUpState } from "./sparkFollowUpStore";
import type { SparkMcapBand, SparkVolBand } from "./sparkTierContext";
import { mcapBandLabelTh, volBandLabelTh } from "./sparkTierContext";
import type {
  SparkHorizonCell,
  SparkHorizonId,
  SparkMatrixRowMcap,
  SparkMatrixRowVol,
  SparkStatsApiPayload,
} from "./sparkStatsShared";
import { SPARK_STATS_HORIZON_ORDER } from "./sparkStatsShared";

export type {
  SparkHorizonCell,
  SparkHorizonId,
  SparkMatrixRowMcap,
  SparkMatrixRowVol,
  SparkStatsApiPayload,
} from "./sparkStatsShared";
export { SPARK_STATS_HORIZON_LABELS, SPARK_STATS_HORIZON_ORDER } from "./sparkStatsShared";

function shortLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function rate(won: number, total: number): string {
  if (total <= 0) return "—";
  return `${((won / total) * 100).toFixed(1)}%`;
}

type Agg = { t15: number; m15: number; t30: number; m30: number; t60: number; m60: number };

function emptyAgg(): Agg {
  return { t15: 0, m15: 0, t30: 0, m30: 0, t60: 0, m60: 0 };
}

function addMomentum(a: Agg, h: SparkFollowUpHistoryRow): void {
  if (h.momentumWon15 === true || h.momentumWon15 === false) {
    a.t15 += 1;
    if (h.momentumWon15 === true) a.m15 += 1;
  }
  if (h.momentumWon30 === true || h.momentumWon30 === false) {
    a.t30 += 1;
    if (h.momentumWon30 === true) a.m30 += 1;
  }
  if (h.momentumWon60 === true || h.momentumWon60 === false) {
    a.t60 += 1;
    if (h.momentumWon60 === true) a.m60 += 1;
  }
}

/** สถิติเงียบ 2h / 3h / 4h (1h = ค่าเดียวกับ momentum ที่ T+1h แจ้งเตือน) */
type LongAgg = { t2: number; m2: number; t3: number; m3: number; t4: number; m4: number };

function emptyLong(): LongAgg {
  return { t2: 0, m2: 0, t3: 0, m3: 0, t4: 0, m4: 0 };
}

function addLong(a: LongAgg, h: SparkFollowUpHistoryRow): void {
  if (h.momentumWon2h === true || h.momentumWon2h === false) {
    a.t2 += 1;
    if (h.momentumWon2h === true) a.m2 += 1;
  }
  if (h.momentumWon3h === true || h.momentumWon3h === false) {
    a.t3 += 1;
    if (h.momentumWon3h === true) a.m3 += 1;
  }
  if (h.momentumWon4h === true || h.momentumWon4h === false) {
    a.t4 += 1;
    if (h.momentumWon4h === true) a.m4 += 1;
  }
}

function fmtAggLine(label: string, a: Agg): string {
  return `• ${label}: 15m ${a.m15}/${a.t15} (${rate(a.m15, a.t15)}) · 30m ${a.m30}/${a.t30} (${rate(a.m30, a.t30)}) · 1h ${a.m60}/${a.t60} (${rate(a.m60, a.t60)})`;
}

function fmtLongLine(label: string, a: LongAgg): string {
  return `• ${label}: 2h ${a.m2}/${a.t2} (${rate(a.m2, a.t2)}) · 3h ${a.m3}/${a.t3} (${rate(a.m3, a.t3)}) · 4h ${a.m4}/${a.t4} (${rate(a.m4, a.t4)})`;
}

const VOL_ORDER: SparkVolBand[] = ["high", "mid", "low", "unknown"];
const MCAP_ORDER: SparkMcapBand[] = ["tier1", "tier2", "tier3", "unknown"];

function volTag(b: SparkVolBand): string {
  if (b === "high") return "H";
  if (b === "mid") return "M";
  if (b === "low") return "L";
  return "?";
}

function mcapTag(b: SparkMcapBand): string {
  if (b === "tier1") return "1";
  if (b === "tier2") return "2";
  if (b === "tier3") return "3";
  return "?";
}

function mf(w: boolean | null | undefined): string {
  if (w === true) return "M";
  if (w === false) return "F";
  return "?";
}

const MAX_LINES = 14;
const MAX_FIRE_LINES = 20;

function horizonCell(wins: number, total: number): SparkHorizonCell {
  return {
    wins,
    total,
    rate: total <= 0 ? null : (wins / total) * 100,
  };
}

function horizonsFromAgg(a: Agg, l: LongAgg): Record<SparkHorizonId, SparkHorizonCell> {
  return {
    m15m: horizonCell(a.m15, a.t15),
    m30m: horizonCell(a.m30, a.t30),
    m1h: horizonCell(a.m60, a.t60),
    m2h: horizonCell(l.m2, l.t2),
    m3h: horizonCell(l.m3, l.t3),
    m4h: horizonCell(l.m4, l.t4),
  };
}

type AggregatedMatrices = {
  total: Agg;
  totalLong: LongAgg;
  byVol: Record<SparkVolBand, Agg>;
  byVolLong: Record<SparkVolBand, LongAgg>;
  byMcap: Record<SparkMcapBand, Agg>;
  byMcapLong: Record<SparkMcapBand, LongAgg>;
  upSpark: number;
  downSpark: number;
};

function aggregateHistory(history: SparkFollowUpHistoryRow[]): AggregatedMatrices {
  const total = emptyAgg();
  const totalLong = emptyLong();
  let upSpark = 0;
  let downSpark = 0;

  const byVol: Record<SparkVolBand, Agg> = {
    high: emptyAgg(),
    mid: emptyAgg(),
    low: emptyAgg(),
    unknown: emptyAgg(),
  };
  const byVolLong: Record<SparkVolBand, LongAgg> = {
    high: emptyLong(),
    mid: emptyLong(),
    low: emptyLong(),
    unknown: emptyLong(),
  };
  const byMcap: Record<SparkMcapBand, Agg> = {
    tier1: emptyAgg(),
    tier2: emptyAgg(),
    tier3: emptyAgg(),
    unknown: emptyAgg(),
  };
  const byMcapLong: Record<SparkMcapBand, LongAgg> = {
    tier1: emptyLong(),
    tier2: emptyLong(),
    tier3: emptyLong(),
    unknown: emptyLong(),
  };

  for (const h of history) {
    if (h.sparkReturnPct > 0) upSpark += 1;
    else if (h.sparkReturnPct < 0) downSpark += 1;
    addMomentum(total, h);
    addLong(totalLong, h);
    const vb = h.volBand ?? "unknown";
    const mb = h.mcapBand ?? "unknown";
    if (byVol[vb]) {
      addMomentum(byVol[vb]!, h);
      addLong(byVolLong[vb]!, h);
    }
    if (byMcap[mb]) {
      addMomentum(byMcap[mb]!, h);
      addLong(byMcapLong[mb]!, h);
    }
  }

  return { total, totalLong, byVol, byVolLong, byMcap, byMcapLong, upSpark, downSpark };
}

/** สำหรับ format ข้อความ LINE — ค่าเดียวกับที่ใช้สร้าง matrix */
export type SparkStatsLineFormatAggs = {
  total: Agg;
  totalLong: LongAgg;
  byVol: Record<SparkVolBand, Agg>;
  byVolLong: Record<SparkVolBand, LongAgg>;
  byMcap: Record<SparkMcapBand, Agg>;
  byMcapLong: Record<SparkMcapBand, LongAgg>;
};

export type SparkStatsPayload = SparkStatsApiPayload & {
  lineFormatAggs: SparkStatsLineFormatAggs;
};

/**
 * สรุปสถิติ Spark + follow-up เป็น JSON (ใช้ LIFF / LINE ร่วมกัน)
 */
export function buildSparkStatsPayload(state: SparkFollowUpState): SparkStatsPayload {
  const { history, pending, recentSparks = [] } = state;
  const n = history.length;
  const fires = recentSparks.length;
  const pendN = pending.length;

  let upFire = 0;
  let downFire = 0;
  for (const r of recentSparks) {
    if (r.sparkReturnPct > 0) upFire += 1;
    else if (r.sparkReturnPct < 0) downFire += 1;
  }

  const fireTail = recentSparks.slice(-MAX_FIRE_LINES).reverse();
  const recentFireLines = fireTail.map((r) => {
    const base = shortLabel(r.symbol);
    const dt = r.atIso.slice(0, 16).replace("T", " ");
    const vTag = volTag(r.volBand ?? "unknown");
    const mTag = mcapTag(r.mcapBand ?? "unknown");
    return `${dt} [${base}] V${vTag}·M${mTag} (${r.sparkReturnPct >= 0 ? "+" : ""}${r.sparkReturnPct.toFixed(1)}%)`;
  });

  const pendingLines =
    pendN > 0
      ? pending.slice(-10).map((p) => {
          const base = shortLabel(p.symbol);
          return `• [${base}] รอ follow-up… (สัญญาณ ${p.sparkReturnPct >= 0 ? "+" : ""}${p.sparkReturnPct.toFixed(1)}%)`;
        })
      : [];

  const emptyGlobal = fires === 0 && pendN === 0 && n === 0;

  const full = aggregateHistory(history);
  const upHist = history.filter((h) => h.sparkReturnPct > 0);
  const downHist = history.filter((h) => h.sparkReturnPct < 0);
  const sparkUp = aggregateHistory(upHist);
  const sparkDown = aggregateHistory(downHist);

  const { total, totalLong, byVol, byVolLong, byMcap, byMcapLong, upSpark, downSpark } = full;

  const tail = history.slice(-MAX_LINES).reverse();
  const historyTailLines = tail.map((h) => {
    const base = shortLabel(h.symbol);
    const w15 = mf(h.momentumWon15);
    const w30 = mf(h.momentumWon30);
    const w1 = mf(h.momentumWon60);
    const w2 = mf(h.momentumWon2h);
    const w3 = mf(h.momentumWon3h);
    const w4 = mf(h.momentumWon4h);
    const dt = h.resolvedAtIso.slice(0, 16).replace("T", " ");
    const vTag = volTag(h.volBand ?? "unknown");
    const mTag = mcapTag(h.mcapBand ?? "unknown");
    return `${dt} [${base}] V${vTag}·M${mTag} 15m:${w15} 30m:${w30} 1h:${w1} 2h:${w2} 3h:${w3} 4h:${w4} (${h.sparkReturnPct >= 0 ? "+" : ""}${h.sparkReturnPct.toFixed(1)}%)`;
  });

  const matrixFrom = (agg: AggregatedMatrices): { vol: SparkMatrixRowVol[]; mcap: SparkMatrixRowMcap[]; totalH: Record<SparkHorizonId, SparkHorizonCell> } => ({
    vol: VOL_ORDER.map((b) => ({
      band: b,
      labelTh: volBandLabelTh(b),
      horizons: horizonsFromAgg(agg.byVol[b]!, agg.byVolLong[b]!),
    })),
    mcap: MCAP_ORDER.map((b) => ({
      band: b,
      labelTh: mcapBandLabelTh(b),
      horizons: horizonsFromAgg(agg.byMcap[b]!, agg.byMcapLong[b]!),
    })),
    totalH: horizonsFromAgg(agg.total, agg.totalLong),
  });

  const overall = matrixFrom(full);
  const upM = matrixFrom(sparkUp);
  const downM = matrixFrom(sparkDown);

  return {
    generatedAt: new Date().toISOString(),
    historyCount: n,
    pendingCount: pendN,
    fireLogCount: fires,
    upFire,
    downFire,
    upSpark,
    downSpark,
    emptyGlobal,
    matrixByVol: overall.vol,
    matrixByMcap: overall.mcap,
    totalHorizons: overall.totalH,
    matrixByVolSparkUp: upM.vol,
    matrixByMcapSparkUp: upM.mcap,
    totalHorizonsSparkUp: upM.totalH,
    matrixByVolSparkDown: downM.vol,
    matrixByMcapSparkDown: downM.mcap,
    totalHorizonsSparkDown: downM.totalH,
    lineFormatAggs: {
      total,
      totalLong,
      byVol,
      byVolLong,
      byMcap,
      byMcapLong,
    },
    recentFireLines,
    pendingLines,
    historyTailLines,
  };
}

/** สำหรับ API LIFF — ไม่ส่ง lineFormatAggs */
export function buildSparkStatsApiPayload(state: SparkFollowUpState): SparkStatsApiPayload {
  const p = buildSparkStatsPayload(state);
  const { lineFormatAggs: _omitLineFormat, ...rest } = p;
  return rest;
}

function formatSparkStatsFromPayload(p: SparkStatsPayload): string {
  const headerParts: string[] = [
    "📊 สถิติ Spark",
    `แจ้ง Spark แล้ว (log): ${p.fireLogCount} ครั้ง (ขึ้น ${p.upFire} · ลง ${p.downFire})`,
  ];
  if (p.pendingCount > 0) {
    headerParts.push(
      `กำลังติดตาม follow-up: ${p.pendingCount} เหตุการณ์ (ครบ ~4 ชม. หลังสัญญาณจึงเข้าสรุป momentum)`
    );
  }
  if (p.emptyGlobal) {
    return [
      ...headerParts,
      "",
      "ยังไม่มี log Spark — หลังแจ้งเตือนสำเร็จจะบันทึกที่นี่",
      "(ต้องมี Redis/KV บน Vercel ให้ state เก็บได้)",
    ].join("\n");
  }

  if (p.fireLogCount > 0) {
    headerParts.push(
      "",
      `— Spark ที่จับได้ (ล่าสุด ${Math.min(p.fireLogCount, MAX_FIRE_LINES)} รายการ) —`,
      ...p.recentFireLines
    );
  }

  if (p.historyCount === 0) {
    return [
      ...headerParts,
      "",
      "— สรุป momentum (หลัง follow-up จบ) —",
      "ยังไม่มีเหตุการณ์ที่จบครบ T+30m … T+4h — รอเวลาหลังสัญญาณ",
      ...(p.pendingLines.length > 0 ? ["", "— คิวติดตาม —", ...p.pendingLines] : []),
    ].join("\n");
  }

  const { total, totalLong, byVol, byVolLong, byMcap, byMcapLong } = p.lineFormatAggs;

  const volSection = VOL_ORDER.filter(
    (b) => (byVol[b]?.t60 ?? 0) > 0 || (byVol[b]?.t30 ?? 0) > 0 || (byVol[b]?.t15 ?? 0) > 0
  ).map((b) => fmtAggLine(volBandLabelTh(b), byVol[b]!));
  const volLongSection = VOL_ORDER.filter((b) => (byVolLong[b]?.t4 ?? 0) > 0 || (byVolLong[b]?.t2 ?? 0) > 0).map(
    (b) => fmtLongLine(`${volBandLabelTh(b)} (เงียบ)`, byVolLong[b]!)
  );
  const mcapSection = MCAP_ORDER.filter(
    (b) => (byMcap[b]?.t60 ?? 0) > 0 || (byMcap[b]?.t30 ?? 0) > 0 || (byMcap[b]?.t15 ?? 0) > 0
  ).map((b) => fmtAggLine(mcapBandLabelTh(b), byMcap[b]!));
  const mcapLongSection = MCAP_ORDER.filter(
    (b) => (byMcapLong[b]?.t4 ?? 0) > 0 || (byMcapLong[b]?.t2 ?? 0) > 0
  ).map((b) => fmtLongLine(`${mcapBandLabelTh(b)} (เงียบ)`, byMcapLong[b]!));

  return [
    ...headerParts,
    "",
    `— สรุป momentum (follow-up จบแล้ว ${p.historyCount} เหตุการณ์ · Spark ขึ้น ${p.upSpark} · ลง ${p.downSpark}) —`,
    "",
    "— รวม (สถิติเงียบ 15m · แจ้งเตือน 30m / 1h) —",
    fmtAggLine("ทั้งหมด", total),
    "",
    "— รวม (สถิติเงียบ 2h / 3h / 4h; 1h ดูจากแถวบน) —",
    fmtLongLine("ทั้งหมด", totalLong),
    "",
    "— ตาม Vol 24h —",
    ...(volSection.length > 0 ? volSection : ["• (ยังไม่มีข้อมูลแยก Vol)"]),
    ...(volLongSection.length > 0 ? ["", "สถิติเงียบ:", ...volLongSection] : []),
    "",
    "— ตามมาร์เก็ตแคป (พร็อกซี) —",
    ...(mcapSection.length > 0 ? mcapSection : ["• (ยังไม่มีข้อมูลแยกมาร์ก.)"]),
    ...(mcapLongSection.length > 0 ? ["", "สถิติเงียบ:", ...mcapLongSection] : []),
    "",
    "หมายเหตุ: มาร์ก. ไม่ใช่ข้อมูล CoinGecko — ใช้จัดกลุ่มโทเคนเท่านั้น",
    "V=Vol H/M/L · M=มาร์ก. 1/2/3",
    "",
    "M = momentum ชนะ · F = fade ชนะ · ? = ไม่มีราคา",
    "",
    `ล่าสุด follow-up จบแล้ว (สูงสุด ${MAX_LINES} รายการ):`,
    ...p.historyTailLines,
    ...(p.pendingLines.length > 0 ? ["", "— คิวติดตาม —", ...p.pendingLines] : []),
  ].join("\n");
}

/** สรุปสถิติ Spark + follow-up */
export async function formatSparkStatsMessage(): Promise<string> {
  const state = await loadSparkFollowUpState();
  return formatSparkStatsFromPayload(buildSparkStatsPayload(state));
}
