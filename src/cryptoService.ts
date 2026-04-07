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

function rowToQuote(row: MexcTickerRow): CoinQuote | null {
  const p = row.lastPrice;
  if (typeof p !== "number" || Number.isNaN(p)) return null;
  const r = row.riseFallRate;
  const pct = typeof r === "number" && !Number.isNaN(r) ? r * 100 : undefined;
  return { usd: p, usd_24h_change: pct };
}

function normalizeResponse(
  wanted: Set<string>,
  data: MexcTickerRow | MexcTickerRow[] | undefined
): Record<string, CoinQuote> {
  const out: Record<string, CoinQuote> = {};
  if (!data) return out;
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row?.symbol || !wanted.has(row.symbol)) continue;
    const q = rowToQuote(row);
    if (q) out[row.symbol] = q;
  }
  return out;
}

/**
 * ดึงราคา MEXC Futures ตามสัญญา เช่น BTC_USDT
 * - 1 สัญญา: GET พร้อม ?symbol=
 * - หลายสัญญา: GET ทั้งหมดแล้วกรอง (คำขอเดียว)
 */
export async function fetchSimplePrices(contractSymbols: string[]): Promise<Record<string, CoinQuote>> {
  const unique = Array.from(new Set(contractSymbols.filter(Boolean)));
  if (unique.length === 0) return {};

  const wanted = new Set(unique);

  if (unique.length === 1) {
    const sym = unique[0]!;
    const { data } = await axios.get<MexcTickerResponse>(MEXC, {
      params: { symbol: sym },
      timeout: 15_000,
    });
    if (!data.success || data.data === undefined) return {};
    return normalizeResponse(wanted, data.data);
  }

  const { data } = await axios.get<MexcTickerResponse>(MEXC, {
    timeout: 30_000,
  });
  if (!data.success || data.data === undefined) return {};
  return normalizeResponse(wanted, data.data);
}

export function formatSignal(change?: number): string {
  if (change === undefined || Number.isNaN(change)) return "ไม่มีข้อมูล %24h";
  const abs = Math.abs(change);
  if (abs >= 8) return `สัญญาณ: เคลื่อนไหวแรง (${change >= 0 ? "+" : ""}${change.toFixed(2)}% /24h)`;
  if (abs >= 4) return `สัญญาณ: ขยับชัด (${change >= 0 ? "+" : ""}${change.toFixed(2)}% /24h)`;
  return `ภาพรวม 24h: ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}
