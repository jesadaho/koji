import { closeAllOpenForSymbol, getContractLastPricePublic, getOpenPositions, type MexcCredentials } from "./mexcFuturesClient";
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

function fmtSnowballPriceUsdt(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function roiPctFromMark(p: { side: SnowballAutoTradeSide; entry: number; mark: number; leverage: number }): number {
  if (!(p.entry > 0) || !(p.mark > 0) || p.leverage < 1) return NaN;
  const movePct = p.side === "long" ? ((p.mark - p.entry) / p.entry) * 100 : ((p.entry - p.mark) / p.entry) * 100;
  return movePct * p.leverage;
}

/** ราคาเข้าเฉลี่ยจาก MEXC — ลำดับ: state → API → จุดอ้างอิงบอท */
async function resolveQuickTpEntry(
  creds: MexcCredentials,
  a: SnowballAutoTradeActive
): Promise<{ entry: number; source: "mexc" | "reference" }> {
  const m = a.mexcAvgEntryPrice;
  if (typeof m === "number" && Number.isFinite(m) && m > 0) return { entry: m, source: "mexc" };
  try {
    const pos = await getOpenPositions(creds, a.contractSymbol);
    const sym = a.contractSymbol.trim();
    const wantType = a.side === "long" ? 1 : 2;
    const row = pos.find(
      (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === wantType
    );
    if (row) {
      const o = Number(row.openAvgPrice);
      if (Number.isFinite(o) && o > 0) return { entry: o, source: "mexc" };
      const h = Number(row.holdAvgPrice);
      if (Number.isFinite(h) && h > 0) return { entry: h, source: "mexc" };
    }
  } catch {
    /* ignore */
  }
  return { entry: a.referenceEntryPrice, source: "reference" };
}

function quickTpDetailLines(p: {
  a: SnowballAutoTradeActive;
  mark: number;
  roi: number;
  entry: number;
  entrySource: "mexc" | "reference";
}): string[] {
  const { a, mark, roi, entry, entrySource } = p;
  const refLine = `จุดอ้างอิงบอท (Binance): ${fmtSnowballPriceUsdt(a.referenceEntryPrice)} USDT`;
  const entryLine =
    entrySource === "mexc"
      ? `ราคาเข้า (MEXC เฉลี่ย): ${fmtSnowballPriceUsdt(entry)} USDT — ใช้คำนวณ ROI Quick TP`
      : `ราคาเข้า MEXC: ไม่พบ — ใช้จุดอ้างอิงบอทคำนวณ ROI (อาจต่างจาก MEXC UI)`;
  const markLine = `ราคา mark ณ ตัดสินใจ: ${fmtSnowballPriceUsdt(mark)} USDT`;
  const roiLine = `ROI บนมาร์จิ้น (ประมาณ): ${roi.toFixed(1)}% (เป้า Quick TP ${a.quickTpRoiPct}%) · เลเวอเรจ ${a.leverage}x`;
  return [refLine, entryLine, markLine, roiLine];
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
      const { entry, source: entrySource } = await resolveQuickTpEntry(creds, a);
      const roi = roiPctFromMark({ side: a.side, entry, mark, leverage: a.leverage });
      if (!Number.isFinite(roi) || roi < a.quickTpRoiPct) continue;

      const detail = quickTpDetailLines({ a, mark, roi, entry, entrySource });

      const r = await closeAllOpenForSymbol(creds, a.contractSymbol);
      if (!r.success) {
        await notifyLines(userId, [
          "Koji — Snowball auto-open (MEXC)",
          "❌ Quick TP: ปิดไม่สำเร็จ",
          `[${shortContractLabel(a.contractSymbol)}]/USDT (${a.side.toUpperCase()})`,
          ...detail,
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
        ...detail,
      ]);
    }
  }

  if (closed > 0) {
    await saveSnowballAutoTradeState(state);
  }
  return closed;
}

