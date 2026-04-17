import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
 * Telegram Bot webhook — ตอบ /start ด้วยปุ่มเปิด Web App
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

  let update: { message?: { chat?: { id?: number }; text?: string } };
  try {
    update = (await req.json()) as typeof update;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const text = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat?.id;
  if (chatId != null && (text === "/start" || text.startsWith("/start "))) {
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
  }

  return NextResponse.json({ ok: true });
}
