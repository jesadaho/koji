import type { Client, Message } from "@line/bot-sdk";

/** เว้นระหว่าง push ต่อเนื่อง (โทเค็นบอทเดียวกัน) — ลด LINE Messaging API 429 เมื่อ cron ยิงหลายข้อความติดกัน (แจ้งเตือนอัตโนมัติใช้เมื่อ LINE_ALERT_PUSH_ENABLED=1) */
function minIntervalMs(): number {
  const v = Number(process.env.LINE_PUSH_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 280;
}

let lastPushDoneAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function markPushDone(): void {
  lastPushDoneAt = Date.now();
}

async function throttleBeforePush(): Promise<void> {
  const gap = minIntervalMs();
  if (gap <= 0) return;
  const elapsed = Date.now() - lastPushDoneAt;
  if (elapsed < gap) await sleep(gap - elapsed);
}

/**
 * `pushMessage` พร้อมเว้นระยะระหว่างการเรียก (ไม่ retry — ถ้า LINE คืน 429 ให้ caller จัดการ)
 */
export async function linePushMessages(client: Client, to: string, messages: Message[]): Promise<void> {
  await throttleBeforePush();
  try {
    await client.pushMessage(to, messages);
  } finally {
    markPushDone();
  }
}
