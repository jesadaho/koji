export type OpenRouterSummaryResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

type OpenRouterChatResponse = {
  choices?: { message?: { content?: string } }[];
};

function openRouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY?.trim() ?? "";
}

function openRouterModel(): string {
  const m = process.env.OPENROUTER_MODEL?.trim();
  return m && m.length <= 120 ? m : "google/gemini-3.1-pro-preview";
}

function openRouterTimeoutMs(): number {
  const n = Number(process.env.OPENROUTER_TIMEOUT_MS?.trim());
  return Number.isFinite(n) && n >= 3000 && n <= 90000 ? Math.floor(n) : 25_000;
}

function cleanText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function looksTruncatedSummary(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (t.length < 40) return true;
  // common truncation patterns: ends with dangling comma/currency
  if (/[,$]\s*$/.test(t)) return true;
  // ends mid-word / mid-token often indicates cutoff
  if (/[A-Za-z]\s*$/.test(t) && !/[.!?)]\s*$/.test(t)) return true;
  const bulletCount = (t.match(/^\s*-\s+/gm) ?? []).length;
  if (bulletCount > 0 && bulletCount < 4) return true;
  // if it looks like it started a bullet but got cut mid-line
  if (/^\s*-\s+.*\s*$/.test(t) && t.includes("Equity") && /[$,]\s*$/.test(t)) return true;
  return false;
}

export async function openRouterSummarizePortfolioFromTextResult(input: {
  text: string;
  maxLines?: number;
}): Promise<OpenRouterSummaryResult> {
  const key = openRouterApiKey();
  if (!key) return { ok: false, error: "missing OPENROUTER_API_KEY" };

  const maxLines =
    Number.isFinite(input.maxLines) && (input.maxLines as number) >= 2 ? (input.maxLines as number) : 6;

  const basePromptLines = [
    "You are Koji, a crypto futures portfolio assistant.",
    "Summarize the portfolio status based ONLY on the provided message.",
    "Requirements:",
    `- Output ${maxLines} lines max.`,
    "- Language: Thai only.",
    "- Do NOT add numbers not present in the message.",
    "- Do NOT give investment advice. No 'ควรซื้อ/ขาย/เพิ่ม/ลด'.",
    "- Avoid generic statements like 'พอร์ตกำไร/ขาดทุน' without referencing specific numbers present in the message.",
    "- Prefer short, actionable monitoring notes (risk/posture/what to watch).",
    "- Use exactly this template (1 line per bullet, keep it tight):",
    "  - ภาพรวม: <สรุปจาก equity + floating PnL ที่มีในข้อความ>",
    "  - ความเสี่ยงหลัก: <1 ประเด็นจาก Risk/Margin/Liq/EMA/PSAR/structure ที่เด่นสุด> (อ้างค่าที่มี)",
    "  - สวนทาง/เตือน: <1 ประเด็นที่สวนทาง position หรือ concern ที่รุนแรงสุด> (อ้างค่าที่มี)",
    "  - โฟกัสต่อไป: <1 สิ่งที่ต้อง monitor เช่น EMA12/PSAR/Liq distance/position margin size> (อ้างค่าที่มี)",
    "- If a field is not present, put '—' for that part.",
    "",
    "Message:",
    input.text,
  ];

  const prompt = basePromptLines.join("\n");

  const strictPrompt = [
    ...basePromptLines.slice(0, basePromptLines.indexOf("Message:")),
    "Additional strict formatting:",
    "- Return exactly 4 lines.",
    "- Each line MUST start with '- ' (dash+space).",
    "",
    "Message:",
    input.text,
  ].join("\n");

  const model = openRouterModel();
  try {
    const callOnce = async (content: string, maxTokens: number): Promise<OpenRouterSummaryResult> => {
      const controller = new AbortController();
      const timeoutMs = openRouterTimeoutMs();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            // optional but recommended by OpenRouter for attribution/limits
            "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://koji.local",
            "X-Title": "Koji",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content }],
            temperature: 0.3,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          return { ok: false, status: res.status, error: `openrouter HTTP ${res.status} (model ${model})` };
        }
        const data = (await res.json()) as OpenRouterChatResponse;
        const raw = data?.choices?.[0]?.message?.content ?? "";
        const cleaned = cleanText(raw);
        if (!cleaned) return { ok: false, error: `empty openrouter response (model ${model})` };
        const lines = cleaned.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, maxLines);
        const joined = lines.join("\n").trim();
        if (!joined) return { ok: false, error: `empty openrouter response (model ${model})` };
        if (looksTruncatedSummary(joined)) {
          return { ok: false, error: `truncated openrouter response (model ${model})` };
        }
        return { ok: true, text: joined };
      } catch (e) {
        const msg =
          e instanceof Error ? (e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : e.message) : String(e);
        return { ok: false, error: `openrouter request failed: ${msg} (model ${model})` };
      } finally {
        clearTimeout(t);
      }
    };

    // Prefer strict format to make parsing predictable
    const first = await callOnce(strictPrompt, 650);
    if (first.ok) return first;
    if (typeof first.error === "string" && first.error.includes("truncated")) {
      const second = await callOnce(strictPrompt, 1100);
      if (second.ok) return second;
      return second;
    }
    return first;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `openrouter request failed: ${msg} (model ${model})` };
  }
}

