import { closeAllOpenForSymbol, type MexcCredentials } from "./mexcFuturesClient";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  loadSparkAutoTradeState,
  saveSparkAutoTradeState,
  withoutSparkTimeStopForSymbol,
  type SparkAutoTradeState,
} from "./sparkAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function notifyTimeStopLines(userId: string, lines: string[]): Promise<void> {
  return notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

type DueItem = { userId: string; sym: string };

function collectDue(state: SparkAutoTradeState, now: number): DueItem[] {
  const out: DueItem[] = [];
  const seen = new Set<string>();
  for (const [userId, u] of Object.entries(state)) {
    if (!/^tg:\d+$/.test(userId.trim())) continue;
    const pend = u.sparkTimeStopPending;
    if (!pend?.length) continue;
    for (const p of pend) {
      if (now < p.closeAtMs) continue;
      const uid = userId.trim();
      const key = `${uid}\0${p.contractSymbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ userId: uid, sym: p.contractSymbol });
    }
  }
  return out;
}

/** รันใน cron — ปิด market ตามเวลาหลัง Spark auto-open (~คลาดเคลื่อนตามรอบ cron, ปกติ ~5 นาที) */
export async function runSparkAutoTradeTimeStopSweep(): Promise<{ due: number; closedOk: number }> {
  let state = await loadSparkAutoTradeState();
  const now = Date.now();
  const dueList = collectDue(state, now);
  if (dueList.length === 0) return { due: 0, closedOk: 0 };

  const map = await loadTradingViewMexcSettingsFullMap();
  let closedOk = 0;

  for (const { userId, sym } of dueList) {
    const row = map[userId];
    const creds: MexcCredentials | null =
      row?.mexcApiKey?.trim() && row?.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;

    if (!creds) {
      state = withoutSparkTimeStopForSymbol(state, userId, sym);
      await notifyTimeStopLines(userId, [
        "Koji — Spark time-stop (MEXC)",
        `⏱ ถึงเวลาปิด [${shortContractLabel(sym)}]/USDT แล้วแต่ไม่มี MEXC API ใน Settings — ล้างคิว time-stop แล้ว (ถ้ายังมีโพซิชันต้องปิดมือ / ตั้ง key แล้วใช้ time-stop ครั้งถัดไป)`,
      ]);
      continue;
    }

    let r: Awaited<ReturnType<typeof closeAllOpenForSymbol>>;
    try {
      r = await closeAllOpenForSymbol(creds, sym);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await notifyTimeStopLines(userId, [
        "Koji — Spark time-stop (MEXC)",
        `❌ ปิด [${shortContractLabel(sym)}]/USDT ไม่สำเร็จ (เครือข่าย/API) — จะลองรอบถัดไป`,
        detail.slice(0, 400),
      ]);
      continue;
    }

    if (r.success) {
      closedOk += 1;
      state = withoutSparkTimeStopForSymbol(state, userId, sym);
      const hadPos = (r.closed?.length ?? 0) > 0;
      await notifyTimeStopLines(userId, [
        "Koji — Spark time-stop (MEXC)",
        hadPos
          ? `✅ ปิดโพซิชัน [${shortContractLabel(sym)}]/USDT ตามเวลา (หลัง Spark auto-open)`
          : `ℹ️ [${shortContractLabel(sym)}]/USDT ไม่มีโพซิชันเปิด — ล้างคิว time-stop แล้ว`,
      ]);
    } else {
      const errs =
        (r.closed ?? [])
          .map((c) => c.error)
          .filter(Boolean)
          .join("; ") ||
        r.message ||
        "";
      await notifyTimeStopLines(userId, [
        "Koji — Spark time-stop (MEXC)",
        `❌ ปิด [${shortContractLabel(sym)}]/USDT ไม่ครบ — จะลองรอบถัดไป`,
        errs ? errs.slice(0, 400) : "",
      ]);
    }
  }

  await saveSparkAutoTradeState(state);
  return { due: dueList.length, closedOk };
}
