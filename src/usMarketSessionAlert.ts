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

function buildOpenMessage(now: Date): string {
  const timeBkk = new Intl.DateTimeFormat("en-GB", {
    timeZone: BKK,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return [
    "🔔 Market Status: US Session Open",
    "🇺🇸 Wall Street is now Active",
    "",
    `Time: ${timeBkk} BKK (window ~19:30–20:30)`,
    "",
    "Impact: High Volatility Expected",
    "",
    `Koji's Note: "ระวังการสะบัดของราคาใน 30 นาทีแรก แนะนำให้รอดูทรงกราฟก่อนเข้าออเดอร์ครับ"`,
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
    "🔔 Market Status: US Session Close Window",
    "🇺🇸 ช่วงปิดตลาดสหรัฐฯ — มักมี rebalance / ทำราคาปิด",
    "",
    `Time: ${timeBkk} BKK (window ~03:00–04:00)`,
    "",
    "Impact: Liquidity & Volatility — watch whipsaw / gaps",
    "",
    `Koji's Note: "ระวังการสะบัดและสเปรดกว้าง — โปรดจัดการขนาดออเดอร์และสต็อปครับ"`,
    "",
    "⚠️ Not financial advice",
  ].join("\n");
}

/**
 * แจ้งเตือนช่วง US session (BKK) — ส่งอย่างละครั้งต่อวันปฏิทินไทยเมื่อเข้า window
 */
export async function runUsMarketSessionAlerts(nowMs: number): Promise<{ sent: number; skipped: string }> {
  if (!usSessionAlertsEnabled()) {
    return { sent: 0, skipped: "US_SESSION_ALERTS_ENABLED=0" };
  }
  if (!telegramSparkSystemGroupConfigured()) {
    return { sent: 0, skipped: "no_telegram_public_chat" };
  }

  const now = new Date(nowMs);
  const ymd = bkkYmd(now);
  const min = bkkMinutesFromMidnight(now);

  let state = await loadUpcomingEventsState();
  let sent = 0;

  if (inOpenWindow(min)) {
    if (state.lastUsOpenAlertBkkYmd !== ymd) {
      try {
        await sendTelegramPublicBroadcastMessage(buildOpenMessage(now), "events_session");
        state.lastUsOpenAlertBkkYmd = ymd;
        sent += 1;
        await saveUpcomingEventsState(state);
      } catch (e) {
        console.error("[usMarketSessionAlert] open", e);
      }
    }
  }

  if (inCloseWindow(min)) {
    if (state.lastUsCloseAlertBkkYmd !== ymd) {
      try {
        await sendTelegramPublicBroadcastMessage(buildCloseMessage(now), "events_session");
        state.lastUsCloseAlertBkkYmd = ymd;
        sent += 1;
        await saveUpcomingEventsState(state);
      } catch (e) {
        console.error("[usMarketSessionAlert] close", e);
      }
    }
  }

  return { sent, skipped: "" };
}
