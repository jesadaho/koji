export type PositionDirection = "short" | "long";

export type ParsedPositionChecklist = {
  direction: PositionDirection;
  /** เช่น btc, BTC_USDT */
  rawSymbol: string;
  leverage: number | null;
};

/** เช่น `check btc` · `check eth long` — ไม่มีเลเวอเรจ */
export type ParsedMarketCheck = {
  rawSymbol: string;
  direction: PositionDirection;
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

/** `check btc` · `check btc long` · `check BTC_USDT short` · `check eth ชอต` — ค่าเริ่มทิศ long */
export function parseMarketCheck(text: string): ParsedMarketCheck | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^check\s+(\S+)(?:\s+(long|short|ชอต))?\s*$/i);
  if (!m) return null;
  const rawSymbol = m[1]!.trim();
  if (!rawSymbol) return null;
  const side = m[2]?.trim().toLowerCase();
  const direction: PositionDirection = side === "short" || side === "ชอต" ? "short" : "long";
  return { rawSymbol, direction };
}
