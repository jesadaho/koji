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
  /** Binance TONUSDT → MEXC ใช้ TONCOIN_USDT (TON_USDT ไม่มีสภาพคล่อง) */
  ton: "TONCOIN_USDT",
  pepe: "PEPE_USDT",
};

const CONTRACT_RE = /^[A-Z0-9]+_[A-Z0-9]+$/;

/** แปลง base (เช่น TON, BTC) → สัญญา MEXC — ใช้ alias ก่อน fallback `{BASE}_USDT` */
export function resolveMexcContractFromBase(base: string): string {
  const raw = base.trim().toLowerCase();
  if (BASE_TO_CONTRACT[raw]) return BASE_TO_CONTRACT[raw];
  const u = base.trim().toUpperCase();
  return `${u}_USDT`;
}

/** Binance USDT-M perp symbol (เช่น TONUSDT) → สัญญา MEXC */
export function resolveMexcContractFromBinanceSymbol(binanceSymbol: string): string | null {
  const sym = binanceSymbol.trim().toUpperCase();
  if (!sym.endsWith("USDT") || sym.length < 5) return null;
  const base = sym.slice(0, -4);
  return resolveMexcContractFromBase(base);
}

/**
 * คืนค่า contractSymbol (เช่น BTC_USDT) สำหรับเก็บใน alert และเรียกราคา
 */
export function resolveContractSymbol(input: string): { contractSymbol: string; label: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (CONTRACT_RE.test(upper)) {
    const base = upper.split("_")[0] ?? upper;
    return { contractSymbol: resolveMexcContractFromBase(base), label: base };
  }

  const raw = trimmed.toLowerCase();
  if (BASE_TO_CONTRACT[raw]) {
    return { contractSymbol: BASE_TO_CONTRACT[raw], label: raw.toUpperCase() };
  }

  if (/^[a-z0-9]{2,20}$/i.test(trimmed) && !trimmed.includes("_")) {
    const u = trimmed.toUpperCase();
    return { contractSymbol: resolveMexcContractFromBase(u), label: u };
  }

  return null;
}

/**
 * แปลง label จาก TradingView ({{ticker}}) เช่น `BINANCE:BTCUSDT.P` → สัญญา MEXC
 */
export function normalizeSymbolFromTradingView(input: string): { contractSymbol: string; label: string } | null {
  let t = input.trim();
  if (!t) return null;
  const c = t.indexOf(":");
  if (c >= 0) t = t.slice(c + 1).trim();
  t = t.replace(/\.P$/i, "").replace(/-PERP$/i, "");
  if (/^[A-Z0-9]+USDT$/i.test(t)) {
    const base = t.replace(/USDT$/i, "");
    return resolveContractSymbol(base);
  }
  return resolveContractSymbol(t);
}
