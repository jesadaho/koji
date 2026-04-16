import axios from "axios";

/** ราคาเทียบ USDT (Futures) — ฟิลด์ชื่อ usd เดิมเพื่อให้ alerts ไม่ต้องเปลี่ยน */
export type CoinQuote = {
  usd: number;
  usd_24h_change?: number;
};

const MEXC = "https://api.mexc.com/api/v1/contract/ticker";

type MexcTickerRow = {
  symbol: string;
  lastPrice: number;
  fairPrice?: number;
  riseFallRate?: number;
};

type MexcTickerResponse = {
  success: boolean;
  code: number;
  data?: MexcTickerRow | MexcTickerRow[];
};

function parseLastPrice(row: MexcTickerRow): number | null {
  const raw = row.lastPrice as unknown;
  const p = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(p) || p <= 0) return null;
  return p;
}

function rowToQuote(row: MexcTickerRow): CoinQuote | null {
  const p = parseLastPrice(row);
  if (p == null) return null;
  const r = row.riseFallRate as unknown;
  const rr = typeof r === "number" ? r : Number(r);
  const pct = Number.isFinite(rr) && !Number.isNaN(rr) ? rr * 100 : undefined;
  return { usd: p, usd_24h_change: pct };
}

/** แมป symbol จาก API → คีย์ที่ caller ใช้ (ไม่สนตัวพิมพ์) */
function normalizeResponse(
  wanted: Set<string>,
  data: MexcTickerRow | MexcTickerRow[] | undefined
): Record<string, CoinQuote> {
  const out: Record<string, CoinQuote> = {};
  if (!data) return out;
  const wantedByUpper = new Map<string, string>();
  wanted.forEach((w) => {
    wantedByUpper.set(w.trim().toUpperCase(), w);
  });
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row?.symbol) continue;
    const key = wantedByUpper.get(row.symbol.trim().toUpperCase());
    if (!key) continue;
    const q = rowToQuote(row);
    if (q) out[key] = q;
  }
  return out;
}

async function fetchContractTickerSingleSymbol(symbol: string): Promise<Record<string, CoinQuote>> {
  const sym = symbol.trim();
  if (!sym) return {};
  const wanted = new Set([sym]);
  try {
    const { data } = await axios.get<MexcTickerResponse>(MEXC, {
      params: { symbol: sym },
      timeout: 15_000,
    });
    if (!data.success || data.data === undefined) return {};
    return normalizeResponse(wanted, data.data);
  } catch {
    return {};
  }
}

/**
 * ดึงราคา MEXC Futures ตามสัญญา เช่น BTC_USDT
 * - 1 สัญญา: GET พร้อม ?symbol=
 * - หลายสัญญา: GET ทั้งหมดแล้วกรอง — ถ้าไม่เจอในชุดใหญ่ (เช่น alt บางคู่) จะ GET ทีละสัญญาเป็น fallback
 */
export async function fetchSimplePrices(contractSymbols: string[]): Promise<Record<string, CoinQuote>> {
  const unique = Array.from(
    new Set(contractSymbols.filter(Boolean).map((s) => s.trim()))
  );
  if (unique.length === 0) return {};

  const wanted = new Set(unique);

  if (unique.length === 1) {
    return fetchContractTickerSingleSymbol(unique[0]!);
  }

  let out: Record<string, CoinQuote> = {};
  try {
    const { data } = await axios.get<MexcTickerResponse>(MEXC, {
      timeout: 30_000,
    });
    if (data.success && data.data !== undefined) {
      out = normalizeResponse(wanted, data.data);
    }
  } catch {
    /* fallback ด้านล่าง */
  }

  for (const sym of unique) {
    const q = out[sym];
    if (q?.usd != null && Number.isFinite(q.usd) && q.usd > 0) continue;
    const single = await fetchContractTickerSingleSymbol(sym);
    Object.assign(out, single);
  }

  return out;
}

export function formatSignal(change?: number): string {
  if (change === undefined || Number.isNaN(change)) return "ไม่มีข้อมูล %24h";
  const abs = Math.abs(change);
  if (abs >= 8) return `สัญญาณ: เคลื่อนไหวแรง (${change >= 0 ? "+" : ""}${change.toFixed(2)}% /24h)`;
  if (abs >= 4) return `สัญญาณ: ขยับชัด (${change >= 0 ? "+" : ""}${change.toFixed(2)}% /24h)`;
  return `ภาพรวม 24h: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}
