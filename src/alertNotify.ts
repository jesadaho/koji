import type { Client } from "@line/bot-sdk";
import { discordWebhookConfigured, sendDiscordWebhookContent } from "./discordWebhook";
import { linePushMessages } from "./linePush";

/**
 * แจ้งเตือนอัตโนมัติ: ถ้ามี DISCORD_ALERT_WEBHOOK_URL ส่ง Discord เท่านั้น มิฉะนั้น LINE push
 */
export async function sendAlertNotification(client: Client, lineUserId: string, text: string): Promise<void> {
  if (discordWebhookConfigured()) {
    await sendDiscordWebhookContent(text);
    return;
  }
  await linePushMessages(client, lineUserId, [{ type: "text", text }]);
}
