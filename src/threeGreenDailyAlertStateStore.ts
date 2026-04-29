import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:three_green_daily_technical_alert";
const filePath = join(process.cwd(), "data", "three_green_daily_alert_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ three-green daily alert state"
    );
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify(
        { lastProcessedSessionId: null, symbolSnapshot: [] } satisfies ThreeGreenDailyAlertState,
        null,
        2
      ),
      "utf-8"
    );
  }
}

export type ThreeGreenDailyAlertState = {
  /** bkkTradingSessionId ล่าสุดที่รับรอบ 3 เขียว + อัปเดต snapshot แล้ว */
  lastProcessedSessionId: string | null;
  /** รายชื่อ symbol ครั้งรันสุดท้าย (สำหรับ diff วันถัดไป) */
  symbolSnapshot: string[];
};

function normalizeState(raw: unknown): ThreeGreenDailyAlertState {
  if (!raw || typeof raw !== "object") {
    return { lastProcessedSessionId: null, symbolSnapshot: [] };
  }
  const o = raw as Record<string, unknown>;
  const id = o.lastProcessedSessionId;
  const lastProcessedSessionId =
    id == null || id === "" ? null : typeof id === "string" ? id.trim() : null;
  const snap = o.symbolSnapshot;
  const symbolSnapshot: string[] = [];
  if (Array.isArray(snap)) {
    for (const x of snap) {
      if (typeof x === "string" && x.trim()) symbolSnapshot.push(x.trim());
    }
  }
  symbolSnapshot.sort();
  return { lastProcessedSessionId, symbolSnapshot };
}

export async function loadThreeGreenDailyAlertState(): Promise<ThreeGreenDailyAlertState> {
  if (useCloudStorage()) {
    try {
      const data = await cloudGet<ThreeGreenDailyAlertState>(KV_KEY);
      return normalizeState(data);
    } catch (e) {
      console.error("[threeGreenDailyAlertStateStore] cloud get failed", e);
      throw e;
    }
  }
  if (isVercel()) {
    return { lastProcessedSessionId: null, symbolSnapshot: [] };
  }
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return { lastProcessedSessionId: null, symbolSnapshot: [] };
  }
}

export async function saveThreeGreenDailyAlertState(state: ThreeGreenDailyAlertState): Promise<void> {
  const normalized = normalizeState(state);
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, normalized);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(normalized, null, 2), "utf-8");
}
