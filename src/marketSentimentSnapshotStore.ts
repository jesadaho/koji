import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { marketSentimentFromFng } from "@/lib/marketSentiment";
import type { MarketSentimentSnapshot } from "@/lib/marketSentiment";
import {
  fetchFearGreedAtTime,
  fetchMarketPulseData,
  marketPulseUsesCoinMarketCap,
} from "./marketPulseFetch";
import {
  appendVolumeSnapshot,
  computeVolumeChangeVs24hApprox,
  loadMarketPulseVolumeBlob,
} from "./marketPulseVolumeStore";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:market_sentiment_snapshot";
const filePath = join(process.cwd(), "data", "market_sentiment_snapshot.json");

/** แถวสด — ดึง F&G ใหม่เสมอ (ไม่ใช้ cache เก่า) */
const LIVE_ALERT_MAX_AGE_MS = 10 * 60_000;
/** F&G รายวัน — snapshot asOf ควรอยู่ใกล้ alertedAt ไม่เกิน ~36 ชม. */
const ALERT_SNAPSHOT_MAX_SKEW_MS = 36 * 3600_000;

function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

function assertWritableStorage(): void {
  if (process.env.VERCEL === "1" && !useCloudStorage()) {
    throw new Error(
      "บน Vercel ต้องตั้ง REDIS_URL หรือ Vercel KV (KV_REST_API_URL) สำหรับ market sentiment snapshot"
    );
  }
}

async function ensureJsonFile(): Promise<void> {
  try {
    await readFile(filePath, "utf-8");
  } catch {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ snapshot: null }, null, 2), "utf-8");
  }
}

function normalizeSnapshot(raw: unknown): MarketSentimentSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<MarketSentimentSnapshot>;
  const asOfIso = typeof o.asOfIso === "string" ? o.asOfIso.trim() : "";
  const fngValue = typeof o.fngValue === "number" ? o.fngValue : Number.NaN;
  const fngClassification = typeof o.fngClassification === "string" ? o.fngClassification.trim() : "";
  const sentiment = o.sentiment === "Bullish" || o.sentiment === "Neutral" || o.sentiment === "Bearish" ? o.sentiment : null;
  const btcDominancePct =
    o.btcDominancePct === null
      ? null
      : typeof o.btcDominancePct === "number" && Number.isFinite(o.btcDominancePct)
        ? o.btcDominancePct
        : Number.NaN;
  const volumeChangePct24hApprox =
    o.volumeChangePct24hApprox === null
      ? null
      : typeof o.volumeChangePct24hApprox === "number" && Number.isFinite(o.volumeChangePct24hApprox)
        ? o.volumeChangePct24hApprox
        : null;
  const source = o.source === "cmc" || o.source === "alt_coingecko" ? o.source : null;
  const t = Date.parse(asOfIso);
  if (!asOfIso || !Number.isFinite(t)) return null;
  if (!Number.isFinite(fngValue) || fngValue < 0 || fngValue > 100) return null;
  if (!fngClassification) return null;
  if (!sentiment) return null;
  if (btcDominancePct != null && (!Number.isFinite(btcDominancePct) || btcDominancePct <= 0 || btcDominancePct > 100)) {
    return null;
  }
  if (!source) return null;
  return {
    asOfIso,
    fngValue,
    fngClassification,
    sentiment,
    btcDominancePct,
    volumeChangePct24hApprox,
    source,
  };
}

export async function loadMarketSentimentSnapshot(): Promise<MarketSentimentSnapshot | null> {
  if (useCloudStorage()) {
    const data = await cloudGet<{ snapshot?: unknown }>(KV_KEY);
    return normalizeSnapshot(data?.snapshot);
  }
  if (isVercel()) return null;
  await ensureJsonFile();
  const raw = await readFile(filePath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as { snapshot?: unknown };
    return normalizeSnapshot(parsed?.snapshot);
  } catch {
    return null;
  }
}

export async function saveMarketSentimentSnapshot(snapshot: MarketSentimentSnapshot): Promise<void> {
  const s = normalizeSnapshot(snapshot);
  if (!s) return;
  if (useCloudStorage()) {
    await cloudSet(KV_KEY, { snapshot: s });
    return;
  }
  assertWritableStorage();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ snapshot: s }, null, 2), "utf-8");
}

async function fetchFreshMarketSentimentSnapshot(asOfIso?: string): Promise<MarketSentimentSnapshot> {
  const data = await fetchMarketPulseData();
  const iso = asOfIso?.trim() || new Date().toISOString();
  const volBlob = await loadMarketPulseVolumeBlob();
  const volChange = computeVolumeChangeVs24hApprox(volBlob.snapshots, iso, data.global.totalVolumeUsd);
  const snapshot: MarketSentimentSnapshot = {
    asOfIso: iso,
    fngValue: data.fng.value,
    fngClassification: data.fng.valueClassification,
    sentiment: marketSentimentFromFng(data.fng.value),
    btcDominancePct: data.global.btcDominancePct,
    volumeChangePct24hApprox: volChange,
    source: marketPulseUsesCoinMarketCap() ? "cmc" : "alt_coingecko",
  };
  try {
    await appendVolumeSnapshot(iso, data.global.totalVolumeUsd);
  } catch {
    /* ignore */
  }
  try {
    await saveMarketSentimentSnapshot(snapshot);
  } catch {
    /* ignore */
  }
  return snapshot;
}

async function buildMarketSentimentAtAlertTime(alertedAtMs: number): Promise<MarketSentimentSnapshot> {
  const fng = await fetchFearGreedAtTime(alertedAtMs);
  return {
    asOfIso: new Date(fng.asOfMs).toISOString(),
    fngValue: fng.value,
    fngClassification: fng.valueClassification,
    sentiment: marketSentimentFromFng(fng.value),
    btcDominancePct: null,
    volumeChangePct24hApprox: null,
    source: marketPulseUsesCoinMarketCap() ? "cmc" : "alt_coingecko",
  };
}

export type StatsRowWithMarketSentiment = {
  alertedAtMs: number;
  marketSentiment?: MarketSentimentSnapshot | null;
};

/** แถวที่ไม่มี snapshot หรือ asOf ไม่ตรงเวลาแจ้ง (เคยใช้ cache กลาง — F&G เท่ากันทุกแถว) */
export function statsRowNeedsMarketSentimentBackfill(row: StatsRowWithMarketSentiment): boolean {
  const ms = row.marketSentiment;
  if (!ms || !Number.isFinite(ms.fngValue)) return true;
  const asOf = Date.parse(ms.asOfIso);
  if (!Number.isFinite(asOf)) return true;
  return Math.abs(asOf - row.alertedAtMs) > ALERT_SNAPSHOT_MAX_SKEW_MS;
}

/** Backfill F&G ตาม alertedAtMs — ใช้ cache Alternative.me ร่วมกัน · จำกัด maxRows ต่อรอบ (ไม่ตั้ง = ไม่จำกัด) */
export async function backfillStatsMarketSentiment<T extends StatsRowWithMarketSentiment>(
  rows: T[],
  opts?: { maxRows?: number },
): Promise<number> {
  const maxRows = opts?.maxRows;
  let updated = 0;
  for (const row of rows) {
    if (maxRows != null && updated >= maxRows) break;
    if (!statsRowNeedsMarketSentimentBackfill(row)) continue;
    try {
      row.marketSentiment = await buildMarketSentimentAtAlertTime(row.alertedAtMs);
      updated += 1;
    } catch (e) {
      console.error("[marketSentimentSnapshot] backfill row", row.alertedAtMs, e);
    }
  }
  return updated;
}

/** รันหลายรอบจนไม่มีแถวค้าง (เปิดหน้าสถิติ / admin backfill) */
export async function backfillAllStatsMarketSentiment<T extends StatsRowWithMarketSentiment>(
  rows: T[],
  opts?: { maxRowsPerPass?: number; maxPasses?: number },
): Promise<number> {
  const maxPasses = opts?.maxPasses ?? 10;
  const maxRowsPerPass = opts?.maxRowsPerPass ?? 150;
  let total = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const n = await backfillStatsMarketSentiment(rows, { maxRows: maxRowsPerPass });
    total += n;
    if (n === 0) break;
  }
  return total;
}

/**
 * สำหรับบันทึกแถวสถิติ (Snowball / Reversal / RSI)
 * - ส่ง alertedAtMs → F&G ณ เวลาแจ้ง (ย้อนหลังจาก Alternative.me / CMC)
 * - แจ้งสด (≤ ~10 นาที) → ดึง Market Pulse ใหม่ (ไม่ใช้ cache เก่า)
 */
export async function resolveMarketSentimentForStats(
  alertedAtMs?: number,
): Promise<MarketSentimentSnapshot | null> {
  try {
    if (alertedAtMs != null && Number.isFinite(alertedAtMs)) {
      const ageMs = Date.now() - alertedAtMs;
      if (ageMs >= 0 && ageMs < LIVE_ALERT_MAX_AGE_MS) {
        return await fetchFreshMarketSentimentSnapshot(new Date(alertedAtMs).toISOString());
      }
      return await buildMarketSentimentAtAlertTime(alertedAtMs);
    }
    return await fetchFreshMarketSentimentSnapshot();
  } catch (e) {
    console.error("[marketSentimentSnapshot] resolve for stats failed", e);
    return null;
  }
}
