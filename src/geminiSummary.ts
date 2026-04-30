type GeminiGenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

export type GeminiSummaryResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

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
  const r = await geminiSummarizePortfolioFromTextResult(input);
  return r.ok ? r.text : null;
}

export async function geminiSummarizePortfolioFromTextResult(input: {
  text: string;
  maxLines?: number;
}): Promise<GeminiSummaryResult> {
  const key = geminiApiKey();
  if (!key) return { ok: false, error: "missing GEMINI_API_KEY" };

  const maxLines =
    Number.isFinite(input.maxLines) && (input.maxLines as number) >= 2 ? (input.maxLines as number) : 6;

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
    if (!res.ok) {
      return { ok: false, status: res.status, error: `gemini HTTP ${res.status}` };
    }
    const data = (await res.json()) as GeminiGenerateResponse;
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const cleaned = cleanGeminiText(text);
    if (!cleaned) return { ok: false, error: "empty gemini response" };
    const lines = cleaned.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, maxLines);
    const joined = lines.join("\n").trim();
    if (!joined) return { ok: false, error: "empty gemini response" };
    return { ok: true, text: joined };
  } catch (e) {
    const msg = e instanceof Error ? e.name === "AbortError" ? "timeout" : e.message : String(e);
    return { ok: false, error: `gemini request failed: ${msg}` };
  } finally {
    clearTimeout(t);
  }
}

