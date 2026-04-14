import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import {
  fetchMarketPulseData,
  MarketPulseFetchError,
  marketPulseUsesCoinMarketCap,
} from "./marketPulseFetch";
import {
  appendVolumeSnapshot,
  computeVolumeChangeVs24hApprox,
  loadMarketPulseVolumeBlob,
} from "./marketPulseVolumeStore";
import { loadSystemChangeSubscribers } from "./systemChangeSubscribersStore";

function marketPulseEnabled(): boolean {
  const v = process.env.MARKET_PULSE_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

function fngDotEmoji(value: number): string {
  if (value >= 75) return "🟢";
  if (value >= 55) return "🟢";
  if (value >= 45) return "🟡";
  if (value >= 25) return "🟠";
  return "🔴";
}

function sentimentFromFng(value: number): { label: string; emoji: string } {
  if (value >= 56) return { label: "Bullish", emoji: "🚀" };
  if (value <= 44) return { label: "Bearish", emoji: "📉" };
  return { label: "Neutral", emoji: "⚖️" };
}

function btcDomNote(btcD: number): string {
  if (btcD >= 52) return "เงินยังนิ่งอยู่ที่พี่ใหญ่";
  if (btcD < 48) return "เงินไหลไป alt มากขึ้น";
  return "สมดุลระหว่าง BTC กับ alt";
}

function volComment(pct: number | null): string {
  if (pct == null) return "ยังไม่มีข้อมูลเปรียบเทียบ ~24 ชม.";
  if (pct >= 5) return "ตลาดเริ่มคึกคัก";
  if (pct <= -5) return "ปริมาณเทียบย้อนหลังลดลงชัดเจน";
  if (pct >= 1) return "ปริมาณสูงขึ้นเล็กน้อย";
  if (pct <= -1) return "ปริมาณลดลงเล็กน้อย";
  return "ปริมาณใกล้เคียงเมื่อวาน";
}

function fmtSignedPct1(pct: number | null): string {
  if (pct == null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function buildMarketPulseMessage(input: {
  fngValue: number;
  fngClassification: string;
  btcDominancePct: number;
  volumeChangePct24hApprox: number | null;
}): string {
  const dot = fngDotEmoji(input.fngValue);
  const sent = sentimentFromFng(input.fngValue);
  const volPctStr = fmtSignedPct1(input.volumeChangePct24hApprox);
  const volLine =
    input.volumeChangePct24hApprox == null
      ? `24h Vol: ${volPctStr} (${volComment(null)})`
      : `24h Vol: ${volPctStr} (${volComment(input.volumeChangePct24hApprox)})`;

  const sourceHint = marketPulseUsesCoinMarketCap()
    ? "ที่มา: CoinMarketCap (Crypto Fear & Greed + global metrics — สอดคล้องการ์ดบน CMC)"
    : "ที่มา: Alternative.me (F&G) + CoinGecko (BTC.D / Vol)";

  return [
    "🦉 Koji Market Pulse",
    `สถานะตลาดปัจจุบัน: ${input.fngClassification} (${input.fngValue}/100) ${dot}`,
    "",
    `BTC.D: ${input.btcDominancePct.toFixed(1)}% (${btcDomNote(input.btcDominancePct)})`,
    "",
    volLine,
    "",
    `Sentiment: ${sent.label} ${sent.emoji}`,
    "",
    sourceHint,
  ].join("\n");
}

export type MarketPulseTickResult = {
  ok: boolean;
  skipped?: string;
  notifiedPushes: number;
  subscribers: number;
  error?: string;
};

/**
 * ข้อความ Market Pulse ปัจจุบัน (LINE คำสั่งเช็ค) — ไม่บันทึก snapshot ปริมาณ
 */
export async function getMarketPulseStatusMessage(): Promise<string> {
  const data = await fetchMarketPulseData();
  const nowIso = new Date().toISOString();
  const volBlob = await loadMarketPulseVolumeBlob();
  const volChange = computeVolumeChangeVs24hApprox(
    volBlob.snapshots,
    nowIso,
    data.global.totalVolumeUsd,
  );
  return buildMarketPulseMessage({
    fngValue: data.fng.value,
    fngClassification: data.fng.valueClassification,
    btcDominancePct: data.global.btcDominancePct,
    volumeChangePct24hApprox: volChange,
  });
}

/**
 * ดึง F&G + CoinGecko, คำนวณ Vol% เทียบ snapshot ~24 ชม., แจ้งผู้ติดตามระบบ
 */
export async function runMarketPulseTick(client: Client): Promise<MarketPulseTickResult> {
  if (!marketPulseEnabled()) {
    return { ok: true, skipped: "MARKET_PULSE_DISABLED", notifiedPushes: 0, subscribers: 0 };
  }

  const subscribers = await loadSystemChangeSubscribers();

  let data: Awaited<ReturnType<typeof fetchMarketPulseData>>;
  try {
    data = await fetchMarketPulseData();
  } catch (e) {
    const msg =
      e instanceof MarketPulseFetchError
        ? `${e.source}: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    console.error("[marketPulseTick] fetch failed", msg);
    return { ok: false, notifiedPushes: 0, subscribers: subscribers.length, error: msg };
  }

  const nowIso = new Date().toISOString();
  const volBlob = await loadMarketPulseVolumeBlob();
  const volChange = computeVolumeChangeVs24hApprox(
    volBlob.snapshots,
    nowIso,
    data.global.totalVolumeUsd,
  );

  const body = buildMarketPulseMessage({
    fngValue: data.fng.value,
    fngClassification: data.fng.valueClassification,
    btcDominancePct: data.global.btcDominancePct,
    volumeChangePct24hApprox: volChange,
  });

  let notifiedPushes = 0;
  if (subscribers.length === 0) {
    try {
      await appendVolumeSnapshot(nowIso, data.global.totalVolumeUsd);
    } catch (e) {
      console.error("[marketPulseTick] appendVolumeSnapshot", e);
    }
    return { ok: true, skipped: "NO_SUBSCRIBERS", notifiedPushes: 0, subscribers: 0 };
  }

  for (const uid of subscribers) {
    try {
      await sendAlertNotification(client, uid, body);
      notifiedPushes += 1;
    } catch (e) {
      console.error("[marketPulseTick] notify", uid, e);
    }
  }

  try {
    await appendVolumeSnapshot(nowIso, data.global.totalVolumeUsd);
  } catch (e) {
    console.error("[marketPulseTick] appendVolumeSnapshot", e);
  }

  return { ok: true, notifiedPushes, subscribers: subscribers.length };
}
