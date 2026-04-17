/**
 * เลเยอร์กลางสำหรับ Telegram Mini App — auth แยกจาก LINE LIFF
 * ฟังก์ชันธุรกิจยังใช้ implementation เดิมใน liffService (รับ userId เป็น string เช่น tg:123)
 */
export { authenticateTmaRequest, type TmaAuthResult, tgUserIdToStoreKey } from "./telegramMiniAppAuth";
export { getLiffMeta as getTmaMeta } from "./liffService";

export function getTmaConfig(): {
  mode: "telegram_mini_app";
  botTokenConfigured: boolean;
} {
  return {
    mode: "telegram_mini_app",
    botTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
  };
}
