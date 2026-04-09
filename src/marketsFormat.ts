export function formatUsd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

export function formatFunding(rate: number): string {
  const pct = rate * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(4)}%`;
}

export function formatFundingCycleHours(h: number | null): string {
  if (h == null || h <= 0) return "—";
  return `${h}h`;
}

/** แสดง funding จาก ticker + รอบ (ชม.) ในวงเล็บ เช่น +0.0100% (8h) */
export function formatFundingWithCycleHours(rate: number, cycleHours: number | null): string {
  const rateStr = formatFunding(rate);
  if (cycleHours == null || cycleHours <= 0) return rateStr;
  return `${rateStr} (${cycleHours}h)`;
}

/** สีตามทิศทาง funding: long จ่ายมาก = แดงเข้ม, short จ่ายมาก = เขียว, ใกล้ศูนย์ = กลาง */
export function fundingRateVisualClass(rate: number): "fundingHotLong" | "fundingHotShort" | "fundingNeutral" {
  const t = 0.00015;
  if (rate > t) return "fundingHotLong";
  if (rate < -t) return "fundingHotShort";
  return "fundingNeutral";
}

/** คำนวณเกณฑ์ max pos ต่ำ (liquidity แคบ) จากชุดแถวที่แสดง — ล่าง ~15% */
export function maxPositionWarnThreshold(usdts: Array<number | null | undefined>): number | null {
  const vals = usdts.filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);
  if (vals.length < 5) return null;
  const idx = Math.max(0, Math.floor(vals.length * 0.15) - 1);
  return vals[idx] ?? null;
}

/** เกณฑ์ maxVol สัญญาต่ำ (ล่าง ~15%) — ใช้เตือนสภาพคล่องใน LINE / logic อื่น */
export function maxVolContractWarnThreshold(maxVols: number[]): number | null {
  const vals = maxVols.filter((x) => typeof x === "number" && x > 0).sort((a, b) => a - b);
  if (vals.length < 5) return null;
  const idx = Math.max(0, Math.floor(vals.length * 0.15) - 1);
  return vals[idx] ?? null;
}

/** ข้อความแจ้งเตือน LINE: สรุปทิศทางต้นทุนถือสถานะ (สอดคล้อง fundingRateVisualClass) */
export function fundingRateLineEmoji(rate: number): string {
  const c = fundingRateVisualClass(rate);
  if (c === "fundingHotLong") return "🔴";
  if (c === "fundingHotShort") return "🟢";
  return "📊";
}

export function fundingSettleTitle(ms: number | null): string | undefined {
  if (ms == null || ms <= 0) return undefined;
  try {
    return `ตัด funding ถัดไป (UTC): ${new Date(ms).toISOString()}`;
  } catch {
    return undefined;
  }
}

export function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 10) return n.toFixed(2);
  return n.toFixed(3);
}
