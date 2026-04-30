type GeminiGenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY?.trim() ?? "";
}

function geminiModel(): string {
  const m = process.env.GEMINI_MODEL?.trim();
  return m && m.length <= 80 ? m : "gemini-1.5-flash";
}

function geminiTimeoutMs(): number {
  const n = Number(process.env.GEMINI_TIMEOUT_MS?.trim());
  return Number.isFinite(n) && n >= 3000 && n <= 60000 ? Math.floor(n) : 12_000;
}

function cleanGeminiText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export async function geminiSummarizePortfolioFromText(input: {
  text: string;
  maxLines?: number;
}): Promise<string | null> {
  const key = geminiApiKey();
  if (!key) return null;

  const maxLines = Number.isFinite(input.maxLines) && (input.maxLines as number) >= 2 ? (input.maxLines as number) : 6;

  const prompt = [
    "You are Koji, a crypto futures portfolio assistant.",
    "Summarize the portfolio status based ONLY on the provided message.",
    "Requirements:",
    `- Output ${maxLines} lines max.`,
    "- Each line must be concise Thai.",
    "- Do NOT add numbers not present in the message.",
    "- Do NOT give investment advice. Focus on risks, posture, and what to monitor.",
    "- If info is missing, say '—' briefly.",
    "",
    "Message:",
    input.text,
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel()
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), geminiTimeoutMs());
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 256,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GeminiGenerateResponse;
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const cleaned = cleanGeminiText(text);
    if (!cleaned) return null;
    const lines = cleaned.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, maxLines);
    return lines.join("\n");
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

