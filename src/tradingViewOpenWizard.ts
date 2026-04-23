/** คำขอเริ่ม wizard (ไม่มีคำว่า MEXC) */
export function isGenericOpenWizardRequest(trimmedText: string): boolean {
  const s = trimmedText.trim().replace(/\s+/g, " ");
  if (/mexc/i.test(s)) return false;
  return /^ขอรับ webhook json$/i.test(s);
}

export function isWebhookJsonOpenSlash(normalized: string): boolean {
  const n = normalized.trim().toLowerCase();
  return n === "webhook_json_open" || n.startsWith("webhook_json_open ");
}

/** ขอรับ Webhook JSON open — ชัดว่าเปิด position (เทียบหลัง normalize + lowercase) */
export function isWebhookJsonOpenThaiRequest(trimmedText: string): boolean {
  const n = trimmedText.replace(/\s+/g, " ").trim().toLowerCase();
  if (/mexc/i.test(n)) return false;
  return n === "ขอรับ webhook json open";
}

export function parseSideAnswer(text: string): "LONG" | "SHORT" | null {
  const t = text.trim().toLowerCase();
  if (/^(long|l|ซื้อ|ลอง)$/.test(t)) return "LONG";
  if (/^(short|s|ขาย)$/.test(t) || t === "ชอร์ต") return "SHORT";
  return null;
}

export function parseMarginAnswer(text: string): number | null {
  const t = text.replace(/,/g, "").replace(/usdt/gi, "").trim();
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseLeverageAnswer(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/x$/i, "").trim();
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1 || n > 500) return null;
  return Math.floor(n);
}

export function isWizardCancel(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "ยกเลิก" || t === "cancel" || t === "/cancel";
}
