import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClient } from "@/src/lineHandler";
import { sendAlertNotification, isAlertAlsoLinePush, isLineAlertPushEnabled } from "@/src/alertNotify";
import { discordWebhookConfigured } from "@/src/discordWebhook";
import { telegramAlertConfigured } from "@/src/telegramAlert";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ทดสอบช่องทางแจ้งเตือน (Telegram → Discord → LINE ตามลำดับความสำคัญของ env)
 *
 * GET /api/cron/test-push — Authorization: Bearer $CRON_SECRET
 *
 * Env:
 * - TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID — ช่องหลัก (แนะนำ)
 * - DISCORD_ALERT_WEBHOOK_URL — ถ้าไม่มี Telegram
 * - LINE_CRON_TEST_USER_ID — ใช้เมื่อไม่มี Telegram/Discord (ต้อง LINE_ALERT_PUSH_ENABLED=1)
 * - LINE_ALERT_PUSH_ENABLED — เปิด LINE สำหรับแจ้งเตือน (ค่าเริ่มปิด)
 * - ALERT_ALSO_LINE_PUSH (+ LINE_ALERT_PUSH_ENABLED) — mirror ไป LINE เมื่อทดสอบ
 * - LINE_CRON_TEST_DISABLED=1 — ข้าม
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  if (process.env.LINE_CRON_TEST_DISABLED?.trim() === "1") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: "LINE_CRON_TEST_DISABLED=1 — ไม่ส่งข้อความ",
    });
  }

  const iso = new Date().toISOString();
  const channelHint = telegramAlertConfigured()
    ? "ช่อง: Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID)"
    : discordWebhookConfigured()
      ? "ช่อง: Discord webhook (DISCORD_ALERT_WEBHOOK_URL)"
      : "ช่อง: LINE push (LINE_CRON_TEST_USER_ID)";

  const text = ["🧪 Koji — ทดสอบแจ้งเตือนจาก cron", `เวลา (UTC): ${iso}`, "", channelHint].join("\n");

  const testLineUid = process.env.LINE_CRON_TEST_USER_ID?.trim() ?? "";

  try {
    const hasPrimary = telegramAlertConfigured() || discordWebhookConfigured();

    if (!hasPrimary && !testLineUid) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message:
          "ตั้ง TELEGRAM_BOT_TOKEN+TELEGRAM_ALERT_CHAT_ID หรือ DISCORD_ALERT_WEBHOOK_URL หรือ LINE_CRON_TEST_USER_ID — ข้ามการทดสอบ",
      });
    }

    if (!hasPrimary && testLineUid && !isLineAlertPushEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "ทดสอบ LINE push ต้องตั้ง LINE_ALERT_PUSH_ENABLED=1 (ค่าเริ่มปิด — ใช้ Telegram เป็นหลักได้โดยไม่เปิด)",
        },
        { status: 400 },
      );
    }

    if (hasPrimary && isAlertAlsoLinePush() && isLineAlertPushEnabled() && !testLineUid) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "ALERT_ALSO_LINE_PUSH=1 (หรือ TELEGRAM/DISCORD_ALERT_ALSO_LINE_PUSH) ต้องตั้ง LINE_CRON_TEST_USER_ID สำหรับการทดสอบ cron",
        },
        { status: 400 },
      );
    }

    const client = createLineClient(config.lineChannelAccessToken);
    await sendAlertNotification(client, testLineUid, text);

    const primary = telegramAlertConfigured() ? "telegram" : discordWebhookConfigured() ? "discord" : "line";

    return NextResponse.json({
      ok: true,
      sent: true,
      channel: primary,
      alsoLine: hasPrimary && isAlertAlsoLinePush() && isLineAlertPushEnabled(),
      at: iso,
      ...(testLineUid ? { toPrefix: `${testLineUid.slice(0, 8)}…` } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron test-push]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
