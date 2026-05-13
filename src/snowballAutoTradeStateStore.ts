import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:snowball_autotrade_state";
const filePath = join(process.cwd(), "data", "snowball_autotrade_state.json");

function dedupeStringsInOrder(upperSymbols: string[]): string[] {
  const seen = Object.create(null) as Record<string, true>;
  const out: string[] = [];
  for (let i = 0; i < upperSymbols.length; i += 1) {
    const u = upperSymbols[i]!.trim();
    if (!u || seen[u]) continue;
    seen[u] = true;
    out.push(u);
  }
  return out;
}

export function bkkSnowballAutoTradeDayKeyNow(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export type SnowballAutoTradeSide = "long" | "short";

export type SnowballAutoTradeActive = {
  contractSymbol: string;
  /** Snowball universe symbol (Binance-style) ใช้ fetch kline สำหรับกติกา 24h */
  binanceSymbol: string;
  side: SnowballAutoTradeSide;
  openedAtMs: number;
  /** จุดเข้าซื้อที่บอทแนะนำ (อ้างอิงคำนวณ ROI/time rules) */
  referenceEntryPrice: number;
  signalBarOpenSec: number;
  signalBarTf: "15m" | "1h" | "4h";
  signalBarLow: number | null;
  svpHoleYn: "Y" | "N";
  leverage: number;
  quickTpEnabled: boolean;
  quickTpRoiPct: number;
  quickTpMaxHours: number;
};

export type SnowballAutoTradePerUserState = {
  dailyKeyBkk: string;
  openedContractSymbolsToday: string[];
  active?: SnowballAutoTradeActive[];
};

export type SnowballAutoTradeState = Record<string, SnowballAutoTradePerUserState>;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องมี REDIS_URL หรือ Vercel KV สำหรับ snowball autotrade state");
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

function normalizeActive(raw: unknown): SnowballAutoTradeActive[] {
  if (!Array.isArray(raw)) return [];
  const out: SnowballAutoTradeActive[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const o = x as Record<string, unknown>;
    const sym = typeof o.contractSymbol === "string" ? o.contractSymbol.trim().toUpperCase() : "";
    const binanceSymbol = typeof o.binanceSymbol === "string" ? o.binanceSymbol.trim().toUpperCase() : "";
    const side = o.side === "long" || o.side === "short" ? (o.side as SnowballAutoTradeSide) : null;
    const openedAtMs = typeof o.openedAtMs === "number" && Number.isFinite(o.openedAtMs) ? o.openedAtMs : NaN;
    const entry = typeof o.referenceEntryPrice === "number" && Number.isFinite(o.referenceEntryPrice) ? o.referenceEntryPrice : NaN;
    const signalBarOpenSec =
      typeof o.signalBarOpenSec === "number" && Number.isFinite(o.signalBarOpenSec) ? o.signalBarOpenSec : NaN;
    const signalBarTf =
      o.signalBarTf === "4h" || o.signalBarTf === "1h" || o.signalBarTf === "15m"
        ? (o.signalBarTf as "15m" | "1h" | "4h")
        : "15m";
    const signalBarLowRaw = (o as { signalBarLow?: unknown }).signalBarLow;
    const signalBarLow =
      typeof signalBarLowRaw === "number" && Number.isFinite(signalBarLowRaw) && signalBarLowRaw > 0
        ? signalBarLowRaw
        : null;
    const svpHoleYn = o.svpHoleYn === "Y" || o.svpHoleYn === "N" ? (o.svpHoleYn as "Y" | "N") : "N";
    const lev = typeof o.leverage === "number" && Number.isFinite(o.leverage) ? Math.floor(o.leverage) : NaN;
    const qEn = Boolean(o.quickTpEnabled);
    const qRoi = typeof o.quickTpRoiPct === "number" && Number.isFinite(o.quickTpRoiPct) ? o.quickTpRoiPct : NaN;
    const qH = typeof o.quickTpMaxHours === "number" && Number.isFinite(o.quickTpMaxHours) ? o.quickTpMaxHours : NaN;
    if (
      !sym ||
      !binanceSymbol ||
      !side ||
      !Number.isFinite(openedAtMs) ||
      !Number.isFinite(entry) ||
      !(entry > 0) ||
      !Number.isFinite(signalBarOpenSec) ||
      !Number.isFinite(lev) ||
      lev < 1
    ) {
      continue;
    }
    const quickTpRoiPct = Number.isFinite(qRoi) && qRoi > 0 ? qRoi : 30;
    const quickTpMaxHours = Number.isFinite(qH) && qH > 0 ? qH : 4;
    out.push({
      contractSymbol: sym,
      binanceSymbol,
      side,
      openedAtMs,
      referenceEntryPrice: entry,
      signalBarOpenSec,
      signalBarTf,
      signalBarLow,
      svpHoleYn,
      leverage: lev,
      quickTpEnabled: qEn,
      quickTpRoiPct,
      quickTpMaxHours,
    });
  }
  const bySym = new Map<string, SnowballAutoTradeActive>();
  for (const e of out) bySym.set(`${e.contractSymbol}|${e.side}`, e);
  const deduped: SnowballAutoTradeActive[] = [];
  bySym.forEach((v) => deduped.push(v));
  return deduped;
}

function normalizeState(raw: unknown): SnowballAutoTradeState {
  if (!raw || typeof raw !== "object") return {};
  const out: SnowballAutoTradeState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k?.trim()) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as {
      dailyKeyBkk?: unknown;
      openedContractSymbolsToday?: unknown;
      active?: unknown;
    };
    const dk = typeof o.dailyKeyBkk === "string" && o.dailyKeyBkk.trim() ? o.dailyKeyBkk.trim() : "";
    let syms: string[] = [];
    if (Array.isArray(o.openedContractSymbolsToday)) {
      syms = o.openedContractSymbolsToday
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim().toUpperCase());
    }
    if (!dk) continue;
    const active = normalizeActive(o.active);
    const entry: SnowballAutoTradePerUserState = {
      dailyKeyBkk: dk,
      openedContractSymbolsToday: dedupeStringsInOrder(syms),
    };
    if (active.length) entry.active = active;
    out[k.trim()] = entry;
  }
  return out;
}

function userStateFresh(
  u: SnowballAutoTradePerUserState | undefined,
  dayKey: string
): SnowballAutoTradePerUserState {
  if (!u || u.dailyKeyBkk !== dayKey) {
    const active = normalizeActive(u?.active);
    const base: SnowballAutoTradePerUserState = {
      dailyKeyBkk: dayKey,
      openedContractSymbolsToday: [],
    };
    if (active.length) base.active = active;
    return base;
  }
  const activeIn = normalizeActive(u.active);
  const next: SnowballAutoTradePerUserState = {
    dailyKeyBkk: dayKey,
    openedContractSymbolsToday: dedupeStringsInOrder(u.openedContractSymbolsToday.map((s) => s.toUpperCase())),
  };
  if (activeIn.length) next.active = activeIn;
  return next;
}

export async function loadSnowballAutoTradeState(): Promise<SnowballAutoTradeState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<SnowballAutoTradeState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[snowballAutoTradeStateStore] cloud get failed", e);
      throw new Error(`อ่าน snowball_autotrade_state ไม่สำเร็จ (${hint})`);
    }
  }
  if (isVercel()) return {};
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export async function saveSnowballAutoTradeState(state: SnowballAutoTradeState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function hasOpenedSnowballContractToday(
  entry: SnowballAutoTradePerUserState | undefined,
  contractSymbol: string,
  dayKey: string
): boolean {
  const sym = contractSymbol.trim().toUpperCase();
  const fresh = userStateFresh(entry, dayKey);
  return fresh.openedContractSymbolsToday.includes(sym);
}

export function withRecordedSnowballSuccessfulOpen(
  state: SnowballAutoTradeState,
  userId: string,
  p: {
    contractSymbol: string;
    binanceSymbol: string;
    side: SnowballAutoTradeSide;
    openedAtMs: number;
    referenceEntryPrice: number;
    signalBarOpenSec: number;
    signalBarTf: "15m" | "1h" | "4h";
    signalBarLow: number | null;
    svpHoleYn: "Y" | "N";
    leverage: number;
    quickTpEnabled: boolean;
    quickTpRoiPct: number;
    quickTpMaxHours: number;
  },
  dayKey: string
): SnowballAutoTradeState {
  const uid = userId.trim();
  const sym = p.contractSymbol.trim().toUpperCase();
  const prev = state[uid];
  const fresh = userStateFresh(prev, dayKey);
  const opened = fresh.openedContractSymbolsToday.includes(sym)
    ? fresh.openedContractSymbolsToday
    : [...fresh.openedContractSymbolsToday, sym];
  const activePrev = normalizeActive(fresh.active);
  const activeNext = activePrev.filter((x) => !(x.contractSymbol === sym && x.side === p.side));
  activeNext.push({
    contractSymbol: sym,
    binanceSymbol: p.binanceSymbol.trim().toUpperCase(),
    side: p.side,
    openedAtMs: p.openedAtMs,
    referenceEntryPrice: p.referenceEntryPrice,
    signalBarOpenSec: p.signalBarOpenSec,
    signalBarTf: p.signalBarTf,
    signalBarLow: p.signalBarLow,
    svpHoleYn: p.svpHoleYn,
    leverage: Math.max(1, Math.floor(p.leverage)),
    quickTpEnabled: Boolean(p.quickTpEnabled),
    quickTpRoiPct: p.quickTpRoiPct > 0 ? p.quickTpRoiPct : 30,
    quickTpMaxHours: p.quickTpMaxHours > 0 ? p.quickTpMaxHours : 4,
  });
  return {
    ...state,
    [uid]: {
      dailyKeyBkk: dayKey,
      openedContractSymbolsToday: opened,
      active: activeNext,
    },
  };
}

export function withSnowballActiveRemoved(
  state: SnowballAutoTradeState,
  userId: string,
  contractSymbol: string,
  side: SnowballAutoTradeSide
): SnowballAutoTradeState {
  const uid = userId.trim();
  const prev = state[uid];
  if (!prev?.active?.length) return state;
  const sym = contractSymbol.trim().toUpperCase();
  const nextActive = normalizeActive(prev.active).filter((x) => !(x.contractSymbol === sym && x.side === side));
  return {
    ...state,
    [uid]: {
      ...prev,
      active: nextActive.length ? nextActive : undefined,
    },
  };
}

