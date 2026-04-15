/** แบ่งตามปริมาณซื้อขาย 24h (amount24 USDT จาก MEXC) */
export type SparkVolBand = "high" | "mid" | "low" | "unknown";

/** พร็อกซีมาร์เก็ตแคป: tier1 = BTC/ETH, tier2 = โทเคนใหญ่ (ตั้ง env ได้), tier3 = อื่นๆ */
export type SparkMcapBand = "tier1" | "tier2" | "tier3" | "unknown";

const DEFAULT_TIER2 =
  "BNB,SOL,XRP,ADA,DOGE,TRX,LINK,AVAX,DOT,POL,LTC,SHIB,UNI,ATOM,NEAR,APT,ARB,OP,WIF,PEPE";

function parseThreshold(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** amount24 USDT — ค่าเริ่มต้น high ≥ 150M, mid ≥ 30M */
export function classifySparkVolBand(amount24Usdt: number | null | undefined): SparkVolBand {
  if (amount24Usdt == null || !Number.isFinite(amount24Usdt) || amount24Usdt < 0) return "unknown";
  const high = parseThreshold("SPARK_VOL_TIER_HIGH_USDT", 150_000_000);
  const mid = parseThreshold("SPARK_VOL_TIER_MID_USDT", 30_000_000);
  if (amount24Usdt >= high) return "high";
  if (amount24Usdt >= mid) return "mid";
  return "low";
}

export function baseAssetFromContract(contractSymbol: string): string {
  return contractSymbol.replace(/_USDT$/i, "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function tier2Set(): Set<string> {
  const raw = process.env.SPARK_MCAP_TIER2_BASES?.trim();
  const s = raw && raw.length > 0 ? raw : DEFAULT_TIER2;
  return new Set(
    s
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean)
  );
}

/** พร็อกซีจากฐานสินทรัพย์ — ไม่ใช่มาร์เก็ตแคปจริงจาก CoinGecko */
export function classifySparkMcapBand(contractSymbol: string): SparkMcapBand {
  const base = baseAssetFromContract(contractSymbol);
  if (!base) return "unknown";
  if (base === "BTC" || base === "ETH") return "tier1";
  if (tier2Set().has(base)) return "tier2";
  return "tier3";
}

export function volBandLabelTh(b: SparkVolBand): string {
  if (b === "high") return "Vol สูง";
  if (b === "mid") return "Vol กลาง";
  if (b === "low") return "Vol ต่ำ";
  return "Vol ไม่ระบุ";
}

export function mcapBandLabelTh(b: SparkMcapBand): string {
  if (b === "tier1") return "มาร์ก. BTC/ETH";
  if (b === "tier2") return "มาร์ก. โทเคนใหญ่ (tier2)";
  if (b === "tier3") return "มาร์ก. alt ทั่วไป";
  return "มาร์ก. ไม่ระบุ";
}
