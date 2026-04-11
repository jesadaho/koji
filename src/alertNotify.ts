import type { Client } from "@line/bot-sdk";
import { discordWebhookConfigured, sendDiscordWebhookContent } from "./discordWebhook";
import { linePushMessages } from "./linePush";
import { sendTelegramAlertMessage, telegramAlertConfigured } from "./telegramAlert";

/** ส่ง LINE push ซ้ำเมื่อช่องหลักเป็น Telegram/Discord — ใช้โควตา LINE */
export function isAlertAlsoLinePush(): boolean {
  const on = (key: string) => {
    const v = process.env[key]?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  };
  return (
    on("ALERT_ALSO_LINE_PUSH") ||
    on("TELEGRAM_ALERT_ALSO_LINE_PUSH") ||
    on("DISCORD_ALERT_ALSO_LINE_PUSH")
  );
}

/** @deprecated ใช้ isAlertAlsoLinePush แทน */
export function isDiscordAlertAlsoLinePush(): boolean {
  return isAlertAlsoLinePush();
}

/**
 * แจ้งเตือนอัตโนมัติ: Telegram (ถ้าตั้ง TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID) → มิฉะนั้น Discord webhook → มิฉะนั้น LINE push
 * ALERT_ALSO_LINE_PUSH=1 หรือ TELEGRAM_ALERT_ALSO_LINE_PUSH / DISCORD_ALERT_ALSO_LINE_PUSH — ส่งซ้ำไป LINE ให้ผู้ใช้คนนั้น
 */
export async function sendAlertNotification(client: Client, lineUserId: string, text: string): Promise<void> {
  if (telegramAlertConfigured()) {
    await sendTelegramAlertMessage(text);
    if (isAlertAlsoLinePush()) {
      const uid = lineUserId?.trim();
      if (!uid) {
        throw new Error("ALERT_ALSO_LINE_PUSH / TELEGRAM_ALERT_ALSO_LINE_PUSH แต่ไม่มี LINE user id สำหรับผู้รับ");
      }
      await linePushMessages(client, uid, [{ type: "text", text }]);
    }
    return;
  }
  if (discordWebhookConfigured()) {
    await sendDiscordWebhookContent(text);
    if (isAlertAlsoLinePush()) {
      const uid = lineUserId?.trim();
      if (!uid) {
        throw new Error("ALERT_ALSO_LINE_PUSH แต่ไม่มี LINE user id สำหรับผู้รับ");
      }
      await linePushMessages(client, uid, [{ type: "text", text }]);
    }
    return;
  }
  await linePushMessages(client, lineUserId, [{ type: "text", text }]);
}
