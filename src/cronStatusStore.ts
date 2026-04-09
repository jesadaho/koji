import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY_HOURLY = "koji:cron_status_hourly";
const KV_KEY_PRICE_SYNC = "koji:cron_status_price_sync";
/** รูปแบบเก่า (รวมทุก step ใน record เดียว) */
const KV_KEY_LEGACY = "koji:cron_status";

const fileHourly = join(process.cwd(), "data", "cron_status_hourly.json");
const filePriceSync = join(process.cwd(), "data", "cron_status_price_sync.json");

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับบันทึกสถานะ cron"
    );
  }
}

export type CronStepResult = {
  ok: boolean;
  ms?: number;
  error?: string;
  detail?: string;
};

/** รายชั่วโมง: สัญญา + ประวัติ funding */
export type HourlyCronRecord = {
  at: string;
  durationMs: number;
  steps: {
    contractCondition: CronStepResult;
    fundingHistory: CronStepResult;
  };
};

/** ~15 นาที: แจ้งเตือนราคาเป้า + แจ้งเตือนการเคลื่อนไหวราคา + volume signal + RSI 1h */
export type PriceSyncCronRecord = {
  at: string;
  durationMs: number;
  steps: {
    priceAlerts: CronStepResult;
    pctStepAlerts: CronStepResult;
    /** บันทึกเก่าอาจไม่มีฟิลด์นี้ */
    volumeSignalAlerts?: CronStepResult;
    /** Indicator engine Phase 1.5 — RSI 1h */
    indicatorAlerts?: CronStepResult;
  };
};

/** รูปแบบเก่า — ใช้แสดงผลย้อนหลังถ้ายังไม่ migrate */
export type LegacyCronRunRecord = {
  at: string;
  durationMs: number;
  steps: {
    priceAlerts: CronStepResult;
    contractCondition: CronStepResult;
    fundingHistory: CronStepResult;
  };
};

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadHourlyCronRecord(): Promise<HourlyCronRecord | null> {
  if (useCloudStorage()) {
    const data = await cloudGet<HourlyCronRecord>(KV_KEY_HOURLY);
    if (data && typeof data === "object" && typeof data.at === "string" && data.steps) {
      return data;
    }
    return null;
  }
  if (isVercel()) return null;
  await mkdir(dirname(fileHourly), { recursive: true });
  return readJsonFile<HourlyCronRecord>(fileHourly);
}

export async function saveHourlyCronRecord(record: HourlyCronRecord): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY_HOURLY, record);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(fileHourly), { recursive: true });
  await writeFile(fileHourly, JSON.stringify(record, null, 2), "utf-8");
}

export async function loadPriceSyncCronRecord(): Promise<PriceSyncCronRecord | null> {
  if (useCloudStorage()) {
    const data = await cloudGet<PriceSyncCronRecord>(KV_KEY_PRICE_SYNC);
    if (data && typeof data === "object" && typeof data.at === "string" && data.steps) {
      return data;
    }
    return null;
  }
  if (isVercel()) return null;
  await mkdir(dirname(filePriceSync), { recursive: true });
  return readJsonFile<PriceSyncCronRecord>(filePriceSync);
}

export async function savePriceSyncCronRecord(record: PriceSyncCronRecord): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY_PRICE_SYNC, record);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePriceSync), { recursive: true });
  await writeFile(filePriceSync, JSON.stringify(record, null, 2), "utf-8");
}

export async function loadLegacyCronRunRecord(): Promise<LegacyCronRunRecord | null> {
  if (useCloudStorage()) {
    const data = await cloudGet<LegacyCronRunRecord>(KV_KEY_LEGACY);
    if (data && typeof data === "object" && typeof data.at === "string" && data.steps?.priceAlerts) {
      return data;
    }
    return null;
  }
  const legacyPath = join(process.cwd(), "data", "cron_status.json");
  return readJsonFile<LegacyCronRunRecord>(legacyPath);
}

/** สำหรับ LINE / สถานะ cron — รวม hourly + price-sync + legacy */
export async function loadCronStatusBundle(): Promise<{
  hourly: HourlyCronRecord | null;
  priceSync: PriceSyncCronRecord | null;
  legacy: LegacyCronRunRecord | null;
}> {
  const [hourly, priceSync, legacy] = await Promise.all([
    loadHourlyCronRecord(),
    loadPriceSyncCronRecord(),
    loadLegacyCronRunRecord(),
  ]);
  return { hourly, priceSync, legacy };
}

const fmt = (s: CronStepResult, label: string) => {
  const icon = s.ok ? "✅" : "❌";
  const ms = s.ms != null ? ` ${s.ms}ms` : "";
  const tail = s.error ? `\n   ${s.error}` : s.detail ? `\n   ${s.detail}` : "";
  return `• ${label}: ${icon}${ms}${tail}`;
};

export function formatCronStatusForLine(bundle: {
  hourly: HourlyCronRecord | null;
  priceSync: PriceSyncCronRecord | null;
  legacy: LegacyCronRunRecord | null;
}): string {
  const { hourly, priceSync, legacy } = bundle;

  if (!hourly && !priceSync && !legacy) {
    return [
      "🗓 สถานะ cron",
      "",
      "ยังไม่มีบันทึกรอบล่าสุด — มักเกิดเมื่อ:",
      "• ยังไม่เคยรัน /api/cron/price-sync หรือ /api/cron/price-alerts สำเร็จ",
      "• บน Vercel ยังไม่ได้ตั้ง REDIS_URL หรือ KV",
      "• CRON_SECRET ไม่ตรง (cron ได้ 401)",
      "",
      "กำหนดการ: price-sync ~ทุก 15 นาที (UTC) · price-alerts ทุกชั่วโมง (UTC)",
      "ดู log: Vercel → Project → Logs",
    ].join("\n");
  }

  const parts: string[] = ["🗓 สถานะ cron", ""];

  if (priceSync) {
    parts.push("— รอบล่าสุด: แจ้งเตือนราคา (~15 นาที) —");
    parts.push(`เวลา: ${priceSync.at} · รวม ${priceSync.durationMs}ms`);
    parts.push(fmt(priceSync.steps.priceAlerts, "แจ้งเตือนเป้าราคา"));
    parts.push(fmt(priceSync.steps.pctStepAlerts, "แจ้งเตือนการเคลื่อนไหวราคา"));
    if (priceSync.steps.volumeSignalAlerts) {
      parts.push(fmt(priceSync.steps.volumeSignalAlerts, "Volume signal (Top 30)"));
    }
    if (priceSync.steps.indicatorAlerts) {
      parts.push(fmt(priceSync.steps.indicatorAlerts, "RSI indicator (1h)"));
    }
    parts.push("");
  }

  if (hourly) {
    parts.push("— รอบล่าสุด: สัญญา / funding history (ชั่วโมง) —");
    parts.push(`เวลา: ${hourly.at} · รวม ${hourly.durationMs}ms`);
    parts.push(fmt(hourly.steps.contractCondition, "สัญญา / ติดตามระบบ"));
    parts.push(fmt(hourly.steps.fundingHistory, "ประวัติ funding (Top 50)"));
    parts.push("");
  }

  if (!priceSync && !hourly && legacy) {
    parts.push("— บันทึกแบบเก่า (ก่อนแยก cron) —");
    parts.push(`เวลา: ${legacy.at} · รวม ${legacy.durationMs}ms`);
    parts.push(fmt(legacy.steps.priceAlerts, "แจ้งเตือนราคา"));
    parts.push(fmt(legacy.steps.contractCondition, "สัญญา / ติดตามระบบ"));
    parts.push(fmt(legacy.steps.fundingHistory, "ประวัติ funding"));
    parts.push("");
  }

  parts.push("หมายเหตุ: ประวัติ funding เก็บชั่วโมงละจุดเฉพาะ Top 50 |funding|");
  return parts.join("\n");
}

/** @deprecated ใช้ loadCronStatusBundle + formatCronStatusForLine */
export async function loadCronRunRecord(): Promise<LegacyCronRunRecord | null> {
  return loadLegacyCronRunRecord();
}

/** @deprecated */
export function formatCronRunForLine(r: LegacyCronRunRecord | null): string {
  if (!r) {
    return formatCronStatusForLine({ hourly: null, priceSync: null, legacy: null });
  }
  return formatCronStatusForLine({ hourly: null, priceSync: null, legacy: r });
}
