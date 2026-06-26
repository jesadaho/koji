/**
 * แมป Binance perp base → CoinGecko coin id
 * ใช้เมื่อ ticker ชนกัน (เช่น TON = Tokamak แทน Toncoin/Gram) หรือ CG เปลี่ยน symbol
 */
const BINANCE_BASE_TO_COINGECKO_ID: Record<string, string> = {
  TON: "the-open-network",
  PEPE: "pepe",
  SHIB: "shiba-inu",
  BONK: "bonk",
  FLOKI: "floki",
  LUNC: "terra-luna",
  XEC: "ecash",
  RATS: "rats",
  SATS: "sats-ordinals",
  CAT: "simon-s-cat",
};

export function coinGeckoIdForBinancePerpBase(base: string): string | null {
  const b = base.trim().toUpperCase();
  if (!b) return null;
  const direct = BINANCE_BASE_TO_COINGECKO_ID[b];
  if (direct) return direct;
  const m1000 = b.match(/^1000(.+)$/);
  if (m1000) {
    const inner = m1000[1]!.toUpperCase();
    return BINANCE_BASE_TO_COINGECKO_ID[inner] ?? null;
  }
  return null;
}

/** symbol candidates สำหรับ /coins/markets?symbols= (lowercase) */
export function coinGeckoSymbolCandidatesForBinancePerpBase(base: string): string[] {
  const b = base.trim().toUpperCase();
  if (!b) return [];
  const out: string[] = [];
  const m1000 = b.match(/^1000(.+)$/);
  if (m1000) out.push(m1000[1]!.toLowerCase());
  out.push(b.toLowerCase());
  return [...new Set(out)];
}
