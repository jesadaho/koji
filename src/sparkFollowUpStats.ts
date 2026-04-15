import type { SparkFollowUpHistoryRow } from "./sparkFollowUpStore";
import { loadSparkFollowUpState } from "./sparkFollowUpStore";
import type { SparkMcapBand, SparkVolBand } from "./sparkTierContext";
import { mcapBandLabelTh, volBandLabelTh } from "./sparkTierContext";

function shortLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function rate(won: number, total: number): string {
  if (total <= 0) return "—";
  return `${((won / total) * 100).toFixed(1)}%`;
}

type Agg = { t30: number; m30: number; t60: number; m60: number };

function emptyAgg(): Agg {
  return { t30: 0, m30: 0, t60: 0, m60: 0 };
}

function addMomentum(a: Agg, h: SparkFollowUpHistoryRow): void {
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
  return `• ${label}: 30m ${a.m30}/${a.t30} (${rate(a.m30, a.t30)}) · 1h ${a.m60}/${a.t60} (${rate(a.m60, a.t60)})`;
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

/** สรุปสถิติ Spark follow-up จาก history ใน store — แยก section ตาม Vol 24h และมาร์ก. (พร็อกซี) */
export async function formatSparkStatsMessage(): Promise<string> {
  const { history } = await loadSparkFollowUpState();
  const n = history.length;
  if (n === 0) {
    return [
      "📊 สถิติ Spark follow-up",
      "",
      "ยังไม่มีเหตุการณ์ที่จบครบ",
      "(T+30m · T+1h แจ้งเตือน + สถิติเงียบ T+2h · T+3h · T+4h)",
    ].join("\n");
  }

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

  const tail = history.slice(-MAX_LINES).reverse();
  const lines = tail.map((h) => {
    const base = shortLabel(h.symbol);
    const w30 = mf(h.momentumWon30);
    const w1 = mf(h.momentumWon60);
    const w2 = mf(h.momentumWon2h);
    const w3 = mf(h.momentumWon3h);
    const w4 = mf(h.momentumWon4h);
    const dt = h.resolvedAtIso.slice(0, 16).replace("T", " ");
    const vTag = volTag(h.volBand ?? "unknown");
    const mTag = mcapTag(h.mcapBand ?? "unknown");
    return `${dt} [${base}] V${vTag}·M${mTag} 30m:${w30} 1h:${w1} 2h:${w2} 3h:${w3} 4h:${w4} (${h.sparkReturnPct >= 0 ? "+" : ""}${h.sparkReturnPct.toFixed(1)}%)`;
  });

  const volSection = VOL_ORDER.filter((b) => (byVol[b]?.t60 ?? 0) > 0 || (byVol[b]?.t30 ?? 0) > 0).map((b) =>
    fmtAggLine(volBandLabelTh(b), byVol[b]!)
  );
  const volLongSection = VOL_ORDER.filter((b) => (byVolLong[b]?.t4 ?? 0) > 0 || (byVolLong[b]?.t2 ?? 0) > 0).map(
    (b) => fmtLongLine(`${volBandLabelTh(b)} (เงียบ)`, byVolLong[b]!)
  );
  const mcapSection = MCAP_ORDER.filter(
    (b) => (byMcap[b]?.t60 ?? 0) > 0 || (byMcap[b]?.t30 ?? 0) > 0
  ).map((b) => fmtAggLine(mcapBandLabelTh(b), byMcap[b]!));
  const mcapLongSection = MCAP_ORDER.filter(
    (b) => (byMcapLong[b]?.t4 ?? 0) > 0 || (byMcapLong[b]?.t2 ?? 0) > 0
  ).map((b) => fmtLongLine(`${mcapBandLabelTh(b)} (เงียบ)`, byMcapLong[b]!));

  return [
    "📊 สถิติ Spark follow-up",
    `เหตุการณ์ในประวัติ: ${n} (Spark ขึ้น ${upSpark} · ลง ${downSpark})`,
    "",
    "— รวม (แจ้งเตือน 30m / 1h) —",
    fmtAggLine("ทั้งหมด", total),
    "",
    "— รวม (สถิติเงียบ 2h / 3h / 4h หลังปิดแท่ง; 1h ดูจากแถวบน) —",
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
    `ล่าสุด (สูงสุด ${MAX_LINES} รายการ):`,
    ...lines,
  ].join("\n");
}
