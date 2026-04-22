/**
 * รองรับ `tg:123` หรือ `123` ให้ตรงกับ userId ใน store
 */
export function normalizeTradingViewUserId(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const t = String(raw).trim();
  if (!t) return "";
  if (/^tg:\d+$/i.test(t)) {
    return `tg:${t.slice(3)}`;
  }
  if (/^\d+$/.test(t)) {
    return `tg:${t}`;
  }
  return t;
}
