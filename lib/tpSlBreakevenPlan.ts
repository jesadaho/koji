/** ค่า default แผนบังทุน (SL หลัง ROI ถึงเกณฑ์) — แยกจาก TP1% */
export const DEFAULT_SL_ARM_ROI_PCT = 10;
/** SL ห่างจาก entry เป็น % ราคาสวน (0 = @entry พอดี) */
export const DEFAULT_SL_ENTRY_OFFSET_PCT = 0;
/** ครบช่วงนี้หลังเปิด + ยังเขียว → ตั้ง SL @entry ทันที */
export const SL_BREAKEVEN_AFTER_24H_IF_GREEN_MS = 24 * 3600 * 1000;

export type TpSlBreakevenConfig = {
  slArmRoiPct: number;
  slEntryOffsetPct: number;
};

export type TpSlBreakevenPlanFields = {
  slAtEntryArmRoiPct?: number;
  slAtEntryOffsetPct?: number;
};

export function slAtEntryArmPctFromPlan(plan: TpSlBreakevenPlanFields): number {
  return parseSlArmRoiPct(plan.slAtEntryArmRoiPct, DEFAULT_SL_ARM_ROI_PCT);
}

export function slEntryOffsetPctFromPlan(plan: TpSlBreakevenPlanFields): number {
  return parseSlEntryOffsetPct(plan.slAtEntryOffsetPct, DEFAULT_SL_ENTRY_OFFSET_PCT);
}

export function parseSlArmRoiPct(
  v: unknown,
  fallback: number = DEFAULT_SL_ARM_ROI_PCT,
): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100) return v;
  return fallback;
}

export function parseSlEntryOffsetPct(
  v: unknown,
  fallback: number = DEFAULT_SL_ENTRY_OFFSET_PCT,
): number {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 50) return v;
  return fallback;
}

/** ราคา trigger plan SL บังทุน — LONG ต่ำกว่า entry · SHORT สูงกว่า entry */
export function computeSlTriggerPrice(
  side: "long" | "short",
  entry: number,
  offsetPct: number,
): number {
  if (!(entry > 0)) return NaN;
  const m = Math.max(0, offsetPct) / 100;
  return side === "long" ? entry * (1 - m) : entry * (1 + m);
}

export function breakevenSlTriggered(
  side: "long" | "short",
  entry: number,
  offsetPct: number,
  high: number,
  low: number,
): boolean {
  const trigger = computeSlTriggerPrice(side, entry, offsetPct);
  if (!(trigger > 0)) return false;
  if (side === "long") return low <= trigger;
  return high >= trigger;
}

/** ขาดทุน % ราคาของส่วนที่เหลือเมื่อโดน SL บังทุน */
export function slBreakevenRemainderLossPct(offsetPct: number): number {
  return -Math.max(0, offsetPct);
}

/** ครบ 24 ชม. หลังเปิดและยังเขียว (favorable move % > 0) */
export function slBreakevenDueAfter24hIfGreen(
  openedAtMs: number,
  favorableMovePct: number,
  nowMs: number,
): boolean {
  return (
    nowMs - openedAtMs >= SL_BREAKEVEN_AFTER_24H_IF_GREEN_MS &&
    Number.isFinite(favorableMovePct) &&
    favorableMovePct > 0
  );
}

export function formatSlBreakevenTriggerLabel(
  side: "long" | "short",
  entry: number,
  offsetPct: number,
  fmtPrice: (p: number) => string,
): string {
  const trigger = computeSlTriggerPrice(side, entry, offsetPct);
  if (!(trigger > 0)) return "—";
  if (offsetPct <= 0) return `@ ${fmtPrice(entry)} (entry)`;
  const dir = side === "long" ? "ลง" : "ขึ้น";
  return `@ ${fmtPrice(trigger)} (entry ${dir} ${offsetPct}%)`;
}
