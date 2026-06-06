import type { AutoOpenOrderLogRow } from "@/lib/autoOpenOrderLogClient";

export function autoOpenMexcActiveKey(contractSymbol: string, side: "long" | "short"): string {
  return `${contractSymbol.trim().toUpperCase()}|${side}`;
}

export function parseAutoOpenMexcActiveKey(key: string): { contractSymbol: string; side: "long" | "short" } | null {
  const parts = key.split("|");
  if (parts.length !== 2) return null;
  const contractSymbol = parts[0]?.trim().toUpperCase();
  const side = parts[1];
  if (!contractSymbol || (side !== "long" && side !== "short")) return null;
  return { contractSymbol, side };
}

type MexcOpenLike = { symbol: string; positionType: number; state?: number; holdVol?: number };

/** จาก MEXC open positions — positionType 1=long 2=short */
export function mexcOpenPositionActiveKeys(rows: MexcOpenLike[]): Set<string> {
  const out = new Set<string>();
  for (const p of rows) {
    if (p.state != null && p.state !== 1) continue;
    if (p.holdVol != null && !(Number(p.holdVol) > 0)) continue;
    const sym = p.symbol?.trim().toUpperCase();
    if (!sym) continue;
    const side = p.positionType === 1 ? "long" : p.positionType === 2 ? "short" : null;
    if (!side) continue;
    out.add(autoOpenMexcActiveKey(sym, side));
  }
  return out;
}

type BotActiveLike = { contractSymbol: string; side: "long" | "short" };

export function botAutoTradeActiveKeys(actives: BotActiveLike[]): Set<string> {
  const out = new Set<string>();
  for (const a of actives) {
    out.add(autoOpenMexcActiveKey(a.contractSymbol, a.side));
  }
  return out;
}

export function mergeMexcActiveKeys(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) {
    for (const k of s) out.add(k);
  }
  return out;
}

/** แถว success ล่าสุดต่อ contract+side ที่ยังมี position บน MEXC */
export function annotateAutoOpenRowsWithMexcActive(
  rows: AutoOpenOrderLogRow[],
  activeKeys: Set<string>,
): AutoOpenOrderLogRow[] {
  if (activeKeys.size === 0) {
    return rows.map((r) => ({ ...r, mexcActive: false }));
  }

  const latestSuccessIdByKey = new Map<string, string>();
  for (const r of rows) {
    if (r.outcome !== "success" || (r.side !== "long" && r.side !== "short")) continue;
    const k = autoOpenMexcActiveKey(r.contractSymbol, r.side);
    if (!latestSuccessIdByKey.has(k)) {
      latestSuccessIdByKey.set(k, r.id);
    }
  }

  return rows.map((r) => {
    if (r.outcome !== "success" || (r.side !== "long" && r.side !== "short")) {
      return { ...r, mexcActive: false };
    }
    const k = autoOpenMexcActiveKey(r.contractSymbol, r.side);
    const isLatest = latestSuccessIdByKey.get(k) === r.id;
    const closed =
      r.mexcRealisedPnlUsdt != null && Number.isFinite(r.mexcRealisedPnlUsdt);
    return {
      ...r,
      mexcActive: isLatest && activeKeys.has(k) && !closed,
    };
  });
}
