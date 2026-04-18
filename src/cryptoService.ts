import axios from "axios";

/** ราคาเทียบ USDT (Futures) — ฟิลด์ชื่อ usd เดิมเพื่อให้ alerts ไม่ต้องเปลี่ยน */
export type CoinQuote = {
  usd: number;
  usd_24h_change?: number;
};

const DEBUG_JSON_MAX = 480;

function jsonSnippetForDebug(o: unknown, max = DEBUG_JSON_MAX): string {
  try {
    const s = JSON.stringify(o);
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > max ? `${one.slice(0, max)}…` : one;
  } catch {
    return String(o).slice(0, max);
  }
}

function describeAxiosError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const st = e.response?.status;
    const data = e.response?.data;
    const msg = e.message ? e.message.replace(/\s+/g, " ").trim() : "";
    return `axios HTTP ${st ?? "?"} ${msg ? `(${msg}) ` : ""}body=${jsonSnippetForDebug(data)}`;
  }
  if (e instanceof Error && e.message) return e.message.replace(/\s+/g, " ").trim();
  return String(e).replace(/\s+/g, " ").trim().slice(0, DEBUG_JSON_MAX);
}

const MEXC = "https://api.mexc.com/api/v1/contract/ticker";
/** fallback เมื่อ MEXC ไม่ตอบหรือไม่มีคู่ — ราคาใกล้เคียง perp USDT (ไม่เท่ากันทุกจุด) */
const BINANCE_FAPI_PRICE = "https://fapi.binance.com/fapi/v1/ticker/price";
const BINANCE_SPOT_PRICE = "https://api.binance.com/api/v3/ticker/price";

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

function isValidQuote(q: CoinQuote | undefined): boolean {
  return q != null && q.usd != null && Number.isFinite(q.usd) && q.usd > 0;
}

/** MEXC perp เช่น BTC_USDT → Binance symbol BTCUSDT */
function mexcContractToBinanceSymbol(contractSymbol: string): string | null {
  const s = contractSymbol.trim().toUpperCase();
  if (!s.endsWith("_USDT")) return null;
  const inner = s.slice(0, -"_USDT".length).replace(/_/g, "");
  if (!inner) return null;
  return `${inner}USDT`;
}

/** มีคู่ Binance ให้ลอง fallback — ใช้ตัดว่าจะแจ้งเตือน “ดึงราคาไม่สำเร็จ” หลังสองแหล่งหรือไม่ */
export function contractHasBinancePriceFallback(contractSymbol: string): boolean {
  return mexcContractToBinanceSymbol(contractSymbol) != null;
}

async function fetchBinancePriceOnce(url: string, binanceSymbol: string): Promise<number | null> {
  const r = await fetchBinancePriceOnceWithDiag(url, "binance", binanceSymbol);
  return r.price;
}

async function fetchBinancePriceOnceWithDiag(
  url: string,
  label: string,
  binanceSymbol: string
): Promise<{ price: number | null; diag?: string }> {
  try {
    const { data, status } = await axios.get<{ price?: string }>(url, {
      params: { symbol: binanceSymbol },
      timeout: 12_000,
      validateStatus: () => true,
    });
    const p = typeof data?.price === "string" ? Number(data.price) : Number(data?.price);
    if (!Number.isFinite(p) || p <= 0) {
      return {
        price: null,
        diag: `${label} HTTP ${status} symbol=${binanceSymbol} body=${jsonSnippetForDebug(data)}`,
      };
    }
    return { price: p };
  } catch (e) {
    return { price: null, diag: `${label} symbol=${binanceSymbol} ${describeAxiosError(e)}` };
  }
}

/**
 * ดึงราคา USDT จาก Binance เมื่อ MEXC ล้ม — ลอง USDT-M futures ก่อน แล้วค่อย spot
 * คืนคีย์เดิมตามที่ caller ใช้ (เช่น BTC_USDT)
 */
async function fetchBinanceFallbackForContract(wantedKey: string): Promise<Record<string, CoinQuote>> {
  const { quotes } = await fetchBinanceFallbackForContractWithDiag(wantedKey);
  return quotes;
}

async function fetchBinanceFallbackForContractWithDiag(wantedKey: string): Promise<{
  quotes: Record<string, CoinQuote>;
  diagParts: string[];
}> {
  const bn = mexcContractToBinanceSymbol(wantedKey);
  if (!bn) {
    return { quotes: {}, diagParts: ["Binance: แมปสัญญาเป็น symbol ไม่ได้ (ไม่ลงท้าย _USDT หรือฐานว่าง)"] };
  }

  const parts: string[] = [];
  const f = await fetchBinancePriceOnceWithDiag(BINANCE_FAPI_PRICE, "Binance FAPI", bn);
  if (f.diag) parts.push(f.diag);
  if (f.price != null) {
    return { quotes: { [wantedKey]: { usd: f.price } }, diagParts: parts };
  }

  const s = await fetchBinancePriceOnceWithDiag(BINANCE_SPOT_PRICE, "Binance spot", bn);
  if (s.diag) parts.push(s.diag);
  if (s.price != null) {
    return { quotes: { [wantedKey]: { usd: s.price } }, diagParts: parts };
  }

  return { quotes: {}, diagParts: parts };
}

async function fetchContractTickerSingleSymbol(symbol: string): Promise<Record<string, CoinQuote>> {
  const { quotes } = await fetchContractTickerSingleSymbolWithDiag(symbol);
  return quotes;
}

async function fetchContractTickerSingleSymbolWithDiag(symbol: string): Promise<{
  quotes: Record<string, CoinQuote>;
  diag?: string;
}> {
  const sym = symbol.trim();
  if (!sym) return { quotes: {} };
  const wanted = new Set([sym]);
  try {
    const { data, status } = await axios.get<MexcTickerResponse>(MEXC, {
      params: { symbol: sym },
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (!data.success || data.data === undefined) {
      return {
        quotes: {},
        diag: `MEXC contract/ticker?symbol=${sym} HTTP ${status} success=${data.success} code=${data.code} body=${jsonSnippetForDebug(data)}`,
      };
    }
    const out = normalizeResponse(wanted, data.data);
    if (!isValidQuote(out[sym])) {
      const row = Array.isArray(data.data) ? data.data[0] : data.data;
      return {
        quotes: out,
        diag: `MEXC contract/ticker?symbol=${sym} success แต่ parse lastPrice ไม่ได้ row=${jsonSnippetForDebug(row)}`,
      };
    }
    return { quotes: out };
  } catch (e) {
    return { quotes: {}, diag: `MEXC contract/ticker?symbol=${sym} ${describeAxiosError(e)}` };
  }
}

export type FetchSimplePricesDiagnostics = {
  quotes: Record<string, CoinQuote>;
  /** เฉพาะสัญญาที่ขอแล้วยังไม่มีราคาใช้ได้หลังครบขั้นตอน — ข้อความ one-line สำหรับ log/แจ้งเตือน */
  missingDetailBySymbol: Record<string, string>;
};

/**
 * เหมือน fetchSimplePrices แต่คืนรายละเอียดจาก API (truncate) ต่อสัญญาที่ยังไม่มีราคา — ใช้ debug Spark follow-up ฯลฯ
 */
export async function fetchSimplePricesWithDiagnostics(
  contractSymbols: string[]
): Promise<FetchSimplePricesDiagnostics> {
  const unique = Array.from(new Set(contractSymbols.filter(Boolean).map((s) => s.trim())));
  if (unique.length === 0) {
    return { quotes: {}, missingDetailBySymbol: {} };
  }

  const wanted = new Set(unique);
  const missingDetailBySymbol: Record<string, string> = {};

  const recordMissing = (sym: string, parts: string[]) => {
    const merged = parts.filter((x) => x && x.trim()).join(" | ");
    missingDetailBySymbol[sym] =
      merged || "ไม่มีราคาใน response (MEXC/Binance ไม่คืนคู่นี้หรือทุกแหล่งว่าง)";
  };

  if (unique.length === 1) {
    const sym = unique[0]!;
    const parts: string[] = [];
    const mexc = await fetchContractTickerSingleSymbolWithDiag(sym);
    if (mexc.diag) parts.push(mexc.diag);
    let out = { ...mexc.quotes };
    if (!isValidQuote(out[sym])) {
      const fb = await fetchBinanceFallbackForContractWithDiag(sym);
      Object.assign(out, fb.quotes);
      parts.push(...fb.diagParts);
    }
    if (!isValidQuote(out[sym])) {
      recordMissing(sym, parts);
    }
    return { quotes: out, missingDetailBySymbol };
  }

  let out: Record<string, CoinQuote> = {};
  const bulkParts: string[] = [];
  try {
    const { data, status } = await axios.get<MexcTickerResponse>(MEXC, {
      timeout: 30_000,
      validateStatus: () => true,
    });
    if (status < 200 || status >= 300) {
      bulkParts.push(`MEXC contract/ticker (bulk) HTTP ${status} body=${jsonSnippetForDebug(data)}`);
    } else if (!data.success || data.data === undefined) {
      bulkParts.push(
        `MEXC contract/ticker (bulk) success=${data.success} code=${data.code} body=${jsonSnippetForDebug(data)}`
      );
    } else {
      out = normalizeResponse(wanted, data.data);
    }
  } catch (e) {
    bulkParts.push(`MEXC contract/ticker (bulk) ${describeAxiosError(e)}`);
  }

  for (const sym of unique) {
    if (isValidQuote(out[sym])) continue;
    const parts: string[] = [...bulkParts];
    const mexc = await fetchContractTickerSingleSymbolWithDiag(sym);
    Object.assign(out, mexc.quotes);
    if (mexc.diag) parts.push(mexc.diag);
    if (!isValidQuote(out[sym])) {
      const fb = await fetchBinanceFallbackForContractWithDiag(sym);
      Object.assign(out, fb.quotes);
      parts.push(...fb.diagParts);
    }
    if (!isValidQuote(out[sym])) {
      recordMissing(sym, parts);
    }
  }

  return { quotes: out, missingDetailBySymbol };
}

/**
 * ดึงราคา MEXC Futures ตามสัญญา เช่น BTC_USDT
 * - 1 สัญญา: GET พร้อม ?symbol=
 * - หลายสัญญา: GET ทั้งหมดแล้วกรอง — ถ้าไม่เจอในชุดใหญ่ (เช่น alt บางคู่) จะ GET ทีละสัญญา
 * - ถ้ายังไม่มีราคา: fallback Binance USDT-M last แล้วค่อย Binance spot (สัญลักษณ์ BTC_USDT → BTCUSDT)
 */
export async function fetchSimplePrices(contractSymbols: string[]): Promise<Record<string, CoinQuote>> {
  const { quotes } = await fetchSimplePricesWithDiagnostics(contractSymbols);
  return quotes;
}

export function formatSignal(change?: number): string {
  if (change === undefined || Number.isNaN(change)) return "ไม่มีข้อมูล %24h";
  const abs = Math.abs(change);
  if (abs >= 8) return `สัญญาณ: เคลื่อนไหวแรง (${change >= 0 ? "+" : ""}${change.toFixed(2)}% /24h)`;
  if (abs >= 4) return `สัญญาณ: ขยับชัด (${change >= 0 ? "+" : ""}${change.toFixed(2)}% /24h)`;
  return `ภาพรวม 24h: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}
