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

function fmtAggLine(label: string, a: Agg): string {
  return `• ${label}: 30m ${a.m30}/${a.t30} (${rate(a.m30, a.t30)}) · 1h ${a.m60}/${a.t60} (${rate(a.m60, a.t60)})`;
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

const MAX_LINES = 16;

/** สรุปสถิติ Spark follow-up จาก history ใน store — แยก section ตาม Vol 24h และมาร์ก. (พร็อกซี) */
export async function formatSparkStatsMessage(): Promise<string> {
  const { history } = await loadSparkFollowUpState();
  const n = history.length;
  if (n === 0) {
    return [
      "📊 สถิติ Spark follow-up",
      "",
      "ยังไม่มีเหตุการณ์ที่จบครบ T+30m และ T+1h",
      "(หลังแจ้ง Spark และรอจบช่วงติดตาม)",
    ].join("\n");
  }

  const total = emptyAgg();
  let upSpark = 0;
  let downSpark = 0;

  const byVol: Record<SparkVolBand, Agg> = {
    high: emptyAgg(),
    mid: emptyAgg(),
    low: emptyAgg(),
    unknown: emptyAgg(),
  };
  const byMcap: Record<SparkMcapBand, Agg> = {
    tier1: emptyAgg(),
    tier2: emptyAgg(),
    tier3: emptyAgg(),
    unknown: emptyAgg(),
  };

  for (const h of history) {
    if (h.sparkReturnPct > 0) upSpark += 1;
    else if (h.sparkReturnPct < 0) downSpark += 1;
    addMomentum(total, h);
    const vb = h.volBand ?? "unknown";
    const mb = h.mcapBand ?? "unknown";
    if (byVol[vb]) addMomentum(byVol[vb]!, h);
    if (byMcap[mb]) addMomentum(byMcap[mb]!, h);
  }

  const tail = history.slice(-MAX_LINES).reverse();
  const lines = tail.map((h) => {
    const base = shortLabel(h.symbol);
    const w30 =
      h.momentumWon30 === true ? "M" : h.momentumWon30 === false ? "F" : "?";
    const w60 =
      h.momentumWon60 === true ? "M" : h.momentumWon60 === false ? "F" : "?";
    const dt = h.resolvedAtIso.slice(0, 16).replace("T", " ");
    const vTag = volTag(h.volBand ?? "unknown");
    const mTag = mcapTag(h.mcapBand ?? "unknown");
    return `${dt} [${base}] V${vTag}·M${mTag} 30m:${w30} 1h:${w60} (${h.sparkReturnPct >= 0 ? "+" : ""}${h.sparkReturnPct.toFixed(1)}%)`;
  });

  const volSection = VOL_ORDER.filter((b) => (byVol[b]?.t60 ?? 0) > 0 || (byVol[b]?.t30 ?? 0) > 0).map((b) =>
    fmtAggLine(volBandLabelTh(b), byVol[b]!)
  );
  const mcapSection = MCAP_ORDER.filter(
    (b) => (byMcap[b]?.t60 ?? 0) > 0 || (byMcap[b]?.t30 ?? 0) > 0
  ).map((b) => fmtAggLine(mcapBandLabelTh(b), byMcap[b]!));

  return [
    "📊 สถิติ Spark follow-up",
    `เหตุการณ์ในประวัติ: ${n} (Spark ขึ้น ${upSpark} · ลง ${downSpark})`,
    "",
    "— รวม —",
    fmtAggLine("ทั้งหมด", total),
    "",
    "— ตาม Vol 24h (amount24 USDT จาก MEXC) —",
    ...(volSection.length > 0 ? volSection : ["• (ยังไม่มีข้อมูลแยก Vol)"]),
    "",
    "— ตามมาร์เก็ตแคป (พร็อกซีจากสกุล BTC/ETH / tier2 / อื่นๆ) —",
    ...(mcapSection.length > 0 ? mcapSection : ["• (ยังไม่มีข้อมูลแยกมาร์ก.)"]),
    "",
    "หมายเหตุ: มาร์ก. ไม่ใช่ข้อมูล CoinGecko — ใช้จัดกลุ่มโทเคนเท่านั้น",
    "V=Vol H/M/L, M=มาร์ก. 1/2/3 ในรายการล่าง",
    "",
    "M = momentum ชนะ · F = fade ชนะ · ? = ไม่มีราคา",
    "",
    `ล่าสุด (สูงสุด ${MAX_LINES} รายการ):`,
    ...lines,
  ].join("\n");
}
