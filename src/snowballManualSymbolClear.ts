import { loadSnowballPendingConfirms, saveSnowballPendingConfirms } from "./snowballConfirmStore";
import { loadIndicatorPublicFeedState, saveIndicatorPublicFeedState } from "./indicatorPublicFeedStore";
import { loadSnowballStatsState, saveSnowballStatsState } from "./snowballStatsStore";

export type SnowballManualSymbolClearResult = {
  binanceSymbol: string;
  statsRowsRemoved: number;
  pendingConfirmRemoved: number;
  publicFeedSnowballKeysCleared: number;
};

/** แปลงอินพุตผู้ใช้ → Binance USDT-M perpetual เช่น btc → BTCUSDT */
export function toBinanceUsdtPerpSymbol(raw: string): string {
  const u = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!u) return "";
  if (u.endsWith("USDT") && u.length > 4) return u;
  if (u.includes("_")) {
    const parts = u.split("_").filter(Boolean);
    if (parts.length >= 2 && parts[parts.length - 1] === "USDT") {
      return `${parts.slice(0, -1).join("")}USDT`;
    }
  }
  if (/^[A-Z0-9]{2,32}$/.test(u)) return `${u}USDT`;
  return u;
}

/**
 * ลบแถวสถิติ Snowball + คิว pending confirm + state ยิง/คูลดาวน์/wave ของ Snowball ต่อสัญญา
 * — ให้ cron รอบถัดไปสามารถประเมิน/ยิงซ้ำได้ (แท่งเดิมถ้ายังไม่เลื่อนไปแท่งใหม่)
 */
export async function clearSnowballSymbolForManualRetry(rawSymbol: string): Promise<SnowballManualSymbolClearResult> {
  const binanceSymbol = toBinanceUsdtPerpSymbol(rawSymbol);
  if (!binanceSymbol || !binanceSymbol.endsWith("USDT") || binanceSymbol.length < 5) {
    throw new Error("symbol ไม่ถูกต้อง (ต้องการเช่น BTC หรือ BTCUSDT)");
  }

  const statsState = await loadSnowballStatsState();
  const beforeStats = statsState.rows.length;
  statsState.rows = statsState.rows.filter((r) => (r.symbol ?? "").toUpperCase() !== binanceSymbol);
  await saveSnowballStatsState(statsState);
  const statsRowsRemoved = beforeStats - statsState.rows.length;

  const pend = await loadSnowballPendingConfirms();
  const beforePend = pend.items.length;
  const nextPend = pend.items.filter((it) => it.symbol.toUpperCase() !== binanceSymbol);
  await saveSnowballPendingConfirms({ items: nextPend });
  const pendingConfirmRemoved = beforePend - nextPend.length;

  const feed = await loadIndicatorPublicFeedState();
  const prefix = `${binanceSymbol}|SNOWBALL|`;
  const keys = new Set<string>();
  for (const k of Object.keys(feed.lastFiredBarSec)) {
    if (k.startsWith(prefix)) keys.add(k);
  }
  if (feed.lastNotifyMs) {
    for (const k of Object.keys(feed.lastNotifyMs)) {
      if (k.startsWith(prefix)) keys.add(k);
    }
  }
  if (feed.lastAlertPrice) {
    for (const k of Object.keys(feed.lastAlertPrice)) {
      if (k.startsWith(prefix)) keys.add(k);
    }
  }
  const keysToClear = Array.from(keys);
  for (let i = 0; i < keysToClear.length; i++) {
    const k = keysToClear[i]!;
    delete feed.lastFiredBarSec[k];
    if (feed.lastNotifyMs) delete feed.lastNotifyMs[k];
    if (feed.lastAlertPrice) delete feed.lastAlertPrice[k];
  }
  await saveIndicatorPublicFeedState(feed);

  return {
    binanceSymbol,
    statsRowsRemoved,
    pendingConfirmRemoved,
    publicFeedSnowballKeysCleared: keys.size,
  };
}
