/** Discord Incoming Webhook — content สูงสุด 2000 ตัวอักษรต่อ request */
export const DISCORD_WEBHOOK_CONTENT_MAX = 2000;

export function discordWebhookConfigured(): boolean {
  return Boolean(process.env.DISCORD_ALERT_WEBHOOK_URL?.trim());
}

/** Snowflake จาก User Settings → Advanced → Developer Mode → คลิกขวาโปรไฟล์ → Copy User ID (คั่นหลายคนด้วยจุลภาคหรือช่องว่าง) */
function parseDiscordAlertMentionUserIds(): string[] {
  const raw = process.env.DISCORD_ALERT_MENTION_USER_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{5,25}$/.test(s));
}

function chunkString(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    out.push(text.slice(i, i + maxLen));
  }
  return out;
}

/** แบ่งข้อความโดย chunk แรกสั้นกว่า (เผื่อ prefix เช่น mention) */
function chunkStringFirstShorter(text: string, firstMax: number, restMax: number): string[] {
  if (firstMax <= 0) return chunkString(text, restMax);
  if (text.length <= firstMax) return [text];
  const out: string[] = [text.slice(0, firstMax)];
  out.push(...chunkString(text.slice(firstMax), restMax));
  return out;
}

/**
 * POST ไป Discord webhook — แบ่งข้อความยาวอัตโนมัติ (หลาย request ต่อกัน)
 * ถ้ามี DISCORD_ALERT_MENTION_USER_IDS จะใส่ <@id> ใน message แรกและ allowed_mentions (ping ได้เมื่อแอปปิด)
 */
export async function sendDiscordWebhookContent(text: string): Promise<void> {
  const url = process.env.DISCORD_ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    throw new Error("DISCORD_ALERT_WEBHOOK_URL ไม่ได้ตั้ง");
  }

  const userIds = parseDiscordAlertMentionUserIds();
  const mentionPrefix =
    userIds.length > 0 ? `${userIds.map((id) => `<@${id}>`).join(" ")}\n` : "";
  const firstMax = DISCORD_WEBHOOK_CONTENT_MAX - mentionPrefix.length;
  const parts =
    mentionPrefix.length > 0
      ? chunkStringFirstShorter(text, firstMax, DISCORD_WEBHOOK_CONTENT_MAX)
      : chunkString(text, DISCORD_WEBHOOK_CONTENT_MAX);

  for (let i = 0; i < parts.length; i++) {
    const isFirst = i === 0;
    const content = isFirst && mentionPrefix ? `${mentionPrefix}${parts[i]}` : parts[i];
    const body: Record<string, unknown> = { content };
    if (isFirst && userIds.length > 0) {
      body.allowed_mentions = { parse: [] as string[], users: userIds };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Discord webhook HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`);
    }
  }
}
