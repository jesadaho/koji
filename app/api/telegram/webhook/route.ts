import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessageToChat } from "@/src/telegramAlert";
import { parsePositionChecklist } from "@/src/positionChecklistLineCommands";
import { buildPositionChecklistMessage } from "@/src/positionChecklistService";
import { isSparkStatsQuery } from "@/src/sparkFollowUpLineCommands";
import { formatSparkStatsMessage } from "@/src/sparkFollowUpStats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** เช็คลิสต์ดึงหลาย API — บน Vercel Pro ใช้ได้ถึง 60s; แพลนฟรีอาจ timeout ที่ 10s */
export const maxDuration = 60;

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
 * (ไม่บังคับ secret — ถ้าต้องการกันคนอื่นยิง POST ปลอม ค่อยใส่ secret_token + ตรวจ header ทีหลัง)
 */
export async function POST(req: NextRequest) {
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
    return NextResponse.json({ ok: true });
  }

  console.info("[telegram/webhook] no handler matched", {
    preview: text.slice(0, 80),
    chatId,
  });

  return NextResponse.json({ ok: true });
}

/** เปิดในเบราว์เซอร์ — สุขภาพ route + ข้อมูลจาก Telegram getWebhookInfo (ช่วยเช็คว่าทำไมบอทไม่ตอบในแชท) */
export async function GET() {
  const base =
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  let telegramWebhook: {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
  } | null = null;

  if (token) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/getWebhookInfo`,
      );
      const j = (await r.json()) as {
        ok?: boolean;
        result?: typeof telegramWebhook;
      };
      if (j?.result && typeof j.result === "object") {
        const le = j.result.last_error_message;
        telegramWebhook = {
          ...j.result,
          last_error_message:
            typeof le === "string" && le.length > 400 ? `${le.slice(0, 400)}…` : le,
        };
      }
    } catch (e) {
      console.error("[telegram/webhook] getWebhookInfo", e);
    }
  }

  return NextResponse.json({
    ok: true,
    service: "telegram_webhook",
    hint: "แจ้งเตือนเข้ากลุ่มใช้แค่ sendMessage — บอทตอบในแชทส่วนตัวต้อง setWebhook ชี้มาที่ webhookUrlExpected (POST)",
    miniAppBaseConfigured: Boolean(base),
    webhookUrlExpected: base ? `${base.replace(/\/$/, "")}/api/telegram/webhook` : null,
    telegramWebhook,
    setWebhookDocs: "https://core.telegram.org/bots/api#setwebhook",
  });
}
