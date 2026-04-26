import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { sendTelegramPublicBroadcastMessage, telegramSparkSystemGroupConfigured } from "./telegramAlert";
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
import {
  loadMarketPulseAlertState,
  saveMarketPulseAlertState,
} from "./marketPulseAlertStateStore";

function marketPulseEnabled(): boolean {
  const v = process.env.MARKET_PULSE_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

/** ส่งทุกรอบ cron ที่ดึงข้อมูลได้ (ไม่กรอง ΔF&G) — ปิด: ไม่ตั้ง หรือ =0 */
function marketPulseAlwaysNotify(): boolean {
  const v = process.env.MARKET_PULSE_ALWAYS_NOTIFY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** อย่างน้อยหนึ่งครั้งต่อช่วง (ดีฟอลต์ ~24 ชม. หลัง push สำเร็จล่าสุด) — ปิด: MARKET_PULSE_DAILY_MIN=0 */
function marketPulseDailyMinEnabled(): boolean {
  const v = process.env.MARKET_PULSE_DAILY_MIN?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}

/** ช่วงห่างขั้นต่ำระหว่าง push สำเร็จ (วินาที) — ดีฟอลต์ 86400 */
function marketPulseDailyMinIntervalSec(): number {
  const n = Number(process.env.MARKET_PULSE_DAILY_MIN_SEC?.trim());
  if (Number.isFinite(n) && n >= 3600 && n <= 172_800) return Math.floor(n);
  return 86_400;
}

function secondsSinceLastSuccessfulPushSec(state: { lastPushAtIso?: string | null }): number | null {
  const iso = state.lastPushAtIso?.trim();
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 1000;
}

/** แจ้งซ้ำเมื่อ |Δ ค่า Fear & Greed| จากครั้งแจ้งล่าสุด ≥ จุดนี้ (ค่าเริ่ม 3) */
function marketPulseAlertDeltaFng(): number {
  const n = Number(process.env.MARKET_PULSE_ALERT_DELTA_FNG?.trim());
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function shouldNotifyMarketPulseFng(prev: number | null, current: number): boolean {
  if (prev == null || !Number.isFinite(prev)) return true;
  return Math.abs(current - prev) >= marketPulseAlertDeltaFng();
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
  /** ค่า F&G ล่าสุดที่ดึงได้ (เมื่อ fetch สำเร็จ) */
  fngValue?: number;
  /** ไม่แจ้งเพราะ |ΔF&G| ต่ำกว่าเกณฑ์ */
  skippedDelta?: boolean;
  lastNotifiedFng?: number | null;
  /** รอบนี้ส่งเพราะครบช่วงขั้นต่ำ (ไม่ใช่แค่ ΔF&G) */
  dailyMinApplied?: boolean;
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
 * ดึง F&G + ตลาด, คำนวณ Vol% เทียบ snapshot ~24 ชม.
 * เมื่อ |Δ Fear & Greed| จากครั้งแจ้งล่าสุด ≥ MARKET_PULSE_ALERT_DELTA_FNG (ค่าเริ่ม 3)
 * หรือเมื่อครบช่วงหลัง push สำเร็จล่าสุด (ดีฟอลต์ ~24 ชม.; ปิด MARKET_PULSE_DAILY_MIN=0)
 * หรือเมื่อตั้ง MARKET_PULSE_ALWAYS_NOTIFY=1 (ส่งทุกรอบ cron):
 * — ถ้าตั้งกลุ่ม Telegram สาธารณะ → ส่งแค่กลุ่ม (topic market_pulse → TELEGRAM_PUBLIC_MARKET_PULSE_MESSAGE_THREAD_ID)
 * — ถ้าไม่ตั้ง → แจ้งผู้ติดตามระบบ (LINE / Telegram ช่องหลัก ตาม sendAlertNotification)
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

  const fngVal = data.fng.value;
  let alertState = await loadMarketPulseAlertState();

  if (
    marketPulseDailyMinEnabled() &&
    alertState.lastNotifiedFngValue != null &&
    !alertState.lastPushAtIso?.trim()
  ) {
    const iso = new Date(
      Date.now() - marketPulseDailyMinIntervalSec() * 1000 - 120_000
    ).toISOString();
    alertState = { ...alertState, lastPushAtIso: iso };
    try {
      await saveMarketPulseAlertState(alertState);
    } catch (e) {
      console.error("[marketPulseTick] backfill lastPushAtIso", e);
    }
  }

  const prevFng = alertState.lastNotifiedFngValue;
  const deltaMin = marketPulseAlertDeltaFng();
  const pushFromAlways = marketPulseAlwaysNotify();
  const pushFromDelta = shouldNotifyMarketPulseFng(prevFng, fngVal);
  const secSincePush = secondsSinceLastSuccessfulPushSec(alertState);
  const intervalSec = marketPulseDailyMinIntervalSec();
  const pushFromDaily =
    marketPulseDailyMinEnabled() &&
    secSincePush != null &&
    secSincePush >= intervalSec;
  const shouldPush = pushFromAlways || pushFromDelta || pushFromDaily;

  const nowIso = new Date().toISOString();
  const volBlob = await loadMarketPulseVolumeBlob();
  const volChange = computeVolumeChangeVs24hApprox(
    volBlob.snapshots,
    nowIso,
    data.global.totalVolumeUsd,
  );

  let body = buildMarketPulseMessage({
    fngValue: data.fng.value,
    fngClassification: data.fng.valueClassification,
    btcDominancePct: data.global.btcDominancePct,
    volumeChangePct24hApprox: volChange,
  });
  if (pushFromDaily && !pushFromDelta && !pushFromAlways) {
    const h = Math.round(intervalSec / 3600);
    body += `\n\n📌 รอบนี้: ส่งตามเกณฑ์อย่างน้อย ~${h} ชม./ครั้ง (ΔF&G ยังไม่ถึง ${deltaMin} จุด)`;
  }

  try {
    await appendVolumeSnapshot(nowIso, data.global.totalVolumeUsd);
  } catch (e) {
    console.error("[marketPulseTick] appendVolumeSnapshot", e);
  }

  if (!shouldPush) {
    return {
      ok: true,
      skipped: "FNG_DELTA_BELOW_THRESHOLD",
      notifiedPushes: 0,
      subscribers: subscribers.length,
      fngValue: fngVal,
      skippedDelta: true,
      lastNotifiedFng: prevFng,
    };
  }

  let notifiedPushes = 0;

  if (telegramSparkSystemGroupConfigured()) {
    try {
      await sendTelegramPublicBroadcastMessage(body, "market_pulse");
      notifiedPushes = 1;
    } catch (e) {
      console.error("[marketPulseTick] telegram public group", e);
    }
  } else {
    if (subscribers.length === 0) {
      return {
        ok: true,
        skipped: "NO_SUBSCRIBERS",
        notifiedPushes: 0,
        subscribers: 0,
        fngValue: fngVal,
        skippedDelta: false,
        lastNotifiedFng: prevFng,
      };
    }
    for (const uid of subscribers) {
      try {
        await sendAlertNotification(client, uid, body);
        notifiedPushes += 1;
      } catch (e) {
        console.error("[marketPulseTick] notify", uid, e);
      }
    }
  }

  if (notifiedPushes > 0) {
    try {
      alertState = {
        ...alertState,
        lastNotifiedFngValue: fngVal,
        lastPushAtIso: new Date().toISOString(),
      };
      await saveMarketPulseAlertState(alertState);
    } catch (e) {
      console.error("[marketPulseTick] saveMarketPulseAlertState", e);
    }
  }

  return {
    ok: true,
    notifiedPushes,
    subscribers: subscribers.length,
    fngValue: fngVal,
    skippedDelta: false,
    lastNotifiedFng: prevFng,
    dailyMinApplied: Boolean(pushFromDaily && !pushFromAlways),
  };
}
