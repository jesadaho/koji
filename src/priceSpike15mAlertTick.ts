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

/** ขาขึ้น: ต้อง ≥ นี้ (default 5%) */
function minPctUp(): number {
  const n = Number(process.env.PRICE_SPIKE_MIN_PCT_UP?.trim());
  if (Number.isFinite(n) && n > 0) return n;
  const legacy = Number(process.env.PRICE_SPIKE_15M_MIN_PCT?.trim());
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 5;
}

/** ขาลง: |%| ต้อง ≥ นี้ (default 5%) */
function minPctDown(): number {
  const n = Number(process.env.PRICE_SPIKE_MIN_PCT_DOWN?.trim());
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function sparkReturnPassesThreshold(returnPct: number): boolean {
  if (returnPct > 0) return returnPct >= minPctUp();
  if (returnPct < 0) return Math.abs(returnPct) >= minPctDown();
  return false;
}

/** ช่วงเทียบ % ระหว่างราคา last สองครั้ง (วินาที) — default 3600 = 1 ชั่วโมง (สูงสุด 3600) */
function signalWindowSec(): number {
  const n = Number(process.env.SPARK_SIGNAL_WINDOW_SEC?.trim());
  return Number.isFinite(n) && n >= 60 && n <= 3600 ? Math.floor(n) : 3600;
}

/**
 * ถ้าไม่ได้สแกน symbol นาน (หลุด Top N) checkpoint จะค้าง — เกินเกณฑ์นี้ให้รีเซ็ตโดยไม่ยิง Spark
 * ต้องมากกว่า window อย่างน้อยช่วงหนึ่ง (เผื่อ cron ~5m) ไม่ให้ช่วง [window, maxStale] แคบจนแทบไม่มีทางยิง
 * ปรับ: SPARK_CHECKPOINT_MAX_STALE_SEC (120–7200)
 */
function checkpointMaxStaleSec(windowSec: number): number {
  const n = Number(process.env.SPARK_CHECKPOINT_MAX_STALE_SEC?.trim());
  const cap = Number.isFinite(n) && n >= 120 && n <= 7200 ? Math.floor(n) : 900;
  const baseline = Math.max(windowSec, cap);
  const minUpper = windowSec + 600; // ~10 นาทีเหนือขอบล่าง — cron ไม่พลาดจุดยิง
  return Math.max(baseline, minUpper);
}

function topN(): number {
  const n = Number(process.env.PRICE_SPIKE_15M_TOP_N?.trim());
  return Number.isFinite(n) && n >= 5 && n <= 200 ? Math.floor(n) : 100;
}

/** เก็บราคาย้อนหลังสำหรับ debug Spark (วินาที) — default 3600 = 1 ชั่วโมง */
function priceHistoryKeepSec(): number {
  const n = Number(process.env.SPARK_PRICE_HISTORY_KEEP_SEC?.trim());
  return Number.isFinite(n) && n >= 900 && n <= 86_400 ? Math.floor(n) : 3600;
}

function appendPriceSample(
  st: PriceSpike15mAlertState[string] | undefined,
  lastPrice: number,
  nowSec: number,
  keepSec: number
): PriceSpike15mAlertState[string] {
  const prev = st?.priceSamples ?? [];
  const minTs = nowSec - keepSec;
  const next = prev.filter((x) => Number.isFinite(x.tsSec) && x.tsSec >= minTs && Number.isFinite(x.lastPrice) && x.lastPrice > 0);
  const last = next[next.length - 1];
  if (last && last.tsSec === nowSec) {
    next[next.length - 1] = { tsSec: nowSec, lastPrice };
  } else {
    next.push({ tsSec: nowSec, lastPrice });
  }
  const maxPoints = Math.max(12, Math.ceil(keepSec / 60));
  const capped = next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
  return {
    checkpointPrice: st?.checkpointPrice ?? lastPrice,
    checkpointSec: st?.checkpointSec ?? nowSec,
    priceSamples: capped,
  };
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

/** เวลา checkpoint (จุดอ้างอิงราคาก่อนหน้า) แสดงเป็น Asia/Bangkok */
function formatCheckpointTimeBkk(checkpointSec: number): string {
  const d = new Date(checkpointSec * 1000);
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildSparkMessage(
  contractSymbol: string,
  returnPct: number,
  lastPrice: number,
  checkpointPrice: number,
  checkpointSec: number,
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
    `📌 ก่อนหน้า: ${formatPriceUsd(checkpointPrice)} · ${formatCheckpointTimeBkk(checkpointSec)} (เวลาไทย)`,
    `💰 ปัจจุบัน: ${formatPriceUsd(lastPrice)}`,
    volLine
  );
  return lines.join("\n");
}

/**
 * Spark — |% เปลี่ยน| ของราคา last เทียบจุดอ้างอิงก่อนหน้า ≥ เกณฑ์ (ไม่อิงแท่งเทียน)
 * ควรเรียกจาก cron ~ทุก 5 นาที (หน้าต่าง 1h ยังใช้ได้ — มีเผื่อช่วง stale เหนือ window)
 */
export async function runPriceSpike15mAlertTick(
  client: Client
): Promise<{ notifiedPushes: number; symbolsHit: number }> {
  if (!isPriceSpike15mSparkCronEnabled()) {
    return { notifiedPushes: 0, symbolsHit: 0 };
  }

  const windowSec = signalWindowSec();
  const keepSec = priceHistoryKeepSec();
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
    const sampled = appendPriceSample(state[sym], p, nowSec, keepSec);
    state[sym] = sampled;
    const st = sampled;

    if (st.checkpointSec <= 0 || st.checkpointPrice <= 0) {
      state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec };
      continue;
    }

    const elapsed = nowSec - st.checkpointSec;
    if (elapsed < windowSec) {
      continue;
    }

    const maxStale = checkpointMaxStaleSec(windowSec);
    if (elapsed > maxStale) {
      state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec };
      continue;
    }

    const returnPct = ((p - st.checkpointPrice) / st.checkpointPrice) * 100;
    if (!sparkReturnPassesThreshold(returnPct)) {
      state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec };
      continue;
    }

    const body = buildSparkMessage(
      sym,
      returnPct,
      p,
      st.checkpointPrice,
      st.checkpointSec,
      m.amount24Usdt,
      windowSec,
      displayBySymbol.get(sym)
    );
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

    state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec };

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
