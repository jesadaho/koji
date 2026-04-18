import type { Client } from "@line/bot-sdk";
import { sendSparkSystemAlert } from "./alertNotify";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import {
  fetchContractDisplayMetaBySymbol,
  fetchContractTickerMetrics,
  getTopUsdtSymbolsByAmount24,
  type ContractDisplayMeta,
} from "./mexcMarkets";
import { classifySparkMcapBand, classifySparkVolBand } from "./sparkTierContext";
import {
  loadPriceSpike15mAlertState,
  savePriceSpike15mAlertState,
  type PriceSpike15mAlertState,
} from "./priceSpike15mAlertStateStore";
import { appendSparkFireLog, enqueueSparkFollowUp } from "./sparkFollowUpStore";

/** ให้สอดคล้องกับ follow-up scheduler (anchor: barOpen + SPARK_BAR_SEC วินาที — ไม่ใช่ TF chart) */
const SPARK_SIGNAL_BAR_SEC = 300;

/** เปิดรอบ Spark (ticker last) ใน cron pct-trailing — ปิด: PRICE_SPIKE_15M_ENABLED=0 */
export function isPriceSpike15mSparkCronEnabled(): boolean {
  const raw = process.env.PRICE_SPIKE_15M_ENABLED?.trim();
  if (raw === "0" || raw === "false") return false;
  return true;
}

/** ขาขึ้น: ต้อง ≥ นี้ (default 10%) */
function minPctUp(): number {
  const n = Number(process.env.PRICE_SPIKE_MIN_PCT_UP?.trim());
  if (Number.isFinite(n) && n > 0) return n;
  const legacy = Number(process.env.PRICE_SPIKE_15M_MIN_PCT?.trim());
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 10;
}

/** ขาลง: |%| ต้อง ≥ นี้ (default 7%) */
function minPctDown(): number {
  const n = Number(process.env.PRICE_SPIKE_MIN_PCT_DOWN?.trim());
  return Number.isFinite(n) && n > 0 ? n : 7;
}

function sparkReturnPassesThreshold(returnPct: number): boolean {
  if (returnPct > 0) return returnPct >= minPctUp();
  if (returnPct < 0) return Math.abs(returnPct) >= minPctDown();
  return false;
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
  windowSec: number,
  displayMeta?: ContractDisplayMeta
): string {
  const base = shortLabel(contractSymbol);
  const pctStr = `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`;
  const wm = Math.round(windowSec / 60);
  const volLine =
    amount24Usdt > 0
      ? `📊 Vol 24h (เทิร์นโอเวอร์): ${formatUsdNotional(amount24Usdt)}`
      : "📊 Vol 24h: —";

  const lines: string[] = [
    `⚡️ Spark Alert: [${base}]/USDT (${pctStr})`,
    `Contract: ${contractSymbol}`,
  ];
  const dn = displayMeta?.displayName?.trim();
  const dne = displayMeta?.displayNameEn?.trim();
  if (dn) {
    lines.push(`📛 ${dn}`);
  }
  if (dne) {
    const dup = dn != null && dne.toLowerCase() === dn.toLowerCase();
    if (!dup) {
      lines.push(`(${dne})`);
    }
  }
  lines.push(
    "",
    returnPct >= 0
      ? `📈 สัญญาณขึ้น — เทียบราคา last ย้อน ~${wm} นาที (ticker · ไม่อิงแท่งเทียน)`
      : `📉 สัญญาณลง — เทียบราคา last ย้อน ~${wm} นาที (ticker · ไม่อิงแท่งเทียน)`,
    `💰 Price: ${formatPriceUsd(lastPrice)}`,
    volLine
  );
  return lines.join("\n");
}

/**
 * Spark — |% เปลี่ยน| ของราคา last เทียบจุดอ้างอิงก่อนหน้า ≥ เกณฑ์ (ไม่อิงแท่งเทียน)
 * ควรเรียกจาก cron ~ทุก 5 นาที ให้สอดคล้องกับ SPARK_SIGNAL_WINDOW_SEC
 */
export async function runPriceSpike15mAlertTick(
  client: Client
): Promise<{ notifiedPushes: number; symbolsHit: number }> {
  if (!isPriceSpike15mSparkCronEnabled()) {
    return { notifiedPushes: 0, symbolsHit: 0 };
  }

  const windowSec = signalWindowSec();
  const limit = topN();
  const [symbols, displayBySymbol] = await Promise.all([
    getTopUsdtSymbolsByAmount24(limit),
    fetchContractDisplayMetaBySymbol(),
  ]);
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
    if (!sparkReturnPassesThreshold(returnPct)) {
      state = { ...state, [sym]: { checkpointPrice: p, checkpointSec: nowSec } };
      continue;
    }

    const body = buildSparkMessage(sym, returnPct, p, m.amount24Usdt, windowSec, displayBySymbol.get(sym));
    let anyOk = false;
    try {
      const n = await sendSparkSystemAlert(client, [], body, "spark");
      if (n > 0) {
        notifiedPushes += n;
        anyOk = true;
      } else if (!telegramSparkSystemGroupConfigured()) {
        console.warn(
          "[priceSpike15mAlertTick] Spark ผ่านเกณฑ์แต่ส่ง 0 push — ตั้ง TELEGRAM_BOT_TOKEN + TELEGRAM_PUBLIC_CHAT_ID (หรือ TELEGRAM_SPARK_SYSTEM_CHAT_ID)",
          sym
        );
      }
    } catch (e) {
      console.error("[priceSpike15mAlertTick] notify", sym, e);
    }

    state = { ...state, [sym]: { checkpointPrice: p, checkpointSec: nowSec } };

    if (anyOk) {
      symbolsHit += 1;
      const amount24 = m.amount24Usdt;
      const volBand = classifySparkVolBand(Number.isFinite(amount24) ? amount24 : null);
      const mcapBand = classifySparkMcapBand(sym);
      try {
        await appendSparkFireLog({
          atIso: new Date().toISOString(),
          symbol: sym,
          sparkReturnPct: returnPct,
          volBand,
          mcapBand,
        });
      } catch (e) {
        console.error("[priceSpike15mAlertTick] appendSparkFireLog", sym, e);
      }
      try {
        await enqueueSparkFollowUp({
          symbol: sym,
          barOpenTimeSec: nowSec - SPARK_SIGNAL_BAR_SEC,
          refPrice: p,
          sparkReturnPct: returnPct,
          amount24Usdt: Number.isFinite(amount24) && amount24 >= 0 ? amount24 : null,
          volBand,
          mcapBand,
        });
      } catch (e) {
        console.error("[priceSpike15mAlertTick] enqueueSparkFollowUp", sym, e);
      }
    }
  }

  await savePriceSpike15mAlertState(state);
  return { notifiedPushes, symbolsHit };
}
