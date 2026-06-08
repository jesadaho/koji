import "server-only";

import { mexcContractFetchCandidatesAsync } from "./mexcContractResolver";
import { getContractLastPricePublic } from "./mexcFuturesClient";
import { fetchAllContractTickers, type MexcTickerRow } from "./mexcMarkets";

function normContractSymbol(sym: string): string {
  return sym.trim().toUpperCase();
}

type TickerWithMark = MexcTickerRow & { fairPrice?: number; indexPrice?: number };

function pickMarkPrice(row: TickerWithMark | null | undefined): number | null {
  if (!row) return null;
  for (const v of [row.lastPrice, row.fairPrice, row.indexPrice]) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/** ราคา mark จาก MEXC perp — key = contract symbol ตาม log เช่น TON_USDT */
export async function fetchAutoOpenMarkPrices(contractSymbols: string[]): Promise<Record<string, number>> {
  const logSymbols = collectAutoOpenContractSymbols(contractSymbols);
  if (logSymbols.length === 0) return {};

  const wanted = new Set(logSymbols);
  const fetchKeyToLogKeys = new Map<string, string[]>();
  for (const logSym of logSymbols) {
    const candidates = await mexcContractFetchCandidatesAsync(logSym);
    for (const fetchSym of candidates) {
      const list = fetchKeyToLogKeys.get(fetchSym) ?? [];
      if (!list.includes(logSym)) list.push(logSym);
      fetchKeyToLogKeys.set(fetchSym, list);
    }
  }

  const out: Record<string, number> = {};

  try {
    const tickers = await fetchAllContractTickers();
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i] as TickerWithMark;
      const fetchSym = t.symbol ? normContractSymbol(t.symbol) : "";
      const logKeys = fetchSym ? fetchKeyToLogKeys.get(fetchSym) : undefined;
      if (!fetchSym || !logKeys?.length) continue;
      const price = pickMarkPrice(t);
      if (price == null) continue;
      for (let j = 0; j < logKeys.length; j++) {
        const logSym = logKeys[j]!;
        out[logSym] = price;
        wanted.delete(logSym);
      }
      if (wanted.size === 0) return out;
    }
  } catch {
    /* fallback ต่อสัญญา */
  }

  if (wanted.size === 0) return out;

  await Promise.all(
    Array.from(wanted).map(async (logSym) => {
      for (const fetchSym of await mexcContractFetchCandidatesAsync(logSym)) {
        const price = await getContractLastPricePublic(fetchSym);
        if (price != null) {
          out[logSym] = price;
          return;
        }
      }
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
