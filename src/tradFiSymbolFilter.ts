/**
 * กรองสัญญา TradFi / stock perp ออกจาก universe สแกนสัญญาณ crypto
 * ค่าเริ่มต้น = ไม่ track · เปิดกลับด้วย BINANCE_INCLUDE_STOCK_PERPS=1 / MEXC_INCLUDE_STOCK_CONTRACTS=1
 */

export function binanceIncludeStockPerps(): boolean {
  const raw = process.env.BINANCE_INCLUDE_STOCK_PERPS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export function mexcIncludeStockContracts(): boolean {
  const raw = process.env.MEXC_INCLUDE_STOCK_CONTRACTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export type BinanceUsdmUnderlyingRow = {
  underlyingType?: string;
  underlyingSubType?: string[] | string;
};

/** Binance exchangeInfo — crypto perp มักเป็น underlyingType COIN */
export function isBinanceTradFiUnderlying(row: BinanceUsdmUnderlyingRow): boolean {
  const ut = row.underlyingType?.trim().toUpperCase();
  if (ut && ut !== "COIN") return true;
  const raw = row.underlyingSubType;
  const subs = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  for (const s of subs) {
    const u = String(s).trim().toUpperCase();
    if (!u) continue;
    if (u === "STOCK" || u === "EQUITY" || u === "TRADFI" || u.includes("STOCK")) return true;
  }
  return false;
}

/** MEXC — สัญญาหุ้นมักมี STOCK ในชื่อ เช่น CBRSSTOCK_USDT */
export function isMexcStockContractSymbol(contractSymbol: string): boolean {
  const s = contractSymbol.trim().toUpperCase();
  if (!s) return false;
  return s.includes("STOCK");
}

export function shouldExcludeBinanceUsdmFromCryptoScan(row: BinanceUsdmUnderlyingRow): boolean {
  if (binanceIncludeStockPerps()) return false;
  return isBinanceTradFiUnderlying(row);
}

export function shouldExcludeMexcContractFromCryptoScan(contractSymbol: string): boolean {
  if (mexcIncludeStockContracts()) return false;
  return isMexcStockContractSymbol(contractSymbol);
}

export type BinanceUsdmSymbolMeta = {
  underlyingType: string | null;
  underlyingSubTypes: string[];
  isTradFi: boolean;
};

/** ข้อความประเภทสินทรัพย์สำหรับแจ้งเตือน Reversal */
export function formatBinanceUsdmAssetTypeLine(meta: BinanceUsdmSymbolMeta | null | undefined): string {
  if (!meta) return "ประเภท: — (ไม่พบใน Binance exchangeInfo)";
  if (meta.isTradFi) {
    const sub =
      meta.underlyingSubTypes.length > 0
        ? meta.underlyingSubTypes.join(", ")
        : meta.underlyingType ?? "TradFi";
    const ut = meta.underlyingType && meta.underlyingType !== sub ? ` · ${meta.underlyingType}` : "";
    return `ประเภท: ${sub}${ut} (TradFi — ไม่ใช่ crypto perp)`;
  }
  const ut = meta.underlyingType ?? "COIN";
  return `ประเภท: ${ut} (crypto perp)`;
}

/** เหตุผล skip auto-open — null = ไม่ skip จากฝั่งสัญญา */
export function reversalAutoOpenSkipLineTh(opts: {
  isTradFi: boolean;
  mexcContractSymbol?: string | null;
}): string | null {
  if (opts.isTradFi) {
    return "⏭️ Auto-open: skip — TradFi/stock perp (ระบบไม่เปิดออเดอร์ MEXC)";
  }
  const mexc = opts.mexcContractSymbol?.trim();
  if (!mexc) {
    return "⏭️ Auto-open: skip — ไม่พบสัญญา USDT perp บน MEXC";
  }
  if (shouldExcludeMexcContractFromCryptoScan(mexc)) {
    return "⏭️ Auto-open: skip — สัญญา MEXC ประเภท stock (ไม่รองรับ auto-open)";
  }
  return null;
}

export function reversalShouldSkipAutoOpenForAsset(opts: {
  isTradFi: boolean;
  mexcContractSymbol?: string | null;
}): boolean {
  return reversalAutoOpenSkipLineTh(opts) != null;
}
