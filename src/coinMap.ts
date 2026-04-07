/** สัญลักษณ์ฐาน (เล็ก) → สัญญา MEXC Perp USDT */
export const BASE_TO_CONTRACT: Record<string, string> = {
  btc: "BTC_USDT",
  eth: "ETH_USDT",
  sol: "SOL_USDT",
  xrp: "XRP_USDT",
  doge: "DOGE_USDT",
  ada: "ADA_USDT",
  bnb: "BNB_USDT",
  avax: "AVAX_USDT",
  dot: "DOT_USDT",
  link: "LINK_USDT",
  matic: "POL_USDT",
  pol: "POL_USDT",
  sui: "SUI_USDT",
  ton: "TON_USDT",
  pepe: "PEPE_USDT",
};

const CONTRACT_RE = /^[A-Z0-9]+_[A-Z0-9]+$/;

/**
 * คืนค่า contractSymbol (เช่น BTC_USDT) สำหรับเก็บใน alert และเรียกราคา
 */
export function resolveContractSymbol(input: string): { contractSymbol: string; label: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (CONTRACT_RE.test(upper)) {
    const base = upper.split("_")[0] ?? upper;
    return { contractSymbol: upper, label: base };
  }

  const raw = trimmed.toLowerCase();
  if (BASE_TO_CONTRACT[raw]) {
    const contractSymbol = BASE_TO_CONTRACT[raw];
    const label = contractSymbol.split("_")[0] ?? raw.toUpperCase();
    return { contractSymbol, label };
  }

  return null;
}
