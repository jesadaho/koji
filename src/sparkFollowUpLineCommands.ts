/** สอบถามสถิติ Spark follow-up */
export function isSparkStatsQuery(text: string): boolean {
  const t = text.trim();
  const l = t.toLowerCase();
  if (l === "สถิติ spark" || l === "spark stats" || l === "spark follow-up" || l === "spark followup") {
    return true;
  }
  return /^#sparkstats[^a-z0-9]*$/i.test(t);
}
