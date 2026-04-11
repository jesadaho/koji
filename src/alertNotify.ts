import type { Client } from "@line/bot-sdk";
import { discordWebhookConfigured, sendDiscordWebhookContent } from "./discordWebhook";
import { linePushMessages } from "./linePush";
import { sendTelegramAlertMessage, telegramAlertConfigured } from "./telegramAlert";

/**
 * LINE push สำหรับแจ้งเตือนอัตโนมัติ (ทั้งช่องหลักและ mirror) — ค่าเริ่มปิด
 * ตั้ง LINE_ALERT_PUSH_ENABLED=1 (หรือ true/yes) เพื่อเปิด
 */
export function isLineAlertPushEnabled(): boolean {
  const v = process.env.LINE_ALERT_PUSH_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** ส่ง LINE push ซ้ำเมื่อช่องหลักเป็น Telegram/Discord — ใช้โควตา LINE (ต้องเปิด LINE_ALERT_PUSH_ENABLED ด้วย) */
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
 * แจ้งเตือนอัตโนมัติ: Telegram → Discord webhook → LINE push (เฉพาะเมื่อ LINE_ALERT_PUSH_ENABLED=1)
 * Mirror ไป LINE: ALERT_ALSO_LINE_PUSH + LINE_ALERT_PUSH_ENABLED + LINE user id
 */
export async function sendAlertNotification(client: Client, lineUserId: string, text: string): Promise<void> {
  if (telegramAlertConfigured()) {
    await sendTelegramAlertMessage(text);
    if (isAlertAlsoLinePush() && isLineAlertPushEnabled()) {
      const uid = lineUserId?.trim();
      if (!uid) {
        throw new Error("ALERT_ALSO_LINE_PUSH แต่ไม่มี LINE user id สำหรับผู้รับ");
      }
      await linePushMessages(client, uid, [{ type: "text", text }]);
    }
    return;
  }
  if (discordWebhookConfigured()) {
    await sendDiscordWebhookContent(text);
    if (isAlertAlsoLinePush() && isLineAlertPushEnabled()) {
      const uid = lineUserId?.trim();
      if (!uid) {
        throw new Error("ALERT_ALSO_LINE_PUSH แต่ไม่มี LINE user id สำหรับผู้รับ");
      }
      await linePushMessages(client, uid, [{ type: "text", text }]);
    }
    return;
  }
  if (!isLineAlertPushEnabled()) {
    throw new Error(
      "แจ้งเตือนอัตโนมัติ: ตั้ง Telegram/Discord หรือเปิด LINE ด้วย LINE_ALERT_PUSH_ENABLED=1",
    );
  }
  await linePushMessages(client, lineUserId, [{ type: "text", text }]);
}
