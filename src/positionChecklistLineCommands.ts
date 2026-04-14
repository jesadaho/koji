export type PositionDirection = "short" | "long";

export type ParsedPositionChecklist = {
  direction: PositionDirection;
  /** เช่น btc, BTC_USDT */
  rawSymbol: string;
  leverage: number | null;
};

function normalizeDirection(s: string): PositionDirection | null {
  const x = s.trim().toLowerCase();
  if (x === "short" || x === "ชอต" || x === "shot") return "short";
  if (x === "long") return "long";
  return null;
}

/** เช่น short BTC · long eth · ชอต btc 5x */
export function parsePositionChecklist(text: string): ParsedPositionChecklist | null {
  const t = text.trim();
  if (!t) return null;

  const m = t.match(/^(short|long|ชอต|shot)\s+(\S+?)(?:\s+([\d.,]+)\s*x)?\s*$/i);
  if (!m) return null;

  const dir = normalizeDirection(m[1]!);
  if (!dir) return null;

  const rawSymbol = m[2]!.trim();
  if (!rawSymbol) return null;

  let leverage: number | null = null;
  if (m[3] != null && m[3] !== "") {
    const n = Number(String(m[3]).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) leverage = n;
  }

  return { direction: dir, rawSymbol, leverage };
}
