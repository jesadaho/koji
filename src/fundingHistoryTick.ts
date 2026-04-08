import { appendFundingHistorySamples } from "./fundingHistoryStore";
import { getFundingHistorySampleRows } from "./mexcMarkets";

/** ต้นชั่วโมง UTC เป็น ISO (ใช้ dedupe รอบ cron เดียวกัน) */
export function fundingHistoryHourBucketUtc(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  d.setUTCMilliseconds(0);
  return d.toISOString();
}

/**
 * รายชั่วโมง: เก็บ funding จาก ticker สำหรับ top 50 ตาม |funding| (สอดคล้องโหมด Funding)
 */
export async function runFundingHistoryTick(
  limit = 50
): Promise<{ rowsSampled: number; bucket: string }> {
  const rows = await getFundingHistorySampleRows(limit);
  const bucket = fundingHistoryHourBucketUtc();
  if (rows.length === 0) {
    return { rowsSampled: 0, bucket };
  }
  await appendFundingHistorySamples(rows, bucket);
  return { rowsSampled: rows.length, bucket };
}
