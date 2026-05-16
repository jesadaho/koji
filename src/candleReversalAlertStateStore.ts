import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:candle_reversal_alert_state";
const filePath = join(process.cwd(), "data", "candle_reversal_alert_state.json");

export type CandleReversalSymbolState = {
  lastInvertedDoji1dOpenSec: number | null;
  lastMarubozu1dOpenSec: number | null;
  lastInvertedDoji1hOpenSec: number | null;
  lastLongestRedBody1hOpenSec: number | null;
  lastInvertedDoji1dAlertedAtMs: number | null;
  lastInvertedDoji1hAlertedAtMs: number | null;
};

export type CandleReversalAlertState = Record<string, CandleReversalSymbolState>;

/** คีย์พิเศษใน state JSON — ไม่ใช่สัญลักษณ์ */
export const CANDLE_REVERSAL_STATE_META_KEY = "__meta__";

export type CandleReversalStateMeta = {
  lastScanSummary1dBarOpenSec?: number | null;
  lastScanSummary1hBarOpenSec?: number | null;
};

export type CandleReversalAlertStateLoaded = {
  symbols: CandleReversalAlertState;
  meta: CandleReversalStateMeta;
};

function normalizeMeta(raw: Partial<CandleReversalStateMeta> | undefined): CandleReversalStateMeta {
  return {
    lastScanSummary1dBarOpenSec:
      raw?.lastScanSummary1dBarOpenSec != null && Number.isFinite(raw.lastScanSummary1dBarOpenSec)
        ? raw.lastScanSummary1dBarOpenSec
        : null,
    lastScanSummary1hBarOpenSec:
      raw?.lastScanSummary1hBarOpenSec != null && Number.isFinite(raw.lastScanSummary1hBarOpenSec)
        ? raw.lastScanSummary1hBarOpenSec
        : null,
  };
}

function splitStateFile(raw: Record<string, unknown>): CandleReversalAlertStateLoaded {
  const symbols: CandleReversalAlertState = {};
  let meta: CandleReversalStateMeta = normalizeMeta(undefined);
  for (const [key, val] of Object.entries(raw)) {
    if (key === CANDLE_REVERSAL_STATE_META_KEY) {
      meta = normalizeMeta(val as Partial<CandleReversalStateMeta>);
      continue;
    }
    symbols[key] = normalizeSymbolState(val as Partial<CandleReversalSymbolState>);
  }
  return { symbols, meta };
}

function mergeStateFile(loaded: CandleReversalAlertStateLoaded): Record<string, unknown> {
  return {
    ...loaded.symbols,
    [CANDLE_REVERSAL_STATE_META_KEY]: loaded.meta,
  };
}

function emptySymbolState(): CandleReversalSymbolState {
  return {
    lastInvertedDoji1dOpenSec: null,
    lastMarubozu1dOpenSec: null,
    lastInvertedDoji1hOpenSec: null,
    lastLongestRedBody1hOpenSec: null,
    lastInvertedDoji1dAlertedAtMs: null,
    lastInvertedDoji1hAlertedAtMs: null,
  };
}

function normalizeSymbolState(raw: Partial<CandleReversalSymbolState> | undefined): CandleReversalSymbolState {
  const base = emptySymbolState();
  if (!raw || typeof raw !== "object") return base;
  return { ...base, ...raw };
}

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ candle reversal alert state");
  }
}

async function ensureFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{}", "utf-8");
  }
}

export async function loadCandleReversalAlertState(): Promise<CandleReversalAlertState> {
  const loaded = await loadCandleReversalAlertStateWithMeta();
  return loaded.symbols;
}

export async function loadCandleReversalAlertStateWithMeta(): Promise<CandleReversalAlertStateLoaded> {
  const empty = (): CandleReversalAlertStateLoaded => ({
    symbols: {},
    meta: normalizeMeta(undefined),
  });

  if (useCloudStorage()) {
    const data = await cloudGet<Record<string, unknown>>(KV_KEY);
    if (data && typeof data === "object") return splitStateFile(data);
    return empty();
  }
  if (isVercel()) return empty();
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") return splitStateFile(parsed);
  } catch {
    /* empty */
  }
  return empty();
}

export async function saveCandleReversalAlertState(state: CandleReversalAlertState): Promise<void> {
  const loaded = await loadCandleReversalAlertStateWithMeta();
  loaded.symbols = state;
  await saveCandleReversalAlertStateWithMeta(loaded);
}

export async function saveCandleReversalAlertStateWithMeta(
  loaded: CandleReversalAlertStateLoaded,
): Promise<void> {
  const file = mergeStateFile(loaded);
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, file);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(file, null, 2), "utf-8");
}
