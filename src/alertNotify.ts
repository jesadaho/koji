import type { Client } from "@line/bot-sdk";
import { discordWebhookConfigured, sendDiscordWebhookContent } from "./discordWebhook";
import { linePushMessages } from "./linePush";
import {
  sendTelegramAlertMessage,
  sendTelegramMessageToChat,
  telegramAlertConfigured,
  telegramSparkSystemGroupConfigured,
} from "./telegramAlert";

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

/**
 * Spark follow-up + System Change: Telegram ไปกลุ่ม TELEGRAM_SPARK_SYSTEM_CHAT_ID ครั้งเดียว (ไม่ยิงซ้ำตามจำนวน subscriber)
 * ถ้าไม่ตั้งกลุ่ม → fallback เป็น sendAlertNotification ต่อ uid เหมือนเดิม
 * @returns จำนวนช่องที่ส่งสำเร็จ (TG 1 + LINE mirror ต่อคน หรือจำนวน uid ใน fallback)
 */
/**
 * Public indicator feed → Telegram กลุ่ม Spark/System อย่างเดียว (ไม่ต้องมี LINE subscriber)
 * @returns true เมื่อส่งสำเร็จ
 */
export async function sendPublicIndicatorFeedToSparkGroup(text: string): Promise<boolean> {
  if (!telegramSparkSystemGroupConfigured()) {
    console.warn(
      "[sendPublicIndicatorFeedToSparkGroup] ไม่มี TELEGRAM_BOT_TOKEN + TELEGRAM_SPARK_SYSTEM_CHAT_ID — ไม่ส่ง public indicator feed"
    );
    return false;
  }
  const gid = process.env.TELEGRAM_SPARK_SYSTEM_CHAT_ID!.trim();
  await sendTelegramMessageToChat(gid, text);
  return true;
}

export async function sendSparkSystemAlert(client: Client, lineUserIds: string[], text: string): Promise<number> {
  const uids = lineUserIds.map((u) => u?.trim()).filter(Boolean);
  if (uids.length === 0) return 0;

  if (telegramSparkSystemGroupConfigured()) {
    const gid = process.env.TELEGRAM_SPARK_SYSTEM_CHAT_ID!.trim();
    await sendTelegramMessageToChat(gid, text);
    let n = 1;
    if (isAlertAlsoLinePush() && isLineAlertPushEnabled()) {
      for (const u of uids) {
        try {
          await linePushMessages(client, u, [{ type: "text", text }]);
          n += 1;
        } catch (e) {
          console.error("[sendSparkSystemAlert] line mirror", u, e);
        }
      }
    }
    return n;
  }
  let n = 0;
  for (const uid of uids) {
    try {
      await sendAlertNotification(client, uid, text);
      n += 1;
    } catch (e) {
      console.error("[sendSparkSystemAlert] fallback", uid, e);
    }
  }
  return n;
}
