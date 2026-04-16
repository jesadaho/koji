import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { fetchContractTickerMetrics, getTopUsdtSymbolsByAmount24 } from "./mexcMarkets";
import { classifySparkMcapBand, classifySparkVolBand } from "./sparkTierContext";
import { loadSystemChangeSubscribers } from "./systemChangeSubscribersStore";
import {
  loadPriceSpike15mAlertState,
  savePriceSpike15mAlertState,
  type PriceSpike15mAlertState,
} from "./priceSpike15mAlertStateStore";
import { enqueueSparkFollowUp } from "./sparkFollowUpStore";

/** ให้สอดคล้องกับ follow-up (refClose = barOpen + 5m) */
const SPARK_SIGNAL_BAR_SEC = 300;

function enabled(): boolean {
  const raw = process.env.PRICE_SPIKE_15M_ENABLED?.trim();
  if (raw === "0" || raw === "false") return false;
  return true;
}

function minAbsPct(): number {
  const n = Number(process.env.PRICE_SPIKE_15M_MIN_PCT?.trim());
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** ช่วงเทียบ % ระหว่างราคา last สองครั้ง (วินาที) — default 300 = 5 นาที */
function signalWindowSec(): number {
  const n = Number(process.env.SPARK_SIGNAL_WINDOW_SEC?.trim());
  return Number.isFinite(n) && n >= 60 && n <= 3600 ? Math.floor(n) : 300;
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

function buildSparkMessage(
  contractSymbol: string,
  returnPct: number,
  lastPrice: number,
  amount24Usdt: number,
  windowSec: number
): string {
  const base = shortLabel(contractSymbol);
  const pctStr = `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`;
  const moveLine =
    returnPct >= 0
      ? `Price jumped ${pctStr} (สัญญาณจากราคา last)`
      : `Price dropped ${pctStr} (สัญญาณจากราคา last)`;
  const wm = Math.round(windowSec / 60);
  const volLine =
    amount24Usdt > 0
      ? `📊 Vol 24h (เทิร์นโอเวอร์): ${formatUsdNotional(amount24Usdt)}`
      : "📊 Vol 24h: —";
  return [
    `⚡️ Koji Spark Alert: [${base}]/USDT`,
    "",
    moveLine,
    `⏱ เทียบช่วง ~${wm} นาที (ticker ไม่อิงแท่งเทียน)`,
    `💰 Price: ${formatPriceUsd(lastPrice)}`,
    volLine,
  ].join("\n");
}

/**
 * Spark — |% เปลี่ยน| ของราคา last เทียบจุดอ้างอิงก่อนหน้า ≥ เกณฑ์ (ไม่อิงแท่งเทียน)
 * ควรเรียกจาก cron ~ทุก 5 นาที ให้สอดคล้องกับ SPARK_SIGNAL_WINDOW_SEC
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
  const windowSec = signalWindowSec();
  const limit = topN();
  const symbols = await getTopUsdtSymbolsByAmount24(limit);
  if (symbols.length === 0) {
    return { notifiedPushes: 0, symbolsHit: 0 };
  }

  let state: PriceSpike15mAlertState = await loadPriceSpike15mAlertState();

  const metricsList = await mapPoolConcurrent(symbols, FETCH_CONCURRENCY, async (sym) => {
    const m = await fetchContractTickerMetrics(sym);
    return { sym, m };
  });

  let notifiedPushes = 0;
  let symbolsHit = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  for (const { sym, m } of metricsList) {
    if (!m || !Number.isFinite(m.lastPrice) || m.lastPrice <= 0) continue;

    const p = m.lastPrice;
    const st = state[sym];

    if (!st) {
      state = { ...state, [sym]: { checkpointPrice: p, checkpointSec: nowSec } };
      continue;
    }

    const elapsed = nowSec - st.checkpointSec;
    if (elapsed < windowSec) {
      continue;
    }

    const returnPct = ((p - st.checkpointPrice) / st.checkpointPrice) * 100;
    if (Math.abs(returnPct) < threshold) {
      state = { ...state, [sym]: { checkpointPrice: p, checkpointSec: nowSec } };
      continue;
    }

    const body = buildSparkMessage(sym, returnPct, p, m.amount24Usdt, windowSec);
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

    state = { ...state, [sym]: { checkpointPrice: p, checkpointSec: nowSec } };

    if (anyOk) {
      symbolsHit += 1;
      try {
        const amount24 = m.amount24Usdt;
        await enqueueSparkFollowUp({
          symbol: sym,
          barOpenTimeSec: nowSec - SPARK_SIGNAL_BAR_SEC,
          refPrice: p,
          sparkReturnPct: returnPct,
          amount24Usdt: Number.isFinite(amount24) && amount24 >= 0 ? amount24 : null,
          volBand: classifySparkVolBand(Number.isFinite(amount24) ? amount24 : null),
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
