import type { Client } from "@line/bot-sdk";
import { fetchContractKline1h } from "./indicatorKline";
import { rsiWilder } from "./indicatorMath";
import {
  loadActiveRsi1hAlerts,
  updateIndicatorAlertAfterFire,
  type IndicatorAlert,
} from "./indicatorAlertsStore";

function cooldownMs(): number {
  const v = Number(process.env.INDICATOR_ALERT_COOLDOWN_MS);
  return Number.isFinite(v) && v > 0 ? v : 4 * 3600 * 1000;
}

function inCooldown(a: IndicatorAlert, now: number): boolean {
  if (!a.lastTriggeredAt) return false;
  const t = Date.parse(a.lastTriggeredAt);
  if (Number.isNaN(t)) return false;
  return now - t < cooldownMs();
}

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

function displaySymbol(mexcSymbol: string): string {
  const base = mexcSymbol.replace(/_USDT$/i, "");
  return `$${base}/USDT`;
}

function crossMatch(
  rPrev: number,
  rNow: number,
  threshold: number,
  direction: "above" | "below"
): boolean {
  if (direction === "above") {
    return rPrev <= threshold && rNow > threshold;
  }
  return rPrev >= threshold && rNow < threshold;
}

function buildLineMessage(a: IndicatorAlert, rPrev: number, rNow: number, barIso: string): string {
  const sym = displaySymbol(a.symbol);
  const cmp = a.direction === "above" ? ">" : "<";
  const dirTh = `${cmp} ${a.threshold}`;
  return [
    `📈 Koji — RSI alert (1h)`,
    `🪙 ${sym}`,
    "",
    `📊 RSI(${a.parameters.period}) ข้ามเกณฑ์ (${dirTh})`,
    `   แท่งก่อน: ${rPrev.toFixed(2)} → ล่าสุด: ${rNow.toFixed(2)}`,
    `   แท่งปิด (UTC): ${barIso}`,
    "",
    "สัญญาณจากแท่งปิดล่าสุด — ใช้เป็นแนวทาง ไม่ใช่คำแนะนำลงทุน",
  ].join("\n");
}

/**
 * Collector → Evaluator → Notifier ในรอบเดียว (cron ~15 นาที)
 */
export async function runIndicatorAlertTick(client: Client): Promise<{ notified: number }> {
  const alerts = await loadActiveRsi1hAlerts();
  if (alerts.length === 0) return { notified: 0 };

  const uniqueSymbols = Array.from(new Set(alerts.map((a) => a.symbol))).sort();
  const CONCURRENCY = 8;

  const klineBySymbol = new Map<string, Awaited<ReturnType<typeof fetchContractKline1h>>>();
  await mapPoolConcurrent(uniqueSymbols, CONCURRENCY, async (sym) => {
    const k = await fetchContractKline1h(sym);
    klineBySymbol.set(sym, k);
    return k;
  });

  const now = Date.now();
  let notified = 0;

  for (const a of alerts) {
    const pack = klineBySymbol.get(a.symbol);
    if (!pack) continue;

    const { close, timeSec } = pack;
    const n = close.length;
    const period = a.parameters.period;
    if (n < period + 3) continue;

    const rsi = rsiWilder(close, period);
    const i = n - 2;
    const iPrev = i - 1;
    const rNow = rsi[i];
    const rPrev = rsi[iPrev];
    if (!Number.isFinite(rNow) || !Number.isFinite(rPrev)) continue;

    const barTimeSec = timeSec[i];
    if (typeof barTimeSec !== "number" || !Number.isFinite(barTimeSec)) continue;

    if (!crossMatch(rPrev, rNow, a.threshold, a.direction)) continue;
    if (a.lastFiredBarTimeSec === barTimeSec) continue;
    if (inCooldown(a, now)) continue;

    const barIso = new Date(barTimeSec * 1000).toISOString();
    const msg = buildLineMessage(a, rPrev, rNow, barIso);
    const iso = new Date().toISOString();

    try {
      await client.pushMessage(a.userId, [{ type: "text", text: msg }]);
      await updateIndicatorAlertAfterFire(a.id, iso, barTimeSec);
      notified += 1;
    } catch (e) {
      console.error("[indicatorAlertWorker] push", a.id, e);
    }
  }

  return { notified };
}

export function getIndicatorCooldownMsDisplay(): number {
  return cooldownMs();
}
