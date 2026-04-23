import { escapeTelegramHtml, sendTelegramMessageToChat, wrapTelegramPreMonospace } from "./telegramAlert";
import {
  clearTvOpenWizard,
  getTvOpenWizard,
  startTvOpenWizard,
  updateTvOpenWizard,
} from "./tradingViewOpenWizardStore";
import { ensureTradingViewMexcUserRow, getTradingViewMexcRowOptional } from "./tradingViewCloseSettingsStore";
import {
  formatTradingViewMexcOpenWebhookJson,
  getTradingViewMexcWebhookCloseUrl,
} from "./liffService";
import {
  isGenericOpenWizardRequest,
  isWebhookJsonOpenSlash,
  isWizardCancel,
  parseLeverageAnswer,
  parseMarginAnswer,
  parseSideAnswer,
} from "./tradingViewOpenWizard";
import { tgUserIdToStoreKey } from "./telegramMiniAppAuth";

type ThreadOpts = { messageThreadId?: number };

/**
 * Wizard เปิด position + JSON — เฉพาะแชท private
 * @returns true ถ้าจัดการแล้ว (ไม่ต้องส่งต่อ handler อื่น)
 */
export async function handleTvOpenWizardTelegramMessage(input: {
  text: string;
  trimmedText: string;
  normalized: string;
  chatType: string | undefined;
  fromUserId: number;
  chatId: number;
  threadOpts?: ThreadOpts;
}): Promise<boolean> {
  const { text, trimmedText, normalized, chatType, fromUserId, chatId, threadOpts } = input;
  if (chatType !== "private") {
    return false;
  }

  const userId = tgUserIdToStoreKey(fromUserId);

  if (isWizardCancel(text)) {
    await clearTvOpenWizard(userId);
    await sendTelegramMessageToChat(
      String(chatId),
      "ยกเลิกการตั้งค่า Webhook (เปิด position) แล้วครับ",
      threadOpts,
    );
    return true;
  }

  const existing = await getTvOpenWizard(userId);
  const wantStart = isGenericOpenWizardRequest(trimmedText) || isWebhookJsonOpenSlash(normalized);

  if (!existing && !wantStart) {
    return false;
  }

  if (wantStart) {
    await startTvOpenWizard(userId);
    await sendTelegramMessageToChat(
      String(chatId),
      "🤖 จะเปิด Long หรือ Short ครับ?\n\n(ตอบเช่น Long / Short — หรือพิมพ์ ยกเลิก เพื่อยกเลิก)",
      threadOpts,
    );
    return true;
  }

  if (!existing) {
    return false;
  }

  if (existing.step === "side") {
    const side = parseSideAnswer(text);
    if (!side) {
      await sendTelegramMessageToChat(
        String(chatId),
        "🤖 ไม่เข้าใจครับ — ตอบ Long หรือ Short ได้เลย\n(ถ้าจะใช้คำสั่งอื่นในแชทนี้ พิมพ์ ยกเลิก ก่อน)",
        threadOpts,
      );
      return true;
    }
    await updateTvOpenWizard(userId, { step: "margin", side });
    await sendTelegramMessageToChat(
      String(chatId),
      "🤖 ใช้ margin กี่ USDT ครับ? (เงินที่วางเปิด position — มูลค่าโดยประมาณจะเป็น margin × leverage)\n\n(พิมพ์ตัวเลข เช่น 50)",
      threadOpts,
    );
    return true;
  }

  if (existing.step === "margin") {
    const margin = parseMarginAnswer(text);
    if (margin == null) {
      await sendTelegramMessageToChat(
        String(chatId),
        "🤖 ตัวเลขไม่ถูกต้องครับ — ใส่จำนวน USDT ที่เป็นบวก (เช่น 100)",
        threadOpts,
      );
      return true;
    }
    await updateTvOpenWizard(userId, { step: "leverage", marginUsdt: margin });
    await sendTelegramMessageToChat(
      String(chatId),
      "🤖 Leverage เท่าไหร่ครับ? (เช่น 5 หรือ 10x)",
      threadOpts,
    );
    return true;
  }

  if (existing.step === "leverage") {
    const lev = parseLeverageAnswer(text);
    if (lev == null) {
      await sendTelegramMessageToChat(
        String(chatId),
        "🤖 Leverage ใช้ตัวเลข 1–500 ครับ (เช่น 10)",
        threadOpts,
      );
      return true;
    }
    const side = existing.side;
    const margin = existing.marginUsdt;
    if (!side || margin == null) {
      await clearTvOpenWizard(userId);
      await sendTelegramMessageToChat(String(chatId), "สถานะ wizard เพี้ยน — เริ่มใหม่ด้วย ขอรับ Webhook JSON", threadOpts);
      return true;
    }

    const credRow = await getTradingViewMexcRowOptional(userId);
    if (!credRow?.mexcApiKey?.trim() || !credRow.mexcSecret?.trim()) {
      await clearTvOpenWizard(userId);
      await sendTelegramMessageToChat(
        String(chatId),
        "ยังสร้าง Webhook JSON ไม่ได้ — กรอก MEXC API Key และ Secret ที่หน้า Settings ใน Mini App แล้วกดบันทึกก่อน แล้วเริ่มใหม่ด้วย ขอรับ Webhook JSON",
        threadOpts,
      );
      return true;
    }

    const row = await ensureTradingViewMexcUserRow(userId);
    const json = formatTradingViewMexcOpenWebhookJson(userId, row.webhookToken, side, margin, lev);
    const pre = wrapTelegramPreMonospace(json);
    const webhookUrl = getTradingViewMexcWebhookCloseUrl();
    const urlLine = `<b>Webhook URL</b> (TradingView → URL)\n<code>${escapeTelegramHtml(webhookUrl)}</code>`;
    const nonceHint =
      "\n\n<i>nonce ใน JSON ใช้ครั้งเดียว — ถ้า TV ส่งซ้ำด้วย body เดิมจะถูกปฏิเสธ แนะนำตั้งเป็น \"nonce\": \"{{timenow}}\" ใน TradingView</i>";
    const msg = pre
      ? `Koji — MEXC เปิด position\n${urlLine}\n\n<b>Webhook JSON</b> (TradingView → Message / body)\n\n${pre}${nonceHint}`
      : `Koji — MEXC เปิด position\n${urlLine}\n\n${escapeTelegramHtml(json.slice(0, 3500))}${nonceHint}`;

    await sendTelegramMessageToChat(String(chatId), msg, { ...threadOpts, parseMode: "HTML" });
    await clearTvOpenWizard(userId);
    return true;
  }

  return false;
}
