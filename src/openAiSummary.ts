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

function extractDailyBrief(s: string): string | null {
  const raw = s.replace(/\r/g, "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!lower.includes("koji") || !lower.includes("daily brief")) return null;

  const takeBetween = (start: RegExp, end: RegExp): string | null => {
    const m = raw.match(start);
    if (!m || m.index == null) return null;
    const from = m.index + m[0].length;
    const rest = raw.slice(from);
    const m2 = rest.match(end);
    const block = (m2 ? rest.slice(0, m2.index) : rest).trim();
    return block.length ? block : null;
  };

  // รองรับทั้ง "KOJI Daily Brief" และ "KOJI AI Daily Brief" (ตาม prompt)
  const head = raw
    .split("\n")
    .map((x) => x.trim())
    .find((ln) => /koji\s+(?:ai\s+)?daily\s+brief/i.test(ln));
  if (!head) return null;

  const q = '["\u201c]'; // straight or curly double quote
  const qe = '["\u201d]';

  const overview = takeBetween(/📊\s*ภาพรวมวันนี้\s*:/i, /⚠️\s*จุดที่ต้อง/i);
  const risk = takeBetween(
    new RegExp(`⚠️\\s*จุดที่ต้อง\\s*${q}ทำใจนิ่งๆ${qe}\\s*\\(High Risk\\)\\s*:`, "i"),
    new RegExp(`🚨\\s*จุด\\s*${q}ไฟไหม้`, "i"),
  );
  const critical = takeBetween(
    new RegExp(`🚨\\s*จุด\\s*${q}ไฟไหม้${qe}\\s*ต้องรีบตัดสินใจ\\s*\\(Critical\\)\\s*:`, "i"),
    /👀\s*มุมมองเชิงเทคนิค\s*:/i,
  );
  const mmHeader = /📐\s*วินัย\s*MM\s*\((?:เช็ก|เช็ค)ลิสต์\)\s*:/i;
  const focus = takeBetween(/👀\s*มุมมองเชิงเทคนิค\s*:/i, mmHeader);
  const mm = takeBetween(mmHeader, /\Z/);

  if (!overview || !risk || !critical || !focus || !mm) return null;

  return [
    head,
    "",
    "📊 ภาพรวมวันนี้:",
    "",
    overview,
    "",
    "⚠️ จุดที่ต้อง \"ทำใจนิ่งๆ\" (High Risk):",
    "",
    risk,
    "",
    "🚨 จุด \"ไฟไหม้\" ต้องรีบตัดสินใจ (Critical):",
    "",
    critical,
    "",
    "👀 มุมมองเชิงเทคนิค:",
    "",
    focus,
    "",
    "📐 วินัย MM (เช็กลิสต์):",
    "",
    mm,
  ].join("\n");
}

function looksTruncatedSummary(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (t.length < 180) return true;
  // Mid-clause cut (comma/dash) or dangling Latin token without sentence end
  if (/[,$\-–—]\s*$/.test(t)) return true;
  if (/[A-Za-z]\s*$/.test(t) && !/[.!?…)]\s*$/.test(t)) return true;
  return false;
}

export async function openAiSummarizePortfolioFromTextResult(input: {
  text: string;
  maxLines?: number;
}): Promise<OpenAiSummaryResult> {
  const key = openAiApiKey();
  if (!key) return { ok: false, error: "missing OPENAI_API_KEY" };

  const prompt = [
    "คุณคือ Koji AI — ผู้ช่วยเทรดเดอร์ที่เน้น Survival และ Risk Management เป็นอันดับแรก สรุปจากข้อความที่ให้มาเท่านั้น",
    "ข้อกำหนดทั่วไป:",
    "- ภาษาไทยล้วน อ่านง่าย ห้ามหยาบคาย",
    "- ห้ามสร้างตัวเลข/ข้อมูลใหม่ นอกเหนือจากที่มีในข้อความ",
    "- บล็อก 📊 ⚠️ 🚨 👀: โทนตรงไปตรงมาได้ แต่ห้ามสั่งซื้อ/ขาย/เปิด/ปิด/เพิ่ม/ลด position เป็นคำสั่งตรงๆ (ห้ามคำว่า ควรซื้อ/ควรขาย/ควรปิด/ควรเพิ่ม/ควรลด)",
    "- ห้ามใส่ reasoning / draft / markdown code fence",
    "",
    "บล็อก \"📐 วินัย MM (เช็กลิสต์)\" — โทนเข้มงวด ไม่เกรงใจ ไม่อ้อมค้อม (ยังห้ามสั่งซื้อ/ขาย/เปิด/ปิดตามสัญญาใดเป็นพิเศษ — พูดเรื่องความเสี่ยงและการจัดการมาร์จิ้น/เลเวอรีจ์เท่านั้น):",
    "- ใช้เฉพาะตัวเลขจากข้อความ (margin use %, ระยะห่างจาก liquidation % ต่อคู่, จำนวน open positions, max margin ratio) มาเทียบเกณฑ์ด้านล่าง — ห้ามพูดว่า \"ยังไม่มีสัญญาณชัด\" / \"โอเค\" ถ้าตัวเลขชัดว่าหลุดเกณฑ์",
    "- Margin use (ของพอร์ตรวมที่ข้อความระบุ) — \"The 10–20% Gold Standard\": ถ้าน้อยกว่า 20% ให้ชมชัดๆ ว่าคุมวินัยดี (โทนภูมิใจได้)",
    "- Margin use: มากกว่า 40% ให้ใช้คำว่า \"เริ่มตึง\" · มากกว่า 50% ให้ \"ด่า\" ทันทีว่า \"เกินครึ่งพอร์ตแล้ว\" / \"ตึงเกิน\" (โทนแรงได้) · มากกว่า 60% ให้ระดับ \"อันตราย (Danger)\" · มากกว่า 80% ให้ใช้โทนสั่งลดความเสี่ยงทันที (เช่น ลดความเสี่ยงจากมาร์จิ้น/เลเวอรีจ์ทันที — ไม่ต้องระบุคู่)",
    "- ระยะห่างจาก liquidation (% ต่อ position ที่มีในข้อความ): ต่ำกว่า 10% ให้ระบุ \"เสี่ยงสูง\" · ต่ำกว่า 5% ให้ระบุ \"วิกฤต/ไฟไหม้ (Critical)\" และบังคับใช้คำว่า \"ต้องจัดการ\" (ห้ามใช้ \"ควรตรวจสอบ\" / \"พิจารณาดู\" แทน)",
    "- จำนวน open positions: ถ้ามากกว่า 5 ให้เตือนเรื่องการกระจายสมาธิและความเสี่ยงจาก correlation ของพอร์ต",
    "- ถ้าไม่มีตัวเลข margin/liq/จำนวนไม้ในข้อความพอที่จะเทียบเกณฑ์ ให้บอกตรงๆ ว่าข้อมูลไม่พอ ห้ามประเมินโกหก",
    "",
    "รูปแบบที่ต้องออกมา (ต้องมีหัวข้อตามนี้ตามลำดับ และมีบรรทัดว่างระหว่างหัวกับเนื้อหา):",
    "บรรทัดแรกต้องเป็นแบบนี้ (ใส่หัวข้อย่อยในวงเล็บคำพูดได้):",
    "🤖 KOJI AI Daily Brief: \"...\"",
    "",
    "จากนั้นเป็นบล็อกต่อไปนี้ (หัวข้อต้องตรงตัวอักษร):",
    "📊 ภาพรวมวันนี้:",
    "<ย่อหน้า 2-4 ประโยค อธิบายภาพรวมจาก equity + floating PnL + margin use ที่มีในข้อความ>",
    "",
    "⚠️ จุดที่ต้อง \"ทำใจนิ่งๆ\" (High Risk):",
    "<ย่อหน้า 2-5 ประโยค เลือก 1 คู่/ประเด็นที่เสี่ยง/กดแรงที่สุดจากข้อความ พร้อมตัวเลขที่มี>",
    "",
    "🚨 จุด \"ไฟไหม้\" ต้องรีบตัดสินใจ (Critical):",
    "<ย่อหน้า 2-5 ประโยค เลือกประเด็นที่ critical ที่สุด (เช่น liq ใกล้/โดนลากหนัก) พร้อมตัวเลขที่มี> ถ้าไม่มีให้ใส่ '—'",
    "",
    "👀 มุมมองเชิงเทคนิค:",
    "<ย่อหน้า 2-5 ประโยค สรุปสิ่งที่น่าเฝ้าดูจาก EMA12(1h)/PSAR(1h)/structure ที่มีในข้อความ>",
    "",
    "📐 วินัย MM (เช็กลิสต์):",
    "<ย่อหน้า 3-6 ประโยค ยึดเกณฑ์เข้มงวดด้านบน — สรุปสถานะ margin use + คู่ที่ liq แคบที่สุดจากข้อความ + จำนวนไม้ — พูดตรงๆ ไม่อ่อนหวาน>",
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
    temperature: 0.35,
    max_tokens: 1100,
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

    const brief = extractDailyBrief(cleaned);
    if (!brief || looksTruncatedSummary(brief)) {
      // Retry once with more tokens (sometimes model truncates)
      const retryBody = { ...requestBody, max_tokens: 1500 };
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
      const brief2 = extractDailyBrief(cleaned2);
      if (!brief2 || looksTruncatedSummary(brief2)) {
        return { ok: false, error: `truncated openai response (model ${model})`, debug: { curl, raw: raw2.slice(0, 3500) } };
      }
      return { ok: true, text: brief2 };
    }

    return { ok: true, text: brief };
  } catch (e) {
    const msg =
      e instanceof Error ? (e.name === "AbortError" ? `timeout (${timeoutMs}ms)` : e.message) : String(e);
    return { ok: false, error: `openai request failed: ${msg} (model ${model})`, debug: { curl } };
  } finally {
    clearTimeout(t);
  }
}

