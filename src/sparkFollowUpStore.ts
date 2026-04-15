import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import type { SparkMcapBand, SparkVolBand } from "./sparkTierContext";

const KV_KEY = "koji:spark_follow_up_state";
const filePath = join(process.cwd(), "data", "spark_follow_up_state.json");

const SPARK_BAR_SEC = 300;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ spark follow-up state");
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}", "utf-8");
  }
}

export type SparkFollowUpPending = {
  eventKey: string;
  symbol: string;
  sparkBarOpenSec: number;
  refPrice: number;
  refCloseSec: number;
  sparkReturnPct: number;
  /** amount24 USDT จาก MEXC ตอน enqueue (สำหรับสถิติ) */
  amount24Usdt: number | null;
  volBand: SparkVolBand;
  mcapBand: SparkMcapBand;
  due30Sec: number;
  due60Sec: number;
  /** T+2h / T+3h / T+4h หลังปิดแท่ง Spark — เก็บสถิติอย่างเดียว (ไม่แจ้งเตือน) */
  due2hSec: number;
  due3hSec: number;
  due4hSec: number;
  sent30: boolean;
  sent60: boolean;
  silent2h: boolean;
  silent3h: boolean;
  silent4h: boolean;
  price30?: number | null;
  momentumWon30?: boolean | null;
  price60?: number | null;
  momentumWon60?: boolean | null;
  price2h?: number | null;
  momentumWon2h?: boolean | null;
  price3h?: number | null;
  momentumWon3h?: boolean | null;
  price4h?: number | null;
  momentumWon4h?: boolean | null;
};

export type SparkFollowUpHistoryRow = {
  eventKey: string;
  symbol: string;
  sparkBarOpenSec: number;
  refCloseSec: number;
  refPrice: number;
  sparkReturnPct: number;
  amount24Usdt: number | null;
  volBand: SparkVolBand;
  mcapBand: SparkMcapBand;
  price30: number | null;
  price60: number | null;
  momentumWon30: boolean | null;
  momentumWon60: boolean | null;
  /** สถิติเงียบ (1h = ใช้ค่าเดียวกับ momentumWon60) */
  price2h: number | null;
  momentumWon2h: boolean | null;
  price3h: number | null;
  momentumWon3h: boolean | null;
  price4h: number | null;
  momentumWon4h: boolean | null;
  resolvedAtIso: string;
};

export type SparkFollowUpState = {
  pending: SparkFollowUpPending[];
  history: SparkFollowUpHistoryRow[];
};

function historyMax(): number {
  const n = Number(process.env.SPARK_FOLLOWUP_HISTORY_MAX?.trim());
  return Number.isFinite(n) && n >= 20 && n <= 5000 ? Math.floor(n) : 400;
}

function parseVolBand(x: unknown): SparkVolBand {
  if (x === "high" || x === "mid" || x === "low" || x === "unknown") return x;
  return "unknown";
}

function parseMcapBand(x: unknown): SparkMcapBand {
  if (x === "tier1" || x === "tier2" || x === "tier3" || x === "unknown") return x;
  return "unknown";
}

function normalizePending(raw: unknown): SparkFollowUpPending[] {
  if (!Array.isArray(raw)) return [];
  const out: SparkFollowUpPending[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const eventKey = typeof o.eventKey === "string" ? o.eventKey.trim() : "";
    const symbol = typeof o.symbol === "string" ? o.symbol.trim() : "";
    if (!eventKey || !symbol) continue;
    const sparkBarOpenSec = Number(o.sparkBarOpenSec);
    const refPrice = Number(o.refPrice);
    const refCloseSec = Number(o.refCloseSec);
    const sparkReturnPct = Number(o.sparkReturnPct);
    const due30Sec = Number(o.due30Sec);
    const due60Sec = Number(o.due60Sec);
    const due2hSec = Number(o.due2hSec);
    const due3hSec = Number(o.due3hSec);
    const due4hSec = Number(o.due4hSec);
    if (
      !Number.isFinite(sparkBarOpenSec) ||
      !Number.isFinite(refPrice) ||
      refPrice <= 0 ||
      !Number.isFinite(refCloseSec) ||
      !Number.isFinite(sparkReturnPct) ||
      !Number.isFinite(due30Sec) ||
      !Number.isFinite(due60Sec)
    ) {
      continue;
    }
    const d2 = Number.isFinite(due2hSec) ? due2hSec : refCloseSec + 2 * 3600;
    const d3 = Number.isFinite(due3hSec) ? due3hSec : refCloseSec + 3 * 3600;
    const d4 = Number.isFinite(due4hSec) ? due4hSec : refCloseSec + 4 * 3600;
    const amtRaw = o.amount24Usdt;
    const amount24Usdt =
      typeof amtRaw === "number" && Number.isFinite(amtRaw) && amtRaw >= 0 ? amtRaw : null;
    const volBand = parseVolBand(o.volBand);
    const mcapBand = parseMcapBand(o.mcapBand);
    const p30 = o.price30;
    const p60 = o.price60;
    const p2 = o.price2h;
    const p3 = o.price3h;
    const p4 = o.price4h;
    out.push({
      eventKey,
      symbol,
      sparkBarOpenSec,
      refPrice,
      refCloseSec,
      sparkReturnPct,
      amount24Usdt,
      volBand,
      mcapBand,
      due30Sec,
      due60Sec,
      due2hSec: d2,
      due3hSec: d3,
      due4hSec: d4,
      sent30: o.sent30 === true,
      sent60: o.sent60 === true,
      silent2h: o.silent2h === true,
      silent3h: o.silent3h === true,
      silent4h: o.silent4h === true,
      price30: typeof p30 === "number" && Number.isFinite(p30) ? p30 : p30 === null ? null : undefined,
      momentumWon30:
        o.momentumWon30 === true ? true : o.momentumWon30 === false ? false : o.momentumWon30 === null ? null : undefined,
      price60: typeof p60 === "number" && Number.isFinite(p60) ? p60 : p60 === null ? null : undefined,
      momentumWon60:
        o.momentumWon60 === true ? true : o.momentumWon60 === false ? false : o.momentumWon60 === null ? null : undefined,
      price2h: typeof p2 === "number" && Number.isFinite(p2) ? p2 : p2 === null ? null : undefined,
      momentumWon2h:
        o.momentumWon2h === true ? true : o.momentumWon2h === false ? false : o.momentumWon2h === null ? null : undefined,
      price3h: typeof p3 === "number" && Number.isFinite(p3) ? p3 : p3 === null ? null : undefined,
      momentumWon3h:
        o.momentumWon3h === true ? true : o.momentumWon3h === false ? false : o.momentumWon3h === null ? null : undefined,
      price4h: typeof p4 === "number" && Number.isFinite(p4) ? p4 : p4 === null ? null : undefined,
      momentumWon4h:
        o.momentumWon4h === true ? true : o.momentumWon4h === false ? false : o.momentumWon4h === null ? null : undefined,
    });
  }
  return out;
}

function normalizeHistory(raw: unknown): SparkFollowUpHistoryRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SparkFollowUpHistoryRow[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const eventKey = typeof o.eventKey === "string" ? o.eventKey.trim() : "";
    const symbol = typeof o.symbol === "string" ? o.symbol.trim() : "";
    if (!eventKey || !symbol) continue;
    const sparkBarOpenSec = Number(o.sparkBarOpenSec);
    const refCloseSec = Number(o.refCloseSec);
    const refPrice = Number(o.refPrice);
    const sparkReturnPct = Number(o.sparkReturnPct);
    const resolvedAtIso = typeof o.resolvedAtIso === "string" ? o.resolvedAtIso : "";
    if (
      !Number.isFinite(sparkBarOpenSec) ||
      !Number.isFinite(refCloseSec) ||
      !Number.isFinite(refPrice) ||
      refPrice <= 0 ||
      !Number.isFinite(sparkReturnPct) ||
      !resolvedAtIso
    ) {
      continue;
    }
    const amtH = o.amount24Usdt;
    const amount24Usdt =
      typeof amtH === "number" && Number.isFinite(amtH) && amtH >= 0 ? amtH : null;
    const volBand = parseVolBand(o.volBand);
    const mcapBand = parseMcapBand(o.mcapBand);
    const p30 = o.price30;
    const p60 = o.price60;
    const p2 = o.price2h;
    const p3 = o.price3h;
    const p4 = o.price4h;
    out.push({
      eventKey,
      symbol,
      sparkBarOpenSec,
      refCloseSec,
      refPrice,
      sparkReturnPct,
      amount24Usdt,
      volBand,
      mcapBand,
      price30: typeof p30 === "number" && Number.isFinite(p30) ? p30 : null,
      price60: typeof p60 === "number" && Number.isFinite(p60) ? p60 : null,
      momentumWon30:
        o.momentumWon30 === true ? true : o.momentumWon30 === false ? false : null,
      momentumWon60:
        o.momentumWon60 === true ? true : o.momentumWon60 === false ? false : null,
      price2h: typeof p2 === "number" && Number.isFinite(p2) ? p2 : null,
      momentumWon2h:
        o.momentumWon2h === true ? true : o.momentumWon2h === false ? false : null,
      price3h: typeof p3 === "number" && Number.isFinite(p3) ? p3 : null,
      momentumWon3h:
        o.momentumWon3h === true ? true : o.momentumWon3h === false ? false : null,
      price4h: typeof p4 === "number" && Number.isFinite(p4) ? p4 : null,
      momentumWon4h:
        o.momentumWon4h === true ? true : o.momentumWon4h === false ? false : null,
      resolvedAtIso,
    });
  }
  return out;
}

function normalizeState(raw: unknown): SparkFollowUpState {
  if (!raw || typeof raw !== "object") return { pending: [], history: [] };
  const o = raw as Record<string, unknown>;
  return {
    pending: normalizePending(o.pending),
    history: normalizeHistory(o.history),
  };
}

export function sparkFollowUpEventKey(symbol: string, barOpenSec: number): string {
  return `${symbol.trim()}:${Math.floor(barOpenSec)}`;
}

export async function loadSparkFollowUpState(): Promise<SparkFollowUpState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<SparkFollowUpState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      console.error("[sparkFollowUpStore] cloud get failed", e);
      throw new Error("อ่าน spark_follow_up_state ไม่สำเร็จ");
    }
  }
  if (isVercel()) return { pending: [], history: [] };
  await ensureJsonFile();
  try {
    const raw = await readFile(filePath, "utf-8");
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return { pending: [], history: [] };
  }
}

export async function saveSparkFollowUpState(state: SparkFollowUpState): Promise<void> {
  const maxH = historyMax();
  const history = state.history.length > maxH ? state.history.slice(-maxH) : state.history;
  const payload: SparkFollowUpState = { ...state, history };

  if (useCloudStorage()) {
    await cloudSet(KV_KEY, payload);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

/** หลังแจ้ง Spark สำเร็จ — จากจุดยืนยันสัญญาณ (refClose ≈ barOpen+5m) นับ T+30m / T+1h … */
export async function enqueueSparkFollowUp(input: {
  symbol: string;
  barOpenTimeSec: number;
  refPrice: number;
  sparkReturnPct: number;
  amount24Usdt: number | null;
  volBand: SparkVolBand;
  mcapBand: SparkMcapBand;
}): Promise<void> {
  const raw = process.env.SPARK_FOLLOWUP_ENABLED?.trim();
  if (raw === "0" || raw === "false") return;

  const symbol = input.symbol.trim();
  const barOpen = Math.floor(input.barOpenTimeSec);
  const refPrice = input.refPrice;
  if (!symbol || !Number.isFinite(barOpen) || !Number.isFinite(refPrice) || refPrice <= 0) return;

  const refCloseSec = barOpen + SPARK_BAR_SEC;
  const due30Sec = refCloseSec + 30 * 60;
  const due60Sec = refCloseSec + 60 * 60;
  const due2hSec = refCloseSec + 2 * 3600;
  const due3hSec = refCloseSec + 3 * 3600;
  const due4hSec = refCloseSec + 4 * 3600;
  const eventKey = sparkFollowUpEventKey(symbol, barOpen);

  let state = await loadSparkFollowUpState();
  if (state.pending.some((p) => p.eventKey === eventKey)) return;

  state = {
    ...state,
    pending: [
      ...state.pending,
      {
        eventKey,
        symbol,
        sparkBarOpenSec: barOpen,
        refPrice,
        refCloseSec,
        sparkReturnPct: input.sparkReturnPct,
        amount24Usdt: input.amount24Usdt,
        volBand: input.volBand,
        mcapBand: input.mcapBand,
        due30Sec,
        due60Sec,
        due2hSec,
        due3hSec,
        due4hSec,
        sent30: false,
        sent60: false,
        silent2h: false,
        silent3h: false,
        silent4h: false,
      },
    ],
  };
  await saveSparkFollowUpState(state);
}
