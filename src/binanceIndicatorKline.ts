import axios, { isAxiosError } from "axios";

/** Binance USDT-M perpetual — เดียวกันทั้ง ticker และ kline */
const FAPI = "https://fapi.binance.com";

/** ปิดการเรียก Binance FAPI ทั้งหมด (klines + ticker 24hr) — ใช้เมื่อโฮสต์ได้ HTTP 451 geo (เช่น Vercel us-east) */
export function isBinanceIndicatorFapiEnabled(): boolean {
  const raw = process.env.BINANCE_INDICATOR_FAPI_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/** เรียกก่อนแต่ละรอบที่ดึงหลายสัญลักษณ์ — ให้ log 451 ได้ครั้งเดียวต่อรอบ */
export function resetBinanceIndicatorFapi451LogDedupe(): void {
  geo451LoggedThisBatch = false;
}

let geo451LoggedThisBatch = false;

function isBinance451Geo(e: unknown): boolean {
  return isAxiosError(e) && e.response?.status === 451;
}

function axiosBrief(e: unknown): string {
  if (!isAxiosError(e)) return e instanceof Error ? e.message : String(e);
  const st = e.response?.status;
  const data = e.response?.data as { msg?: string } | undefined;
  const msg = typeof data?.msg === "string" ? data.msg : e.message;
  const tail = msg.length > 180 ? `${msg.slice(0, 180)}…` : msg;
  return st != null ? `HTTP ${st}: ${tail}` : tail;
}

function logBinance451Once(ctx: string, sym: string): void {
  if (geo451LoggedThisBatch) return;
  geo451LoggedThisBatch = true;
  console.warn(
    `[binanceIndicatorKline] ${ctx} ${sym}: Binance FAPI HTTP 451 (geo-restricted host). ` +
      "Set BINANCE_INDICATOR_FAPI_ENABLED=0 or deploy to a region Binance allows. " +
      "Further 451s in this run are silent."
  );
}

export type BinanceKlinePack = {
  close: number[];
  /** high / low ต่อแท่ง — ใช้ fractal / divergence (ตรง index กับ close) */
  high: number[];
  low: number[];
  /** Unix sec — open time ของแท่ง (ตรง index กับ close) */
  timeSec: number[];
};

const KLINE_LIMIT = 150;

/** TF สำหรับ public feed — ตรงกับ Binance interval string */
export type BinanceIndicatorTf = "1h" | "4h";

const INTERVAL: Record<BinanceIndicatorTf, string> = {
  "1h": "1h",
  "4h": "4h",
};

function parseKlineRows(rows: unknown): BinanceKlinePack | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const close: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const timeSec: number[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const openMs = Number(row[0]);
    const hi = Number(row[2]);
    const lo = Number(row[3]);
    const c = Number(row[4]);
    if (!Number.isFinite(openMs) || !Number.isFinite(c)) continue;
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    timeSec.push(Math.floor(openMs / 1000));
    high.push(hi);
    low.push(lo);
    close.push(c);
  }
  if (close.length < 10) return null;
  return { close, high, low, timeSec };
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
  if (!isBinanceIndicatorFapiEnabled()) return null;
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
    if (isBinance451Geo(e)) {
      logBinance451Once("klines", sym);
    } else {
      console.error("[binanceIndicatorKline] klines", sym, axiosBrief(e));
    }
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
  if (!isBinanceIndicatorFapiEnabled()) return [];
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
    if (isBinance451Geo(e)) {
      logBinance451Once("ticker/24hr", "—");
    } else {
      console.error("[binanceIndicatorKline] ticker 24hr", axiosBrief(e));
    }
    return [];
  }
}
