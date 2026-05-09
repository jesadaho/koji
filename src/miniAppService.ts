/**
 * เลเยอร์กลางสำหรับ Telegram Mini App (auth initData เทียบ BOT_TOKEN).
 * Logic ธุรกิจอยู่ที่ `src/liffService.ts` (ชื่อไฟล์เดิม; ฟังก์ชันมี prefix `liff*`) และรับ `userId` เป็น string เช่น `tg:123`
 */
export { authenticateTmaRequest, type TmaAuthResult, tgUserIdToStoreKey } from "./telegramMiniAppAuth";
/** รายการย่อย่อสำหรับพิมพ์สัญลักษณ์ (ใช้ร่วม /api/tma/meta กับ legacy /api/liff/meta) */
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
