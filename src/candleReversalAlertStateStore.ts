import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:candle_reversal_alert_state";
const filePath = join(process.cwd(), "data", "candle_reversal_alert_state.json");

export type CandleReversalSymbolState = {
  lastInvertedDoji1dOpenSec: number | null;
  lastMarubozu1dOpenSec: number | null;
  lastInvertedDojiAlertedAtMs: number | null;
};

export type CandleReversalAlertState = Record<string, CandleReversalSymbolState>;

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
  if (useCloudStorage()) {
    const data = await cloudGet<CandleReversalAlertState>(KV_KEY);
    if (data && typeof data === "object") return { ...data };
    return {};
  }
  if (isVercel()) return {};
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as CandleReversalAlertState;
    if (parsed && typeof parsed === "object") return { ...parsed };
  } catch {
    /* empty */
  }
  return {};
}

export async function saveCandleReversalAlertState(state: CandleReversalAlertState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}
