import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClient } from "@/src/lineHandler";
import { linePushMessages } from "@/src/linePush";
import { discordWebhookConfigured, sendDiscordWebhookContent } from "@/src/discordWebhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ทดสอบช่องทางแจ้งเตือน (Discord webhook ถ้ามี env มิฉะนั้น LINE push)
 *
 * GET /api/cron/test-push — Authorization: Bearer $CRON_SECRET
 *
 * Env:
 * - DISCORD_ALERT_WEBHOOK_URL — ถ้ามีจะส่งข้อความทดสอบไป Discord (ไม่ต้องมี LINE_CRON_TEST_USER_ID)
 * - LINE_CRON_TEST_USER_ID — ใช้เมื่อไม่มี Discord URL (ทดสอบ LINE push)
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
  const text = [
    "🧪 Koji — ทดสอบแจ้งเตือนจาก cron",
    `เวลา (UTC): ${iso}`,
    "",
    discordWebhookConfigured()
      ? "ช่อง: Discord webhook (DISCORD_ALERT_WEBHOOK_URL)"
      : "ช่อง: LINE push (LINE_CRON_TEST_USER_ID)",
  ].join("\n");

  try {
    if (discordWebhookConfigured()) {
      await sendDiscordWebhookContent(text);
      return NextResponse.json({
        ok: true,
        sent: true,
        channel: "discord",
        at: iso,
      });
    }

    const userId = process.env.LINE_CRON_TEST_USER_ID?.trim();
    if (!userId) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message:
          "ตั้ง DISCORD_ALERT_WEBHOOK_URL หรือ LINE_CRON_TEST_USER_ID — ข้ามการทดสอบ",
      });
    }

    const client = createLineClient(config.lineChannelAccessToken);
    await linePushMessages(client, userId, [{ type: "text", text }]);
    return NextResponse.json({
      ok: true,
      sent: true,
      channel: "line",
      at: iso,
      toPrefix: `${userId.slice(0, 8)}…`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron test-push]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
