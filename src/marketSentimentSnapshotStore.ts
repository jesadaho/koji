import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { marketSentimentFromFng } from "@/lib/marketSentiment";
import type { MarketSentimentSnapshot } from "@/lib/marketSentiment";
import { fetchMarketPulseData, marketPulseUsesCoinMarketCap } from "./marketPulseFetch";
import {
  appendVolumeSnapshot,
  computeVolumeChangeVs24hApprox,
  loadMarketPulseVolumeBlob,
} from "./marketPulseVolumeStore";
import { cloudGet, cloudSet, useCloudStorage } from "./remoteJsonStore";

const KV_KEY = "koji:market_sentiment_snapshot";
const filePath = join(process.cwd(), "data", "market_sentiment_snapshot.json");

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
  const btcDominancePct = typeof o.btcDominancePct === "number" ? o.btcDominancePct : Number.NaN;
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
  if (!Number.isFinite(btcDominancePct) || btcDominancePct <= 0 || btcDominancePct > 100) return null;
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

/**
 * สำหรับบันทึกแถวสถิติ (Snowball / Reversal / RSI) — ใช้ snapshot ล่าสุด
 * ถ้ายังไม่มี (cron ยังไม่รัน / cache ว่าง) ดึง F&G + ตลาดทันทีแล้ว cache ไว้
 */
export async function resolveMarketSentimentForStats(): Promise<MarketSentimentSnapshot | null> {
  const cached = await loadMarketSentimentSnapshot();
  if (cached) return cached;

  try {
    const data = await fetchMarketPulseData();
    const nowIso = new Date().toISOString();
    const volBlob = await loadMarketPulseVolumeBlob();
    const volChange = computeVolumeChangeVs24hApprox(
      volBlob.snapshots,
      nowIso,
      data.global.totalVolumeUsd,
    );
    const snapshot: MarketSentimentSnapshot = {
      asOfIso: nowIso,
      fngValue: data.fng.value,
      fngClassification: data.fng.valueClassification,
      sentiment: marketSentimentFromFng(data.fng.value),
      btcDominancePct: data.global.btcDominancePct,
      volumeChangePct24hApprox: volChange,
      source: marketPulseUsesCoinMarketCap() ? "cmc" : "alt_coingecko",
    };
    try {
      await appendVolumeSnapshot(nowIso, data.global.totalVolumeUsd);
    } catch {
      /* ignore */
    }
    try {
      await saveMarketSentimentSnapshot(snapshot);
    } catch {
      /* ignore */
    }
    return normalizeSnapshot(snapshot);
  } catch (e) {
    console.error("[marketSentimentSnapshot] resolve for stats failed", e);
    return null;
  }
}

