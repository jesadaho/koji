import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { getTopUsdtSymbolsByAmount24 } from "./mexcMarkets";
import { sendTelegramPublicBroadcastMessage, telegramSparkSystemGroupConfigured } from "./telegramAlert";
import { formatScore } from "./marketsFormat";
import {
  loadVolumeSignalAlerts,
  setVolumeSignalLastNotified,
  type VolumeSignalAlert,
  type VolumeSignalTimeframe,
} from "./volumeSignalAlertsStore";
import { computeVolumeSpikeRatio, fetchContractKlineVolumeSignal } from "./volumeSignalKline";

const TOP_N = 30;

function minVolRatio(): number {
  const v = Number(process.env.VOLUME_SIGNAL_MIN_VOL_RATIO);
  return Number.isFinite(v) && v > 1 ? v : 3;
}

function cooldownMs(): number {
  const v = Number(process.env.VOLUME_SIGNAL_COOLDOWN_MS);
  return Number.isFinite(v) && v > 0 ? v : 4 * 3600 * 1000;
}

/** เฟส 2: |% เปลี่ยนราคาแท่ง| ขั้นต่ำ — 0 = ปิดเกณฑ์นี้ */
function minAbsReturnPctEnv(): number {
  const v = Number(process.env.VOLUME_SIGNAL_MIN_ABS_RETURN_PCT);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/** เฟส 2: |momentumScore| ขั้นต่ำ — 0 = ปิด */
function minAbsMomentumEnv(): number {
  const v = Number(process.env.VOLUME_SIGNAL_MIN_ABS_MOMENTUM);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function effectiveMinVolRatio(a: VolumeSignalAlert): number {
  const d = minVolRatio();
  if (typeof a.minVolRatio === "number" && Number.isFinite(a.minVolRatio) && a.minVolRatio >= 1.5) {
    return a.minVolRatio;
  }
  return d;
}

function effectiveMinAbsReturnPct(a: VolumeSignalAlert): number {
  const env = minAbsReturnPctEnv();
  if (typeof a.minAbsReturnPct === "number" && Number.isFinite(a.minAbsReturnPct) && a.minAbsReturnPct >= 0) {
    return a.minAbsReturnPct;
  }
  return env;
}

function inCooldown(a: VolumeSignalAlert, now: number): boolean {
  if (!a.lastNotifiedAt) return false;
  const t = Date.parse(a.lastNotifiedAt);
  if (Number.isNaN(t)) return false;
  return now - t < cooldownMs();
}

async function mapPoolConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const part = await Promise.all(chunk.map(fn));
    out.push(...part);
  }
  return out;
}

type GroupKey = `${string}\t${VolumeSignalTimeframe}`;

type Hit = { volRatio: number; returnPct: number; momentumScore: number };

function passesQualityGates(hit: Hit, a: VolumeSignalAlert): boolean {
  const minV = effectiveMinVolRatio(a);
  if (hit.volRatio < minV) return false;

  const minRet = effectiveMinAbsReturnPct(a);
  if (minRet > 0 && Math.abs(hit.returnPct) < minRet) return false;

  const minMom = minAbsMomentumEnv();
  if (minMom > 0 && Math.abs(hit.momentumScore) < minMom) return false;

  return true;
}

function directionEmoji(returnPct: number): string {
  if (returnPct > 0.02) return "🟢";
  if (returnPct < -0.02) return "🔴";
  return "📊";
}

function buildVolumeSignalLineMessage(
  a: VolumeSignalAlert,
  hit: Hit,
  ratioFloor: number
): string {
  const tfLabel = a.timeframe === "4h" ? "4 ชม." : "1 ชม.";
  const dir = directionEmoji(hit.returnPct);
  const minV = effectiveMinVolRatio(a);
  const minRet = effectiveMinAbsReturnPct(a);
  const momFloor = minAbsMomentumEnv();

  const lines = [
    `📊 Koji — Volume + Momentum (Top ${TOP_N} vol)`,
    `🪙 ${a.coinId} · แท่ง ${tfLabel}`,
    "",
    `📦 ปริมาณ (Vol spike)`,
    `   เทียบค่าเฉลี่ย: ${hit.volRatio.toFixed(2)}× (เกณฑ์ ≥ ${minV.toFixed(2)}× · ค่าเริ่มระบบ ${ratioFloor.toFixed(2)}×)`,
    "",
    `💹 Momentum ${dir}`,
    `   Score: ${formatScore(hit.momentumScore)} · แท่ง ${hit.returnPct >= 0 ? "+" : ""}${hit.returnPct.toFixed(2)}%`,
  ];

  if (minRet > 0) {
    lines.push(`   (กรอง |แท่ง %| ≥ ${minRet.toFixed(2)}%)`);
  }
  if (momFloor > 0) {
    lines.push(`   (กรอง |score| ≥ ${formatScore(momFloor)})`);
  }

  lines.push(
    "",
    "มีการเคลื่อนไหวของปริมาณผิดปกติ — ใช้ร่วมกับทิศทาง/ความเสี่ยงของคุณ"
  );

  return lines.join("\n");
}

export async function runVolumeSignalAlertTick(client: Client): Promise<{ notified: number }> {
  const all = await loadVolumeSignalAlerts();
  if (all.length === 0) return { notified: 0 };

  let top: string[];
  try {
    top = await getTopUsdtSymbolsByAmount24(TOP_N);
  } catch (e) {
    console.error("[volumeSignalAlertTick] top30", e);
    return { notified: 0 };
  }
  const allowed = new Set(top);
  const ratioFloor = minVolRatio();
  const now = Date.now();

  const groups = new Map<GroupKey, VolumeSignalAlert[]>();
  for (const a of all) {
    if (!allowed.has(a.coinId)) continue;
    const key = `${a.coinId}\t${a.timeframe}` as GroupKey;
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }

  const entries = Array.from(groups.entries());
  const CONCURRENCY = 6;

  const results = await mapPoolConcurrent(entries, CONCURRENCY, async ([key, alerts]) => {
    const tab = key.indexOf("\t");
    const symbol = key.slice(0, tab);
    const tf = key.slice(tab + 1) as VolumeSignalTimeframe;

    const kline = await fetchContractKlineVolumeSignal(symbol, tf);
    if (!kline) return { alerts, hit: null as Hit | null };
    const hit = computeVolumeSpikeRatio(kline);
    return { alerts, hit };
  });

  let notified = 0;

  for (const { alerts, hit } of results) {
    if (!hit) continue;

    for (const a of alerts) {
      if (!passesQualityGates(hit, a)) continue;
      if (inCooldown(a, now)) continue;

      const msg = buildVolumeSignalLineMessage(a, hit, ratioFloor);
      const iso = new Date().toISOString();

      try {
        await sendAlertNotification(client, a.userId, msg);
        if (telegramSparkSystemGroupConfigured()) {
          try {
            await sendTelegramPublicBroadcastMessage(msg, "technical");
          } catch (e) {
            console.error("[volumeSignalAlertTick] public group mirror", a.id, e);
          }
        }
        await setVolumeSignalLastNotified(a.id, iso, {
          volRatio: hit.volRatio,
          returnPct: hit.returnPct,
          momentumScore: hit.momentumScore,
        });
        notified += 1;
      } catch (e) {
        console.error("[volumeSignalAlertTick] push", a.id, e);
      }
    }
  }

  return { notified };
}

/** สำหรับ LIFF meta (เกณฑ์จาก env / default) */
export function getVolumeSignalMinVolRatioDisplay(): number {
  return minVolRatio();
}

export function getVolumeSignalCooldownMsDisplay(): number {
  return cooldownMs();
}

export function getVolumeSignalMinAbsReturnPctDisplay(): number {
  return minAbsReturnPctEnv();
}

export function getVolumeSignalMinAbsMomentumDisplay(): number {
  return minAbsMomentumEnv();
}
