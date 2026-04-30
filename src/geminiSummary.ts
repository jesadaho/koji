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
  // gemini-1.5-* ถูก retire ไปแล้ว (2025) → default ใช้รุ่น 2.5
  return m && m.length <= 80 ? m : "gemini-2.5-flash";
}

function geminiTimeoutMs(): number {
  const n = Number(process.env.GEMINI_TIMEOUT_MS?.trim());
  // AI summary บางช่วงตอบช้า — default เผื่อ latency ให้มากขึ้น
  return Number.isFinite(n) && n >= 3000 && n <= 60000 ? Math.floor(n) : 20_000;
}

function cleanGeminiText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function looksTruncatedSummary(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  // Too short to be useful
  if (t.length < 40) return true;
  // Ends with an obviously incomplete token
  if (/[,$\u0E00-\u0E7F]\s*$/.test(t) && /[$,]$/.test(t)) return true;
  // If it starts with our bullet template but has < 2 bullets, it's likely cut
  const bulletCount = (t.match(/^\s*-\s+/gm) ?? []).length;
  if (bulletCount >= 1 && bulletCount < 2) return true;
  return false;
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
  ].join("\n");

  const primary = geminiModel();
  const fallbackModels = Array.from(
    new Set([primary, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-pro"])
  );

  try {
    const tryOnce = async (model: string, maxOutputTokens: number): Promise<GeminiSummaryResult> => {
      const controller = new AbortController();
      const timeoutMs = geminiTimeoutMs();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(key)}`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens,
            },
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 404) return { ok: false, status: 404, error: `gemini model not found (model ${model})` };
          return { ok: false, status: res.status, error: `gemini HTTP ${res.status} (model ${model})` };
        }
        const data = (await res.json()) as GeminiGenerateResponse;
        const rawText = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        const cleaned = cleanGeminiText(rawText);
        if (!cleaned) return { ok: false, error: `empty gemini response (model ${model})` };
        const lines = cleaned.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, maxLines);
        const joined = lines.join("\n").trim();
        if (!joined) return { ok: false, error: `empty gemini response (model ${model})` };
        if (looksTruncatedSummary(joined)) return { ok: false, error: `truncated gemini response (model ${model})` };
        return { ok: true, text: joined };
      } catch (e) {
        const msg =
          e instanceof Error ? (e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : e.message) : String(e);
        return { ok: false, error: `gemini request failed: ${msg} (model ${model})` };
      } finally {
        clearTimeout(t);
      }
    };

    for (const model of fallbackModels) {
      // pass 1: compact output
      const first = await tryOnce(model, 256);
      if (first.ok) return first;
      // retry only when it looks like truncation and not model-not-found/timeout
      if (first.status === 404) continue;
      if (typeof first.error === "string" && first.error.includes("truncated")) {
        const second = await tryOnce(model, 512);
        if (second.ok) return second;
        if (second.status === 404) continue;
        // if still truncated, keep trying other models
        continue;
      }
      // other non-404 errors: bail early
      if (first.status && first.status !== 404) return first;
    }
    return { ok: false, status: 404, error: `gemini model not found (tried ${fallbackModels.join(", ")})` };
  } catch (e) {
    const msg = e instanceof Error ? e.name === "AbortError" ? "timeout" : e.message : String(e);
    return { ok: false, error: `gemini request failed: ${msg}` };
  }
}

