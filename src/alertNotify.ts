import type { Client } from "@line/bot-sdk";
import { discordWebhookConfigured, sendDiscordWebhookContent } from "./discordWebhook";
import { linePushMessages } from "./linePush";
import {
  sendTelegramAlertMessage,
  sendTelegramMessageToChat,
  sendTelegramPublicBroadcastMessage,
  telegramAlertConfigured,
  telegramBotTokenConfigured,
  telegramSparkSystemGroupConfigured,
  type PublicBroadcastKind,
} from "./telegramAlert";

export type { PublicBroadcastKind } from "./telegramAlert";

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

/** userId จาก Mini App — ส่ง DM ด้วย chat_id = telegram user id (แชทส่วนตัวกับบอท) */
function telegramDmChatIdFromStoreUserId(userId: string): string | null {
  const m = userId.trim().match(/^tg:(\d{1,20})$/);
  return m ? m[1]! : null;
}

/**
 * แจ้งเตือนอัตโนมัติ: Telegram → Discord webhook → LINE push (เฉพาะเมื่อ LINE_ALERT_PUSH_ENABLED=1)
 * Mirror ไป LINE: ALERT_ALSO_LINE_PUSH + LINE_ALERT_PUSH_ENABLED + LINE user id
 * ผู้ใช้จาก Telegram Mini App (`tg:<id>`): ส่ง DM ผ่าน TELEGRAM_BOT_TOKEN โดยไม่ต้องมี TELEGRAM_ALERT_CHAT_ID
 */
export async function sendAlertNotification(client: Client, lineUserId: string, text: string): Promise<void> {
  const tgChat = telegramDmChatIdFromStoreUserId(lineUserId);
  if (tgChat && telegramBotTokenConfigured()) {
    await sendTelegramMessageToChat(tgChat, text);
    return;
  }

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
 * Public indicator feed → Telegram กลุ่ม Spark/System อย่างเดียว (ไม่ต้องมี LINE subscriber)
 * @returns true เมื่อส่งสำเร็จ
 */
export async function sendPublicIndicatorFeedToSparkGroup(text: string): Promise<boolean> {
  if (!telegramSparkSystemGroupConfigured()) {
    console.warn(
      "[sendPublicIndicatorFeedToSparkGroup] ไม่มี TELEGRAM_BOT_TOKEN + TELEGRAM_PUBLIC_CHAT_ID (หรือ TELEGRAM_SPARK_SYSTEM_CHAT_ID) — ไม่ส่ง public indicator feed"
    );
    return false;
  }
  await sendTelegramPublicBroadcastMessage(text, "technical");
  return true;
}

/**
 * Spark / System Change / สัญญาณสาธารณะที่ใช้กลุ่มเดียวกัน: Telegram → TELEGRAM_PUBLIC_CHAT_ID (+ topic ตาม kind)
 * ไม่บังคับมี LINE user id — ถ้าไม่ตั้งกลุ่ม จะ fallback เป็น sendAlertNotification ต่อ uid (ต้องมี uids)
 * LINE mirror ต่อ uid: เฉพาะเมื่อมี uids + ALERT_ALSO_LINE_PUSH + LINE_ALERT_PUSH_ENABLED
 * @returns จำนวนช่องที่ส่งสำเร็จ (TG 1 + LINE mirror ต่อคน หรือจำนวน uid ใน fallback)
 */
/** placeholder ในรายการผู้รับ — ไม่ส่ง LINE mirror; ใช้ให้รอบรวมข้อความส่งกลุ่ม TG ได้แม้ไม่มี subscriber */
export const SPARK_SYSTEM_BROADCAST_PLACEHOLDER_UID = "__spark_system_broadcast__";

export async function sendSparkSystemAlert(
  client: Client,
  lineUserIds: string[],
  text: string,
  kind: PublicBroadcastKind
): Promise<number> {
  const uids = lineUserIds
    .map((u) => u?.trim())
    .filter(Boolean)
    .filter((u) => u !== SPARK_SYSTEM_BROADCAST_PLACEHOLDER_UID);

  if (telegramSparkSystemGroupConfigured()) {
    await sendTelegramPublicBroadcastMessage(text, kind);
    let n = 1;
    if (uids.length > 0 && isAlertAlsoLinePush() && isLineAlertPushEnabled()) {
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

  if (uids.length === 0) return 0;

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
