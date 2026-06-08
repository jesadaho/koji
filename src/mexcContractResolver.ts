import axios from "axios";
import { BASE_TO_CONTRACT, resolveMexcContractFromBase } from "./coinMap";
import { mexcFuturesBaseUrl } from "./mexcFuturesClient";

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type MexcContractResolverRow = {
  symbol?: string;
  baseCoin?: string;
  baseCoinName?: string;
  settleCoin?: string;
  quoteCoin?: string;
  futureType?: number;
  state?: number;
};

type MexcContractIndex = {
  loadedAtMs: number;
  byBaseCoinName: Map<string, string>;
  symbolSet: Set<string>;
};

let indexCache: MexcContractIndex | null = null;
let indexLoadPromise: Promise<MexcContractIndex> | null = null;

function cacheTtlMs(): number {
  const raw = process.env.MEXC_CONTRACT_RESOLVER_CACHE_MS?.trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 60_000) return Math.floor(n);
  return DEFAULT_CACHE_TTL_MS;
}

function normBaseKey(s: string): string {
  return s.trim().toUpperCase().replace(/_/g, "");
}

function isActiveUsdtPerp(row: MexcContractResolverRow): boolean {
  const sym = row.symbol?.trim();
  if (!sym || !sym.endsWith("_USDT")) return false;
  if (row.state != null && row.state !== 0) return false;
  if (row.settleCoin && row.settleCoin !== "USDT") return false;
  if (row.quoteCoin && row.quoteCoin !== "USDT") return false;
  if (row.futureType != null && row.futureType !== 1) return false;
  return true;
}

function buildIndex(rows: MexcContractResolverRow[]): MexcContractIndex {
  const byBaseCoinName = new Map<string, string>();
  const symbolSet = new Set<string>();
  for (const row of rows) {
    const sym = row.symbol?.trim();
    if (!sym) continue;
    symbolSet.add(sym);
    if (!isActiveUsdtPerp(row)) continue;
    const name = normBaseKey(row.baseCoinName ?? "");
    if (!name || byBaseCoinName.has(name)) continue;
    byBaseCoinName.set(name, sym);
  }
  return { loadedAtMs: Date.now(), byBaseCoinName, symbolSet };
}

async function fetchAllMexcContractResolverRows(): Promise<MexcContractResolverRow[]> {
  const url = `${mexcFuturesBaseUrl()}/api/v1/contract/detail`;
  try {
    const { data } = await axios.get<{
      success: boolean;
      data?: MexcContractResolverRow | MexcContractResolverRow[];
    }>(url, { timeout: 60_000, validateStatus: () => true });
    if (!data?.success || data.data == null) return [];
    return Array.isArray(data.data) ? data.data : [data.data];
  } catch (e) {
    console.error("[mexcContractResolver] fetch detail failed", e);
    return [];
  }
}

/** โหลด index MEXC — cache TTL ค่าเริ่มต้น 6 ชม. (MEXC_CONTRACT_RESOLVER_CACHE_MS) */
export async function getMexcContractIndex(forceRefresh = false): Promise<MexcContractIndex> {
  const ttl = cacheTtlMs();
  if (!forceRefresh && indexCache && Date.now() - indexCache.loadedAtMs < ttl) {
    return indexCache;
  }
  if (!forceRefresh && indexLoadPromise) return indexLoadPromise;

  indexLoadPromise = (async () => {
    try {
      const rows = await fetchAllMexcContractResolverRows();
      const built = buildIndex(rows);
      indexCache = built;
      return built;
    } catch (e) {
      console.error("[mexcContractResolver] load failed", e);
      if (indexCache) return indexCache;
      return { loadedAtMs: Date.now(), byBaseCoinName: new Map(), symbolSet: new Set() };
    } finally {
      indexLoadPromise = null;
    }
  })();

  return indexLoadPromise;
}

/** ผู้สมัครสัญญาแบบ static (alias + {BASE}_USDT) */
export function staticMexcContractCandidates(base: string): string[] {
  const b = normBaseKey(base);
  if (!b) return [];
  const alias = BASE_TO_CONTRACT[b.toLowerCase()];
  const fallback = `${b}_USDT`;
  const out: string[] = [];
  if (alias) out.push(alias);
  if (!out.includes(fallback)) out.push(fallback);
  return out;
}

/**
 * แปลง base (เช่น CBRS) → สัญญา MEXC จริง
 * 1) index จาก baseCoinName (เช่น CBRS → CBRSSTOCK_USDT)
 * 2) static candidate ที่มีใน index
 * 3) legacy static ถ้า index ว่าง (API ล้ม)
 */
export async function resolveMexcContractFromBaseAsync(base: string): Promise<string | null> {
  const b = normBaseKey(base);
  if (!b) return null;

  const index = await getMexcContractIndex();
  const fromIndex = index.byBaseCoinName.get(b);
  if (fromIndex) return fromIndex;

  for (const cand of staticMexcContractCandidates(b)) {
    if (index.symbolSet.has(cand)) return cand;
  }

  if (index.symbolSet.size === 0) {
    return resolveMexcContractFromBase(b);
  }
  return null;
}

/** Binance USDT-M (เช่น CBRSUSDT) → สัญญา MEXC */
export async function resolveMexcContractFromBinanceSymbolAsync(
  binanceSymbol: string,
): Promise<string | null> {
  const sym = binanceSymbol.trim().toUpperCase();
  if (!sym) return null;
  if (sym.includes("_") && sym.endsWith("_USDT")) return sym;
  if (!sym.endsWith("USDT") || sym.length < 5) return null;
  return resolveMexcContractFromBaseAsync(sym.slice(0, -4));
}

/** ลำดับสัญญาสำหรับดึง mark/ticker */
export async function mexcContractFetchCandidatesAsync(logOrBinanceSymbol: string): Promise<string[]> {
  const sym = logOrBinanceSymbol.trim().toUpperCase();
  let base = sym;
  if (sym.endsWith("USDT") && !sym.includes("_")) {
    base = sym.slice(0, -4);
  } else if (sym.includes("_")) {
    base = sym.split("_")[0] ?? sym;
  }

  const resolved = await resolveMexcContractFromBaseAsync(base);
  const staticCands = staticMexcContractCandidates(base);
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };

  if (sym.includes("_")) add(sym);
  else add(`${normBaseKey(base)}_USDT`);
  for (const c of staticCands) add(c);
  if (resolved) add(resolved);
  return out;
}
