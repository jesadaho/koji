import "dotenv/config";

/**
 * อ่าน env แบบ lazy — LINE OA เป็น optional เมื่อใช้ Telegram Mini App เป็นหลัก
 */
export const config = {
  get port() {
    return Number(process.env.PORT) || 3000;
  },
  get lineChannelSecret(): string | undefined {
    return process.env.LINE_CHANNEL_SECRET?.trim() || undefined;
  },
  get lineChannelAccessToken(): string | undefined {
    return process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || undefined;
  },
  get priceCheckCron() {
    return process.env.PRICE_CHECK_CRON || "*/2 * * * *";
  },
  get liffId() {
    return process.env.LIFF_ID?.trim() || undefined;
  },
  get lineChannelId() {
    return process.env.LINE_CHANNEL_ID?.trim() || undefined;
  },
};
