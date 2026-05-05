import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import {
  loadContractWatches,
  uniqueWatchedSymbols,
  userIdsForSymbol,
  type ContractWatch,
} from "./contractWatchStore";
import {
  loadEma612WatchCrossState,
  pruneEma612WatchCrossState,
  saveEma612WatchCrossState,
  stateKey,
} from "./ema612WatchCrossStateStore";
import { emaLine } from "./indicatorMath";
import { fetchContractKline15mIndicatorPack } from "./mexcMarkets";
import { useCloudStorage } from "./remoteJsonStore";

function featureEnabled(): boolean {
  const raw = process.env.EMA612_15M_WATCH_ALERTS_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return true;
}

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

function symbolLabelSlash(mexcSymbol: string): string {
  const base = mexcSymbol.replace(/_USDT$/i, "");
  return `${base}/USDT`;
}

/** ราคาแสดงผล — คอมมาแบบ en-US */
function formatAlertPrice(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "—";
  const opts: Intl.NumberFormatOptions =
    usd >= 1
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 8 };
  return `$${usd.toLocaleString("en-US", opts)}`;
}

function emaCrossKind(
  fastAbovePrev: boolean,
  fastAboveNow: boolean
): "golden" | "death" | null {
  if (!fastAbovePrev && fastAboveNow) return "golden";
  if (fastAbovePrev && !fastAboveNow) return "death";
  return null;
}

function gapSpreadPct(emaFast: number, emaSlow: number, price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return (Math.abs(emaFast - emaSlow) / price) * 100;
}

function distanceThaiNote(gapNowPct: number, gapPrevPct: number): string {
  if (!Number.isFinite(gapNowPct) || !Number.isFinite(gapPrevPct)) return "—";
  if (gapNowPct > gapPrevPct * 1.0000001) return "กำลังถ่างออก";
  if (gapNowPct < gapPrevPct * 0.9999999) return "กำลังบีบเข้า";
  return "สเปรดใกล้เคียงแท่งก่อน";
}

function buildMessage(
  symbol: string,
  kind: "golden" | "death",
  fastNow: number,
  slowNow: number,
  closeNow: number,
  closePrev: number,
  fastPrev: number,
  slowPrev: number
): string {
  const sym = symbolLabelSlash(symbol);
  const header = kind === "golden" ? "[ 📈 EMA Cross Detected ]" : "[ 📉 EMA Cross Detected ]";
  const signal =
    kind === "golden"
      ? "Signal: Golden Cross (EMA6 ↗️ EMA12)"
      : "Signal: Death Cross (EMA6 ↘️ EMA12)";

  const gapNow = gapSpreadPct(fastNow, slowNow, closeNow);
  const gapPrev = gapSpreadPct(fastPrev, slowPrev, closePrev);
  const gapStr = gapNow.toFixed(2);
  const note = distanceThaiNote(gapNow, gapPrev);

  return [
    header,
    `Symbol: ${sym} (15m)`,
    signal,
    `Price: ${formatAlertPrice(closeNow)}`,
    `Distance: Gap ${gapStr}% (${note})`,
  ].join("\n");
}

function validKeysFromWatches(watches: ContractWatch[]): Set<string> {
  const s = new Set<string>();
  for (const w of watches) {
    s.add(stateKey(w.userId, w.coinId));
  }
  return s;
}

/**
 * แจ้งเตือนเมื่อ EMA6/EMA12 ตัดกันบน 15m — เฉพาะสัญญาที่ผู้ใช้ติดตาม (contract watch)
 */
export async function runEma612ContractWatchAlertTick(client: Client): Promise<number> {
  if (!featureEnabled()) return 0;
  // IMPORTANT: On Vercel, local FS state is not reliable; without Redis/KV the dedupe state resets
  // and can cause repeated notifications every cron run for the same closed bar.
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    console.warn(
      "[ema612ContractWatchAlertTick] skip: missing cloud storage on Vercel (set REDIS_URL or KV_REST_API_URL)"
    );
    return 0;
  }

  const watches = await loadContractWatches();
  if (watches.length === 0) return 0;

  const symbols = uniqueWatchedSymbols(watches);
  if (symbols.length === 0) return 0;

  let state = await loadEma612WatchCrossState();
  state = pruneEma612WatchCrossState(state, validKeysFromWatches(watches));

  const klineResults = await mapPoolConcurrent(symbols, 8, async (sym) => {
    const pack = await fetchContractKline15mIndicatorPack(sym);
    return { sym, pack };
  });

  const klineBySymbol = new Map<string, Awaited<ReturnType<typeof fetchContractKline15mIndicatorPack>>>();
  for (const { sym, pack } of klineResults) {
    klineBySymbol.set(sym, pack);
  }

  let notified = 0;

  for (const symbol of symbols) {
    const pack = klineBySymbol.get(symbol);
    if (!pack) continue;

    const { close, timeSec } = pack;
    const n = close.length;
    const fastP = 6;
    const slowP = 12;
    if (fastP >= slowP || n < 14) continue;

    const emaF = emaLine(close, fastP);
    const emaS = emaLine(close, slowP);
    const minIdx = slowP - 1;
    const i = n - 2;
    const iPrev = i - 1;
    if (i < minIdx || iPrev < minIdx) continue;

    const efNow = emaF[i];
    const esNow = emaS[i];
    const efPrev = emaF[iPrev];
    const esPrev = emaS[iPrev];
    if (
      !Number.isFinite(efNow) ||
      !Number.isFinite(esNow) ||
      !Number.isFinite(efPrev) ||
      !Number.isFinite(esPrev)
    ) {
      continue;
    }

    const closeNow = close[i]!;
    const closePrev = close[iPrev]!;
    if (
      typeof closeNow !== "number" ||
      typeof closePrev !== "number" ||
      !Number.isFinite(closeNow) ||
      closeNow <= 0 ||
      !Number.isFinite(closePrev) ||
      closePrev <= 0
    ) {
      continue;
    }

    const fastAboveNow = efNow > esNow;
    const fastAbovePrev = efPrev > esPrev;
    const kind = emaCrossKind(fastAbovePrev, fastAboveNow);
    if (!kind) continue;

    const barTimeSec = timeSec[i];
    if (typeof barTimeSec !== "number" || !Number.isFinite(barTimeSec)) continue;

    const msg = buildMessage(symbol, kind, efNow, esNow, closeNow, closePrev, efPrev, esPrev);

    const recipients = userIdsForSymbol(watches, symbol);
    for (const userId of recipients) {
      const key = stateKey(userId, symbol);
      if (state[key]?.lastFiredBarTimeSec === barTimeSec) continue;

      try {
        await sendAlertNotification(client, userId, msg);
        state[key] = { lastFiredBarTimeSec: barTimeSec };
        notified += 1;
      } catch (e) {
        console.error("[ema612ContractWatchAlertTick] push", key, e);
      }
    }
  }

  await saveEma612WatchCrossState(state);
  return notified;
}
