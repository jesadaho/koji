/** Discord Incoming Webhook — content สูงสุด 2000 ตัวอักษรต่อ request */
export const DISCORD_WEBHOOK_CONTENT_MAX = 2000;

export function discordWebhookConfigured(): boolean {
  return Boolean(process.env.DISCORD_ALERT_WEBHOOK_URL?.trim());
}

function chunkString(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    out.push(text.slice(i, i + maxLen));
  }
  return out;
}

/**
 * POST ไป Discord webhook — แบ่งข้อความยาวอัตโนมัติ (หลาย request ต่อกัน)
 */
export async function sendDiscordWebhookContent(text: string): Promise<void> {
  const url = process.env.DISCORD_ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    throw new Error("DISCORD_ALERT_WEBHOOK_URL ไม่ได้ตั้ง");
  }

  const parts = chunkString(text, DISCORD_WEBHOOK_CONTENT_MAX);
  for (const content of parts) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Discord webhook HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`);
    }
  }
}
