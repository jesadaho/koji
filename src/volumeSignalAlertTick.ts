import type { Client } from "@line/bot-sdk";
import { getTopUsdtSymbolsByAmount24 } from "./mexcMarkets";
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
  const ratioMin = minVolRatio();
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
    if (!kline) return { alerts, hit: null as { volRatio: number; returnPct: number } | null };
    const hit = computeVolumeSpikeRatio(kline);
    return { alerts, hit };
  });

  let notified = 0;

  for (const { alerts, hit } of results) {
    if (!hit || hit.volRatio < ratioMin) continue;

    for (const a of alerts) {
      if (inCooldown(a, now)) continue;
      const tfLabel = a.timeframe === "4h" ? "4 ชม." : "1 ชม.";
      const msg = [
        `📊 Koji — สัญญาณ Volume (Top ${TOP_N} vol)`,
        `${a.coinId} · แท่ง ${tfLabel}`,
        `ปริมาณเทียบค่าเฉลี่ย ~ ${hit.volRatio.toFixed(2)}× (เกณฑ์ ≥ ${ratioMin})`,
        `แท่งล่าสุดเปลี่ยนราคา ~ ${hit.returnPct >= 0 ? "+" : ""}${hit.returnPct.toFixed(2)}%`,
        "",
        "มีการเคลื่อนไหวของปริมาณผิดปกติ — ระวังเลือกทิศทางเร็วๆ นี้",
      ].join("\n");

      try {
        await client.pushMessage(a.userId, [{ type: "text", text: msg }]);
        await setVolumeSignalLastNotified(a.id, new Date().toISOString());
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
