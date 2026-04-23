import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:tv_webhook_open_wizard";
const filePath = join(process.cwd(), "data", "trading_view_open_wizard.json");

const TTL_MS = 15 * 60 * 1000;

export type TvOpenWizardStep = "side" | "margin" | "leverage";

export type TvOpenWizardState = {
  step: TvOpenWizardStep;
  side?: "LONG" | "SHORT";
  marginUsdt?: number;
  leverage?: number;
  /** epoch ms — refresh on each touch */
  expiresAtMs: number;
};

type WizardMap = Record<string, TvOpenWizardState>;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ KV สำหรับ tv_webhook_open_wizard");
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

async function loadMap(): Promise<WizardMap> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<WizardMap>(KV_KEY);
      if (data && typeof data === "object" && !Array.isArray(data)) return data;
    } catch (e) {
      console.error("[tradingViewOpenWizardStore] cloud get failed", e);
      throw e;
    }
    return {};
  }
  if (isVercel()) return {};
  await ensureFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as WizardMap;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveMap(map: WizardMap): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, map);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(map, null, 2), "utf-8");
}

function nowMs(): number {
  return Date.now();
}

function pruneExpired(map: WizardMap): WizardMap {
  const t = nowMs();
  const next: WizardMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && typeof v.expiresAtMs === "number" && v.expiresAtMs > t) {
      next[k] = v;
    }
  }
  return next;
}

export async function getTvOpenWizard(userId: string): Promise<TvOpenWizardState | null> {
  const map = pruneExpired(await loadMap());
  return map[userId] ?? null;
}

export async function clearTvOpenWizard(userId: string): Promise<void> {
  const map = pruneExpired(await loadMap());
  if (!(userId in map)) return;
  delete map[userId];
  await saveMap(map);
}

export async function startTvOpenWizard(userId: string): Promise<TvOpenWizardState> {
  const map = pruneExpired(await loadMap());
  const state: TvOpenWizardState = {
    step: "side",
    expiresAtMs: nowMs() + TTL_MS,
  };
  map[userId] = state;
  await saveMap(map);
  return state;
}

export async function updateTvOpenWizard(
  userId: string,
  patch: Partial<Pick<TvOpenWizardState, "step" | "side" | "marginUsdt" | "leverage">>
): Promise<TvOpenWizardState | null> {
  const map = pruneExpired(await loadMap());
  const prev = map[userId];
  if (!prev) return null;
  const next: TvOpenWizardState = {
    ...prev,
    ...patch,
    expiresAtMs: nowMs() + TTL_MS,
  };
  map[userId] = next;
  await saveMap(map);
  return next;
}
