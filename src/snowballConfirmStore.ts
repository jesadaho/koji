import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";
import type { SnowballBinanceTf } from "./binanceIndicatorKline";

/** ค่าเดียวกับ SnowballConfirmRiskFlagId ใน publicIndicatorFeed — แยกเพื่อกัน import วน */
export type SnowballConfirmRiskFlagId = "wick_history" | "supply_zone" | "signal_wick";

const KV_KEY = "koji:snowball_pending_confirm";
const filePath = join(process.cwd(), "data", "snowball_pending_confirm.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ snowball pending confirm state");
  }
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '{"items":[]}', "utf-8");
  }
}

export type SnowballPendingConfirmFlag = {
  id: SnowballConfirmRiskFlagId;
  label: string;
  detail: string;
};

export type SnowballPendingConfirm = {
  id: string;
  symbol: string;
  side: "long" | "bear";
  snowTf: SnowballBinanceTf;
  signalBarOpenSec: number;
  signalHigh: number;
  signalLow: number;
  signalClose: number;
  signalVolume: number;
  alertedAtIso: string;
  alertedAtMs: number;
  riskFlags: SnowballPendingConfirmFlag[];
  qualityTier?: "a_plus" | "b_plus" | "c_plus";
  /**
   * true = แท่ง 1 ไม่ส่ง TG / ไม่ autotrade — ให้เรียก Snowball auto-open หลัง ✅ Confirmed (เมื่อเป็น Super A+)
   */
  deferSnowballAutotradeToConfirm?: boolean;
  /** เก็บไว้สำหรับ append Snowball stats หลัง confirm (แท่ง 1 ไม่ใส่ลิสต์เมื่อ skip TG) */
  statsTriggerKind?: string;
  /** SMA(volume) ที่แท่งสัญญาณ — ใช้คำนวณ SVP hole ใน stats ให้สอดคล้องแท่ง 1 */
  statsVolSma?: number;
  /** ATR(100) ตอนแท่งสัญญาณ — ส่งต่อให้ stats หลัง confirm */
  statsAtr100?: number | null;
  /** Max upper wick 100 แท่งก่อนสัญญาณ */
  statsMaxUpperWick100?: number | null;
  statsRangeScore?: number | null;
  statsWickScore?: number | null;
  statsBarRangePctPrev?: number | null;
  statsBarRangePctSignal?: number | null;
  statsBarRangePct2Sum?: number | null;
  statsBtcPsar4hTrend?: "up" | "down" | null;
  statsBtcPsar4hClose?: number | null;
  statsQuoteVol24hUsdt?: number | null;
};

export type SnowballPendingConfirmState = {
  items: SnowballPendingConfirm[];
};

function normalizeFlag(raw: unknown): SnowballPendingConfirmFlag | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (id !== "wick_history" && id !== "supply_zone" && id !== "signal_wick") return null;
  const label = typeof obj.label === "string" ? obj.label : "";
  const detail = typeof obj.detail === "string" ? obj.detail : "";
  return { id, label, detail };
}

function normalizeItem(raw: unknown): SnowballPendingConfirm | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const symbol = typeof o.symbol === "string" ? o.symbol.toUpperCase() : "";
  if (!symbol) return null;
  const side = o.side === "long" || o.side === "bear" ? o.side : null;
  if (!side) return null;
  const snowTf = o.snowTf === "15m" || o.snowTf === "1h" || o.snowTf === "4h" ? o.snowTf : null;
  if (!snowTf) return null;
  const signalBarOpenSec = Number(o.signalBarOpenSec);
  if (!Number.isFinite(signalBarOpenSec) || signalBarOpenSec <= 0) return null;
  const signalHigh = Number(o.signalHigh);
  const signalLow = Number(o.signalLow);
  const signalClose = Number(o.signalClose);
  const signalVolume = Number(o.signalVolume);
  if (
    !Number.isFinite(signalHigh) ||
    !Number.isFinite(signalLow) ||
    !Number.isFinite(signalClose) ||
    !Number.isFinite(signalVolume)
  ) {
    return null;
  }
  const alertedAtIso = typeof o.alertedAtIso === "string" ? o.alertedAtIso : new Date().toISOString();
  const alertedAtMs = Number(o.alertedAtMs);
  const flagsRaw = Array.isArray(o.riskFlags) ? o.riskFlags : [];
  const riskFlags = flagsRaw
    .map(normalizeFlag)
    .filter((f): f is SnowballPendingConfirmFlag => f != null);
  const qualityTier =
    o.qualityTier === "a_plus" || o.qualityTier === "b_plus" || o.qualityTier === "c_plus"
      ? o.qualityTier
      : undefined;
  const deferSnowballAutotradeToConfirm =
    o.deferSnowballAutotradeToConfirm === true ||
    o.deferSnowballAutotradeToConfirm === 1 ||
    o.deferSnowballAutotradeToConfirm === "1" ||
    o.deferSnowballAutotradeToConfirm === "true";
  const statsTriggerKind = typeof o.statsTriggerKind === "string" && o.statsTriggerKind.trim() ? o.statsTriggerKind.trim() : undefined;
  const statsVolSma = Number(o.statsVolSma);
  const statsVolSmaOk = Number.isFinite(statsVolSma) && statsVolSma > 0;
  const statsAtr100 = Number(o.statsAtr100);
  const statsAtr100Ok = Number.isFinite(statsAtr100) && statsAtr100 > 0;
  const statsMaxUpperWick100 = Number(o.statsMaxUpperWick100);
  const statsMaxUpperWick100Ok = Number.isFinite(statsMaxUpperWick100) && statsMaxUpperWick100 >= 0;
  const statsRangeScore = Number(o.statsRangeScore);
  const statsRangeScoreOk = Number.isFinite(statsRangeScore) && statsRangeScore >= 0;
  const statsWickScore = Number(o.statsWickScore);
  const statsWickScoreOk = Number.isFinite(statsWickScore) && statsWickScore >= 0;
  const statsBarRangePctPrev = Number(o.statsBarRangePctPrev);
  const statsBarRangePctPrevOk = Number.isFinite(statsBarRangePctPrev) && statsBarRangePctPrev >= 0;
  const statsBarRangePctSignal = Number(o.statsBarRangePctSignal);
  const statsBarRangePctSignalOk = Number.isFinite(statsBarRangePctSignal) && statsBarRangePctSignal >= 0;
  const statsBarRangePct2Sum = Number(o.statsBarRangePct2Sum);
  const statsBarRangePct2SumOk = Number.isFinite(statsBarRangePct2Sum) && statsBarRangePct2Sum >= 0;
  const statsBtcPsar4hTrend =
    o.statsBtcPsar4hTrend === "up" || o.statsBtcPsar4hTrend === "down" ? o.statsBtcPsar4hTrend : null;
  const statsBtcPsar4hClose = Number(o.statsBtcPsar4hClose);
  const statsBtcPsar4hCloseOk = Number.isFinite(statsBtcPsar4hClose) && statsBtcPsar4hClose > 0;
  const statsQuoteVol24hUsdt = Number(o.statsQuoteVol24hUsdt);
  const statsQuoteVol24hUsdtOk = Number.isFinite(statsQuoteVol24hUsdt) && statsQuoteVol24hUsdt > 0;
  return {
    id: typeof o.id === "string" && o.id ? o.id : randomUUID(),
    symbol,
    side,
    snowTf,
    signalBarOpenSec,
    signalHigh,
    signalLow,
    signalClose,
    signalVolume,
    alertedAtIso,
    alertedAtMs: Number.isFinite(alertedAtMs) ? alertedAtMs : Date.parse(alertedAtIso),
    riskFlags,
    qualityTier,
    ...(deferSnowballAutotradeToConfirm ? { deferSnowballAutotradeToConfirm: true as const } : {}),
    ...(statsTriggerKind ? { statsTriggerKind } : {}),
    ...(statsVolSmaOk ? { statsVolSma } : {}),
    ...(statsAtr100Ok ? { statsAtr100 } : {}),
    ...(statsMaxUpperWick100Ok ? { statsMaxUpperWick100 } : {}),
    ...(statsRangeScoreOk ? { statsRangeScore } : {}),
    ...(statsWickScoreOk ? { statsWickScore } : {}),
    ...(statsBarRangePctPrevOk ? { statsBarRangePctPrev } : {}),
    ...(statsBarRangePctSignalOk ? { statsBarRangePctSignal } : {}),
    ...(statsBarRangePct2SumOk ? { statsBarRangePct2Sum } : {}),
    ...(statsBtcPsar4hTrend ? { statsBtcPsar4hTrend } : {}),
    ...(statsBtcPsar4hCloseOk ? { statsBtcPsar4hClose } : {}),
    ...(statsQuoteVol24hUsdtOk ? { statsQuoteVol24hUsdt } : {}),
  };
}

function normalizeState(raw: unknown): SnowballPendingConfirmState {
  if (!raw || typeof raw !== "object") return { items: [] };
  const o = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items = itemsRaw
    .map(normalizeItem)
    .filter((x): x is SnowballPendingConfirm => x != null);
  return { items };
}

export async function loadSnowballPendingConfirms(): Promise<SnowballPendingConfirmState> {
  if (useCloudStorage()) {
    const data = await cloudGet<SnowballPendingConfirmState>(KV_KEY);
    return normalizeState(data);
  }
  if (isVercel()) return { items: [] };
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return { items: [] };
  }
}

export async function saveSnowballPendingConfirms(state: SnowballPendingConfirmState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export type AddSnowballPendingConfirmInput = Omit<SnowballPendingConfirm, "id">;

/**
 * เพิ่มรายการ pending — กันซ้ำต่อ (symbol, side, signalBarOpenSec)
 */
export async function addSnowballPendingConfirm(input: AddSnowballPendingConfirmInput): Promise<void> {
  const state = await loadSnowballPendingConfirms();
  const exists = state.items.some(
    (it) =>
      it.symbol === input.symbol &&
      it.side === input.side &&
      it.signalBarOpenSec === input.signalBarOpenSec,
  );
  if (exists) return;
  state.items.push({ id: randomUUID(), ...input });
  /* hard cap กันบวมจากกรณี state สะสม */
  if (state.items.length > 300) {
    state.items.splice(0, state.items.length - 300);
  }
  await saveSnowballPendingConfirms(state);
}

export async function removeSnowballPendingConfirms(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const state = await loadSnowballPendingConfirms();
  const idSet = new Set(ids);
  const next = state.items.filter((it) => !idSet.has(it.id));
  if (next.length === state.items.length) return;
  await saveSnowballPendingConfirms({ items: next });
}
