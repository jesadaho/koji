const EPS = 1e-10;

function fmtPrice(p: number): string {
  return p.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function fmtUsd(p: number): string {
  return `$${fmtPrice(p)}`;
}

export type TrailingStepResult =
  | { fired: false; nextAnchor: number }
  | { fired: true; prevAnchor: number; price: number; nextAnchor: number };

/** เปรียบเทียบราคากับ anchor แบบ trailing — ใช้ร่วมกับ pct step และ portfolio trailing */
export function evaluateTrailingPriceStep(
  price: number,
  anchor: number | undefined,
  stepPct: number
): TrailingStepResult {
  const p = price;
  const a = anchor ?? p;
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(a) || a <= 0) {
    return { fired: false, nextAnchor: a };
  }
  const diffPct = (Math.abs(p - a) / a) * 100;
  if (diffPct + EPS >= stepPct) {
    return { fired: true, prevAnchor: a, price: p, nextAnchor: p };
  }
  return { fired: false, nextAnchor: anchor ?? p };
}

export function buildTrailingAlertMessage(
  label: string,
  prevAnchor: number,
  price: number,
  options?: { titlePrefix?: string }
): string {
  const prefix = options?.titlePrefix ?? "Price Alert";
  const deltaPct = ((price - prevAnchor) / prevAnchor) * 100;
  const pctStr =
    deltaPct >= 0 ? `+${Math.abs(deltaPct).toFixed(1)}%` : `-${Math.abs(deltaPct).toFixed(1)}%`;

  const head =
    deltaPct >= 0 ? `🚀 ${prefix}: [${label}] (${pctStr})` : `🔴 ${prefix}: [${label}] (${pctStr})`;

  const body = deltaPct >= 0 ? `ขยับขึ้นจากเตือนครั้งก่อนแล้ว!` : `ขยับลงจากเตือนครั้งก่อนแล้ว!`;

  return [
    head,
    "",
    body,
    "",
    `🔹 ราคาปัจจุบัน: ${fmtUsd(price)}`,
    `🔹 นับจากเตือนครั้งก่อน: ${fmtUsd(prevAnchor)}`,
  ].join("\n");
}

export function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}
