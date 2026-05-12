import type { Client } from "@line/bot-sdk";
import { sendSparkSystemAlert } from "./alertNotify";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import {
  fetchContractDisplayMetaBySymbol,
  fetchAllContractTickers,
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
import {
  isSparkAutotradeCronEnabled,
  loadSparkAutoTradeTickBatch,
  runSparkAutoTradeAfterSparkNotify,
  type SparkAutoTradeTickBatchRef,
} from "./sparkAutoTradeExecutor";
import { saveSparkAutoTradeState } from "./sparkAutoTradeStateStore";
import { runSparkAutoTradeTimeStopSweep } from "./sparkAutoTradeTimeStopTick";
import { passesSparkKlineConfirm, sparkKlineConfirmEnabled } from "./sparkKlineConfirm";

/** ให้สอดคล้องกับ follow-up scheduler (anchor: barOpen + SPARK_BAR_SEC วินาที — ไม่ใช่ TF chart) */
const SPARK_SIGNAL_BAR_SEC = 300;

/** หลังส่ง Spark สำเร็จ — ไม่ส่งซ้ำสำหรับสัญญาเดียวกันภายในช่วงนี้ (default 24 ชม.) */
function sparkAlertCooldownSec(): number {
  const n = Number(process.env.SPARK_ALERT_COOLDOWN_SEC?.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 24 * 60 * 60;
}

/** เปิดรอบ Spark (ticker last) ใน cron pct-trailing — ปิด: PRICE_SPIKE_15M_ENABLED=0 */
export function isPriceSpike15mSparkCronEnabled(): boolean {
  const raw = process.env.PRICE_SPIKE_15M_ENABLED?.trim();
  if (raw === "0" || raw === "false") return false;
  return true;
}

/** ขาขึ้น: ต้อง ≥ นี้ (default 9%) */
function minPctUp(): number {
  const n = Number(process.env.PRICE_SPIKE_MIN_PCT_UP?.trim());
  if (Number.isFinite(n) && n > 0) return n;
  const legacy = Number(process.env.PRICE_SPIKE_15M_MIN_PCT?.trim());
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 9;
}

/** ขาลง: |%| ต้อง ≥ นี้ (default 9%) */
function minPctDown(): number {
  const n = Number(process.env.PRICE_SPIKE_MIN_PCT_DOWN?.trim());
  return Number.isFinite(n) && n > 0 ? n : 9;
}

function sparkReturnPassesThreshold(returnPct: number): boolean {
  if (returnPct > 0) return returnPct >= minPctUp();
  if (returnPct < 0) return Math.abs(returnPct) >= minPctDown();
  return false;
}

type RefSample = { tsSec: number; lastPrice: number };
type WindowSignal = { windowSec: number; ref: RefSample; returnPct: number };

/** ช่วงเวลาเทียบราคาหลายช่วง (วินาที) — default: 5m, 10m, 15m */
function signalWindowsSec(): number[] {
  const raw = process.env.SPARK_SIGNAL_WINDOWS_SEC?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x >= 60 && x <= 3600)
      .map((x) => Math.floor(x));
    const uniq = Array.from(new Set(parsed)).sort((a, b) => a - b);
    if (uniq.length > 0) return uniq;
  }
  const legacy = Number(process.env.SPARK_SIGNAL_WINDOW_SEC?.trim());
  if (Number.isFinite(legacy) && legacy >= 60 && legacy <= 3600) return [Math.floor(legacy)];
  return [300, 600, 900];
}

function pickReferenceSample(samples: RefSample[], nowSec: number, windowSec: number): RefSample | null {
  if (samples.length === 0) return null;
  const targetTs = nowSec - windowSec;
  let best: RefSample | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of samples) {
    if (!Number.isFinite(s.tsSec) || !Number.isFinite(s.lastPrice) || s.lastPrice <= 0) continue;
    if (s.tsSec >= nowSec) continue;
    const dist = Math.abs(s.tsSec - targetTs);
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  // cron ปกติทุก ~5 นาที จึงยอมรับ sample ที่คลาดเป้าหมายได้ไม่เกิน 10 นาที
  return best && bestDist <= 600 ? best : null;
}

function pickBestWindowSignal(samples: RefSample[], nowSec: number, windowsSec: number[]): WindowSignal | null {
  let best: WindowSignal | null = null;
  for (const windowSec of windowsSec) {
    const ref = pickReferenceSample(samples, nowSec, windowSec);
    if (!ref) continue;
    const returnPct = ((samples[samples.length - 1]!.lastPrice - ref.lastPrice) / ref.lastPrice) * 100;
    if (!sparkReturnPassesThreshold(returnPct)) continue;
    if (!best || Math.abs(returnPct) > Math.abs(best.returnPct)) {
      best = { windowSec, ref, returnPct };
    }
  }
  return best;
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
 * ควรเรียกจาก cron ~ทุก 5 นาที (เทียบราคาย้อนหลังจาก sample history)
 */
export async function runPriceSpike15mAlertTick(
  client: Client
): Promise<{ notifiedPushes: number; symbolsHit: number }> {
  /** time-stop ต้องรันแม้ปิด ticker Spark — ไม่งั้นคิวปิดจาก Spark จะไม่ถูกสแกน */
  try {
    await runSparkAutoTradeTimeStopSweep();
  } catch (e) {
    console.error("[priceSpike15mAlertTick] spark time-stop sweep (early)", e);
  }

  if (!isPriceSpike15mSparkCronEnabled()) {
    return { notifiedPushes: 0, symbolsHit: 0 };
  }

  const windowsSec = signalWindowsSec();
  const keepSec = priceHistoryKeepSec();
  const limit = topN();
  const [symbols, displayBySymbol] = await Promise.all([
    getTopUsdtSymbolsByAmount24(limit),
    fetchContractDisplayMetaBySymbol(),
  ]);
  if (symbols.length === 0) {
    // ถ้า universe ว่าง แปลว่าดึง ticker list ไม่ได้/โดน rate limit/หรือ filter เข้มเกินไป
    // ให้ถือเป็นความล้มเหลวของ cron เพื่อให้มี alert เข้า TELEGRAM_ALERT_CHAT_ID (cronFailureNotify)
    throw new Error(
      `Spark universe empty (topN=${limit}) — MEXC contract ticker list อาจว่าง/ถูกจำกัด หรือ filter (SPARK_MIN_AMOUNT24_USDT) เข้มเกินไป`
    );
  }

  let state: PriceSpike15mAlertState = await loadPriceSpike15mAlertState();

  const allTickers = await fetchAllContractTickers();
  const bySym = new Map<string, { lastPrice: number; amount24Usdt: number; volume24: number }>();
  for (const t of allTickers) {
    const sym = t.symbol?.trim();
    if (!sym) continue;
    const lp = t.lastPrice;
    const amt = t.amount24;
    if (typeof lp !== "number" || Number.isNaN(lp) || lp <= 0) continue;
    if (typeof amt !== "number" || Number.isNaN(amt) || amt < 0) continue;
    const vol = t.volume24;
    bySym.set(sym, {
      lastPrice: lp,
      amount24Usdt: amt,
      volume24: typeof vol === "number" && !Number.isNaN(vol) ? vol : 0,
    });
  }
  let okMetrics = 0;
  for (const sym of symbols) {
    if (bySym.get(sym)) okMetrics += 1;
  }
  if (okMetrics === 0) {
    throw new Error(
      `Spark ticker metrics empty (0/${symbols.length}) — MEXC /contract/ticker list อาจว่าง/ผิดปกติ; ตรวจ Project Logs และลอง curl MEXC API จาก server`
    );
  }

  let notifiedPushes = 0;
  let symbolsHit = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  /** Spark auto-open: preload map+state ครั้งแรกที่ฟ้าจริง — save ปิดท้าย tick */
  let sparkAutoTradeBatch: SparkAutoTradeTickBatchRef | null = null;

  for (const sym of symbols) {
    const m = bySym.get(sym);
    if (!m) continue;
    const p = m.lastPrice;
    const sampled = appendPriceSample(state[sym], p, nowSec, keepSec);
    state[sym] = sampled;
    const st = sampled;

    if (st.checkpointSec <= 0 || st.checkpointPrice <= 0) {
      state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec };
      continue;
    }

    const signal = pickBestWindowSignal(st.priceSamples ?? [], nowSec, windowsSec);
    if (!signal) {
      state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec };
      continue;
    }

    const { ref, returnPct, windowSec } = signal;
    const cooldown = sparkAlertCooldownSec();
    if (cooldown > 0 && st.lastNotifiedSec != null && nowSec - st.lastNotifiedSec < cooldown) {
      // อยู่ใน cooldown: ยังเก็บ sample + อัปเดต checkpoint แต่ไม่ส่งแจ้งเตือน/ไม่ enqueue follow-up
      state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec };
      continue;
    }

    if (sparkKlineConfirmEnabled()) {
      try {
        const klineOk = await passesSparkKlineConfirm(sym, returnPct);
        if (!klineOk) {
          // ไม่รีเซ็ต checkpoint — รอบถัดไปลองยืนยัน kline ใหม่
          continue;
        }
      } catch (e) {
        console.error("[priceSpike15mAlertTick] spark kline confirm", sym, e);
        continue;
      }
    }

    const body = buildSparkMessage(
      sym,
      returnPct,
      p,
      ref.lastPrice,
      ref.tsSec,
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

    state[sym] = { ...st, checkpointPrice: p, checkpointSec: nowSec, lastNotifiedSec: anyOk ? nowSec : st.lastNotifiedSec };

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
      if (isSparkAutotradeCronEnabled()) {
        try {
          if (!sparkAutoTradeBatch) sparkAutoTradeBatch = await loadSparkAutoTradeTickBatch();
          await runSparkAutoTradeAfterSparkNotify(
            {
              contractSymbol: sym,
              returnPct,
              amount24Usdt: Number.isFinite(amount24) && amount24 >= 0 ? amount24 : 0,
            },
            sparkAutoTradeBatch,
          );
        } catch (e) {
          console.error("[priceSpike15mAlertTick] spark auto-open", sym, e);
        }
      }
    }
  }

  if (sparkAutoTradeBatch) {
    try {
      await saveSparkAutoTradeState(sparkAutoTradeBatch.state);
    } catch (e) {
      console.error("[priceSpike15mAlertTick] save spark autotrade state", e);
    }
  }

  await savePriceSpike15mAlertState(state);
  return { notifiedPushes, symbolsHit };
}
