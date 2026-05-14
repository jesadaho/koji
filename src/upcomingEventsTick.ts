import { openAiMacroEventLiveBrief } from "./openAiSummary";
import {
  sendTelegramPublicBroadcastMessage,
  TELEGRAM_SEND_MESSAGE_MAX,
  telegramSparkSystemGroupConfigured,
} from "./telegramAlert";
import {
  buildUpcomingEventsSnapshot,
  fetchUnifiedEventsRange,
  saveSnapshot,
  utcMondayYmdOfDate,
} from "./upcomingEventsService";
import { finnhubCalendarConfigured } from "./finnhubEconomicCalendar";
import { loadUpcomingEventsState, saveUpcomingEventsState, type UpcomingEventsState } from "./upcomingEventsState";
import type { UnifiedEvent } from "./upcomingEventsTypes";

function envFlagOn(key: string, defaultOn: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

function upcomingAlertsEnabled(): boolean {
  return envFlagOn("UPCOMING_EVENTS_ALERTS_ENABLED", true);
}

function weeklyDigestEnabled(): boolean {
  return envFlagOn("UPCOMING_EVENTS_WEEKLY_ENABLED", true);
}

function preAlertEnabled(): boolean {
  return envFlagOn("UPCOMING_EVENTS_PRE_ALERT_ENABLED", true);
}

function resultAlertEnabled(): boolean {
  return envFlagOn("UPCOMING_EVENTS_RESULT_ALERT_ENABLED", true);
}

/** เลยเวลาเหตุการณ์แล้วแต่ API ยังไม่มี actual — แจ้งครั้งเดียว (อิงเวลา startsAtUtc เดียวกับ pre-alert) */
function resultPendingAlertEnabled(): boolean {
  return envFlagOn("UPCOMING_EVENTS_RESULT_PENDING_ALERT_ENABLED", true);
}

/** ถ้าเปิด: ส่ง pending เฉพาะ event ที่เคยส่ง pre-alert (60/30 นาที) แล้ว */
function resultPendingRequiresPreAlert(): boolean {
  return envFlagOn("UPCOMING_EVENTS_RESULT_PENDING_REQUIRES_PRE_ALERT", true);
}

function resultPendingMinutesAfter(): number {
  const n = Number(process.env.UPCOMING_EVENTS_RESULT_PENDING_MINUTES_AFTER?.trim());
  return Number.isFinite(n) && n >= 0 && n <= 120 ? Math.floor(n) : 2;
}

function hadPreAlert(state: UpcomingEventsState, eventId: string): boolean {
  return Boolean(state.preAlertFired[`${eventId}|60`] || state.preAlertFired[`${eventId}|30`]);
}

function liveAiEnabled(): boolean {
  return envFlagOn("UPCOMING_EVENTS_LIVE_AI_ENABLED", false);
}

function liveAiWindowMinutes(): number {
  const n = Number(process.env.UPCOMING_EVENTS_LIVE_AI_WINDOW_MINUTES?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 120 ? Math.floor(n) : 15;
}

function eventImportanceRank(imp?: "high" | "medium" | "low"): number {
  if (imp === "high") return 3;
  if (imp === "medium") return 2;
  if (imp === "low") return 1;
  return 0;
}

/** ค่าเริ่มต้น: high เท่านั้น — ตั้ง UPCOMING_EVENTS_LIVE_AI_MIN_IMPORTANCE=medium|all */
function liveAiMinImportanceRank(): number {
  const raw = process.env.UPCOMING_EVENTS_LIVE_AI_MIN_IMPORTANCE?.trim().toLowerCase();
  if (raw === "all" || raw === "any" || raw === "low") return 0;
  if (raw === "medium") return 2;
  return 3;
}

function passesLiveAiImportanceFilter(e: UnifiedEvent): boolean {
  return eventImportanceRank(e.importance) >= liveAiMinImportanceRank();
}

function daysForward(): number {
  const n = Number(process.env.UPCOMING_EVENTS_RANGE_DAYS);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.floor(n) : 14;
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function fmtEventLine(e: UnifiedEvent): string {
  const t = new Date(e.startsAtUtc).toISOString().replace("T", " ").slice(0, 16);
  const z = e.country ? `${e.country} · ` : "";
  const imp = e.importance === "high" ? "🔴 " : "";
  return `${imp}${z}${e.title} — ${t} UTC`;
}

function fmtUtcYmdHm(tsUtcMs: number): string {
  return new Date(tsUtcMs).toISOString().replace("T", " ").slice(0, 16);
}

function fmtBkkYmdHm(tsUtcMs: number): string {
  const d = new Date(tsUtcMs);
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}

function buildWeeklyMessage(weekMondayYmd: string, events: UnifiedEvent[]): string {
  const macro = events.filter((e) => e.category === "macro");
  const unlocks = events.filter((e) => e.category === "unlock");
  const infra = events.filter((e) => e.category === "crypto_infra");
  const lines = [
    "📅 Koji — Weekly outlook (high-impact only)",
    `สัปดาห์เริ่มจันทร์ (UTC): ${weekMondayYmd}`,
    "",
    "US Macro (CPI / PPI / PCE · FOMC · NFP):",
  ];
  if (macro.length === 0) lines.push("— ไม่มีรายการ (หรือยังไม่มี FINNHUB / ไม่มีเหตุการณ์ในช่วง)");
  else macro.slice(0, 40).forEach((e) => lines.push(`• ${fmtEventLine(e)}`));
  lines.push("", `Token unlocks (≥ เกณฑ์ % circ.):`);
  if (unlocks.length === 0) lines.push("— ไม่มีรายการที่ผ่านเกณฑ์ (หรือ API ไม่ส่ง % supply)");
  else unlocks.slice(0, 30).forEach((e) => lines.push(`• ${fmtEventLine(e)}`));
  lines.push("", "Network / listing (crypto infra):");
  if (infra.length === 0) lines.push("— ไม่มี (หรือยังไม่ตั้ง CRYPTO_MARKET_EVENTS_API_URL)");
  else infra.slice(0, 25).forEach((e) => lines.push(`• ${fmtEventLine(e)}`));
  lines.push("", "ข้อมูลจากแหล่ง API — ไม่ใช่คำแนะนำลงทุน");
  return lines.join("\n");
}

function buildPreMessage(minutes: 60 | 30, e: UnifiedEvent): string {
  const utc = fmtUtcYmdHm(e.startsAtUtc);
  const bkk = fmtBkkYmdHm(e.startsAtUtc);
  return [
    `⏰ Koji — Pre-event (${minutes} นาที)`,
    "",
    `${e.title}${e.country ? ` (${e.country})` : ""}`,
    `เวลา: ${utc} UTC`,
    `เวลาไทย: ${bkk} (BKK)`,
    "",
    "แนะนำ: เช็ค position / stop loss ก่อนข่าว — ความผันผวนอาจสูง",
    "",
    "ไม่ใช่คำแนะนำลงทุน",
  ].join("\n");
}

function buildResultPendingMessage(e: UnifiedEvent): string {
  const est = e.forecast ?? "—";
  const prev = e.previous ?? "—";
  const utc = fmtUtcYmdHm(e.startsAtUtc);
  const bkk = fmtBkkYmdHm(e.startsAtUtc);
  return [
    "📊 Koji — Event window (รอตัวเลข)",
    "",
    `${e.title}${e.country ? ` (${e.country})` : ""}`,
    `เวลาประกาศตามปฏิทิน: ${utc} UTC | ${bkk} (BKK)`,
    "",
    `Forecast: ${est} | Previous: ${prev}`,
    "",
    "ยังไม่มี Actual จากแหล่งข้อมูล (เช่น Finnhub) — จะแจ้งผลอีกครั้งเมื่อมีตัวเลข",
    "",
    "ไม่ใช่คำแนะนำลงทุน",
  ].join("\n");
}

function buildResultMessage(e: UnifiedEvent): string {
  const act = e.actual ?? "—";
  const est = e.forecast ?? "—";
  const prev = e.previous ?? "—";
  const cmp =
    e.actual != null && e.forecast != null && String(e.actual).trim() !== String(e.forecast).trim()
      ? (() => {
          const na = Number(String(e.actual).replace(/[^0-9.-]/g, ""));
          const nf = Number(String(e.forecast).replace(/[^0-9.-]/g, ""));
          if (Number.isFinite(na) && Number.isFinite(nf)) {
            return na > nf ? "สูงกว่าคาด" : na < nf ? "ต่ำกว่าคาด" : "ใกล้เคียงคาด";
          }
          return "ต่างจากที่คาดไว้";
        })()
      : "ตามหรือใกล้เคียงคาด";
  return [
    "📊 Koji — Event result",
    "",
    e.title + (e.country ? ` (${e.country})` : ""),
    "",
    `Actual: ${act} | Forecast: ${est} | Previous: ${prev}`,
    `→ ${cmp} — ตลาดอาจตอบสนองแรง โปรดระวังความผันผวน`,
    "",
    "ไม่ใช่คำแนะนำลงทุน",
  ].join("\n");
}

function buildLiveAiTelegramBody(cur: UnifiedEvent, aiText: string): string {
  const act =
    cur.actual != null && String(cur.actual).trim() !== ""
      ? String(cur.actual).trim()
      : "— (ยังไม่มีในแหล่งข้อมูล)";
  const header = [
    "🤖 Koji — Event live (AI)",
    "",
    `${cur.title}${cur.country ? ` (${cur.country})` : ""}`,
    `เวลา: ${fmtUtcYmdHm(cur.startsAtUtc)} UTC | ${fmtBkkYmdHm(cur.startsAtUtc)} (BKK)`,
    `Forecast: ${cur.forecast ?? "—"} | Previous: ${cur.previous ?? "—"} | Actual: ${act}`,
    "",
    "———",
    "",
  ].join("\n");
  const footer = "\n\nไม่ใช่คำแนะนำลงทุน";
  const maxBody = TELEGRAM_SEND_MESSAGE_MAX - header.length - footer.length - 40;
  let body = aiText.trim();
  if (maxBody > 200 && body.length > maxBody) {
    body = `${body.slice(0, Math.max(0, maxBody - 20)).trimEnd()}\n\n…(ตัดข้อความ)`;
  }
  return header + body + footer;
}

/** Cron 5 นาที: อัปเดต snapshot + pre-alert + live AI (T+0 window) + ผลจริง / แจ้งรอตัวเลขเมื่อเลยเวลา (US session แยกเรียกใน route) */
export async function runUpcomingEventsAlertsTick(nowMs: number): Promise<{
  ok: boolean;
  preSent: number;
  resultSent: number;
  resultPendingSent: number;
  liveAiSent: number;
  skipped: string;
}> {
  if (!upcomingAlertsEnabled()) {
    return {
      ok: true,
      preSent: 0,
      resultSent: 0,
      resultPendingSent: 0,
      liveAiSent: 0,
      skipped: "UPCOMING_EVENTS_ALERTS_ENABLED=0",
    };
  }
  if (!telegramSparkSystemGroupConfigured()) {
    return {
      ok: true,
      preSent: 0,
      resultSent: 0,
      resultPendingSent: 0,
      liveAiSent: 0,
      skipped: "no_telegram_public_chat",
    };
  }

  const hasAnySource =
    finnhubCalendarConfigured() ||
    Boolean(process.env.TOKEN_UNLOCKS_API_URL?.trim()) ||
    Boolean(process.env.CRYPTO_MARKET_EVENTS_API_URL?.trim());
  if (!hasAnySource) {
    return {
      ok: true,
      preSent: 0,
      resultSent: 0,
      resultPendingSent: 0,
      liveAiSent: 0,
      skipped: "no_data_sources",
    };
  }

  const snap = await buildUpcomingEventsSnapshot(daysForward());
  await saveSnapshot(snap);

  let state = await loadUpcomingEventsState();
  let preSent = 0;
  let resultSent = 0;
  let resultPendingSent = 0;
  let liveAiSent = 0;
  const now = new Date(nowMs);

  const relevantMacro = snap.events.filter((e) => e.category === "macro");
  const allMacro = relevantMacro;

  if (preAlertEnabled()) {
    for (const e of relevantMacro) {
      const msUntil = e.startsAtUtc - nowMs;
      const minUntil = msUntil / 60_000;
      if (msUntil <= 0) continue;

      for (const window of [60, 30] as const) {
        const lo = window - 2;
        const hi = window + 2;
        if (minUntil < lo || minUntil > hi) continue;
        const key = `${e.id}|${window}`;
        if (state.preAlertFired[key]) continue;
        try {
          await sendTelegramPublicBroadcastMessage(buildPreMessage(window, e), "events_pre");
          state.preAlertFired[key] = nowMs;
          preSent += 1;
          await saveUpcomingEventsState(state);
        } catch (err) {
          console.error("[upcomingEventsTick] pre-alert", e.id, err);
        }
      }
    }
  }

  let byId: Map<string, UnifiedEvent> | null = null;
  if (resultAlertEnabled() || liveAiEnabled()) {
    const from = addDaysUtc(now, -2);
    const to = addDaysUtc(now, 1);
    const fresh = await fetchUnifiedEventsRange(from, to);
    byId = new Map(fresh.map((x) => [x.id, x]));
  }

  if (liveAiEnabled() && byId) {
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    if (!openAiKey) {
      console.warn("[upcomingEventsTick] UPCOMING_EVENTS_LIVE_AI_ENABLED but OPENAI_API_KEY missing");
    } else {
      const winMs = liveAiWindowMinutes() * 60_000;
      for (const e of allMacro) {
        if (!passesLiveAiImportanceFilter(e)) continue;
        const msSince = nowMs - e.startsAtUtc;
        if (msSince < 0 || msSince > winMs) continue;
        if (state.liveAiFired[e.id]) continue;
        const cur = byId.get(e.id) ?? e;
        const ai = await openAiMacroEventLiveBrief({
          title: cur.title,
          country: cur.country,
          currency: cur.currency,
          importance: cur.importance,
          forecast: cur.forecast,
          previous: cur.previous,
          actual: cur.actual,
          startsAtUtc: cur.startsAtUtc,
        });
        if (!ai.ok) {
          console.error("[upcomingEventsTick] live-ai", e.id, ai.error);
          continue;
        }
        try {
          await sendTelegramPublicBroadcastMessage(buildLiveAiTelegramBody(cur, ai.text), "events_live_ai");
          state.liveAiFired[e.id] = nowMs;
          liveAiSent += 1;
          await saveUpcomingEventsState(state);
        } catch (err) {
          console.error("[upcomingEventsTick] live-ai send", e.id, err);
        }
      }
    }
  }

  if (resultAlertEnabled() && byId) {
    const graceMs = resultPendingMinutesAfter() * 60_000;
    for (const e of allMacro) {
      const cur = byId.get(e.id) ?? e;
      if (cur.startsAtUtc > nowMs) continue;
      if (state.resultNotified[e.id]) continue;

      const hasActual = cur.actual != null && String(cur.actual).trim() !== "";
      if (hasActual) {
        try {
          await sendTelegramPublicBroadcastMessage(buildResultMessage(cur), "events_result");
          state.resultNotified[e.id] = nowMs;
          delete state.resultPendingNotified[e.id];
          resultSent += 1;
          await saveUpcomingEventsState(state);
        } catch (err) {
          console.error("[upcomingEventsTick] result", e.id, err);
        }
        continue;
      }

      if (!resultPendingAlertEnabled()) continue;
      if (state.resultPendingNotified[e.id]) continue;
      if (resultPendingRequiresPreAlert() && !hadPreAlert(state, e.id)) continue;
      if (nowMs - cur.startsAtUtc < graceMs) continue;

      try {
        await sendTelegramPublicBroadcastMessage(buildResultPendingMessage(cur), "events_result_pending");
        state.resultPendingNotified[e.id] = nowMs;
        resultPendingSent += 1;
        await saveUpcomingEventsState(state);
      } catch (err) {
        console.error("[upcomingEventsTick] result-pending", e.id, err);
      }
    }
  }

  pruneOldStateKeys(state, nowMs);
  await saveUpcomingEventsState(state);

  return { ok: true, preSent, resultSent, resultPendingSent, liveAiSent, skipped: "" };
}

function pruneOldStateKeys(state: UpcomingEventsState, nowMs: number): void {
  const maxAge = 8 * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(state.preAlertFired)) {
    const t = state.preAlertFired[k];
    if (typeof t === "number" && nowMs - t > maxAge) delete state.preAlertFired[k];
  }
  for (const k of Object.keys(state.resultNotified)) {
    const t = state.resultNotified[k];
    if (typeof t === "number" && nowMs - t > maxAge) delete state.resultNotified[k];
  }
  for (const k of Object.keys(state.resultPendingNotified)) {
    const t = state.resultPendingNotified[k];
    if (typeof t === "number" && nowMs - t > maxAge) delete state.resultPendingNotified[k];
  }
  for (const k of Object.keys(state.liveAiFired)) {
    const t = state.liveAiFired[k];
    if (typeof t === "number" && nowMs - t > maxAge) delete state.liveAiFired[k];
  }
}

/** Cron จันทร์: สรุปสัปดาห์ → events_weekly */
export async function runUpcomingEventsWeeklyDigest(nowMs: number): Promise<{
  ok: boolean;
  sent: boolean;
  reason: string;
}> {
  if (!weeklyDigestEnabled()) {
    return { ok: true, sent: false, reason: "UPCOMING_EVENTS_WEEKLY_ENABLED=0" };
  }
  if (!telegramSparkSystemGroupConfigured()) {
    return { ok: true, sent: false, reason: "no_telegram_public_chat" };
  }
  const hasAnySource =
    finnhubCalendarConfigured() ||
    Boolean(process.env.TOKEN_UNLOCKS_API_URL?.trim()) ||
    Boolean(process.env.CRYPTO_MARKET_EVENTS_API_URL?.trim());
  if (!hasAnySource) {
    return { ok: true, sent: false, reason: "no_data_sources" };
  }

  const mondayYmd = utcMondayYmdOfDate(new Date(nowMs));
  let state = await loadUpcomingEventsState();
  if (state.lastWeeklyDigestUtcMonday === mondayYmd) {
    return { ok: true, sent: false, reason: "already_sent_this_week" };
  }

  const from = new Date(`${mondayYmd}T00:00:00.000Z`);
  const to = addDaysUtc(from, 7);
  const events = await fetchUnifiedEventsRange(from, to);
  const msg = buildWeeklyMessage(mondayYmd, events);

  try {
    await sendTelegramPublicBroadcastMessage(msg, "events_weekly");
    state.lastWeeklyDigestUtcMonday = mondayYmd;
    await saveUpcomingEventsState(state);
    const snap = await buildUpcomingEventsSnapshot(daysForward());
    await saveSnapshot(snap);
    return { ok: true, sent: true, reason: "" };
  } catch (e) {
    console.error("[upcomingEventsWeekly]", e);
    return { ok: false, sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** ให้ cron อัปเดต snapshot อย่างเดียว (ถ้าไม่ต้องการส่งแจ้งเตือน) */
export async function refreshUpcomingEventsSnapshotOnly(): Promise<void> {
  const hasAnySource =
    finnhubCalendarConfigured() ||
    Boolean(process.env.TOKEN_UNLOCKS_API_URL?.trim()) ||
    Boolean(process.env.CRYPTO_MARKET_EVENTS_API_URL?.trim());
  if (!hasAnySource) return;
  const snap = await buildUpcomingEventsSnapshot(daysForward());
  await saveSnapshot(snap);
}
