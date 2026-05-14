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
 * กลุ่มสาธารณะหลัก (Spark / events / technical / …) — TELEGRAM_PUBLIC_CHAT_ID ก่อน แล้ว TELEGRAM_SPARK_SYSTEM_CHAT_ID (legacy)
 */
export function resolvePublicBroadcastChatId(): string | undefined {
  const pub = process.env.TELEGRAM_PUBLIC_CHAT_ID?.trim();
  const legacy = process.env.TELEGRAM_SPARK_SYSTEM_CHAT_ID?.trim();
  return pub || legacy || undefined;
}

/**
 * chat_id สำหรับ sendMessage — ทุก kind ใช้กลุ่มหลักเดียวกัน
 * ถ้ายังไม่มี TELEGRAM_PUBLIC_CHAT_ID จะ fallback ไป TELEGRAM_MARKET_PULSE_CHAT_ID (legacy)
 */
export function resolvePublicBroadcastChatIdForKind(_kind?: PublicBroadcastKind): string | undefined {
  const pub = resolvePublicBroadcastChatId();
  if (pub) return pub;
  return process.env.TELEGRAM_MARKET_PULSE_CHAT_ID?.trim() || undefined;
}

/** ชนิดแจ้งเตือนกลุ่มสาธารณะ → Forum topic คนละหัวข้อ (เมื่อตั้ง env แยก) */
export type PublicBroadcastKind =
  | "spark"
  | "condition"
  | "market_pulse"
  | "technical"
  | "snowball"
  | "events_weekly"
  | "events_pre"
  | "events_result"
  | "events_result_pending"
  | "events_live_ai"
  | "events_session";

function parsePositiveIntegerMessageThreadId(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/** Forum topic เดียว (legacy) — ส่งเป็น message_thread_id ใน sendMessage */
export function resolvePublicBroadcastMessageThreadId(): number | undefined {
  return parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_MESSAGE_THREAD_ID);
}

/**
 * topic ตามชนิดสัญญาณ → ถ้าไม่ตั้ง TELEGRAM_PUBLIC_*_MESSAGE_THREAD_ID ของชนิดนั้น ใช้ TELEGRAM_PUBLIC_MESSAGE_THREAD_ID
 */
const KIND_TO_THREAD_ENV: Record<PublicBroadcastKind, string> = {
  spark: "TELEGRAM_PUBLIC_SPARK_MESSAGE_THREAD_ID",
  condition: "TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID",
  market_pulse: "TELEGRAM_PUBLIC_MARKET_PULSE_MESSAGE_THREAD_ID",
  technical: "TELEGRAM_PUBLIC_TECHNICAL_MESSAGE_THREAD_ID",
  snowball: "TELEGRAM_PUBLIC_SNOWBALL_MESSAGE_THREAD_ID",
  events_weekly: "TELEGRAM_PUBLIC_EVENTS_WEEKLY_MESSAGE_THREAD_ID",
  events_pre: "TELEGRAM_PUBLIC_EVENTS_PRE_MESSAGE_THREAD_ID",
  events_result: "TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID",
  events_result_pending: "TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID",
  events_live_ai: "TELEGRAM_PUBLIC_EVENTS_LIVE_AI_MESSAGE_THREAD_ID",
  events_session: "TELEGRAM_PUBLIC_EVENTS_SESSION_MESSAGE_THREAD_ID",
};

export function resolvePublicBroadcastMessageThreadIdForKind(kind: PublicBroadcastKind): number | undefined {
  const specific = parsePositiveIntegerMessageThreadId(process.env[KIND_TO_THREAD_ENV[kind]]);
  if (specific != null) return specific;
  if (kind === "snowball") {
    return (
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_TECHNICAL_MESSAGE_THREAD_ID) ??
      resolvePublicBroadcastMessageThreadId()
    );
  }
  if (kind === "events_result" || kind === "events_result_pending") {
    return (
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID) ??
      resolvePublicBroadcastMessageThreadId()
    );
  }
  if (kind === "events_session") {
    const sid = parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_SESSION_MESSAGE_THREAD_ID);
    if (sid != null) return sid;
    return (
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_WEEKLY_MESSAGE_THREAD_ID) ??
      resolvePublicBroadcastMessageThreadId()
    );
  }
  if (kind === "market_pulse") {
    return (
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID) ??
      resolvePublicBroadcastMessageThreadId()
    );
  }
  /** ไม่ fallback ไป TELEGRAM_PUBLIC_MESSAGE_THREAD_ID ทันที — มักเป็นหัวข้อ Spark; ลอง session / events อื่น / condition ก่อน */
  if (kind === "events_weekly") {
    return (
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_SESSION_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_PRE_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID) ??
      resolvePublicBroadcastMessageThreadId()
    );
  }
  if (kind === "events_pre") {
    return (
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_WEEKLY_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_SESSION_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID) ??
      resolvePublicBroadcastMessageThreadId()
    );
  }
  if (kind === "events_live_ai") {
    return (
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_PRE_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_RESULT_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_WEEKLY_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_EVENTS_SESSION_MESSAGE_THREAD_ID) ??
      parsePositiveIntegerMessageThreadId(process.env.TELEGRAM_PUBLIC_CONDITION_MESSAGE_THREAD_ID) ??
      resolvePublicBroadcastMessageThreadId()
    );
  }
  return resolvePublicBroadcastMessageThreadId();
}

/** มีที่ส่ง public broadcast ได้อย่างน้อยหนึ่งที่: กลุ่มหลัก (หรือ legacy TELEGRAM_MARKET_PULSE_CHAT_ID) */
export function telegramSparkSystemGroupConfigured(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const pulse = process.env.TELEGRAM_MARKET_PULSE_CHAT_ID?.trim();
  return Boolean(token && (resolvePublicBroadcastChatId() || pulse));
}

function chunkString(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    out.push(text.slice(i, i + maxLen));
  }
  return out;
}

/** สำหรับ parse_mode=HTML — ต้อง escape ก่อนใส่ใน <pre> / ข้อความทั่วไป */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** ครอบทั้งข้อความเป็น monospace ใน Telegram (HTML) — คืน null ถ้ายาวเกิน limit หลัง wrap */
export function wrapTelegramPreMonospace(plain: string): string | null {
  const escaped = escapeTelegramHtml(plain);
  const wrapped = `<pre>${escaped}</pre>`;
  if (wrapped.length > TELEGRAM_SEND_MESSAGE_MAX) return null;
  return wrapped;
}

export type SendTelegramMessageOptions = {
  /** กลุ่ม Forum — id ของหัวข้อ (topic) */
  messageThreadId?: number;
  /** เมื่อตั้ง → ส่ง parse_mode ไป Telegram (ข้อความต้องถูกต้องตามรูปแบบนั้น) */
  parseMode?: "HTML";
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
  const parseMode = options?.parseMode;

  for (const t of parts) {
    const body: Record<string, unknown> = {
      chat_id: cid,
      text: t,
      disable_web_page_preview: true,
    };
    if (parseMode != null) {
      body.parse_mode = parseMode;
    }
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

export type SendTelegramPublicBroadcastOptions = {
  /** ครอบข้อความด้วย &lt;pre&gt; + parse_mode HTML — monospace ใน Telegram (เฉพาะเมื่อความยาวพอดี) */
  monospaceHtml?: boolean;
  /**
   * Forum topic id — บังคับห้องปลายทาง (เช่น ให้ตรง TELEGRAM_PUBLIC_TECHNICAL_MESSAGE_THREAD_ID โดยไม่พึ่ง resolve ของ kind อื่น)
   * เมื่อไม่ส่ง → ใช้ topic ตาม `kind` (เช่น technical → TELEGRAM_PUBLIC_TECHNICAL_MESSAGE_THREAD_ID)
   */
  messageThreadId?: number;
};

/**
 * ส่งไปกลุ่มสาธารณะตาม env (chat + optional topic)
 * @param kind เมื่อระบุ → ใช้ topic ตามชนิด (เช่น market_pulse → TELEGRAM_PUBLIC_MARKET_PULSE_MESSAGE_THREAD_ID); เมื่อไม่ระบุ → TELEGRAM_PUBLIC_MESSAGE_THREAD_ID
 */
export async function sendTelegramPublicBroadcastMessage(
  text: string,
  kind?: PublicBroadcastKind,
  options?: SendTelegramPublicBroadcastOptions
): Promise<void> {
  const chatId = resolvePublicBroadcastChatIdForKind(kind);
  if (!chatId) {
    throw new Error(
      "ไม่มี chat ปลายทาง: ตั้ง TELEGRAM_PUBLIC_CHAT_ID (หรือ TELEGRAM_SPARK_SYSTEM_CHAT_ID) — หรือ legacy TELEGRAM_MARKET_PULSE_CHAT_ID",
    );
  }
  const tidOverride = options?.messageThreadId;
  const tid =
    typeof tidOverride === "number" &&
    Number.isInteger(tidOverride) &&
    tidOverride > 0
      ? tidOverride
      : kind == null
        ? resolvePublicBroadcastMessageThreadId()
        : resolvePublicBroadcastMessageThreadIdForKind(kind);

  let payload = text;
  const chatOpts: SendTelegramMessageOptions = tid != null ? { messageThreadId: tid } : {};
  if (options?.monospaceHtml) {
    const wrapped = wrapTelegramPreMonospace(text);
    if (wrapped != null) {
      payload = wrapped;
      chatOpts.parseMode = "HTML";
    }
  }
  await sendTelegramMessageToChat(chatId, payload, chatOpts);
}

/**
 * ส่งไปกลุ่มสาธารณะหัวข้อ **Technical** (`TELEGRAM_PUBLIC_TECHNICAL_MESSAGE_THREAD_ID` หรือ fallback ตาม `resolvePublicBroadcastMessageThreadIdForKind("technical")`)
 */
export async function sendTechnicalPublicBroadcastMessage(
  text: string,
  options?: SendTelegramPublicBroadcastOptions
): Promise<void> {
  return sendTelegramPublicBroadcastMessage(text, "technical", options);
}
