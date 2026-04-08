/** สอบถามสถานะ cron / log ล่าสุด (บันทึกจากแต่ละรันของ /api/cron/price-alerts) */
export function isCronStatusQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === "สถานะ cron" || t === "cron status" || t === "cron สถานะ") return true;
  return /^#cronstatus[^a-z0-9]*$/i.test(text.trim());
}
