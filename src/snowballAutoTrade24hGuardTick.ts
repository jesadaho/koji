import { closeAllOpenForSymbol, getContractLastPricePublic, type MexcCredentials } from "./mexcFuturesClient";
import { fetchBinanceUsdmKlinesRange, isBinanceIndicatorFapiEnabled } from "./binanceIndicatorKline";
import { loadTradingViewMexcSettingsFullMap } from "./tradingViewCloseSettingsStore";
import {
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withSnowballActiveRemoved,
  type SnowballAutoTradeActive,
} from "./snowballAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

const KLINE_GRAN_SEC = 900;

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function signalBarDurationSec(tf: "15m" | "1h" | "4h"): number {
  if (tf === "4h") return 4 * 3600;
  if (tf === "1h") return 3600;
  return 900;
}

function passesRunTrendGuardLikeStats(p: {
  side: "long" | "short";
  price24h: number;
  signalBarLow: number | null;
  maxDrawdownPct: number;
  svpHoleYn: "Y" | "N";
}): boolean {
  if (p.side !== "long") return false;
  if (!Number.isFinite(p.price24h)) return false;
  if (p.signalBarLow == null || !Number.isFinite(p.signalBarLow) || p.signalBarLow <= 0) return false;
  if (!Number.isFinite(p.maxDrawdownPct) || p.maxDrawdownPct < 0) return false;
  const maxDdAllowed = (() => {
    const v = Number(process.env.SNOWBALL_STATS_OUTCOME_RUN_TREND_MAX_DD_PCT);
    return Number.isFinite(v) && v > 0 && v < 100 ? v : 3;
  })();
  if (p.price24h <= p.signalBarLow) return false;
  if (p.maxDrawdownPct > maxDdAllowed) return false;
  if (p.svpHoleYn !== "N") return false;
  return true;
}

export async function runSnowballAutoTrade24hGuardTick(nowMs: number): Promise<number> {
  if (!isBinanceIndicatorFapiEnabled()) return 0;

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
      const ageMs = nowMs - a.openedAtMs;
      if (!(ageMs >= 24 * 3600 * 1000)) continue;

      // ใช้ราคา mark ล่าสุดของ MEXC เทียบกับ entry reference
      const mark = await getContractLastPricePublic(a.contractSymbol);
      if (mark == null || !(mark > 0)) continue;

      // เงื่อนไข: ราคา < จุดซื้อ (สำหรับ long) เท่านั้นตาม requirement
      if (a.side !== "long") {
        // ยังไม่รองรับนิยาม run-trend ฝั่ง short ในสถิติเดิม
        continue;
      }
      if (!(mark < a.referenceEntryPrice)) {
        // ถ้าไม่ติดลบจาก reference entry ไม่ต้องใช้ guard-close
        state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
        continue;
      }

      // ประเมิน run-trend guard ด้วยวิธีเดียวกับ Snowball stats: ใช้ Binance 15m klines ช่วง 24h
      const ac = a.signalBarOpenSec + signalBarDurationSec(a.signalBarTf);
      const pack = await fetchBinanceUsdmKlinesRange(a.binanceSymbol, "15m", {
        startTimeMs: a.signalBarOpenSec * 1000,
        endTimeMs: nowMs,
        limit: 500,
      });
      if (!pack || pack.timeSec.length === 0) {
        // ถ้า fetch ไม่ได้ ให้ “fail closed” ตาม requirement: ไม่เข้าเกณฑ์รันเทรน -> ปิด
        const r = await closeAllOpenForSymbol(creds, a.contractSymbol);
        if (r.success) {
          closed += 1;
          state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
          await notifyLines(userId, [
            "Koji — Snowball auto-open (MEXC)",
            "✅ 24h rule: ปิดโพซิชันแล้ว (ดึงข้อมูลรันเทรนไม่สำเร็จ)",
            `[${shortContractLabel(a.contractSymbol)}]/USDT (LONG)`,
          ]);
        }
        continue;
      }

      const { timeSec, low, close } = pack;
      const nowSec = Math.floor(nowMs / 1000);
      const windowEndSec = Math.min(nowSec, ac + 24 * 3600);
      const iFirst = timeSec.findIndex((t) => t + KLINE_GRAN_SEC >= ac);
      if (iFirst < 0) continue;
      let iLast = iFirst;
      for (let i = iFirst; i < timeSec.length; i++) {
        if (timeSec[i]! + KLINE_GRAN_SEC <= windowEndSec) iLast = i;
      }
      while (iLast >= iFirst && timeSec[iLast]! + KLINE_GRAN_SEC > windowEndSec) iLast--;
      if (iLast < iFirst) continue;

      let minLow = Infinity;
      for (let i = iFirst; i <= iLast; i++) {
        minLow = Math.min(minLow, low[i]!);
      }
      const maxDdPct = ((a.referenceEntryPrice - minLow) / a.referenceEntryPrice) * 100;

      // price24h = close of last bar inside 24h window
      const p24 = close[iLast]!;

      const runTrendOk = passesRunTrendGuardLikeStats({
        side: a.side,
        price24h: p24,
        signalBarLow: a.signalBarLow,
        maxDrawdownPct: Number.isFinite(maxDdPct) && maxDdPct >= 0 ? maxDdPct : 0,
        svpHoleYn: a.svpHoleYn,
      });

      if (runTrendOk) {
        // ถือว่าเข้าเกณฑ์รันเทรน -> ไม่ปิดด้วยกติกานี้ แต่เลิก track
        state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
        continue;
      }

      const r = await closeAllOpenForSymbol(creds, a.contractSymbol);
      if (!r.success) {
        await notifyLines(userId, [
          "Koji — Snowball auto-open (MEXC)",
          "❌ 24h rule: ปิดไม่สำเร็จ",
          `[${shortContractLabel(a.contractSymbol)}]/USDT (LONG)`,
          r.message ? `MEXC: ${r.message}` : "",
        ]);
        continue;
      }

      closed += 1;
      state = withSnowballActiveRemoved(state, userId, a.contractSymbol, a.side);
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        "✅ 24h rule: ปิดโพซิชันแล้ว",
        `[${shortContractLabel(a.contractSymbol)}]/USDT (LONG)`,
        "เหตุผล: ครบ 24 ชม. แล้วยังต่ำกว่าจุดซื้อ และไม่เข้าเกณฑ์รันเทรน",
      ]);
    }
  }

  if (closed > 0) {
    await saveSnowballAutoTradeState(state);
  }
  return closed;
}

