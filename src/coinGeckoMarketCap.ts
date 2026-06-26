import axios, { isAxiosError } from "axios";
import { binanceUsdtPerpBase } from "@/lib/binancePerpBase";
import {
  coinGeckoIdForBinancePerpBase,
  coinGeckoSymbolCandidatesForBinancePerpBase,
} from "@/lib/coinGeckoMcapResolve";

const COINGECKO = "https://api.coingecko.com/api/v3";
const CMC_PRO_BASE = "https://pro-api.coinmarketcap.com";
const TIMEOUT_MS = 12_000;

type MarketsRow = { market_cap?: number | null; id?: string };

function pickBestMarketCap(rows: MarketsRow[] | null | undefined): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let best: number | null = null;
  for (const row of rows) {
    const mc = row.market_cap;
    if (typeof mc === "number" && Number.isFinite(mc) && mc > 0) {
      if (best == null || mc > best) best = mc;
    }
  }
  return best;
}

function cmcProApiKey(): string | undefined {
  const k = process.env.CMC_PRO_API_KEY?.trim();
  return k || undefined;
}

async function fetchCoinGeckoMarketsByIds(ids: string[]): Promise<number | null> {
  const uniq = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))];
  if (uniq.length === 0) return null;
  try {
    const { data } = await axios.get<MarketsRow[]>(`${COINGECKO}/coins/markets`, {
      timeout: TIMEOUT_MS,
      params: { vs_currency: "usd", ids: uniq.join(",") },
    });
    return pickBestMarketCap(data);
  } catch {
    return null;
  }
}

async function fetchCoinGeckoMarketsBySymbols(symbols: string[]): Promise<number | null> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (uniq.length === 0) return null;
  let best: number | null = null;
  for (const sym of uniq) {
    try {
      const { data } = await axios.get<MarketsRow[]>(`${COINGECKO}/coins/markets`, {
        timeout: TIMEOUT_MS,
        params: { vs_currency: "usd", symbols: sym },
      });
      const mc = pickBestMarketCap(data);
      if (mc != null && (best == null || mc > best)) best = mc;
    } catch {
      /* try next symbol */
    }
  }
  return best;
}

async function fetchCmcMarketCapUsdByBase(base: string): Promise<number | null> {
  const key = cmcProApiKey();
  if (!key) return null;
  const sym = base.trim().toUpperCase();
  if (!sym) return null;
  try {
    const { data } = await axios.get<{
      data?: Record<string, Array<{ quote?: { USD?: { market_cap?: number } } }>>;
    }>(`${CMC_PRO_BASE}/v2/cryptocurrency/quotes/latest`, {
      timeout: TIMEOUT_MS,
      headers: { "X-CMC_PRO_API_KEY": key },
      params: { symbol: sym, convert: "USD" },
    });
    const rows = data?.data?.[sym];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    let best: number | null = null;
    for (const row of rows) {
      const mc = row.quote?.USD?.market_cap;
      if (typeof mc === "number" && Number.isFinite(mc) && mc > 0) {
        if (best == null || mc > best) best = mc;
      }
    }
    return best;
  } catch (e) {
    if (!isAxiosError(e) || e.response?.status !== 429) {
      console.error("[coinGeckoMarketCap] CMC", sym, e instanceof Error ? e.message : e);
    }
    return null;
  }
}

/** Market cap USD จาก CoinGecko (id map ก่อน) · fallback CMC · fallback symbols */
export async function fetchCoinGeckoMarketCapUsd(baseSymbol: string): Promise<number | null> {
  const base = baseSymbol.trim().toUpperCase();
  if (!base) return null;

  const mappedId = coinGeckoIdForBinancePerpBase(base);
  if (mappedId) {
    const byId = await fetchCoinGeckoMarketsByIds([mappedId]);
    if (byId != null) return byId;
  }

  const cmc = await fetchCmcMarketCapUsdByBase(base);
  if (cmc != null) return cmc;

  const m1000 = base.match(/^1000(.+)$/);
  if (m1000) {
    const innerCmc = await fetchCmcMarketCapUsdByBase(m1000[1]!);
    if (innerCmc != null) return innerCmc;
  }

  return fetchCoinGeckoMarketsBySymbols(coinGeckoSymbolCandidatesForBinancePerpBase(base));
}

/** Market cap USD จาก Binance symbol เช่น TONUSDT */
export async function fetchBinancePerpMarketCapUsd(binanceSymbol: string): Promise<number | null> {
  const base = binanceUsdtPerpBase(binanceSymbol);
  if (!base) return null;
  return fetchCoinGeckoMarketCapUsd(base);
}
