import { bkkTradingSessionId, bkkYmdh } from "./bkkSession";
import { getUsdtPerpsThreeGreenDailyCloses, type TopMarketRow } from "./mexcMarkets";
import {
  loadThreeGreenDailyAlertState,
  saveThreeGreenDailyAlertState,
} from "./threeGreenDailyAlertStateStore";
import { sendTelegramPublicBroadcastMessage, telegramSparkSystemGroupConfigured } from "./telegramAlert";

function isThreeGreenDailyTechnicalEnabled(): boolean {
  const raw = process.env.THREE_GREEN_DAILY_TECHNICAL_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  return true;
}

function notifyMaxSymbols(): number {
  const n = Number(process.env.THREE_GREEN_DAILY_NOTIFY_MAX?.trim());
  return Number.isFinite(n) && n >= 1 && n <= 200 ? Math.floor(n) : 20;
}

function shortSymbol(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function buildMessage(sessionId: string, rows: TopMarketRow[], newSyms: string[]): string {
  const lines: string[] = [
    "📊 Koji — 3 เขียว Day1 ติดกัน (MEXC USDT-M)",
    `เซสชัน BKK: ${sessionId}`,
    "",
    `คู่ที่เพิ่งเข้า list (${newSyms.length}):`,
  ];
  const max = notifyMaxSymbols();
  const show = newSyms.slice(0, max);
  for (const sym of show) {
    const row = rows.find((r) => r.symbol === sym);
    const label = shortSymbol(sym);
    const ch =
      row && Number.isFinite(row.change24hPercent)
        ? ` (${row.change24hPercent >= 0 ? "+" : ""}${row.change24hPercent.toFixed(2)}% 24h)`
        : "";
    lines.push(`• ${label}/USDT${ch}`);
  }
  if (newSyms.length > max) {
    lines.push(`… และอีก ${newSyms.length - max} คู่`);
  }
  lines.push(
    "",
    "เงื่อนไข: แท่ง Day1 ปิดแล้ว 3 วันล่าสุดเขียวทุกแท่ง (close > open) · ข้อมูลอ้างอิง"
  );
  return lines.join("\n");
}

export type ThreeGreenDailyAlertTickResult = {
  ok: boolean;
  detail: string;
  notified: number;
  newCount: number;
  currentCount: number;
  skippedReason?: string;
};

/**
 * ครั้งเดียวต่อเซสชัน BKK (หลัง 07:00): แจ้งเฉพาะคู่ที่เพิ่งเข้า list 3 เขียว — Telegram technical เท่านั้น
 */
export async function runThreeGreenDailyTechnicalAlertTick(): Promise<ThreeGreenDailyAlertTickResult> {
  if (!isThreeGreenDailyTechnicalEnabled()) {
    return {
      ok: true,
      detail: "ปิด (THREE_GREEN_DAILY_TECHNICAL_ENABLED=0)",
      notified: 0,
      newCount: 0,
      currentCount: 0,
      skippedReason: "disabled",
    };
  }

  const now = new Date();
  const { hour } = bkkYmdh(now);
  if (hour < 7) {
    return {
      ok: true,
      detail: "รอก่อน 07:00 น. (เวลาไทย)",
      notified: 0,
      newCount: 0,
      currentCount: 0,
      skippedReason: "before_0700_bkk",
    };
  }

  if (!telegramSparkSystemGroupConfigured()) {
    return {
      ok: true,
      detail: "ไม่ส่ง — ไม่มี TELEGRAM_PUBLIC_CHAT_ID (+ token)",
      notified: 0,
      newCount: 0,
      currentCount: 0,
      skippedReason: "no_telegram_public",
    };
  }

  const sessionId = bkkTradingSessionId(now);
  let state = await loadThreeGreenDailyAlertState();

  if (state.lastProcessedSessionId === sessionId) {
    return {
      ok: true,
      detail: `รอบนี้ประมวลผลแล้ว (${sessionId})`,
      notified: 0,
      newCount: 0,
      currentCount: state.symbolSnapshot.length,
      skippedReason: "already_processed_session",
    };
  }

  const rows = await getUsdtPerpsThreeGreenDailyCloses();
  const currentSet = new Set(rows.map((r) => r.symbol.trim()).filter(Boolean));
  const currentSorted = Array.from(currentSet).sort();

  const prev = new Set(state.symbolSnapshot);
  const isBaseline =
    state.lastProcessedSessionId == null && state.symbolSnapshot.length === 0;

  const newSyms = currentSorted.filter((s) => !prev.has(s));

  if (isBaseline) {
    state = {
      lastProcessedSessionId: sessionId,
      symbolSnapshot: currentSorted,
    };
    await saveThreeGreenDailyAlertState(state);
    return {
      ok: true,
      detail: `baseline: เก็บ snapshot ${currentSorted.length} คู่ — ยังไม่แจ้ง (รันแรก)`,
      notified: 0,
      newCount: 0,
      currentCount: currentSorted.length,
      skippedReason: "baseline_seed",
    };
  }

  if (newSyms.length > 0) {
    const msg = buildMessage(sessionId, rows, newSyms);
    await sendTelegramPublicBroadcastMessage(msg, "technical");
  }

  state = {
    lastProcessedSessionId: sessionId,
    symbolSnapshot: currentSorted,
  };
  await saveThreeGreenDailyAlertState(state);

  const detail =
    newSyms.length > 0
      ? `แจ้งใหม่ ${newSyms.length} คู่ · list ปัจจุบัน ${currentSorted.length} คู่`
      : `ไม่มีคู่ใหม่ · list ${currentSorted.length} คู่`;

  return {
    ok: true,
    detail,
    notified: newSyms.length > 0 ? 1 : 0,
    newCount: newSyms.length,
    currentCount: currentSorted.length,
  };
}
