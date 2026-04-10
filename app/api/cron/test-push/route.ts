import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config } from "@/src/config";
import { requireCronAuth } from "@/src/cronAuth";
import { createLineClient } from "@/src/lineHandler";
import { linePushMessages } from "@/src/linePush";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ทดสอบ LINE pushMessage ผ่านชุดเดียวกับแจ้งเตือนจริง (มี linePush + throttle/retry)
 *
 * GET /api/cron/test-push — Authorization: Bearer $CRON_SECRET
 *
 * Env:
 * - LINE_CRON_TEST_USER_ID — userId ของคุณ (จาก webhook / LIFF) ที่จะรับข้อความทดสอบ
 * - LINE_CRON_TEST_DISABLED=1 — ข้าม (ไม่ยิง) แต่คืน 200 เพื่อไม่ให้ cron แดง
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

  const userId = process.env.LINE_CRON_TEST_USER_ID?.trim();
  if (!userId) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message:
        "ยังไม่ได้ตั้ง LINE_CRON_TEST_USER_ID — ข้ามการทดสอบ push (ใส่ userId แล้ว deploy ใหม่เพื่อให้ cron ยิงได้)",
    });
  }

  const iso = new Date().toISOString();
  const text = [
    "🧪 Koji — ทดสอบ push จาก cron",
    `เวลา (UTC): ${iso}`,
    "",
    "ถ้าเห็นข้อความนี้ แปลว่า CRON_SECRET + LINE channel token + push ใช้งานได้",
  ].join("\n");

  try {
    const client = createLineClient(config.lineChannelAccessToken);
    await linePushMessages(client, userId, [{ type: "text", text }]);
    return NextResponse.json({
      ok: true,
      sent: true,
      at: iso,
      toPrefix: `${userId.slice(0, 8)}…`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron test-push]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
