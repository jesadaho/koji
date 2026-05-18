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

export function contractSymbolToPairLabel(contractSymbol: string): string {
  const s = contractSymbol.trim().toUpperCase();
  const m = s.match(/^(.+)_USDT$/);
  return m ? `${m[1]}/USDT` : contractSymbol;
}

function fmtSignedUsd(n: number, digits = 2): string {
  const sign = n < 0 ? "-" : "+";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatPctSigned(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export type PortfolioTrailingPositionPnl = {
  entryPrice: number | null;
  unrealizedUsdt: number | null;
  pnlPct: number | null;
};

/** คำนวณ unrealized PnL จาก mark + ข้อมูล position (ไม่เรียก API เพิ่ม) */
export function computePositionUnrealizedFromMark(
  pos: {
    positionType: number;
    holdVol: number;
    holdAvgPrice?: number;
    openAvgPrice?: number;
    im?: number;
    oim?: number;
  },
  mark: number,
  contractSize: number | null | undefined
): PortfolioTrailingPositionPnl {
  const long = pos.positionType === 1;
  const avgRaw =
    numFromUnknown(pos.holdAvgPrice) ?? numFromUnknown(pos.openAvgPrice);
  const entryPrice = avgRaw != null && avgRaw > 0 ? avgRaw : null;
  const vol = Number(pos.holdVol);
  const volOk = Number.isFinite(vol) && vol > 0;
  const cs =
    contractSize != null && Number.isFinite(contractSize) && contractSize > 0
      ? contractSize
      : null;

  if (entryPrice == null || !volOk || cs == null || !(mark > 0)) {
    return { entryPrice, unrealizedUsdt: null, pnlPct: null };
  }

  const dir = long ? 1 : -1;
  const unrealizedUsdt = dir * (mark - entryPrice) * vol * cs;
  const im = numFromUnknown(pos.im) ?? numFromUnknown(pos.oim);
  let pnlPct: number | null = null;
  if (im != null && im > 0) {
    pnlPct = (unrealizedUsdt / im) * 100;
  } else {
    const notional = vol * cs * mark;
    if (notional > 0) pnlPct = (unrealizedUsdt / notional) * 100;
  }

  return { entryPrice, unrealizedUsdt, pnlPct };
}

function numFromUnknown(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

export function buildPortfolioTrailingAlertMessage(
  prevAnchor: number,
  price: number,
  ctx: {
    pairLabel: string;
    side: "LONG" | "SHORT";
    entryPrice: number | null;
    unrealizedUsdt: number | null;
    pnlPct: number | null;
  }
): string {
  const deltaPct = ((price - prevAnchor) / prevAnchor) * 100;
  const pctStr =
    deltaPct >= 0 ? `+${Math.abs(deltaPct).toFixed(1)}%` : `-${Math.abs(deltaPct).toFixed(1)}%`;

  const head =
    deltaPct >= 0
      ? `🚀 Portfolio trailing: [${ctx.pairLabel}] ${ctx.side} (${pctStr})`
      : `🔴 Portfolio trailing: [${ctx.pairLabel}] ${ctx.side} (${pctStr})`;

  const body =
    deltaPct >= 0 ? `ขยับขึ้นจากเตือนครั้งก่อนแล้ว!` : `ขยับลงจากเตือนครั้งก่อนแล้ว!`;

  const priceLine =
    ctx.entryPrice != null
      ? `🔹 ราคา: ${fmtUsd(price)} (Entry: ${fmtUsd(ctx.entryPrice)})`
      : `🔹 ราคาปัจจุบัน: ${fmtUsd(price)}`;

  const lines = [head, "", body, "", priceLine];

  if (ctx.unrealizedUsdt != null && Number.isFinite(ctx.unrealizedUsdt)) {
    const pnlIcon = ctx.unrealizedUsdt >= 0 ? "🟢" : "🔴";
    const pctPart =
      ctx.pnlPct != null && Number.isFinite(ctx.pnlPct)
        ? ` (${formatPctSigned(ctx.pnlPct)})`
        : "";
    lines.push(`🔹 PnL: ${pnlIcon} ${fmtSignedUsd(ctx.unrealizedUsdt)}${pctPart}`);
  }

  lines.push(`🔹 นับจากเตือนครั้งก่อน: ${fmtUsd(prevAnchor)}`);

  return lines.join("\n");
}
