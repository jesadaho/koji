import type { Client } from "@line/bot-sdk";
import { sendSparkSystemAlert } from "./alertNotify";
import {
  contractHasBinancePriceFallback,
  fetchSimplePricesWithDiagnostics,
  type CoinQuote,
} from "./cryptoService";
import { telegramSparkSystemGroupConfigured } from "./telegramAlert";
import {
  loadSparkFollowUpState,
  saveSparkFollowUpState,
  type SparkFollowUpHistoryRow,
  type SparkFollowUpPending,
} from "./sparkFollowUpStore";

function enabled(): boolean {
  const raw = process.env.SPARK_FOLLOWUP_ENABLED?.trim();
  if (raw === "0" || raw === "false") return false;
  return true;
}

/** แจ้งเตือนเมื่อดึงราคา follow-up ไม่สำเร็จ — ปิดด้วย SPARK_FOLLOWUP_PRICE_FAIL_NOTIFY=0 */
function priceFailNotifyEnabled(): boolean {
  const raw = process.env.SPARK_FOLLOWUP_PRICE_FAIL_NOTIFY?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function shortLabel(contractSymbol: string): string {
  const s = contractSymbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || contractSymbol;
}

function formatPriceUsd(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p < 1) return `$${p.toFixed(4)}`;
  if (p < 1000) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function momentumOutcome(
  refPrice: number,
  sparkReturnPct: number,
  endPrice: number | null
): boolean | null {
  if (endPrice == null || !Number.isFinite(endPrice) || endPrice <= 0) return null;
  const eps = Math.max(refPrice * 1e-9, 1e-12);
  if (sparkReturnPct > 0) return endPrice > refPrice + eps;
  if (sparkReturnPct < 0) return endPrice < refPrice - eps;
  /** Spark แท่งอ้างอิง return 0% — ไม่มีทิศ momentum จากสัญญาณ; ใช้ราคาหลังจุดอ้างอิง > ref เป็นตัวแทน “ต่อเนื่องขึ้น” เพื่อให้สถิติ T+15m นับได้ */
  return endPrice > refPrice + eps;
}

function outcomeLabel(won: boolean | null, sparkUp: boolean): string {
  if (won === null) return "ไม่มีข้อมูลราคา";
  if (sparkUp) {
    return won ? "momentum (long) ชนะ" : "fade (short) ชนะ";
  }
  return won ? "momentum (short) ชนะ" : "fade (long) ชนะ";
}

function buildCheckpoint30mMessage(
  symbol: string,
  refPrice: number,
  endPrice: number | null,
  sparkReturnPct: number,
  won: boolean | null
): string {
  const base = shortLabel(symbol);
  const sparkUp = sparkReturnPct > 0;
  const pctStr = `${sparkReturnPct >= 0 ? "+" : ""}${sparkReturnPct.toFixed(1)}%`;
  return [
    `📍 Koji Spark follow-up (T+30m)`,
    `[${base}]/USDT · Spark ${pctStr}`,
    `อ้างอิงราคา: ${formatPriceUsd(refPrice)} (last + timestamp จาก series — ไม่ใช่ TF กราฟ)`,
    `ราคาปัจจุบัน: ${endPrice != null ? formatPriceUsd(endPrice) : "—"}`,
    `ผล: ${outcomeLabel(won, sparkUp)}`,
  ].join("\n");
}

function isFollowUpComplete(cur: SparkFollowUpPending): boolean {
  return (
    cur.silent15 &&
    cur.sent30 &&
    cur.sent60 &&
    cur.silent2h &&
    cur.silent3h &&
    cur.silent4h
  );
}

/** รายละเอียด API ในแจ้งเตือน — ยาวขึ้นเพื่อ debug (Telegram ~4k) */
const FETCH_DETAIL_MAX = 1400;

function truncateFetchDetail(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= FETCH_DETAIL_MAX) return oneLine;
  return `${oneLine.slice(0, FETCH_DETAIL_MAX)}…`;
}

function formatFetchError(e: unknown): string {
  if (e instanceof Error && e.message) return truncateFetchDetail(e.message);
  return truncateFetchDetail(String(e));
}

type UsdLookupResult = {
  usd: number | null;
  /** ตั้งเมื่อ usd เป็น null — สำหรับแจ้งเตือน (ไม่ใส่ stack) */
  detailIfNull?: string;
};

/** มี checkpoint ใดถึงกำหนดในรอบนี้ (ต้องดึงราคา) */
function pendingHasDueCheckpoint(p: SparkFollowUpPending, nowSec: number): boolean {
  if (!p.silent15 && nowSec >= p.due15Sec) return true;
  if (!p.sent30 && nowSec >= p.due30Sec) return true;
  if (!p.sent60 && nowSec >= p.due60Sec) return true;
  if (p.sent60 && !p.silent2h && nowSec >= p.due2hSec) return true;
  if (p.sent60 && !p.silent3h && nowSec >= p.due3hSec) return true;
  if (p.sent60 && !p.silent4h && nowSec >= p.due4hSec) return true;
  return false;
}

function isValidCachedQuote(q: CoinQuote | undefined): boolean {
  return q != null && q.usd != null && Number.isFinite(q.usd) && q.usd > 0;
}

async function usdForSymbol(
  symbol: string,
  cache: Record<string, CoinQuote>,
  batchMissingDiag: Record<string, string> | undefined,
  batchFailDetail: string | undefined
): Promise<UsdLookupResult> {
  const q = cache[symbol];
  if (isValidCachedQuote(q)) {
    return { usd: q!.usd };
  }

  const pre = batchMissingDiag?.[symbol]?.trim();
  if (pre) {
    if (batchFailDetail?.trim()) {
      return {
        usd: null,
        detailIfNull: `${truncateFetchDetail(pre)} · batch cron: ${truncateFetchDetail(batchFailDetail)}`,
      };
    }
    return { usd: null, detailIfNull: truncateFetchDetail(pre) };
  }

  try {
    const { quotes, missingDetailBySymbol } = await fetchSimplePricesWithDiagnostics([symbol]);
    Object.assign(cache, quotes);
    const q2 = cache[symbol];
    if (isValidCachedQuote(q2)) {
      return { usd: q2!.usd };
    }
    const fromDiag = missingDetailBySymbol[symbol]?.trim();
    const base =
      fromDiag ||
      "ไม่มีราคาใน response (MEXC/Binance ไม่คืนคู่นี้หรือทุกแหล่งว่าง)";
    if (batchFailDetail?.trim()) {
      return {
        usd: null,
        detailIfNull: `${truncateFetchDetail(base)} · batch cron: ${truncateFetchDetail(batchFailDetail)}`,
      };
    }
    return { usd: null, detailIfNull: truncateFetchDetail(base) };
  } catch (e) {
    console.error("[sparkFollowUpTick] price fetch", symbol, e);
    return { usd: null, detailIfNull: formatFetchError(e) };
  }
}

export async function runSparkFollowUpTick(client: Client): Promise<{
  notifiedPushes: number;
  resolvedEvents: number;
  checkpoints: number;
}> {
  if (!enabled()) {
    return { notifiedPushes: 0, resolvedEvents: 0, checkpoints: 0 };
  }

  let state = await loadSparkFollowUpState();
  const nowSec = Math.floor(Date.now() / 1000);
  let notifiedPushes = 0;
  let checkpoints = 0;
  let resolvedEvents = 0;

  const symbolsThisTick = new Set<string>();
  for (const p of state.pending) {
    if (pendingHasDueCheckpoint(p, nowSec)) symbolsThisTick.add(p.symbol);
  }

  let quoteCache: Record<string, CoinQuote> = {};
  let batchMissingDiag: Record<string, string> = {};
  let batchFetchFailDetail: string | undefined;
  if (symbolsThisTick.size > 0) {
    try {
      const r = await fetchSimplePricesWithDiagnostics(Array.from(symbolsThisTick));
      quoteCache = r.quotes;
      batchMissingDiag = r.missingDetailBySymbol;
    } catch (e) {
      console.error("[sparkFollowUpTick] batch price fetch", e);
      batchFetchFailDetail = formatFetchError(e);
    }
  }

  const nextPending: SparkFollowUpPending[] = [];

  for (const p of state.pending) {
    let cur: SparkFollowUpPending = { ...p };
    /** ราคา snapshot รอบเดียวต่อ 1 pending — ใช้ร่วม T+30m … T+4h ในรอบเดียวกัน */
    let rowPrice: number | null | undefined;
    /** ส่งแจ้งเตือนดึงราคาไม่สำเร็จได้ครั้งเดียวต่อ 1 pending ต่อรอบ cron */
    let priceFetchFailNotified = false;

    const snapUsd = async (): Promise<number | null> => {
      if (rowPrice !== undefined) return rowPrice;
      const lookup = await usdForSymbol(cur.symbol, quoteCache, batchMissingDiag, batchFetchFailDetail);
      rowPrice = lookup.usd;
      if (
        rowPrice == null &&
        contractHasBinancePriceFallback(cur.symbol) &&
        priceFailNotifyEnabled() &&
        !priceFetchFailNotified &&
        telegramSparkSystemGroupConfigured()
      ) {
        priceFetchFailNotified = true;
        const base = shortLabel(cur.symbol);
        const detail =
          lookup.detailIfNull?.trim() ||
          "ไม่ทราบสาเหตุ (ไม่มีรายละเอียดจากการดึงราคา)";
        const body = [
          "⚠️ Spark follow-up: ดึงราคาไม่สำเร็จ (ลอง MEXC + Binance แล้ว)",
          `[${base}]/USDT`,
          "สถิติจุดวัดในรอบ cron นี้จะเป็น null — รอบถัดไปจะลองใหม่",
          `รายละเอียด: ${detail}`,
        ].join("\n");
        try {
          notifiedPushes += await sendSparkSystemAlert(client, [], body);
        } catch (e) {
          console.error("[sparkFollowUpTick] price-fail notify", cur.symbol, e);
        }
      }
      return rowPrice;
    };

    /** T+30m แจ้ง LINE · T+1h เก็บสถิติอย่างเดียว (ไม่ push) */
    const runCheckpoint = async (kind: "30" | "60"): Promise<void> => {
      const endPrice = await snapUsd();
      const won = momentumOutcome(cur.refPrice, cur.sparkReturnPct, endPrice);

      if (kind === "30") {
        cur = {
          ...cur,
          sent30: true,
          price30: endPrice,
          momentumWon30: won,
        };
      } else {
        cur = {
          ...cur,
          sent60: true,
          price60: endPrice,
          momentumWon60: won,
        };
      }
      checkpoints += 1;

      /** แจ้ง T+30m เฉพาะเมื่อดึงราคาไม่สำเร็จ — ถ้ามีราคาและคำนวณผลได้แล้วไม่ส่ง (เก็บสถิติใน state อย่างเดียว) */
      if (kind === "30") {
        const priceMissing =
          endPrice == null || !Number.isFinite(endPrice) || endPrice <= 0 || won === null;
        if (priceMissing) {
          const body = buildCheckpoint30mMessage(cur.symbol, cur.refPrice, endPrice, cur.sparkReturnPct, won);
          try {
            notifiedPushes += await sendSparkSystemAlert(client, [], body);
          } catch (e) {
            console.error("[sparkFollowUpTick] notify", cur.symbol, e);
          }
        }
      }
    };

    /** สถิติเงียบ T+15m — ไม่แจ้งเตือน */
    const runSilent15 = async (): Promise<void> => {
      const endPrice = await snapUsd();
      const won = momentumOutcome(cur.refPrice, cur.sparkReturnPct, endPrice);
      checkpoints += 1;
      cur = {
        ...cur,
        silent15: true,
        price15: endPrice,
        momentumWon15: won,
      };
    };

    /** สถิติเงียบ T+2h / T+3h / T+4h — ไม่แจ้งเตือน */
    const runSilent = async (slot: "2h" | "3h" | "4h"): Promise<void> => {
      const endPrice = await snapUsd();
      const won = momentumOutcome(cur.refPrice, cur.sparkReturnPct, endPrice);
      checkpoints += 1;
      if (slot === "2h") {
        cur = {
          ...cur,
          silent2h: true,
          price2h: endPrice,
          momentumWon2h: won,
        };
      } else if (slot === "3h") {
        cur = {
          ...cur,
          silent3h: true,
          price3h: endPrice,
          momentumWon3h: won,
        };
      } else {
        cur = {
          ...cur,
          silent4h: true,
          price4h: endPrice,
          momentumWon4h: won,
        };
      }
    };

    if (!cur.silent15 && nowSec >= cur.due15Sec) {
      await runSilent15();
    }

    if (!cur.sent30 && nowSec >= cur.due30Sec) {
      await runCheckpoint("30");
    }

    if (!cur.sent60 && nowSec >= cur.due60Sec) {
      await runCheckpoint("60");
    }

    if (cur.sent60 && !cur.silent2h && nowSec >= cur.due2hSec) {
      await runSilent("2h");
    }
    if (cur.sent60 && !cur.silent3h && nowSec >= cur.due3hSec) {
      await runSilent("3h");
    }
    if (cur.sent60 && !cur.silent4h && nowSec >= cur.due4hSec) {
      await runSilent("4h");
    }

    if (isFollowUpComplete(cur)) {
      const row: SparkFollowUpHistoryRow = {
        eventKey: cur.eventKey,
        symbol: cur.symbol,
        sparkBarOpenSec: cur.sparkBarOpenSec,
        refCloseSec: cur.refCloseSec,
        refPrice: cur.refPrice,
        sparkReturnPct: cur.sparkReturnPct,
        amount24Usdt: cur.amount24Usdt ?? null,
        volBand: cur.volBand,
        mcapBand: cur.mcapBand,
        price15: cur.price15 ?? null,
        momentumWon15: cur.momentumWon15 ?? null,
        price30: cur.price30 ?? null,
        price60: cur.price60 ?? null,
        momentumWon30: cur.momentumWon30 ?? null,
        momentumWon60: cur.momentumWon60 ?? null,
        price2h: cur.price2h ?? null,
        momentumWon2h: cur.momentumWon2h ?? null,
        price3h: cur.price3h ?? null,
        momentumWon3h: cur.momentumWon3h ?? null,
        price4h: cur.price4h ?? null,
        momentumWon4h: cur.momentumWon4h ?? null,
        resolvedAtIso: new Date().toISOString(),
      };
      state = { ...state, history: [...state.history, row] };
      resolvedEvents += 1;
    } else {
      nextPending.push(cur);
    }
  }

  state = { ...state, pending: nextPending };
  await saveSparkFollowUpState(state);

  return { notifiedPushes, resolvedEvents, checkpoints };
}
