import "dotenv/config";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  lineChannelSecret: requireEnv("LINE_CHANNEL_SECRET"),
  lineChannelAccessToken: requireEnv("LINE_CHANNEL_ACCESS_TOKEN"),
  /** ช่วงเช็คราคา (นาที) */
  priceCheckCron: process.env.PRICE_CHECK_CRON || "*/2 * * * *",
  /** LIFF ID จาก LINE Developers (หน้า LIFF) */
  liffId: process.env.LIFF_ID?.trim() || undefined,
  /** Channel ID ตัวเลข — ใช้ยืนยัน ID token จาก LIFF (Basic settings ของช่อง OA) */
  lineChannelId: process.env.LINE_CHANNEL_ID?.trim() || undefined,
};
