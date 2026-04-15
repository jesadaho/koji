import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import {
  fetchContractTickerMetrics,
  fetchLastClosed5mSparkBar,
  getTopUsdtSymbolsByAmount24,
} from "./mexcMarkets";
import { classifySparkMcapBand, classifySparkVolBand } from "./sparkTierContext";
import { loadSystemChangeSubscribers } from "./systemChangeSubscribersStore";
import {
  loadPriceSpike15mAlertState,
  savePriceSpike15mAlertState,
  type PriceSpike15mAlertState,
} from "./priceSpike15mAlertStateStore";
import { enqueueSparkFollowUp } from "./sparkFollowUpStore";

function enabled(): boolean {
  const raw = process.env.PRICE_SPIKE_15M_ENABLED?.trim();
  if (raw === "0" || raw === "false") return false;
  return true;
}

function minAbsPct(): number {
  const n = Number(process.env.PRICE_SPIKE_15M_MIN_PCT?.trim());
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function topN(): number {
  const n = Number(process.env.PRICE_SPIKE_15M_TOP_N?.trim());
  return Number.isFinite(n) && n >= 5 && n <= 200 ? Math.floor(n) : 50;
}

const FETCH_CONCURRENCY = 8;

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

function shortLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function formatPriceUsd(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p < 1) return `$${p.toFixed(4)}`;
  if (p < 1000) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatUsdNotional(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function volVsAvgThai(volVsAvgPct: number | null): string {
  if (volVsAvgPct == null || !Number.isFinite(volVsAvgPct)) return "";
  const r = Math.round(volVsAvgPct);
  if (r >= 0) return ` (สูงกว่าค่าเฉลี่ย ${r}%)`;
  return ` (ต่ำกว่าค่าเฉลี่ย ${Math.abs(r)}%)`;
}

function buildSparkMessage(
  contractSymbol: string,
  returnPct: number,
  lastClose: number,
  volUsdt5m: number,
  volVsAvgPct: number | null
): string {
  const base = shortLabel(contractSymbol);
  const pctStr = `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`;
  const moveLine =
    returnPct >= 0
      ? `Price jumped ${pctStr} (ในรอบ 5 นาที)`
      : `Price dropped ${pctStr} (ในรอบ 5 นาที)`;
  const volSuffix = volVsAvgThai(volVsAvgPct);
  return [
    `⚡️ Koji Spark Alert: [${base}]/USDT`,
    "",
    moveLine,
    `💰 Price: ${formatPriceUsd(lastClose)}`,
    `📊 Vol (5m): ${formatUsdNotional(volUsdt5m)}${volSuffix}`,
  ].join("\n");
}

/**
 * แจ้งผู้ติดตามระบบเมื่อ |% แท่ง 5m ล่าสุดที่ปิดแล้ว| ≥ เกณฑ์ — สแกน Top N ตาม Vol 24h (Spark)
 */
export async function runPriceSpike15mAlertTick(
  client: Client
): Promise<{ notifiedPushes: number; symbolsHit: number }> {
  if (!enabled()) {
    return { notifiedPushes: 0, symbolsHit: 0 };
  }

  const subs = await loadSystemChangeSubscribers();
  if (subs.length === 0) {
    return { notifiedPushes: 0, symbolsHit: 0 };
  }

  const threshold = minAbsPct();
  const limit = topN();
  const symbols = await getTopUsdtSymbolsByAmount24(limit);
  if (symbols.length === 0) {
    return { notifiedPushes: 0, symbolsHit: 0 };
  }

  let state = await loadPriceSpike15mAlertState();
  const minPct = threshold;

  const results = await mapPoolConcurrent(symbols, FETCH_CONCURRENCY, async (sym) => {
    const bar = await fetchLastClosed5mSparkBar(sym);
    return { sym, bar };
  });

  let notifiedPushes = 0;
  let symbolsHit = 0;

  for (const { sym, bar } of results) {
    if (!bar) continue;
    if (Math.abs(bar.returnPct) < minPct) continue;

    const prev = state[sym]?.lastNotifiedBarOpenSec;
    if (prev === bar.barOpenTimeSec) continue;

    const body = buildSparkMessage(sym, bar.returnPct, bar.lastClose, bar.volUsdt5m, bar.volVsAvgPct);
    let anyOk = false;
    for (const uid of subs) {
      try {
        await sendAlertNotification(client, uid, body);
        notifiedPushes += 1;
        anyOk = true;
      } catch (e) {
        console.error("[priceSpike15mAlertTick] notify", sym, uid, e);
      }
    }

    if (anyOk) {
      symbolsHit += 1;
      state = {
        ...state,
        [sym]: { lastNotifiedBarOpenSec: bar.barOpenTimeSec },
      };
      try {
        const metrics = await fetchContractTickerMetrics(sym);
        const amount24 = metrics?.amount24Usdt ?? null;
        await enqueueSparkFollowUp({
          symbol: sym,
          barOpenTimeSec: bar.barOpenTimeSec,
          refPrice: bar.lastClose,
          sparkReturnPct: bar.returnPct,
          amount24Usdt: amount24,
          volBand: classifySparkVolBand(amount24),
          mcapBand: classifySparkMcapBand(sym),
        });
      } catch (e) {
        console.error("[priceSpike15mAlertTick] enqueueSparkFollowUp", sym, e);
      }
    }
  }

  await savePriceSpike15mAlertState(state);
  return { notifiedPushes, symbolsHit };
}
