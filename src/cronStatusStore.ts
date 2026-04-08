import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:cron_status";
const filePath = join(process.cwd(), "data", "cron_status.json");

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

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "null", "utf-8");
  }
}

export type CronStepResult = {
  ok: boolean;
  ms?: number;
  error?: string;
  /** รายละเอียดสั้น ๆ สำหรับอ่านใน LINE */
  detail?: string;
};

export type CronRunRecord = {
  at: string;
  durationMs: number;
  steps: {
    priceAlerts: CronStepResult;
    contractCondition: CronStepResult;
    fundingHistory: CronStepResult;
  };
};

export async function loadCronRunRecord(): Promise<CronRunRecord | null> {
  if (useCloudStorage()) {
    const data = await cloudGet<CronRunRecord>(KV_KEY);
    if (data && typeof data === "object" && typeof data.at === "string" && data.steps) {
      return data;
    }
    return null;
  }
  if (isVercel()) return null;
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as CronRunRecord | null;
    if (parsed && typeof parsed.at === "string" && parsed.steps) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveCronRunRecord(record: CronRunRecord): Promise<void> {
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, record);
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
}

/** ข้อความสั้นสำหรับตอบ LINE (ไม่มี secret) */
export function formatCronRunForLine(r: CronRunRecord | null): string {
  if (!r) {
    return [
      "🗓 สถานะ cron",
      "",
      "ยังไม่มีบันทึกรอบล่าสุด — มักเกิดเมื่อ:",
      "• ยังไม่เคยรัน /api/cron/price-alerts สำเร็จ",
      "• บน Vercel ยังไม่ได้ตั้ง REDIS_URL หรือ KV (ใช้เก็บสถานะ)",
      "• CRON_SECRET ไม่ตรง (cron ได้ 401)",
      "",
      "Cron ตาม vercel.json: ทุกต้นชั่วโมง UTC (0 * * * *)",
      "ดู log ย้อนหลัง: Vercel → Project → Logs (filter path cron หรือ price-alerts)",
    ].join("\n");
  }

  const fmt = (s: CronStepResult, label: string) => {
    const icon = s.ok ? "✅" : "❌";
    const ms = s.ms != null ? ` ${s.ms}ms` : "";
    const tail = s.error ? `\n   ${s.error}` : s.detail ? `\n   ${s.detail}` : "";
    return `• ${label}: ${icon}${ms}${tail}`;
  };

  return [
    "🗓 สถานะ cron (รอบล่าสุด)",
    `เวลา: ${r.at} (UTC จากเซิร์ฟเวอร์)`,
    `รวม: ${r.durationMs}ms`,
    "",
    fmt(r.steps.priceAlerts, "แจ้งเตือนราคา"),
    fmt(r.steps.contractCondition, "สัญญา / ติดตามระบบ"),
    fmt(r.steps.fundingHistory, "ประวัติ funding (Top 50)"),
    "",
    "หมายเหตุ: ประวัติ funding ใน Markets เก็บชั่วโมงละจุดเฉพาะคู่ใน Top 50 |funding| ณ เวลานั้น",
  ].join("\n");
}
