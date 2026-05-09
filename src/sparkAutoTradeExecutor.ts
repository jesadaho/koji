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
  saveSparkAutoTradeState,
  hasOpenedContractToday,
  withRecordedSuccessfulOpen,
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
      console.error("[sparkAutoTrade] open_positions fail", sym, userId, e);
      continue;
    }
    if (hasActiveUsdtPosition(positions, sym)) continue;

    const long = sparkAutoTradeOpenLongFromSpark(returnPct, row as TradingViewMexcUserSettings);
    const { marginUsdt, leverage, tpPct } = resolved.value;
    usersAttempted += 1;

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
      takeProfitPrice,
    });

    let tpOmittedFallback = false;
    if (!om.success && takeProfitPrice != null) {
      om = await createOpenMarketOrder(creds, {
        contractSymbol: sym,
        long,
        marginUsdt,
        leverage,
      });
      tpOmittedFallback = true;
    }

    if (!om.success) {
      const msg = om.message ?? `code ${om.code}`;
      await notifyLines(userId, [
        "Koji — Spark auto-open (MEXC)",
        "❌ สั่งเปิดไม่สำเร็จ",
        `[${shortContractLabel(sym)}]/USDT (${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%)`,
        `Vol band: ${volBand}`,
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
    usersSucceeded += 1;

    const tpLine =
      takeProfitPrice != null && !tpOmittedFallback
        ? `Take-profit ~ ${takeProfitPrice} (+${resolved.value.tpPct}%)`
        : tpPct > 0 && tpOmittedFallback
          ? `TP (${resolved.value.tpPct}%) ไม่ได้แนบ — แลกเปิดด้วย market อย่างเดียว`
          : "";

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
      ...(tpLine ? [tpLine] : []),
      `Order: ${orderId ?? "-"}`,
      "ครั้งถัดไปในวันนี้: จะไม่เปิดจาก Spark เหมือนกันในเหรียญนี้ (ตั้งค่า 1 order/เหรียญ/วัน)",
    ]);
  }

  ensuredBatch.state = state;
  return { usersAttempted, usersSucceeded };
}
