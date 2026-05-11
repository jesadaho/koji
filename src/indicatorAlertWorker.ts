import type { Client } from "@line/bot-sdk";
import { runEma612ContractWatchAlertTick } from "./ema612ContractWatchAlertTick";
import { fetchContractKlineForTf, type IndicatorChartTf } from "./indicatorKline";
import { sendAlertNotification } from "./alertNotify";
import { sendTelegramPublicBroadcastMessage, telegramSparkSystemGroupConfigured } from "./telegramAlert";
import { isIndicatorPublicFeedEnabled, runPublicIndicatorFeedInternal } from "./publicIndicatorFeed";
import { runSnowballStatsFollowUpTick } from "./snowballStatsTick";
import { emaLine, rsiWilder } from "./indicatorMath";
import {
  loadActiveEmaCrossAlerts,
  loadActiveRsiAlerts,
  updateIndicatorAlertAfterFire,
  type EmaCrossIndicatorAlert,
  type RsiIndicatorAlert,
} from "./indicatorAlertsStore";

function cooldownMs(): number {
  const v = Number(process.env.INDICATOR_ALERT_COOLDOWN_MS);
  return Number.isFinite(v) && v > 0 ? v : 4 * 3600 * 1000;
}

function inCooldown(
  a: { lastTriggeredAt?: string },
  now: number
): boolean {
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

function rsiCrossMatch(
  rPrev: number,
  rNow: number,
  threshold: number,
  direction: "above" | "below" | "both"
): boolean {
  if (direction === "both") {
    const up = rPrev <= threshold && rNow > threshold;
    const down = rPrev >= threshold && rNow < threshold;
    return up || down;
  }
  if (direction === "above") {
    return rPrev <= threshold && rNow > threshold;
  }
  return rPrev >= threshold && rNow < threshold;
}

function isNeutralRsi50Threshold(threshold: number): boolean {
  return Math.abs(threshold - 50) < 1e-9;
}

function rsiTfLabel(tf: RsiIndicatorAlert["timeframe"]): string {
  return tf === "4h" ? "4 ชม." : "1 ชม.";
}

function buildRsiLineMessage(a: RsiIndicatorAlert, rPrev: number, rNow: number, barIso: string): string {
  const sym = displaySymbol(a.symbol);
  const tfLabel = rsiTfLabel(a.timeframe);
  let crossLine: string;
  if (a.direction === "both") {
    const up = rPrev <= a.threshold && rNow > a.threshold;
    crossLine = up
      ? `ข้ามขึ้นเหนือ > ${a.threshold}`
      : `ข้ามลงใต้ < ${a.threshold}`;
  } else {
    const cmp = a.direction === "above" ? ">" : "<";
    crossLine = `ข้ามเกณฑ์ (${cmp} ${a.threshold})`;
  }
  return [
    `📈 Koji — RSI alert (${tfLabel})`,
    `🪙 ${sym}`,
    "",
    `📊 RSI(${a.parameters.period}) ${crossLine}`,
    `   แท่งก่อน: ${rPrev.toFixed(2)} → ล่าสุด: ${rNow.toFixed(2)}`,
    `   แท่งปิด (UTC): ${barIso}`,
    "",
    "สัญญาณจากแท่งปิดล่าสุด — ใช้เป็นแนวทาง ไม่ใช่คำแนะนำลงทุน",
  ].join("\n");
}

function buildEmaLineMessage(
  a: EmaCrossIndicatorAlert,
  fastPrev: number,
  slowPrev: number,
  fastNow: number,
  slowNow: number,
  barIso: string
): string {
  const sym = displaySymbol(a.symbol);
  const tfLabel = a.timeframe === "4h" ? "4 ชม." : "1 ชม.";
  const kindLabel = a.emaCrossKind === "golden" ? "Golden cross (เร่งตัว)" : "Death cross (กดลง)";
  return [
    `📉 Koji — EMA Cross (${tfLabel})`,
    `🪙 ${sym}`,
    "",
    `📊 ${kindLabel}`,
    `   EMA ${a.parameters.fast} / ${a.parameters.slow}`,
    `   ก่อน: ${fastPrev.toFixed(4)} vs ${slowPrev.toFixed(4)} → ล่าสุด: ${fastNow.toFixed(4)} vs ${slowNow.toFixed(4)}`,
    `   แท่งปิด (UTC): ${barIso}`,
    "",
    "สัญญาณจากแท่งปิดล่าสุด — ใช้เป็นแนวทาง ไม่ใช่คำแนะนำลงทุน",
  ].join("\n");
}

async function runRsiInternal(client: Client, now: number): Promise<number> {
  const alerts = await loadActiveRsiAlerts();
  if (alerts.length === 0) return 0;

  const keys = new Set<string>();
  for (const a of alerts) {
    keys.add(`${a.symbol}\t${a.timeframe}`);
  }

  const klineMap = new Map<string, Awaited<ReturnType<typeof fetchContractKlineForTf>>>();
  await mapPoolConcurrent(Array.from(keys), 8, async (key) => {
    const tab = key.indexOf("\t");
    const sym = key.slice(0, tab);
    const tf = key.slice(tab + 1) as IndicatorChartTf;
    const k = await fetchContractKlineForTf(sym, tf);
    klineMap.set(key, k);
    return k;
  });

  let notified = 0;

  for (const a of alerts) {
    const pack = klineMap.get(`${a.symbol}\t${a.timeframe}`);
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

    if (isNeutralRsi50Threshold(a.threshold)) continue;
    if (!rsiCrossMatch(rPrev, rNow, a.threshold, a.direction)) continue;
    if (a.lastFiredBarTimeSec === barTimeSec) continue;
    if (inCooldown(a, now)) continue;

    const barIso = new Date(barTimeSec * 1000).toISOString();
    const msg = buildRsiLineMessage(a, rPrev, rNow, barIso);
    const iso = new Date().toISOString();

    try {
      await sendAlertNotification(client, a.userId, msg);
      if (telegramSparkSystemGroupConfigured()) {
        try {
          await sendTelegramPublicBroadcastMessage(msg, "technical");
        } catch (e) {
          console.error("[indicatorAlertWorker] RSI public group mirror", a.id, e);
        }
      }
      await updateIndicatorAlertAfterFire(a.id, iso, barTimeSec);
      notified += 1;
    } catch (e) {
      console.error("[indicatorAlertWorker] RSI push", a.id, e);
    }
  }

  return notified;
}

function emaCrossMatch(fastAbovePrev: boolean, fastAboveNow: boolean, kind: "golden" | "death"): boolean {
  if (kind === "golden") {
    return !fastAbovePrev && fastAboveNow;
  }
  return fastAbovePrev && !fastAboveNow;
}

async function runEmaCrossInternal(client: Client, now: number): Promise<number> {
  const alerts = await loadActiveEmaCrossAlerts();
  if (alerts.length === 0) return 0;

  const keys = new Set<string>();
  for (const a of alerts) {
    keys.add(`${a.symbol}\t${a.timeframe}`);
  }

  const klineMap = new Map<string, Awaited<ReturnType<typeof fetchContractKlineForTf>>>();
  await mapPoolConcurrent(Array.from(keys), 8, async (key) => {
    const tab = key.indexOf("\t");
    const sym = key.slice(0, tab);
    const tf = key.slice(tab + 1) as IndicatorChartTf;
    const k = await fetchContractKlineForTf(sym, tf);
    klineMap.set(key, k);
    return k;
  });

  let notified = 0;

  for (const a of alerts) {
    const pack = klineMap.get(`${a.symbol}\t${a.timeframe}`);
    if (!pack) continue;

    const { close, timeSec } = pack;
    const n = close.length;
    const { fast, slow } = a.parameters;
    if (fast >= slow || fast < 2 || slow < 3) continue;

    const minIdx = Math.max(fast, slow) - 1;
    const emaF = emaLine(close, fast);
    const emaS = emaLine(close, slow);

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

    const fastAboveNow = efNow > esNow;
    const fastAbovePrev = efPrev > esPrev;

    if (!emaCrossMatch(fastAbovePrev, fastAboveNow, a.emaCrossKind)) continue;

    const barTimeSec = timeSec[i];
    if (typeof barTimeSec !== "number" || !Number.isFinite(barTimeSec)) continue;
    if (a.lastFiredBarTimeSec === barTimeSec) continue;
    if (inCooldown(a, now)) continue;

    const barIso = new Date(barTimeSec * 1000).toISOString();
    const msg = buildEmaLineMessage(a, efPrev, esPrev, efNow, esNow, barIso);
    const iso = new Date().toISOString();

    try {
      await sendAlertNotification(client, a.userId, msg);
      if (telegramSparkSystemGroupConfigured()) {
        try {
          await sendTelegramPublicBroadcastMessage(msg, "technical");
        } catch (e) {
          console.error("[indicatorAlertWorker] EMA public group mirror", a.id, e);
        }
      }
      await updateIndicatorAlertAfterFire(a.id, iso, barTimeSec);
      notified += 1;
    } catch (e) {
      console.error("[indicatorAlertWorker] EMA push", a.id, e);
    }
  }

  return notified;
}

/**
 * Collector → Evaluator → Notifier ในรอบเดียว (cron price-sync ~15 นาที)
 */
export async function runIndicatorAlertTick(client: Client): Promise<{ notified: number; detail?: string }> {
  const now = Date.now();
  const rsiN = await runRsiInternal(client, now);
  const emaN = await runEmaCrossInternal(client, now);
  const publicN = isIndicatorPublicFeedEnabled() ? await runPublicIndicatorFeedInternal(client, now) : 0;
  const snowballStatsN = await runSnowballStatsFollowUpTick(now);
  const watch612 = await runEma612ContractWatchAlertTick(client);
  const total = rsiN + emaN + publicN + watch612;

  const parts: string[] = [`RSI/EMA (MEXC) ${rsiN + emaN}`];
  if (publicN > 0) parts.push(`public Binance ${publicN}`);
  if (snowballStatsN > 0) parts.push(`snowball stats ${snowballStatsN}`);
  if (watch612 > 0) parts.push(`EMA6/12·15m ติดตาม ${watch612}`);
  const detail = total > 0 ? `แจ้ง ${total} ครั้ง (${parts.join(" · ")})` : undefined;

  return { notified: total, ...(detail ? { detail } : {}) };
}

export function getIndicatorCooldownMsDisplay(): number {
  return cooldownMs();
}
