/** สอบถามสถานะ sentiment / Market Pulse — รวม #marketPulse */
export function isMarketPulseStatusQuery(text: string): boolean {
  const t = text.trim();
  const l = t.toLowerCase();
  if (
    l === "สถานะ sentiment" ||
    l === "sentiment" ||
    l === "market pulse" ||
    l === "สถานะตลาด" ||
    l === "market pulse status" ||
    l === "koji market pulse"
  ) {
    return true;
  }
  return /^#marketpulse[^a-z0-9]*$/i.test(t);
}
