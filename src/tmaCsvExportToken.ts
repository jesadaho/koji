import { createHmac, timingSafeEqual } from "node:crypto";

/** path ใน token (ไม่มี /api/tma/) */
export const TMA_CSV_EXPORT_PATHS = new Set([
  "snowball-stats.csv",
  "reversal-stats.csv",
  "divergence-stats.csv",
  "auto-open-history.csv",
]);

const TTL_SEC = 120;

function signingSecret(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return t || null;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string | null {
  try {
    return Buffer.from(s, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** สร้าง token สำหรับ Telegram.WebApp.downloadFile (HTTPS URL สั้น ไม่ใส่ initData ทั้งก้อน) */
export function createTmaCsvExportToken(telegramUserId: number, csvPath: string): string | null {
  if (!TMA_CSV_EXPORT_PATHS.has(csvPath)) return null;
  const secret = signingSecret();
  if (!secret || !Number.isFinite(telegramUserId) || telegramUserId <= 0) return null;

  const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
  const payload = `${Math.floor(telegramUserId)}:${csvPath}:${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return b64urlEncode(`${payload}|${sig}`);
}

/** คืน telegramUserId ถ้า token ถูกต้องและ path ตรง */
export function verifyTmaCsvExportToken(token: string, csvPath: string): number | null {
  if (!TMA_CSV_EXPORT_PATHS.has(csvPath)) return null;
  const secret = signingSecret();
  if (!secret) return null;

  const raw = b64urlDecode(token.trim());
  if (!raw) return null;
  const pipe = raw.lastIndexOf("|");
  if (pipe <= 0) return null;

  const payload = raw.slice(0, pipe);
  const sig = raw.slice(pipe + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [uidStr, path, expStr] = parts;
  if (path !== csvPath) return null;

  const uid = Number(uidStr);
  const exp = Number(expStr);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(exp)) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;

  return uid;
}

export function csvPathFromTmaExportUrl(exportPath: string): string | null {
  const m = exportPath.trim().match(/\/([^/]+\.csv)$/i);
  return m ? m[1]! : null;
}
