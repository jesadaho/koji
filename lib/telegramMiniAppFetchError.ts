/** แปลงข้อความ error จาก fetch ให้ผู้ใช้ Mini App เข้าใจได้ */
export function formatTelegramMiniAppFetchError(err: unknown, context?: string): string {
  const raw = err instanceof Error ? err.message.trim() : String(err).trim();
  const m = raw.toLowerCase();

  let detail: string;
  if (!raw || m === "load failed" || m === "failed to fetch" || m.includes("networkerror")) {
    const api = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").trim();
    const apiHint = api
      ? ` · API ${api}`
      : " · ตั้ง NEXT_PUBLIC_API_BASE_URL ถ้าเปิดนอก Telegram";
    detail = `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — เช็คเน็ตหรือเปิดแอปใหม่${apiHint}`;
  } else if (m.includes("abort") || m.includes("aborted")) {
    detail = "คำขอถูกยกเลิกหรือ timeout — ลองกดรีเฟรช";
  } else {
    detail = raw;
  }

  return context ? `${context}: ${detail}` : detail;
}
