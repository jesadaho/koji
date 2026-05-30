import "server-only";

import { fetchAllContractTickers, fetchContractTickerSingle } from "./mexcMarkets";

function normContractSymbol(sym: string): string {
  return sym.trim().toUpperCase();
}

/** ราคา last จาก MEXC perp — key = contract symbol เช่น BTC_USDT */
export async function fetchAutoOpenMarkPrices(contractSymbols: string[]): Promise<Record<string, number>> {
  const wanted = new Set(
    contractSymbols.map(normContractSymbol).filter((s) => s.length > 0),
  );
  if (wanted.size === 0) return {};

  const out: Record<string, number> = {};

  try {
    const tickers = await fetchAllContractTickers();
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i]!;
      const sym = t.symbol ? normContractSymbol(t.symbol) : "";
      if (!sym || !wanted.has(sym)) continue;
      const lp = t.lastPrice;
      if (typeof lp === "number" && Number.isFinite(lp) && lp > 0) {
        out[sym] = lp;
        wanted.delete(sym);
      }
      if (wanted.size === 0) return out;
    }
  } catch {
    /* fallback ต่อสัญญา */
  }

  if (wanted.size === 0) return out;

  await Promise.all(
    Array.from(wanted).map(async (sym) => {
      const t = await fetchContractTickerSingle(sym);
      const lp = t?.lastPrice;
      if (typeof lp === "number" && Number.isFinite(lp) && lp > 0) out[sym] = lp;
    }),
  );

  return out;
}

export function collectAutoOpenContractSymbols(contractSymbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < contractSymbols.length; i++) {
    const sym = normContractSymbol(contractSymbols[i]!);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}
