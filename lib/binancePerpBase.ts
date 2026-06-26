/** ดึง base asset จาก Binance USDT-M perp เช่น BTCUSDT → BTC */
export function binanceUsdtPerpBase(binanceSymbol: string): string | null {
  const sym = binanceSymbol.trim().toUpperCase();
  if (!sym.endsWith("USDT") || sym.length < 5) return null;
  return sym.slice(0, -4);
}
