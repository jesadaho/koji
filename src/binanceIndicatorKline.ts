import axios from "axios";

/** Binance USDT-M perpetual — เดียวกันทั้ง ticker และ kline */
const FAPI = "https://fapi.binance.com";

export type BinanceKlinePack = {
  close: number[];
  /** Unix sec — open time ของแท่ง (ตรง index กับ close) */
  timeSec: number[];
};

const KLINE_LIMIT = 150;

/** TF สำหรับ public feed v1 — ตรงกับ Binance interval string */
export type BinanceIndicatorTf = "1h";

const INTERVAL: Record<BinanceIndicatorTf, string> = {
  "1h": "1h",
};

function parseKlineRows(rows: unknown): BinanceKlinePack | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const close: number[] = [];
  const timeSec: number[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const openMs = Number(row[0]);
    const c = Number(row[4]);
    if (!Number.isFinite(openMs) || !Number.isFinite(c)) continue;
    timeSec.push(Math.floor(openMs / 1000));
    close.push(c);
  }
  if (close.length < 10) return null;
  return { close, timeSec };
}

/**
 * Kline USDT-M จาก Binance Futures (เช่น BTCUSDT, interval 1h)
 */
export async function fetchBinanceUsdmKlines(
  symbol: string,
  tf: BinanceIndicatorTf
): Promise<BinanceKlinePack | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const { data } = await axios.get<unknown[]>(`${FAPI}/fapi/v1/klines`, {
      timeout: 20_000,
      params: {
        symbol: sym,
        interval: INTERVAL[tf],
        limit: KLINE_LIMIT,
      },
    });
    return parseKlineRows(data);
  } catch (e) {
    console.error("[binanceIndicatorKline] klines", sym, e);
    return null;
  }
}

type Ticker24hRow = {
  symbol?: string;
  quoteVolume?: string;
  volume?: string;
};

/** สัญลักษณ์ที่ไม่นับเป็น alt สำหรับ top list */
const EXCLUDED_TOP_SYMBOLS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "USDCUSDT",
  "FDUSDUSDT",
  "TUSDUSDT",
  "BUSDUSDT",
  "DAIUSDT",
  "EURUSDT",
  "GBPUSDT",
]);

/**
 * ดึง Top N สัญญา USDT-M (ยกเว้น BTC/ETH และคู่ stable ที่กำหนด) เรียงจาก quoteVolume สูงสุด
 */
export async function fetchTopUsdmUsdtSymbolsByQuoteVolume(topN: number): Promise<string[]> {
  if (topN <= 0) return [];
  try {
    const { data } = await axios.get<Ticker24hRow[]>(`${FAPI}/fapi/v1/ticker/24hr`, {
      timeout: 45_000,
    });
    if (!Array.isArray(data)) return [];
    const rows = data
      .filter((r) => {
        const s = r.symbol?.trim().toUpperCase();
        if (!s || !s.endsWith("USDT")) return false;
        if (EXCLUDED_TOP_SYMBOLS.has(s)) return false;
        return true;
      })
      .map((r) => ({
        symbol: r.symbol!.trim().toUpperCase(),
        qv: Number(r.quoteVolume ?? r.volume ?? 0),
      }))
      .filter((r) => Number.isFinite(r.qv) && r.qv > 0)
      .sort((a, b) => b.qv - a.qv);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (out.length >= topN) break;
      if (seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      out.push(r.symbol);
    }
    return out;
  } catch (e) {
    console.error("[binanceIndicatorKline] ticker 24hr", e);
    return [];
  }
}
