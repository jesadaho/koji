import type { Client, Message } from "@line/bot-sdk";

/** เว้นระหว่าง push ต่อเนื่อง (โทเค็นบอทเดียวกัน) — ลด LINE Messaging API 429 เมื่อ cron ยิงหลายข้อความติดกัน */
function minIntervalMs(): number {
  const v = Number(process.env.LINE_PUSH_MIN_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 120;
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

function getHttpStatus(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const o = e as Record<string, unknown>;
  if (typeof o.statusCode === "number") return o.statusCode;
  const orig = o.originalError as { response?: { status?: number } } | undefined;
  if (orig?.response?.status) return orig.response.status;
  return undefined;
}

function retryAfterMs(e: unknown): number | null {
  const orig = (e as { originalError?: { response?: { headers?: Record<string, unknown> } } })?.originalError;
  const h = orig?.response?.headers;
  if (!h) return null;
  const ra = h["retry-after"] ?? h["Retry-After"];
  const raw = Array.isArray(ra) ? ra[0] : ra;
  if (raw == null) return null;
  const s = Number(raw);
  if (!Number.isFinite(s) || s < 0) return null;
  return Math.min(s * 1000, 60_000);
}

/**
 * `pushMessage` พร้อมเว้นระยะระหว่างการเรียก + retry เมื่อ LINE คืน 429 (Too Many Requests)
 */
export async function linePushMessages(client: Client, to: string, messages: Message[]): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await throttleBeforePush();
    try {
      await client.pushMessage(to, messages);
      markPushDone();
      return;
    } catch (e: unknown) {
      const st = getHttpStatus(e);
      if (st === 429 && attempt < maxAttempts - 1) {
        const backoff = retryAfterMs(e) ?? Math.min(250 * 2 ** attempt, 10_000);
        console.warn(`[linePush] 429 → wait ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await sleep(backoff);
        continue;
      }
      markPushDone();
      throw e;
    }
  }
}
