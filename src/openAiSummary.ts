export type OpenAiSummaryResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number; debug?: { curl: string; raw?: string } };

type OpenAiChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; type?: string; code?: string };
};

function openAiApiKey(): string {
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

function openAiModel(): string {
  const m = process.env.OPENAI_MODEL?.trim();
  return m && m.length <= 80 ? m : "gpt-4o-mini";
}

function openAiTimeoutMs(): number {
  const n = Number(process.env.OPENAI_TIMEOUT_MS?.trim());
  return Number.isFinite(n) && n >= 3000 && n <= 90000 ? Math.floor(n) : 20_000;
}

function cleanText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function extractDashBullets(s: string, want = 4): string[] {
  const lines = s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const bullets = lines.filter((ln) => ln.startsWith("- "));
  return bullets.slice(0, want);
}

function extractKojiEmojiSummary(s: string): string | null {
  const lines = s
    .replace(/\r/g, "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  if (lines.length < 5) return null;
  const head = lines[0]!;
  if (!head.toLowerCase().includes("koji") || !head.toLowerCase().includes("summary")) return null;
  const body = lines.slice(1);
  const pick = (prefix: string) => body.find((ln) => ln.startsWith(prefix)) ?? null;
  const pnl = pick("PnL");
  const risk = pick("⚠️ Risk:");
  const critical = pick("🚨 Critical:");
  const focus = pick("👀 Focus:");
  if (!pnl || !risk || !critical || !focus) return null;
  return [head, "", pnl, "", risk, "", critical, "", focus].join("\n");
}

function looksTruncatedSummary(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (t.length < 40) return true;
  if (/[,$]\s*$/.test(t)) return true;
  const bulletCount = (t.match(/^\s*-\s+/gm) ?? []).length;
  if (bulletCount > 0 && bulletCount < 4) return true;
  return false;
}

export async function openAiSummarizePortfolioFromTextResult(input: {
  text: string;
  maxLines?: number;
}): Promise<OpenAiSummaryResult> {
  const key = openAiApiKey();
  if (!key) return { ok: false, error: "missing OPENAI_API_KEY" };

  const wantLines =
    Number.isFinite(input.maxLines) && (input.maxLines as number) >= 2 ? (input.maxLines as number) : 4;

  const prompt = [
    "สรุปสถานะพอร์ตจากข้อความที่ให้มาเท่านั้น",
    "ข้อกำหนด:",
    "- ตอบเป็น 5 บรรทัดเท่านั้น (ห้ามเกิน/ห้ามขาด)",
    "- ภาษาไทยล้วน",
    "- ห้ามสร้างตัวเลข/ข้อมูลใหม่ นอกเหนือจากที่มีในข้อความ",
    "- ห้ามให้คำแนะนำลงทุน เช่น ควรซื้อ/ขาย/เพิ่ม/ลด",
    "- ใช้ emoji ตามหัวข้อให้เหมือนตัวอย่าง (อย่าใส่คำว่า Alternative Draft / reasoning)",
    "",
    "รูปแบบที่ต้องการ (ห้ามเพิ่ม/ลดหัวข้อ):",
    "🤖 Koji AI Summary",
    "PnL รวม: <ตัวเลขจากข้อความ> (<emoji สื่อดี/แย่>)",
    "⚠️ Risk: <1 ประเด็น risk สำคัญพร้อมตัวเลขจากข้อความ>",
    "🚨 Critical: <1 ประเด็นที่ critical ที่สุดพร้อมตัวเลขจากข้อความ> (ถ้าไม่มีให้ใส่ '—')",
    "👀 Focus: <1 สิ่งที่ต้อง monitor ต่อไปพร้อมอ้างอิงจากข้อความ>",
    "",
    "- ถ้าไม่มีข้อมูลหัวข้อนั้น ให้ใส่ '—' แต่ยังต้องมีบรรทัดนั้น",
    "",
    "ข้อความ:",
    input.text,
  ].join("\n");

  const controller = new AbortController();
  const timeoutMs = openAiTimeoutMs();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const model = openAiModel();
  const url = "https://api.openai.com/v1/chat/completions";

  const requestBody = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 260,
  };

  const curl = [
    "curl -sS https://api.openai.com/v1/chat/completions \\",
    "  -H \"Authorization: Bearer $OPENAI_API_KEY\" \\",
    "  -H \"Content-Type: application/json\" \\",
    `  -d '${JSON.stringify({ ...requestBody, messages: [{ role: "user", content: "<omitted: portfolio text>" }] })}'`,
  ].join("\n");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const rawText = await res.text();
    if (!res.ok) {
      let errMsg = `openai HTTP ${res.status} (model ${model})`;
      try {
        const parsed = JSON.parse(rawText) as OpenAiChatResponse;
        const m = parsed?.error?.message;
        if (m) errMsg = `${errMsg}: ${m}`;
      } catch {
        /* ignore */
      }
      return { ok: false, status: res.status, error: errMsg, debug: { curl, raw: rawText.slice(0, 3500) } };
    }

    const data = JSON.parse(rawText) as OpenAiChatResponse;
    const content = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = cleanText(content);
    if (!cleaned) return { ok: false, error: `empty openai response (model ${model})`, debug: { curl, raw: rawText.slice(0, 3500) } };

    const emojiSummary = extractKojiEmojiSummary(cleaned);
    if (!emojiSummary || looksTruncatedSummary(emojiSummary)) {
      // Retry once with more tokens (sometimes model truncates)
      const retryBody = { ...requestBody, max_tokens: 420 };
      const res2 = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(retryBody),
        signal: controller.signal,
      });
      const raw2 = await res2.text();
      if (!res2.ok) {
        return {
          ok: false,
          status: res2.status,
          error: `openai HTTP ${res2.status} (model ${model})`,
          debug: { curl, raw: raw2.slice(0, 3500) },
        };
      }
      const data2 = JSON.parse(raw2) as OpenAiChatResponse;
      const content2 = data2?.choices?.[0]?.message?.content ?? "";
      const cleaned2 = cleanText(content2);
      const emoji2 = extractKojiEmojiSummary(cleaned2);
      if (!emoji2 || looksTruncatedSummary(emoji2)) {
        return { ok: false, error: `truncated openai response (model ${model})`, debug: { curl, raw: raw2.slice(0, 3500) } };
      }
      return { ok: true, text: emoji2 };
    }

    return { ok: true, text: emojiSummary };
  } catch (e) {
    const msg =
      e instanceof Error ? (e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : e.message) : String(e);
    return { ok: false, error: `openai request failed: ${msg} (model ${model})`, debug: { curl } };
  } finally {
    clearTimeout(t);
  }
}

