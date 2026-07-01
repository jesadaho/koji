/** Hybrid Limit SHORT — หมดอายุถ้าไม่ fill (ชม.) */
export const REVERSAL_LIMIT_EXPIRE_HOURS_DEFAULT = 2;
export const REVERSAL_LIMIT_EXPIRE_HOURS_MIN = 1;
export const REVERSAL_LIMIT_EXPIRE_HOURS_MAX = 48;

export function parseReversalAutoTradeLimitExpireHours(
  raw: unknown,
  fallback = REVERSAL_LIMIT_EXPIRE_HOURS_DEFAULT,
): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  const h = Math.floor(n);
  if (h < REVERSAL_LIMIT_EXPIRE_HOURS_MIN || h > REVERSAL_LIMIT_EXPIRE_HOURS_MAX) return fallback;
  return h;
}

export function reversalLimitExpireMsFromHours(hours: number): number {
  return hours * 3600 * 1000;
}

/** default 2 ชม. — ใช้ stats touch window เมื่อไม่มี per-user config */
export const REVERSAL_LIMIT_EXPIRE_MS = reversalLimitExpireMsFromHours(
  REVERSAL_LIMIT_EXPIRE_HOURS_DEFAULT,
);

export type ReversalLimitExpireSettingsRow = {
  reversalAutoTradeLimitExpireHours?: number;
};

export function reversalLimitExpireHoursFromRow(row: ReversalLimitExpireSettingsRow): number {
  return parseReversalAutoTradeLimitExpireHours(row.reversalAutoTradeLimitExpireHours);
}

export function reversalLimitExpireMsFromRow(row: ReversalLimitExpireSettingsRow): number {
  return reversalLimitExpireMsFromHours(reversalLimitExpireHoursFromRow(row));
}
