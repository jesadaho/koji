import "dotenv/config";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * อ่าน env แบบ lazy เพื่อไม่ให้ `next build` ล้มเมื่อยังไม่ใส่ secret ใน CI
 * (จะ error ตอน runtime เมื่อมีการเรียกใช้จริง)
 */
export const config = {
  get port() {
    return Number(process.env.PORT) || 3000;
  },
  get lineChannelSecret() {
    return requireEnv("LINE_CHANNEL_SECRET");
  },
  get lineChannelAccessToken() {
    return requireEnv("LINE_CHANNEL_ACCESS_TOKEN");
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
