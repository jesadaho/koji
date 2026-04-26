import { sendTelegramMessageToChat, telegramBotTokenConfigured, TELEGRAM_SEND_MESSAGE_MAX } from "./telegramAlert";
import { tgStoreKeyToTelegramDmChatId } from "./telegramMiniAppAuth";

/** แจ้ง TV webhook body พัง — ส่งเฉพาะ admin (ไม่ DM user จาก body ดิบ) */
function resolveTvWebhookMalformedAdminChatId(): string | null {
  const dedicated = process.env.TELEGRAM_TV_WEBHOOK_MALFORMED_CHAT_ID?.trim();
  if (dedicated) return dedicated;
  return process.env.TELEGRAM_ALERT_CHAT_ID?.trim() || null;
}

function tvWebhookMalformedMessageThreadId(): number | undefined {
  const raw = process.env.TELEGRAM_TV_WEBHOOK_MALFORMED_MESSAGE_THREAD_ID?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/** บรรทัดช่วย admin — ลาก id จากดิบเท่านั้น (ไม่ยืนยัน token) */
function formatWebhookIdGuessLineForAdmin(raw: string): string {
  const s = raw.slice(0, 12_000).trim();
  if (!s) return "body ว่าง — ไม่มี id ให้ดู";
  const mTg = s.match(/"id"\s*:\s*"tg:\s*(\d{1,20})\s*"/i);
  if (mTg?.[1]) return `ดึง id จากดิบ (ไม่ยืนยัน): tg:${mTg[1].trim()}`;
  const mStr = s.match(/"id"\s*:\s*"([^"]{0,80})"\s*([,}]|$)/);
  if (mStr?.[1]) {
    const v = mStr[1].trim().slice(0, 60);
    if (v) return `ดึง id จากดิบ (ไม่ยืนยัน): "${v}"`;
  }
  const mNum = s.match(/"id"\s*:\s*(\d{1,20})(?=\s*[,}])/);
  if (mNum?.[1]) return `ดึง id จากดิบ (ไม่ยืนยัน): ${mNum[1]}`;
  return "ไม่พบคีย์ id ใน body";
}

/**
 * แจ้ง admin เมื่อ body ไม่ใช่ JSON ที่อ่านได้ — ไม่ส่ง DM ไปหา user จาก body ดิบ
 * ปลายทาง: TELEGRAM_TV_WEBHOOK_MALFORMED_CHAT_ID หรือ fallback TELEGRAM_ALERT_CHAT_ID (+ bot token)
 */
export async function notifyTvWebhookMalformedBodyRaw(
  raw: string,
  errorCode: string,
  detailLines: string[]
): Promise<void> {
  const adminChat = resolveTvWebhookMalformedAdminChatId();
  if (!adminChat || !telegramBotTokenConfigured()) return;

  const text = [
    "Koji — TradingView webhook (admin)",
    "⚠️ อ่าน JSON request ไม่ผ่าน",
    `รหัส: ${errorCode}`,
    formatWebhookIdGuessLineForAdmin(raw),
    ...detailLines.filter((x) => x && String(x).trim()),
  ]
    .join("\n")
    .slice(0, TELEGRAM_SEND_MESSAGE_MAX);

  try {
    const threadId = tvWebhookMalformedMessageThreadId();
    await sendTelegramMessageToChat(adminChat, text, threadId != null ? { messageThreadId: threadId } : undefined);
  } catch (e) {
    console.error("[tv/webhook] malformed admin notify", e);
  }
}

/**
 * แจ้ง DM เมื่อ webhook ล้มเหลว — ไม่ส่งถ้าไม่ใช่ `tg:…` หรือไม่มี bot token
 */
export async function notifyTvWebhookError(userId: string, errorCode: string, lines: string[]): Promise<void> {
  if (!tgStoreKeyToTelegramDmChatId(userId)) return;
  const text = [
    "Koji — MEXC",
    "❌ TradingView webhook ไม่สำเร็จ",
    `รหัส: ${errorCode}`,
    ...lines,
  ]
    .filter((x) => x && String(x).trim())
    .join("\n")
    .slice(0, TELEGRAM_SEND_MESSAGE_MAX);
  await notifyTradingViewWebhookTelegram(userId, text);
}

/**
 * แจ้ง Telegram DM หลัง MEXC webhook จาก TradingView สำเร็จ — เฉพาะ user id แบบ `tg:123`
 */
export async function notifyTradingViewWebhookTelegram(userId: string, text: string): Promise<void> {
  if (!telegramBotTokenConfigured()) return;
  const chatId = tgStoreKeyToTelegramDmChatId(userId);
  if (!chatId) return;
  try {
    await sendTelegramMessageToChat(chatId, text);
  } catch (e) {
    console.error("[tv/webhook] telegram notify", e);
  }
}

function finiteStr(n: unknown, fallback: string): string {
  if (typeof n === "number" && Number.isFinite(n)) return String(n);
  if (typeof n === "string" && n.trim()) return n.trim().slice(0, 80);
  return fallback;
}

export async function notifyTvWebhookCloseOk(input: {
  userId: string;
  label: string;
  contractSymbol: string;
  closed: { positionId: number; orderId?: string; error?: string }[];
  priceNote: string | null;
  remark?: string;
}): Promise<void> {
  const lines: string[] = [
    "Koji — MEXC",
    "✅ ปิด position สำเร็จ (TradingView)",
    `${input.label} · ${input.contractSymbol}`,
  ];
  const parts = input.closed.slice(0, 8).map((c) =>
    c.error ? `• pos ${c.positionId}: ${c.error.slice(0, 120)}` : `• pos ${c.positionId} → order ${c.orderId ?? "-"}`
  );
  lines.push(parts.join("\n"));
  if (input.closed.length > 8) lines.push(`… อีก ${input.closed.length - 8} รายการ`);
  lines.push(`ราคา (จาก alert): ${input.priceNote ?? "-"}`);
  if (input.remark?.trim()) lines.push(`หมายเหตุ: ${input.remark.trim().slice(0, 200)}`);
  await notifyTradingViewWebhookTelegram(input.userId, lines.join("\n"));
}

export async function notifyTvWebhookCloseNoOpen(input: {
  userId: string;
  label: string;
  contractSymbol: string;
  priceNote: string | null;
  remark?: string;
}): Promise<void> {
  const lines = [
    "Koji — MEXC",
    "ℹ️ ไม่มี position ที่เปิด (TradingView)",
    `${input.label} · ${input.contractSymbol}`,
    `ราคา (จาก alert): ${input.priceNote ?? "-"}`,
  ];
  if (input.remark?.trim()) lines.push(`หมายเหตุ: ${input.remark.trim().slice(0, 200)}`);
  await notifyTradingViewWebhookTelegram(input.userId, lines.join("\n"));
}

export async function notifyTvWebhookOpenOk(input: {
  userId: string;
  label: string;
  contractSymbol: string;
  long: boolean;
  marginUsdt: number;
  leverage: number;
  orderId?: string;
  priceNote: string | null;
  remark?: string;
}): Promise<void> {
  const side = input.long ? "LONG" : "SHORT";
  const lines = [
    "Koji — MEXC",
    `✅ เปิด ${side} สำเร็จ (TradingView)`,
    `${input.label} · ${input.contractSymbol}`,
    `Margin ~${finiteStr(input.marginUsdt, "?")} USDT · ${finiteStr(input.leverage, "?")}x`,
    `Order: ${input.orderId ?? "-"}`,
    `ราคา (จาก alert): ${input.priceNote ?? "-"}`,
  ];
  if (input.remark?.trim()) lines.push(`หมายเหตุ: ${input.remark.trim().slice(0, 200)}`);
  await notifyTradingViewWebhookTelegram(input.userId, lines.join("\n"));
}
