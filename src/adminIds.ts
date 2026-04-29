/** Admin IDs (shared across channels).
 *
 * `KOJI_ADMIN_IDS` accepts comma-separated IDs:
 * - LINE userId: starts with "U" (e.g. Uxxxxxxxx...)
 * - Telegram userId: digits only (e.g. 123456789)
 *
 * Backward-compatible:
 * - LINE Spark reset: SPARK_MATRIX_RESET_ALLOWED_USER_IDS (LINE userIds)
 * - Telegram run cron: TELEGRAM_CRON_RUN_ALLOWED_USER_IDS (telegram userIds)
 */

function splitCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function adminIdTokens(): string[] {
  const primary = splitCsv(process.env.KOJI_ADMIN_IDS);
  return primary;
}

export function isAdminLineUserId(lineUserId: string): boolean {
  const id = lineUserId.trim();
  if (!id) return false;

  const tokens = adminIdTokens();
  if (tokens.includes(id)) return true;

  // Legacy fallback
  const legacy = splitCsv(process.env.SPARK_MATRIX_RESET_ALLOWED_USER_IDS);
  return legacy.includes(id);
}

export function isAdminTelegramUserId(tgUserId: number | undefined): boolean {
  if (tgUserId == null || !Number.isFinite(tgUserId) || tgUserId <= 0 || !Number.isInteger(tgUserId)) {
    return false;
  }
  const idStr = String(tgUserId);

  const tokens = adminIdTokens();
  if (tokens.includes(idStr)) return true;

  // Legacy fallback
  const legacy = splitCsv(process.env.TELEGRAM_CRON_RUN_ALLOWED_USER_IDS);
  return legacy.includes(idStr);
}

