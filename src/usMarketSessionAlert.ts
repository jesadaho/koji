import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { loadSystemChangeSubscribers } from "./systemChangeSubscribersStore";
import { sendTelegramPublicBroadcastMessage, telegramSparkSystemGroupConfigured } from "./telegramAlert";
import { loadUpcomingEventsState, saveUpcomingEventsState } from "./upcomingEventsState";

const BKK = "Asia/Bangkok";

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function usSessionAlertsEnabled(): boolean {
  return envFlagOn("US_SESSION_ALERTS_ENABLED", true);
}

function bkkYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BKK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** นาทีนับจากเที่ยงคืน (Bangkok) */
function bkkMinutesFromMidnight(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BKK,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/** Pre-market / US cash open window (BKK) — 19:30–20:30 */
const OPEN_START = 19 * 60 + 30;
const OPEN_END = 20 * 60 + 30;
/** US regular close / rebalance window (BKK) — 03:00–04:00 */
const CLOSE_START = 3 * 60;
const CLOSE_END = 4 * 60;

function inOpenWindow(min: number): boolean {
  return min >= OPEN_START && min <= OPEN_END;
}

function inCloseWindow(min: number): boolean {
  return min >= CLOSE_START && min <= CLOSE_END;
}

function buildOpenMessage(_now: Date): string {
  return [
    "[ 🌐 EVENT: US MARKET OPEN ]",
    "",
    "🇺🇸 Wall Street Active",
    "🕒 Time: 19:30 BKK",
    "🚨 Impact: High Volatility (30–60m)",
    "",
    "🦉 Koji's Note:",
    '"ระวังความผันผวนช่วงเปิดตลาด แนะนำรอการคอนเฟิร์มโครงสร้างราคา (Market Structure) ก่อนเทรดครับ"',
    "",
    "⚠️ Not financial advice",
  ].join("\n");
}

function buildCloseMessage(now: Date): string {
  const timeBkk = new Intl.DateTimeFormat("en-GB", {
    timeZone: BKK,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return [
    "[ 🌐 MARKET SESSION: US CLOSE ]",
    "",
    "🇺🇸 US Regular Close / Rebalance Window",
    `🕒 Time: ${timeBkk} BKK (Volatility Window: 60m)`,
    "📊 Impact: Liquidity Shift / Close Auction & Rebalance",
    "",
    "🦉 Koji's Note:",
    '"ระวังการสะบัดและสเปรดกว้าง — โปรดจัดการขนาดออเดอร์และสต็อปครับ"',
    "",
    "⚠️ Not financial advice",
  ].join("\n");
}

/**
 * กลุ่มสาธารณะ (events_session topic) ถ้าตั้งครบ; ไม่งั้นส่งหาผู้ติดตาม «ระบบ» (LINE/Telegram/DISCORD ตาม sendAlertNotification)
 * ถ้า Telegram กลุ่มล้มเหลว → ลองผู้ติดตามระบบต่อ
 */
async function deliverUsSessionMessage(client: Client, text: string): Promise<number> {
  if (telegramSparkSystemGroupConfigured()) {
    try {
      await sendTelegramPublicBroadcastMessage(text, "events_session");
      return 1;
    } catch (e) {
      console.error("[usMarketSessionAlert] telegram public group failed", e);
    }
  }
  const subscribers = await loadSystemChangeSubscribers();
  let ok = 0;
  for (const uid of subscribers) {
    try {
      await sendAlertNotification(client, uid, text);
      ok += 1;
    } catch (e) {
      console.error("[usMarketSessionAlert] notify", uid, e);
    }
  }
  return ok;
}

/**
 * แจ้งเตือนช่วง US session (BKK) — ส่งอย่างละครั้งต่อวันปฏิทินไทยเมื่อเข้า window
 */
export async function runUsMarketSessionAlerts(client: Client, nowMs: number): Promise<{ sent: number; skipped: string }> {
  if (!usSessionAlertsEnabled()) {
    return { sent: 0, skipped: "US_SESSION_ALERTS_ENABLED=0" };
  }

  const now = new Date(nowMs);
  const ymd = bkkYmd(now);
  const min = bkkMinutesFromMidnight(now);

  let state = await loadUpcomingEventsState();
  let sent = 0;
  let skipped = "";

  if (inOpenWindow(min)) {
    if (state.lastUsOpenAlertBkkYmd !== ymd) {
      try {
        const n = await deliverUsSessionMessage(client, buildOpenMessage(now));
        if (n > 0) {
          state.lastUsOpenAlertBkkYmd = ymd;
          sent += 1;
          await saveUpcomingEventsState(state);
        } else {
          skipped = "no_recipients";
        }
      } catch (e) {
        console.error("[usMarketSessionAlert] open", e);
      }
    }
  }

  if (inCloseWindow(min)) {
    if (state.lastUsCloseAlertBkkYmd !== ymd) {
      try {
        const n = await deliverUsSessionMessage(client, buildCloseMessage(now));
        if (n > 0) {
          state.lastUsCloseAlertBkkYmd = ymd;
          sent += 1;
          await saveUpcomingEventsState(state);
        } else {
          skipped = "no_recipients";
        }
      } catch (e) {
        console.error("[usMarketSessionAlert] close", e);
      }
    }
  }

  return { sent, skipped };
}
