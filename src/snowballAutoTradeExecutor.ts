import {
  createOpenLimitOrder,
  createOpenMarketOrder,
  getOpenPositions,
  type MexcCredentials,
  type OpenPositionRow,
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

/** Grade LONG จากสัญญาณ Snowball (สอดคล้อง publicIndicatorFeed) */
export type SnowballLongAlertGrade = "a_plus" | "b_plus" | "c_plus";

/** เกรดต่ำกว่า B = C เท่านั้น */
export function isSnowballLongGradeBelowB(grade: SnowballLongAlertGrade | undefined): boolean {
  return grade === "c_plus";
}

/**
 * ทิศ auto-open จากสัญญาณ LONG + Grade (ต้องเปิด Double Barrier)
 * A+ → Long · C → Short ผ่าน `evaluateSnowballGradeCShortFade` แยก · B → ไม่ auto-open
 */
export function snowballAutotradeSideForLongGrade(
  grade: SnowballLongAlertGrade | undefined,
  doubleBarrierOn: boolean,
): SnowballAutoTradeSide | null {
  if (!doubleBarrierOn || !grade) return null;
  if (grade === "a_plus") return "long";
  return null;
}

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function fmtSnowballPriceUsdt(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
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

/** ราคาเข้าเฉลี่ยจาก MEXC — ใช้คำนวณ Quick TP ให้ใกล้ UI จริง (ไม่ใช่แค่ close Binance) */
function readMexcAvgEntryPrice(
  positions: OpenPositionRow[],
  contractSymbol: string,
  side: SnowballAutoTradeSide
): number | null {
  const sym = contractSymbol.trim();
  const wantType = side === "long" ? 1 : 2;
  const p = positions.find(
    (x) => x.symbol === sym && x.state === 1 && Number(x.holdVol) > 0 && x.positionType === wantType
  );
  if (!p) return null;
  const o = Number(p.openAvgPrice);
  if (Number.isFinite(o) && o > 0) return o;
  const h = Number(p.holdAvgPrice);
  if (Number.isFinite(h) && h > 0) return h;
  return null;
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
  /** Grade C Short fade — สายไส้ = limit retest · สาย V-Top = market */
  gradeCShortEntry?: {
    strategy: "wick_limit_retest" | "vtop_market";
    limitPrice?: number | null;
  };
  /** สัดส่วน margin (เช่น 0.5 สำหรับ Grade B sustained flow) */
  marginScale?: number;
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

    const marginBase = row.snowballAutoTradeMarginUsdt ?? NaN;
    const marginScale =
      typeof input.marginScale === "number" && Number.isFinite(input.marginScale) && input.marginScale > 0
        ? Math.min(1, input.marginScale)
        : 1;
    const marginUsdt = marginBase * marginScale;
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
    if (hasActiveUsdtPosition(positions, sym)) {
      const active = positions.find((p) => p.symbol === sym && p.state === 1 && Number(p.holdVol) > 0);
      const sideOpen = active?.positionType === 2 ? "SHORT" : "LONG";
      const hv = active != null ? Number(active.holdVol) : NaN;
      const volLine =
        Number.isFinite(hv) && hv > 0 ? `โพซิชันที่เปิดอยู่: ${sideOpen} · holdVol ~${hv}` : "โพซิชันที่เปิดอยู่: มี (รายละเอียดจาก MEXC ไม่ครบ)";
      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        "ℹ️ ไม่สั่งเปิด — MEXC มีโพซิชันคู่สัญญานี้อยู่แล้ว",
        `[${shortContractLabel(sym)}]/USDT`,
        `สัญญาณ Snowball ล่าสุด: ${input.side.toUpperCase()}`,
        volLine,
        "ระบบจึงไม่เปิดซ้ำ (กันซ้อน margin / order ซ้ำ)",
      ]);
      continue;
    }

    usersAttempted += 1;

    const long = input.side === "long";
    const gradeCEntry = input.gradeCShortEntry;
    const useWickLimit =
      !long &&
      gradeCEntry?.strategy === "wick_limit_retest" &&
      typeof gradeCEntry.limitPrice === "number" &&
      Number.isFinite(gradeCEntry.limitPrice) &&
      gradeCEntry.limitPrice > 0;

    try {
      const om = useWickLimit
        ? await createOpenLimitOrder(creds, {
            contractSymbol: sym,
            long: false,
            marginUsdt,
            leverage: Math.floor(leverage),
            limitPrice: gradeCEntry!.limitPrice!,
            openType: 1,
          })
        : await createOpenMarketOrder(creds, {
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
          `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น ${long ? "LONG" : "SHORT"}${useWickLimit ? " · Limit retest ไส้" : gradeCEntry?.strategy === "vtop_market" ? " · Market V-Top" : ""})`,
          `[${shortContractLabel(sym)}]/USDT`,
          `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
          useWickLimit ? `Limit ~${fmtSnowballPriceUsdt(gradeCEntry!.limitPrice!)} USDT` : "",
          `MEXC: ${msg}`,
        ]);
        continue;
      }

      let mexcAvgEntry: number | null = null;
      let positionOpen = false;
      try {
        const posAfter = await getOpenPositions(creds, sym);
        positionOpen = hasActiveUsdtPosition(posAfter, sym);
        mexcAvgEntry = readMexcAvgEntryPrice(posAfter, sym, input.side);
      } catch (e) {
        console.error("[snowballAutoTrade] getOpenPositions after open", sym, userId, e);
      }

      if (useWickLimit && !positionOpen) {
        await notifyLines(userId, [
          "Koji — Snowball auto-open (MEXC)",
          "⏳ ตั้ง Limit SHORT ดัก retest ไส้บนแล้ว — ยังไม่ fill",
          `[${shortContractLabel(sym)}]/USDT`,
          `Limit ~${fmtSnowballPriceUsdt(gradeCEntry!.limitPrice!)} USDT · Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
          `จุดอ้างอิง (บอท): ${fmtSnowballPriceUsdt(input.referenceEntryPrice)} USDT`,
          "ยังไม่นับ 1 order/วัน — จะเปิดซ้ำได้เมื่อยังไม่มีโพซิชันและยังไม่เคยเปิดสำเร็จวันนี้",
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
          mexcAvgEntryPrice: mexcAvgEntry,
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

      const entryModeLine = useWickLimit
        ? "โหมดเข้า: Limit retest ไส้บน (50% ไส้บนแท่ง rejection ล่าสุด)"
        : gradeCEntry?.strategy === "vtop_market"
          ? "โหมดเข้า: Market V-Top (ทุบกลืนเนื้อเขียว)"
          : "";

      await notifyLines(userId, [
        "Koji — Snowball auto-open (MEXC)",
        long ? "✅ เปิด LONG จาก Snowball" : "✅ เปิด SHORT จาก Snowball",
        `[${shortContractLabel(sym)}]/USDT`,
        `Margin ~${marginUsdt} USDT · ${Math.floor(leverage)}x`,
        ...(entryModeLine ? [entryModeLine] : []),
        useWickLimit
          ? `Limit ที่ตั้ง: ${fmtSnowballPriceUsdt(gradeCEntry!.limitPrice!)} USDT`
          : "",
        `จุดเข้าอ้างอิง (บอท / Binance): ${fmtSnowballPriceUsdt(input.referenceEntryPrice)} USDT`,
        mexcAvgEntry != null && Number.isFinite(mexcAvgEntry) && mexcAvgEntry > 0
          ? `ราคาเข้าเฉลี่ย MEXC: ${fmtSnowballPriceUsdt(mexcAvgEntry)} USDT — Quick TP คิด ROI จากราคานี้`
          : "ราคาเข้าเฉลี่ย MEXC: ยังดึงไม่ได้ — Quick TP จะใช้จุดอ้างอิงบอท (อาจคลาดกับ UI)",
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

