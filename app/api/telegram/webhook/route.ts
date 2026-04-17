import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessageToChat } from "@/src/telegramAlert";
import { parsePositionChecklist } from "@/src/positionChecklistLineCommands";
import { buildPositionChecklistMessage } from "@/src/positionChecklistService";
import { isSparkStatsQuery } from "@/src/sparkFollowUpLineCommands";
import { formatSparkStatsMessage } from "@/src/sparkFollowUpStats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** `/short@bot btc` → `short btc` — ให้ตรงกับพาร์สเซอร์แบบ LINE */
function normalizeTelegramSlashCommand(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("/")) return t;
  let rest = t.slice(1);
  const m = rest.match(/^([a-zA-Z_]+)@\S+\s*([\s\S]*)$/);
  if (m) {
    rest = `${m[1]!} ${m[2] ?? ""}`.trim();
  }
  return rest;
}

/** URL ที่เปิด Mini App (BotFather Menu Button / ปุ่ม web_app) */
function miniAppOpenUrl(): string {
  const raw =
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = raw.replace(/\/$/, "");
  return base ? `${base}/` : "";
}

/**
 * Telegram Bot webhook — รับข้อความจากผู้ใช้ (โดยทั่วไปแชทส่วนตัวกับบอท)
 * /start → ปุ่ม Mini App · อื่นๆ: เช็คลิสต์ position (short/long …) · สถิติ Spark (คำสั่งเดียวกับ LINE)
 * กลุ่มสาธารณะ (TELEGRAM_PUBLIC_*) ใช้แค่ส่งแจ้งเตือนจาก cron — ไม่ต้องคุยคำสั่งในกลุ่มก็ได้
 * ถ้าไปพิมพ์คำสั่งใน supergroup แทน DM และเปิด Group Privacy ต้องใช้ `/short btc` ฯลฯ
 * ตั้ง webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<https://host>/api/telegram/webhook`
 * แนะนำตั้ง `TELEGRAM_WEBHOOK_SECRET` แล้วส่ง `secret_token` ใน setWebhook
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== secret) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN" }, { status: 503 });
  }

  let update: {
    message?: { chat?: { id?: number }; text?: string; message_thread_id?: number };
  };
  try {
    update = (await req.json()) as typeof update;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const text = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat?.id;
  const replyThreadId = update.message?.message_thread_id;
  const threadOpts =
    replyThreadId != null && replyThreadId > 0 ? { messageThreadId: replyThreadId } : undefined;
  if (chatId == null) {
    return NextResponse.json({ ok: true });
  }

  if (text === "/start" || text.startsWith("/start ")) {
    const url = miniAppOpenUrl();
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: url
        ? "Koji — แตะปุ่มด้านล่างเพื่อเปิด Mini App"
        : "ตั้ง TELEGRAM_MINI_APP_URL หรือ NEXT_PUBLIC_APP_URL แล้วตั้ง Web App URL ใน BotFather",
    };
    if (url) {
      payload.reply_markup = {
        inline_keyboard: [[{ text: "เปิด Koji", web_app: { url } }]],
      };
    }

    try {
      const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("[telegram/webhook] sendMessage", r.status, t.slice(0, 300));
      }
    } catch (e) {
      console.error("[telegram/webhook] sendMessage", e);
    }
    return NextResponse.json({ ok: true });
  }

  if (!text) {
    return NextResponse.json({ ok: true });
  }

  const normalized = normalizeTelegramSlashCommand(text);

  if (isSparkStatsQuery(text) || isSparkStatsQuery(normalized)) {
    try {
      const body = await formatSparkStatsMessage();
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] spark stats", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `อ่านสถิติ Spark ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] spark stats error reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const checklist = parsePositionChecklist(normalized);
  if (checklist) {
    try {
      const body = await buildPositionChecklistMessage(checklist);
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] position checklist", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `สร้าง checklist ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] checklist error reply", sendErr);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

/** เปิดในเบราว์เซอร์เพื่อเช็คว่า route โหลดได้ — การรับ /start ต้องตั้ง webhook (POST) */
export async function GET() {
  const base =
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return NextResponse.json({
    ok: true,
    service: "telegram_webhook",
    hint: "POST เท่านั้น — ตั้ง setWebhook ก่อน · คำสั่ง (short btc, สถิติ spark, /start) ใช้ในแชทส่วนตัวกับบอท — กลุ่มรับแจ้งเตือนอย่างเดียว (ส่งจาก cron ไม่ผ่าน webhook นี้)",
    miniAppBaseConfigured: Boolean(base),
    webhookSecretEnvSet: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
    setWebhookDocs: "https://core.telegram.org/bots/api#setwebhook",
  });
}
