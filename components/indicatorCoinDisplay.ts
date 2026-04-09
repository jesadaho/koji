/** ข้อมูลแสดงผลใน Coin Picker (ไม่ต้องพึ่ง API ภายนอก) */
export type CoinPickerRow = {
  contract: string;
  short: string;
  name: string;
  icon: string;
};

const DISPLAY: Record<string, { name: string; icon: string }> = {
  BTC: { name: "Bitcoin", icon: "₿" },
  ETH: { name: "Ethereum", icon: "💎" },
  SOL: { name: "Solana", icon: "☀️" },
  BNB: { name: "BNB", icon: "◆" },
  DOGE: { name: "Dogecoin", icon: "🐕" },
  XRP: { name: "XRP", icon: "✕" },
  ADA: { name: "Cardano", icon: "₳" },
  AVAX: { name: "Avalanche", icon: "▲" },
  DOT: { name: "Polkadot", icon: "●" },
  LINK: { name: "Chainlink", icon: "◎" },
  POL: { name: "Polygon", icon: "⬡" },
  SUI: { name: "Sui", icon: "◇" },
  TON: { name: "Toncoin", icon: "◈" },
  PEPE: { name: "Pepe", icon: "🐸" },
  LTC: { name: "Litecoin", icon: "Ł" },
  ATOM: { name: "Cosmos", icon: "⚛" },
  NEAR: { name: "NEAR", icon: "Ⓝ" },
  APT: { name: "Aptos", icon: "◆" },
  ARB: { name: "Arbitrum", icon: "◇" },
  OP: { name: "Optimism", icon: "○" },
  WLD: { name: "Worldcoin", icon: "◎" },
  TRX: { name: "TRON", icon: "◈" },
  SHIB: { name: "Shiba Inu", icon: "🐕" },
  FIL: { name: "Filecoin", icon: "⬡" },
  INJ: { name: "Injective", icon: "◈" },
  RENDER: { name: "Render", icon: "◆" },
};

/** เหรียญด่วน Top 5 ตามสเปกผู้ใช้ */
export const QUICK_PRESET_CONTRACTS = [
  "BTC_USDT",
  "ETH_USDT",
  "SOL_USDT",
  "BNB_USDT",
  "DOGE_USDT",
] as const;

export function coinRowFromContract(contract: string): CoinPickerRow {
  const base = contract.replace(/_USDT$/i, "").toUpperCase();
  const d = DISPLAY[base];
  return {
    contract: contract.toUpperCase(),
    short: base,
    name: d?.name ?? `${base} (USDT-M)`,
    icon: d?.icon ?? "◆",
  };
}

export function buildCoinPickerRows(opts: {
  topSymbols: string[];
  volAlerts: { coinId: string; createdAt: string }[];
  techRows: { symbol: string; createdAt: string }[];
}): CoinPickerRow[] {
  const { topSymbols, volAlerts, techRows } = opts;
  const topRank = new Map(topSymbols.map((s, i) => [s.toUpperCase(), i]));

  type Rec = { contract: string; t: number };
  const recList: Rec[] = [];
  for (const v of volAlerts) {
    recList.push({ contract: v.coinId.toUpperCase(), t: Date.parse(v.createdAt) || 0 });
  }
  for (const r of techRows) {
    recList.push({ contract: r.symbol.toUpperCase(), t: Date.parse(r.createdAt) || 0 });
  }
  recList.sort((a, b) => b.t - a.t);
  const recentOrder = new Map<string, number>();
  let ri = 0;
  for (const x of recList) {
    if (!recentOrder.has(x.contract)) recentOrder.set(x.contract, ri++);
  }

  const all = new Set<string>();
  for (const s of topSymbols) all.add(s.toUpperCase());
  for (const v of volAlerts) all.add(v.coinId.toUpperCase());
  for (const r of techRows) all.add(r.symbol.toUpperCase());
  for (const q of QUICK_PRESET_CONTRACTS) all.add(q);

  const rows = Array.from(all).map((contract) => {
    const row = coinRowFromContract(contract);
    return {
      ...row,
      _recentOrder: recentOrder.get(contract) ?? 9999,
      _volOrder: topRank.get(contract) ?? 9999,
    };
  });

  rows.sort((a, b) => {
    const ar = a._recentOrder < 9999 ? 0 : 1;
    const br = b._recentOrder < 9999 ? 0 : 1;
    if (ar !== br) return ar - br;
    if (ar === 0 && a._recentOrder !== b._recentOrder) return a._recentOrder - b._recentOrder;
    return a._volOrder - b._volOrder;
  });

  return rows.map(({ _recentOrder: _r, _volOrder: _v, ...rest }) => rest);
}
