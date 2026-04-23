import { NextRequest, NextResponse } from "next/server";
import { escapeTelegramHtml, sendTelegramMessageToChat, wrapTelegramPreMonospace } from "@/src/telegramAlert";
import { formatTradingViewMexcWebhookJson, getTradingViewMexcWebhookCloseUrl } from "@/src/liffService";
import { ensureTradingViewMexcUserRow, getTradingViewMexcRowOptional } from "@/src/tradingViewCloseSettingsStore";
import { mexcFuturesBaseUrl, verifyMexcFuturesApiForUser } from "@/src/mexcFuturesClient";
import { tgUserIdToStoreKey } from "@/src/telegramMiniAppAuth";
import { parseMarketCheck, parsePositionChecklist } from "@/src/positionChecklistLineCommands";
import { buildMarketCheckMessage, buildPositionChecklistMessage } from "@/src/positionChecklistService";
import { isSparkStatsQuery } from "@/src/sparkFollowUpLineCommands";
import { formatSparkStatsMessage } from "@/src/sparkFollowUpStats";
import { handleTvOpenWizardTelegramMessage } from "@/src/tradingViewOpenWizardTelegram";

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
 * /start → ปุ่ม Mini App · ขอ Webhook JSON MEXC / ขอรับ webhook json close / ขอรับ Webhook JSON open / เช็ค MEXC API · เช็คลิสต์ position (short/long …) · สถิติ Spark (คำสั่งเดียวกับ LINE)
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
    message?: {
      chat?: { id?: number; type?: string };
      text?: string;
      message_thread_id?: number;
      from?: { id?: number };
    };
  };
  try {
    update = (await req.json()) as typeof update;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const text = update.message?.text?.trim() ?? "";
  const chatType = update.message?.chat?.type;
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
  const fromUserId = update.message?.from?.id;

  const trimmedText = text.trim();

  if (typeof fromUserId === "number" && fromUserId > 0 && chatId != null) {
    const wizardHandled = await handleTvOpenWizardTelegramMessage({
      text,
      trimmedText,
      normalized,
      chatType,
      fromUserId,
      chatId,
      threadOpts,
    });
    if (wizardHandled) {
      return NextResponse.json({ ok: true });
    }
  }

  const tvClosePhraseNorm = trimmedText.replace(/\s+/g, " ").trim().toLowerCase();
  const wantsWebhookJsonClose =
    trimmedText === "ขอรับ Webhook JSON MEXC" ||
    tvClosePhraseNorm === "ขอรับ webhook json close" ||
    (normalized === "webhook_json" && !normalized.startsWith("webhook_json_open"));

  if (wantsWebhookJsonClose && typeof fromUserId === "number" && fromUserId > 0) {
    try {
      const userId = tgUserIdToStoreKey(fromUserId);
      const row = await ensureTradingViewMexcUserRow(userId);
      if (!row.mexcApiKey?.trim() || !row.mexcSecret?.trim()) {
        await sendTelegramMessageToChat(
          String(chatId),
          "ยังขอ Webhook JSON ไม่ได้ — กรอก MEXC API Key และ Secret ที่หน้า Settings ใน Mini App แล้วกดบันทึกก่อน",
          threadOpts,
        );
        return NextResponse.json({ ok: true });
      }
      const json = formatTradingViewMexcWebhookJson(userId, row.webhookToken);
      const pre = wrapTelegramPreMonospace(json);
      const webhookUrl = getTradingViewMexcWebhookCloseUrl();
      const urlLine = `<b>Webhook URL</b> (TradingView → URL)\n<code>${escapeTelegramHtml(webhookUrl)}</code>`;
      const nonceHint =
        "\n\n<i>nonce ใน JSON ใช้ครั้งเดียว — ถ้า TV ส่งซ้ำด้วย body เดิมจะถูกปฏิเสธ แนะนำตั้งเป็น \"nonce\": \"{{timenow}}\" ใน TradingView</i>";
      const msg = pre
        ? `Koji — MEXC\n${urlLine}\n\n<b>Webhook JSON</b> (TradingView → Message / body)\n\n${pre}${nonceHint}`
        : `Koji — MEXC\n${urlLine}\n\n<b>Webhook JSON</b>\n\n(ข้อความยาว) — ใช้หน้า Settings ใน Mini App แทน\n\n${escapeTelegramHtml(json.slice(0, 2000))}${nonceHint}`;
      await sendTelegramMessageToChat(String(chatId), msg, { parseMode: "HTML" });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `Webhooks JSON: อ่านการตั้งค่าไม่สำเร็จ — ${detail.slice(0, 500)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] webhook json reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const wantsMexcApiCheck =
    trimmedText === "เช็ค MEXC API" || /^\/?mexc_api(@\S+)?\s*$/i.test(normalized);

  if (wantsMexcApiCheck && typeof fromUserId === "number" && fromUserId > 0) {
    try {
      const userId = tgUserIdToStoreKey(fromUserId);
      const row = await getTradingViewMexcRowOptional(userId);
      if (!row?.mexcApiKey?.trim() || !row.mexcSecret?.trim()) {
        await sendTelegramMessageToChat(
          String(chatId),
          "ยังเช็ค MEXC API ไม่ได้ — กรอก MEXC API Key และ Secret ที่หน้า Settings ใน Mini App แล้วกดบันทึกก่อน",
          threadOpts,
        );
        return NextResponse.json({ ok: true });
      }
      const r = await verifyMexcFuturesApiForUser({ apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() });
      if (!r.ok) {
        const stepTh =
          r.step === "account_assets"
            ? "อ่านทรัพย์สินฟิวเจอร์"
            : r.step === "position_mode"
              ? "อ่านโหมด position"
              : r.step === "open_positions"
                ? "อ่าน position ที่เปิด"
                : "เครือข่าย/เซิร์ฟเวอร์";
        const codePart = r.code != null ? `\nรหัส MEXC: ${r.code}` : "";
        await sendTelegramMessageToChat(
          String(chatId),
          `MEXC API — เช็คแล้ว ❌\nขั้น ${stepTh} ไม่ผ่าน${codePart}\n${r.message.slice(0, 800)}\n\nลอง: สิทธิ์ API (View + Order ถ้าต้องสั่งปิด) / IP whitelist / เวลาเครื่อง / host ${mexcFuturesBaseUrl()}`,
          threadOpts,
        );
        return NextResponse.json({ ok: true });
      }
      const symLine =
        r.openSymbolsSample.length > 0
          ? `\nสัญญาที่เปิดอยู่ (ตัวอย่าง): ${r.openSymbolsSample.join(", ")}`
          : "";
      await sendTelegramMessageToChat(
        String(chatId),
        `MEXC API — เช็คแล้ว ✅\n• USDT ใช้ได้ (ฟิวเจอร์): ${r.usdtAvailable}\n• โหมด position: ${r.positionModeLabel}\n• จำนวน position เปิด: ${r.openPositionsCount}${symLine}`,
        threadOpts,
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `เช็ค MEXC API ไม่สำเร็จ — ${detail.slice(0, 500)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] mexc api check reply", sendErr);
      }
    }
    return NextResponse.json({ ok: true });
  }

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

  const marketCheck = parseMarketCheck(normalized);
  if (marketCheck) {
    try {
      const body = await buildMarketCheckMessage(marketCheck);
      await sendTelegramMessageToChat(String(chatId), body, threadOpts);
    } catch (e) {
      console.error("[telegram/webhook] market check", e);
      const detail = e instanceof Error ? e.message : String(e);
      try {
        await sendTelegramMessageToChat(
          String(chatId),
          `Market check ไม่สำเร็จ — ${detail.slice(0, 300)}`,
          threadOpts,
        );
      } catch (sendErr) {
        console.error("[telegram/webhook] market check error reply", sendErr);
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

type TelegramWebhookInfoResult = {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
};

/** เปิดในเบราว์เซอร์ — สุขภาพ route + ข้อมูลจาก Telegram getWebhookInfo (ช่วยเช็คว่าทำไมบอทไม่ตอบในแชท) */
export async function GET() {
  const base =
    process.env.TELEGRAM_MINI_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  let telegramWebhook: TelegramWebhookInfoResult | null = null;

  if (token) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/getWebhookInfo`,
      );
      const j = (await r.json()) as {
        ok?: boolean;
        result?: TelegramWebhookInfoResult;
      };
      const raw = j?.result;
      if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
        const le = raw.last_error_message;
        telegramWebhook = {
          ...raw,
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
