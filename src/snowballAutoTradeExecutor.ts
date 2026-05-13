import {
  createOpenMarketOrder,
  getOpenPositions,
  type MexcCredentials,
} from "./mexcFuturesClient";
import {
  loadTradingViewMexcSettingsFullMap,
  type TradingViewMexcUserSettings,
} from "./tradingViewCloseSettingsStore";
import {
  bkkSnowballAutoTradeDayKeyNow,
  hasOpenedSnowballContractToday,
  loadSnowballAutoTradeState,
  saveSnowballAutoTradeState,
  withRecordedSnowballSuccessfulOpen,
  type SnowballAutoTradeSide,
} from "./snowballAutoTradeStateStore";
import { computeSvpHoleYn } from "./snowballStatsStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

/**
 * ค่าเริ่มต้นเปิด — ผู้ใช้เปิด/ปิดหลักใน Mini App (`snowballAutoTradeEnabled`)
 * ตั้ง `SNOWBALL_AUTOTRADE_ENABLED=0` / `false` / `off` / `no` เพื่อปิดฉุกเฉินทั้งเซิร์ฟ
 */
export function isSnowballAutotradeEnabled(): boolean {
  const v = process.env.SNOWBALL_AUTOTRADE_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function directionAllows(
  cfg: TradingViewMexcUserSettings,
  side: SnowballAutoTradeSide
): boolean {
  const d = cfg.snowballAutoTradeDirection ?? "both";
  if (d === "both") return true;
  if (d === "long_only") return side === "long";
  return side === "short";
}

function hasActiveUsdtPosition(
  positions: Awaited<ReturnType<typeof getOpenPositions>>,
  contractSymbol: string
): boolean {
  const sym = contractSymbol.trim();
  return positions.some((p) => p.symbol === sym && p.state === 1 && Number(p.holdVol) > 0);
}

export async function runSnowballAutoTradeAfterSnowballAlert(input: {
  contractSymbol: string;
  binanceSymbol: string;
  side: SnowballAutoTradeSide;
  /** จุดเข้าซื้อที่บอทแนะนำ (จาก Snowball signal) */
  referenceEntryPrice: number;
  signalBarOpenSec: number;
  signalBarTf: "15m" | "1h" | "4h";
  signalBarLow: number | null;
  vol: number;
  volSma: number;
}): Promise<{ usersAttempted: number; usersSucceeded: number }> {
  if (!isSnowballAutotradeEnabled()) return { usersAttempted: 0, usersSucceeded: 0 };

  const sym = input.contractSymbol.trim();
  if (!sym) return { usersAttempted: 0, usersSucceeded: 0 };
  const binanceSymbol = input.binanceSymbol.trim().toUpperCase();
  if (!binanceSymbol) return { usersAttempted: 0, usersSucceeded: 0 };
  if (!(input.referenceEntryPrice > 0) || !Number.isFinite(input.referenceEntryPrice)) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }
  if (!(typeof input.signalBarOpenSec === "number" && Number.isFinite(input.signalBarOpenSec))) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }

  const [map, state0] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadSnowballAutoTradeState(),
  ]);

  let state = state0;
  const dayKey = bkkSnowballAutoTradeDayKeyNow();

  let usersAttempted = 0;
  let usersSucceeded = 0;

  for (const [userId, rowRaw] of Object.entries(map)) {
    if (!/^tg:\d+$/.test(userId.trim())) continue;
    const row = rowRaw as TradingViewMexcUserSettings;
    if (!row.snowballAutoTradeEnabled) continue;
    if (!directionAllows(row, input.side)) continue;

    if (hasOpenedSnowballContractToday(state[userId], sym, dayKey)) continue;

    const creds: MexcCredentials | null =
      row.mexcApiKey?.trim() && row.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;
    if (!creds) continue;

    const marginUsdt = row.snowballAutoTradeMarginUsdt ?? NaN;
    const leverage = row.snowballAutoTradeLeverage ?? NaN;
    if (!(typeof marginUsdt === "number" && Number.isFinite(marginUsdt) && marginUsdt > 0)) continue;
    if (!(typeof leverage === "number" && Number.isFinite(leverage) && leverage >= 1)) continue;

    let positions: Awaited<ReturnType<typeof getOpenPositions>>;
    try {
      positions = await getOpenPositions(creds, sym);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[snowballAutoTrade] open_positions fail", sym, userId, e);
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        "❌ เช็คโพซิชันจาก MEXC ไม่สำเร็จ — จึงไม่สั่งเปิด (ป้องกันซ้ำ)",
        `[${shortContractLabel(sym)}]/USDT (${input.side.toUpperCase()})`,
        `รายละเอียด: ${detail.slice(0, 320)}`,
      ]);
      continue;
    }
    if (hasActiveUsdtPosition(positions, sym)) continue;

    usersAttempted += 1;

    const long = input.side === "long";
    try {
      const om = await createOpenMarketOrder(creds, {
        contractSymbol: sym,
        long,
        marginUsdt,
        leverage: Math.floor(leverage),
        openType: 1,
      });
      if (!om.success) {
        const msg = om.message ?? `code ${om.code}`;
        await notifyLines(userId, [
          "Koji — Snowball auto-open (MEXC)",
          `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น ${long ? "LONG" : "SHORT"})`,
          `[${shortContractLabel(sym)}]/USDT`,
          `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
          `MEXC: ${msg}`,
        ]);
        continue;
      }

      const quickTpEnabled = Boolean(row.snowballAutoTradeQuickTpEnabled);
      const quickTpRoiPct =
        typeof row.snowballAutoTradeQuickTpRoiPct === "number" && Number.isFinite(row.snowballAutoTradeQuickTpRoiPct)
          ? row.snowballAutoTradeQuickTpRoiPct
          : 30;
      const quickTpMaxHours =
        typeof row.snowballAutoTradeQuickTpMaxHours === "number" && Number.isFinite(row.snowballAutoTradeQuickTpMaxHours)
          ? row.snowballAutoTradeQuickTpMaxHours
          : 4;

      state = withRecordedSnowballSuccessfulOpen(
        state,
        userId,
        {
          contractSymbol: sym,
          binanceSymbol,
          side: input.side,
          openedAtMs: Date.now(),
          referenceEntryPrice: input.referenceEntryPrice,
          signalBarOpenSec: input.signalBarOpenSec,
          signalBarTf: input.signalBarTf,
          signalBarLow: input.signalBarLow,
          svpHoleYn: computeSvpHoleYn(input.vol, input.volSma),
          leverage: Math.floor(leverage),
          quickTpEnabled,
          quickTpRoiPct,
          quickTpMaxHours,
        },
        dayKey
      );
      usersSucceeded += 1;

      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        long ? "✅ เปิด LONG จาก Snowball" : "✅ เปิด SHORT จาก Snowball",
        `[${shortContractLabel(sym)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
        `จุดเข้าอ้างอิง (บอทแนะนำ): ${input.referenceEntryPrice}`,
        quickTpEnabled
          ? `Quick TP: เปิด (ROI ≥ ${quickTpRoiPct}% ภายใน ${quickTpMaxHours} ชม.)`
          : "Quick TP: ปิด",
        "กติกา 24h: ถ้าครบ 24 ชม. แล้วยังติดลบและไม่เข้าเกณฑ์รันเทรน ระบบจะพยายามปิด market",
        "ครั้งถัดไปในวันนี้: จะไม่เปิดจาก Snowball ซ้ำในเหรียญนี้ (1 order/เหรียญ/วัน)",
      ]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        `❌ สั่งเปิดล้มเหลวจากข้อผิดพลาดระหว่างเรียก MEXC / เครือข่าย (ตั้งใจเป็น ${long ? "LONG" : "SHORT"})`,
        `[${shortContractLabel(sym)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
        `รายละเอียด: ${detail.slice(0, 400)}`,
      ]);
    }
  }

  try {
    await saveSnowballAutoTradeState(state);
  } catch (e) {
    console.error("[snowballAutoTrade] save state failed", e);
  }

  return { usersAttempted, usersSucceeded };
}

