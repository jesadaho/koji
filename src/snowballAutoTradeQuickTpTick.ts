import { closeAllOpenForSymbol, getContractLastPricePublic, type MexcCredentials } from "./mexcFuturesClient";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withSnowballActiveRemoved,
  type SnowballAutoTradeActive,
  type SnowballAutoTradeSide,
} from "./snowballAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function roiPctFromMark(p: { side: SnowballAutoTradeSide; entry: number; mark: number; leverage: number }): number {
  if (!(p.entry > 0) || !(p.mark > 0) || p.leverage < 1) return NaN;
  const movePct = p.side === "long" ? ((p.mark - p.entry) / p.entry) * 100 : ((p.entry - p.mark) / p.entry) * 100;
  return movePct * p.leverage;
}

export async function runSnowballAutoTradeQuickTpTick(nowMs: number): Promise<number> {
  const [map, state0] = await Promise.all([loadTradingViewMexcSettingsFullMap(), loadSnowballAutoTradeState()]);
  let state = state0;
  let closed = 0;

  for (const [userId, perUser] of Object.entries(state)) {
    const actives = perUser.active ?? [];
    if (!actives.length) continue;

    const row = map[userId];
    if (!row?.mexcApiKey?.trim() || !row?.mexcSecret?.trim()) continue;
    const creds: MexcCredentials = { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() };

    for (const a of actives as SnowballAutoTradeActive[]) {
      if (!a.quickTpEnabled) continue;
      const ageMs = nowMs - a.openedAtMs;
      const maxMs = Math.max(0, a.quickTpMaxHours) * 3600 * 1000;
      if (!(ageMs >= 0) || !(maxMs > 0) || ageMs > maxMs) continue;

      const mark = await getContractLastPricePublic(a.contractSymbol);
      if (mark == null || !(mark > 0)) continue;
      const roi = roiPctFromMark({ side: a.side, entry: a.referenceEntryPrice, mark, leverage: a.leverage });
      if (!Number.isFinite(roi) || roi < a.quickTpRoiPct) continue;

      const r = await closeAllOpenForSymbol(creds, a.contractSymbol);
      if (!r.success) {
        await notifyLines(userId, [
          "Koji — Snowball auto-open (MEXC)",
          "❌ Quick TP: ปิดไม่สำเร็จ",
          `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
          `ROI ประมาณ: ${roi.toFixed(1)}% (เป้า ${a.quickTpRoiPct}%)`,
          r.message ? `MEXC: ${r.message}` : "",
        ]);
        continue;
      }

      closed += 1;
      state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        "✅ Quick TP: ปิดโพซิชันแล้ว",
        `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
        `ROI ประมาณ: ${roi.toFixed(1)}% (เป้า ${a.quickTpRoiPct}%)`,
      ]);
    }
  }

  if (closed > 0) {
    await saveSnowballAutoTradeState(state);
  }
  return closed;
}

