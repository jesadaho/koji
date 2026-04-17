/** Telegram Bot API — sendMessage ข้อความสูงสุด 4096 ตัวอักษรต่อ request */
export const TELEGRAM_SEND_MESSAGE_MAX = 4096;

const TG_API = "https://api.telegram.org";

/** มี bot token (ใช้ส่ง DM / Web App validation) */
export function telegramBotTokenConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export function telegramAlertConfigured(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim();
  return Boolean(token && chatId);
}

/**
 * กลุ่มสาธารณะ (Spark / System / indicator feed) — ใช้ TELEGRAM_PUBLIC_CHAT_ID ก่อน แล้วค่อย TELEGRAM_SPARK_SYSTEM_CHAT_ID (legacy)
 */
export function resolvePublicBroadcastChatId(): string | undefined {
  const pub = process.env.TELEGRAM_PUBLIC_CHAT_ID?.trim();
  const legacy = process.env.TELEGRAM_SPARK_SYSTEM_CHAT_ID?.trim();
  return pub || legacy || undefined;
}

/** Forum topic — ส่งเป็น message_thread_id ใน sendMessage (กลุ่มแบบ Topics) */
export function resolvePublicBroadcastMessageThreadId(): number | undefined {
  const raw = process.env.TELEGRAM_PUBLIC_MESSAGE_THREAD_ID?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/** Spark follow-up + System Change → กลุ่ม Telegram (ไม่ใช่ TELEGRAM_ALERT_CHAT_ID) */
export function telegramSparkSystemGroupConfigured(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return Boolean(token && resolvePublicBroadcastChatId());
}

function chunkString(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    out.push(text.slice(i, i + maxLen));
  }
  return out;
}

export type SendTelegramMessageOptions = {
  /** กลุ่ม Forum — id ของหัวข้อ (topic) */
  messageThreadId?: number;
};

/**
 * ส่งข้อความไป Telegram chat ใดก็ได้ (ต้องมี TELEGRAM_BOT_TOKEN)
 * @param chatId เช่น -1001234567890 สำหรับกลุ่ม/ช่อง
 */
export async function sendTelegramMessageToChat(
  chatId: string,
  text: string,
  options?: SendTelegramMessageOptions
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN ไม่ได้ตั้ง");
  }
  const cid = chatId.trim();
  if (!cid) {
    throw new Error("chat_id ว่าง");
  }

  const url = `${TG_API}/bot${encodeURIComponent(token)}/sendMessage`;
  const parts = chunkString(text, TELEGRAM_SEND_MESSAGE_MAX);
  const threadId = options?.messageThreadId;

  for (const t of parts) {
    const body: Record<string, unknown> = {
      chat_id: cid,
      text: t,
      disable_web_page_preview: true,
    };
    if (threadId != null) {
      body.message_thread_id = threadId;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let j: { ok?: boolean; description?: string };
    try {
      j = JSON.parse(raw) as { ok?: boolean; description?: string };
    } catch {
      throw new Error(`Telegram response ไม่ใช่ JSON (HTTP ${res.status}): ${raw.slice(0, 200)}`);
    }
    if (!res.ok || j.ok === false) {
      throw new Error(
        j.description ?? `Telegram sendMessage HTTP ${res.status}: ${raw.slice(0, 300)}`
      );
    }
  }
}

/**
 * ส่งข้อความแจ้งเตือนไป Telegram (แบ่งยาวอัตโนมัติ)
 * ต้องมี TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID (chat_id ได้จาก getUpdates หลังกด Start ที่บอท)
 */
export async function sendTelegramAlertMessage(text: string): Promise<void> {
  const chatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim();
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim() || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN หรือ TELEGRAM_ALERT_CHAT_ID ไม่ได้ตั้ง");
  }
  await sendTelegramMessageToChat(chatId, text);
}

/** ส่งไปกลุ่มสาธารณะตาม env (chat + optional topic) */
export async function sendTelegramPublicBroadcastMessage(text: string): Promise<void> {
  const chatId = resolvePublicBroadcastChatId();
  if (!chatId) {
    throw new Error("TELEGRAM_PUBLIC_CHAT_ID หรือ TELEGRAM_SPARK_SYSTEM_CHAT_ID ไม่ได้ตั้ง");
  }
  const tid = resolvePublicBroadcastMessageThreadId();
  await sendTelegramMessageToChat(chatId, text, tid != null ? { messageThreadId: tid } : undefined);
}
