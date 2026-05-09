import {
  createOpenMarketOrder,
  getContractLastPricePublic,
  getOpenPositions,
  type MexcCredentials,
} from "./mexcFuturesClient";
import { classifySparkVolBand } from "./sparkTierContext";
import {
  sparkAutoTradeParamsForVolBand,
  sparkAutoTradeDirectionAllowed,
  sparkAutoTradeOpenLongFromSpark,
  computeTakeProfitPriceFromMark,
} from "./sparkAutoTradeResolve";
import {
  loadTradingViewMexcSettingsFullMap,
  orderSideEffective,
  type TradingViewMexcUserSettings,
} from "./tradingViewCloseSettingsStore";
import {
  loadSparkAutoTradeState,
  hasOpenedContractToday,
  withRecordedSuccessfulOpen,
  withSparkTimeStopScheduled,
  bkkSparkAutoTradeDayKeyNow,
} from "./sparkAutoTradeStateStore";
import { notifyTradingViewWebhookTelegram } from "./tradingViewWebhookTelegramNotify";

/** preload จาก price tick — lazy สร้างครั้งแรก; state เก็บกลับเพื่อ save ท้ายครอบ */
export type SparkAutoTradeTickBatchRef = {
  map: Record<string, TradingViewMexcUserSettings>;
  state: Awaited<ReturnType<typeof loadSparkAutoTradeState>>;
};

export async function loadSparkAutoTradeTickBatch(): Promise<SparkAutoTradeTickBatchRef> {
  const [map, state] = await Promise.all([
    loadTradingViewMexcSettingsFullMap(),
    loadSparkAutoTradeState(),
  ]);
  return { map, state };
}

/** default ปิด — ตั้ง SPARK_AUTOTRADE_ENABLED=1 */
export function isSparkAutotradeCronEnabled(): boolean {
  const v = process.env.SPARK_AUTOTRADE_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function shortContractLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

/** แสดงราคา USDT ในแชท — อ่านง่าย ไม่ทิ้ง .00 ยาวเกิน */
function formatSparkPriceUsdt(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function sparkOpenTpNotifyLines(p: {
  tpPct: number;
  mark: number | null;
  takeProfitPrice: number | undefined;
  tpOmittedFallback: boolean;
}): string[] {
  const { tpPct, mark, takeProfitPrice, tpOmittedFallback } = p;
  if (!(tpPct > 0)) {
    return ["เป้า TP: ไม่ตั้ง (TP% = 0 หรือว่างใน Settings)"];
  }
  const markStr = mark != null ? formatSparkPriceUsdt(mark) : null;
  if (takeProfitPrice != null) {
    const tgt = formatSparkPriceUsdt(takeProfitPrice);
    if (!tpOmittedFallback) {
      return [
        `เป้าราคา take-profit: ${tgt} USDT (+${tpPct}% จาก mark ประมาณ ${markStr ?? "—"} USDT) — แนบกับคำสั่งเปิดบน MEXC แล้ว`,
      ];
    }
    return [
      `เป้าราคา take-profit ที่คำนวณ: ${tgt} USDT (+${tpPct}% จาก mark ประมาณ ${markStr ?? "—"} USDT) — ไม่ได้แนบกับออเดอร์ (เปิด market อย่างเดียว) · แนะนำตั้ง TP มือบน MEXC ใกล้ราคานี้`,
    ];
  }
  return [
    `ตั้ง TP ${tpPct}% ใน Settings แต่คำนวณราคาเป้าไม่ได้ (ดึง mark ไม่สำเร็จ) — ควรตั้ง TP มือเอง`,
  ];
}

async function notifyLines(userId: string, lines: string[]): Promise<void> {
  await notifyTradingViewWebhookTelegram(userId, lines.filter(Boolean).join("\n"));
}

function hasActiveUsdtPosition(
  positions: Awaited<ReturnType<typeof getOpenPositions>>,
  contractSymbol: string
): boolean {
  const sym = contractSymbol.trim();
  return positions.some((p) => p.symbol === sym && p.state === 1 && Number(p.holdVol) > 0);
}

/** @param batch ถ้ามี — โหลดแล้ว; ถ้าการโหลดครั้งแรกให้เรียง map+state พร้อมกัน; persist = false เมื่อมี batch */
export async function runSparkAutoTradeAfterSparkNotify(
  input: { contractSymbol: string; returnPct: number; amount24Usdt: number },
  batch?: SparkAutoTradeTickBatchRef,
): Promise<{ usersAttempted: number; usersSucceeded: number }> {
  if (!isSparkAutotradeCronEnabled()) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }

  const { contractSymbol: symRaw, returnPct } = input;
  const sym = symRaw.trim();
  if (!sym || returnPct === 0) {
    return { usersAttempted: 0, usersSucceeded: 0 };
  }

  if (!batch?.map || !batch.state) {
    throw new Error("[sparkAutoTrade] ต้องส่ง SparkAutoTradeTickBatchRef จากครอบ runPriceSpike15mAlertTick");
  }

  const volBand = classifySparkVolBand(input.amount24Usdt);

  const ensuredBatch = batch;

  let state = ensuredBatch.state;
  const map = ensuredBatch.map;
  const dayKey = bkkSparkAutoTradeDayKeyNow();

  let usersAttempted = 0;
  let usersSucceeded = 0;

  for (const [userId, row] of Object.entries(map)) {
    if (!/^tg:\d+$/.test(userId.trim())) continue;

    const resolved = sparkAutoTradeParamsForVolBand(row as TradingViewMexcUserSettings, volBand);
    if (!resolved.ok) continue;

    if (!sparkAutoTradeDirectionAllowed(returnPct, row.sparkAutoTradeDirection)) continue;

    if (hasOpenedContractToday(state[userId], sym, dayKey)) continue;

    const creds: MexcCredentials | null =
      row.mexcApiKey?.trim() && row.mexcSecret?.trim()
        ? { apiKey: row.mexcApiKey.trim(), secret: row.mexcSecret.trim() }
        : null;
    if (!creds) continue;

    let positions: Awaited<ReturnType<typeof getOpenPositions>>;
    try {
      positions = await getOpenPositions(creds, sym);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[sparkAutoTrade] open_positions fail", sym, userId, e);
      await notifyLines(userId, [
        "Koji — Spark auto-open (MEXC)",
        "❌ เช็คโพซิชันจาก MEXC ไม่สำเร็จ — จึงไม่สั่งเปิด (ป้องกันซ้ำ)",
        `[${shortContractLabel(sym)}]/USDT (${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%)`,
        `Vol band: ${volBand}`,
        `รายละเอียด: ${detail.slice(0, 320)}`,
      ]);
      continue;
    }
    if (hasActiveUsdtPosition(positions, sym)) continue;

    const long = sparkAutoTradeOpenLongFromSpark(returnPct, row as TradingViewMexcUserSettings);
    const { marginUsdt, leverage, tpPct } = resolved.value;
    usersAttempted += 1;

    const sideHint = long ? "LONG" : "SHORT";

    try {
      const markPub = await getContractLastPricePublic(sym);
      const mark = typeof markPub === "number" && markPub > 0 ? markPub : null;
      let takeProfitPrice: number | undefined;
      if (mark != null) {
        const tp = computeTakeProfitPriceFromMark(mark, long, tpPct);
        if (tp != null) takeProfitPrice = tp;
      }

      let om = await createOpenMarketOrder(creds, {
        contractSymbol: sym,
        long,
        marginUsdt,
        leverage,
        openType: 1,
        takeProfitPrice,
      });

      let tpOmittedFallback = false;
      if (!om.success && takeProfitPrice != null) {
        om = await createOpenMarketOrder(creds, {
          contractSymbol: sym,
          long,
          marginUsdt,
          leverage,
          openType: 1,
        });
        tpOmittedFallback = true;
      }

      if (!om.success) {
        const msg = om.message ?? `code ${om.code}`;
        await notifyLines(userId, [
          "Koji — Spark auto-open (MEXC)",
          `❌ สั่งเปิดไม่สำเร็จ (ตั้งใจให้เป็น ${sideHint})`,
          `[${shortContractLabel(sym)}]/USDT (${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%)`,
          `Vol band: ${volBand}`,
          `Margin ~${marginUsdt} USDT · ${leverage}x`,
          `MEXC: ${msg}`,
        ]);
        continue;
      }

      const d = om.data;
      const orderId =
        d && typeof d === "object" && d !== null && "orderId" in d
          ? String((d as { orderId: unknown }).orderId)
          : undefined;

      state = withRecordedSuccessfulOpen(state, userId, sym, dayKey);
      const tsH = (row as TradingViewMexcUserSettings).sparkAutoTradeTimeStopHours;
      let timeStopLine = "";
      if (typeof tsH === "number" && Number.isFinite(tsH) && tsH >= 1 && tsH <= 168) {
        state = withSparkTimeStopScheduled(state, userId, sym, Date.now() + Math.floor(tsH) * 3600 * 1000);
        timeStopLine =
          tsH === 3
            ? `Time-stop: ระบบจะพยายามปิดมาร์เก็ต ~ 3 ชม. หลังเปิดนี้ (ตามรอบ cron ~5–15 นาที)`
            : `Time-stop: ระบบจะพยายามปิดมาร์เก็ต ~ ${Math.floor(tsH)} ชม. หลังเปิดนี้ (ตามรอบ cron)`;
      }
      usersSucceeded += 1;

      const tpNotifyLines = sparkOpenTpNotifyLines({
        tpPct: resolved.value.tpPct,
        mark,
        takeProfitPrice,
        tpOmittedFallback,
      });

      const ord = orderSideEffective(row as TradingViewMexcUserSettings);
      const ordHint =
        ord === "fade_spark"
          ? " · ฝั่งออเดอร์: เข้าสวนสัญญาณ Spike"
          : ord === "long"
            ? " · ฝั่งออเดอร์: long ทุกครั้งเมื่อเข้ากรอง"
            : ord === "short"
              ? " · ฝั่งออเดอร์: short ทุกครั้งเมื่อเข้ากรอง"
              : "";

      await notifyLines(userId, [
        "Koji — Spark auto-open (MEXC)",
        (long ? "✅ เปิด LONG" : "✅ เปิด SHORT") + ` จาก Spark${ordHint}`,
        `[${shortContractLabel(sym)}]/USDT (${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%)`,
        `Vol band: ${volBand}`,
        `Margin ~${marginUsdt} USDT · ${resolved.value.leverage}x`,
        ...tpNotifyLines,
        ...(timeStopLine ? [timeStopLine] : []),
        `Order: ${orderId ?? "-"}`,
        "ครั้งถัดไปในวันนี้: จะไม่เปิดจาก Spark เหมือนกันในเหรียญนี้ (ตั้งค่า 1 order/เหรียญ/วัน)",
      ]);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await notifyLines(userId, [
        "Koji — Spark auto-open (MEXC)",
        `❌ สั่งเปิดล้มเหลวจากข้อผิดพลาดระหว่างเรียก MEXC / เครือข่าย (ตั้งใจเป็น ${sideHint})`,
        `[${shortContractLabel(sym)}]/USDT (${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%)`,
        `Vol band: ${volBand}`,
        `Margin ~${marginUsdt} USDT · ${leverage}x`,
        `รายละเอียด: ${detail.slice(0, 400)}`,
      ]);
    }
  }

  ensuredBatch.state = state;
  return { usersAttempted, usersSucceeded };
}
