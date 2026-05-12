import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:upcoming_events_state";
const filePath = join(process.cwd(), "data", "upcoming_events_state.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error("บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV สำหรับ upcoming events state");
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

export type UpcomingEventsState = {
  /** ส่ง weekly digest แล้วสำหรับสัปดาห์ (จันทร์ UTC ของสัปดาห์นั้น YYYY-MM-DD — สอดคล้าย cron จันทร์ 00:00 UTC ≈ 07:00 ไทย) */
  lastWeeklyDigestUtcMonday: string | null;
  /** preAlertFired[eventId + "|60" | "|30"] = timestamp ms */
  preAlertFired: Record<string, number>;
  /** แจ้งผลจริงแล้วต่อ eventId */
  resultNotified: Record<string, number>;
  /** ส่งสรุป AI ช่วงถึงเวลาแล้วต่อ eventId */
  liveAiFired: Record<string, number>;
  /** ปฏิทิน BKK (YYYY-MM-DD) ที่ส่ง US session open แล้ว */
  lastUsOpenAlertBkkYmd?: string | null;
  /** ปฏิทิน BKK ที่ส่ง US close window แล้ว */
  lastUsCloseAlertBkkYmd?: string | null;
};

export async function loadUpcomingEventsState(): Promise<UpcomingEventsState> {
  if (useCloudStorage()) {
    const data = await cloudGet<UpcomingEventsState>(KV_KEY);
    if (data && typeof data === "object") {
      return {
        lastWeeklyDigestUtcMonday: data.lastWeeklyDigestUtcMonday ?? null,
        preAlertFired: data.preAlertFired && typeof data.preAlertFired === "object" ? { ...data.preAlertFired } : {},
        resultNotified:
          data.resultNotified && typeof data.resultNotified === "object" ? { ...data.resultNotified } : {},
        liveAiFired: data.liveAiFired && typeof data.liveAiFired === "object" ? { ...data.liveAiFired } : {},
        lastUsOpenAlertBkkYmd: data.lastUsOpenAlertBkkYmd ?? null,
        lastUsCloseAlertBkkYmd: data.lastUsCloseAlertBkkYmd ?? null,
      };
    }
    return {
      lastWeeklyDigestUtcMonday: null,
      preAlertFired: {},
      resultNotified: {},
      liveAiFired: {},
      lastUsOpenAlertBkkYmd: null,
      lastUsCloseAlertBkkYmd: null,
    };
  }
  if (isVercel())
    return {
      lastWeeklyDigestUtcMonday: null,
      preAlertFired: {},
      resultNotified: {},
      liveAiFired: {},
      lastUsOpenAlertBkkYmd: null,
      lastUsCloseAlertBkkYmd: null,
    };
  await ensureFile();
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as UpcomingEventsState;
    if (parsed && typeof parsed === "object") {
      return {
        lastWeeklyDigestUtcMonday: parsed.lastWeeklyDigestUtcMonday ?? null,
        preAlertFired: parsed.preAlertFired ?? {},
        resultNotified: parsed.resultNotified ?? {},
        liveAiFired: parsed.liveAiFired ?? {},
        lastUsOpenAlertBkkYmd: parsed.lastUsOpenAlertBkkYmd ?? null,
        lastUsCloseAlertBkkYmd: parsed.lastUsCloseAlertBkkYmd ?? null,
      };
    }
  } catch {
    /* empty */
  }
  return {
    lastWeeklyDigestUtcMonday: null,
    preAlertFired: {},
    resultNotified: {},
    liveAiFired: {},
    lastUsOpenAlertBkkYmd: null,
    lastUsCloseAlertBkkYmd: null,
  };
}

export async function saveUpcomingEventsState(state: UpcomingEventsState): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, state);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}
