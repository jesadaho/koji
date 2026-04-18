/** สอบถามสถานะ cron / log ล่าสุด (รวม pct-trailing = Spark ticker + follow-up) */
export function isCronStatusQuery(text: string): boolean {
  const t = text.trim().toLowerCase();
  const phrases = [
    "สถานะ cron",
    "cron status",
    "cron สถานะ",
    "สถานะ spark",
    "spark cron",
    "spark cron status",
    "สถานะ spark cron",
    "สถานะ ticker spark",
    "sync spark",
  ];
  if (phrases.includes(t)) return true;
  const raw = text.trim();
  if (/^#cronstatus[^a-z0-9]*$/i.test(raw)) return true;
  if (/^#sparkcron[^a-z0-9]*$/i.test(raw)) return true;
  return false;
}
