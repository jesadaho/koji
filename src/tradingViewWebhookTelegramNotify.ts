import { sendTelegramMessageToChat, telegramBotTokenConfigured } from "./telegramAlert";
import { tgStoreKeyToTelegramDmChatId } from "./telegramMiniAppAuth";

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
