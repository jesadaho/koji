import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { fetchSimplePrices, type CoinQuote } from "./cryptoService";
import { loadSystemChangeSubscribers } from "./systemChangeSubscribersStore";
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
  return null;
}

function outcomeLabel(won: boolean | null, sparkUp: boolean): string {
  if (won === null) return "ไม่มีข้อมูลราคา";
  if (sparkUp) {
    return won ? "momentum (long) ชนะ" : "fade (short) ชนะ";
  }
  return won ? "momentum (short) ชนะ" : "fade (long) ชนะ";
}

function buildCheckpointMessage(
  which: "30m" | "1h",
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
    `📍 Koji Spark follow-up (${which === "30m" ? "T+30m" : "T+1h"})`,
    `[${base}]/USDT · Spark ${pctStr}`,
    `อ้างอิงราคา: ${formatPriceUsd(refPrice)} (last + timestamp จาก series — ไม่ใช่ TF กราฟ)`,
    `ราคาปัจจุบัน: ${endPrice != null ? formatPriceUsd(endPrice) : "—"}`,
    `ผล: ${outcomeLabel(won, sparkUp)}`,
  ].join("\n");
}

function isFollowUpComplete(cur: SparkFollowUpPending): boolean {
  return (
    cur.sent30 &&
    cur.sent60 &&
    cur.silent2h &&
    cur.silent3h &&
    cur.silent4h
  );
}

/** มี checkpoint ใดถึงกำหนดในรอบนี้ (ต้องดึงราคา) */
function pendingHasDueCheckpoint(p: SparkFollowUpPending, nowSec: number): boolean {
  if (!p.sent30 && nowSec >= p.due30Sec) return true;
  if (!p.sent60 && nowSec >= p.due60Sec) return true;
  if (p.sent60 && !p.silent2h && nowSec >= p.due2hSec) return true;
  if (p.sent60 && !p.silent3h && nowSec >= p.due3hSec) return true;
  if (p.sent60 && !p.silent4h && nowSec >= p.due4hSec) return true;
  return false;
}

async function usdForSymbol(symbol: string, cache: Record<string, CoinQuote>): Promise<number | null> {
  const q = cache[symbol];
  if (q?.usd != null && Number.isFinite(q.usd)) return q.usd;
  try {
    const r = await fetchSimplePrices([symbol]);
    Object.assign(cache, r);
    const q2 = cache[symbol];
    return q2?.usd != null && Number.isFinite(q2.usd) ? q2.usd : null;
  } catch (e) {
    console.error("[sparkFollowUpTick] price fetch", symbol, e);
    return null;
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
  const subs = await loadSystemChangeSubscribers();

  let notifiedPushes = 0;
  let checkpoints = 0;
  let resolvedEvents = 0;

  const symbolsThisTick = new Set<string>();
  for (const p of state.pending) {
    if (pendingHasDueCheckpoint(p, nowSec)) symbolsThisTick.add(p.symbol);
  }

  let quoteCache: Record<string, CoinQuote> = {};
  if (symbolsThisTick.size > 0) {
    try {
      quoteCache = await fetchSimplePrices([...symbolsThisTick]);
    } catch (e) {
      console.error("[sparkFollowUpTick] batch price fetch", e);
    }
  }

  const nextPending: SparkFollowUpPending[] = [];

  for (const p of state.pending) {
    let cur: SparkFollowUpPending = { ...p };
    /** ราคา snapshot รอบเดียวต่อ 1 pending — ใช้ร่วม T+30m … T+4h ในรอบเดียวกัน */
    let rowPrice: number | null | undefined;

    const snapUsd = async (): Promise<number | null> => {
      if (rowPrice !== undefined) return rowPrice;
      rowPrice = await usdForSymbol(cur.symbol, quoteCache);
      return rowPrice;
    };

    const runCheckpoint = async (kind: "30" | "60"): Promise<void> => {
      const endPrice = await snapUsd();
      const won = momentumOutcome(cur.refPrice, cur.sparkReturnPct, endPrice);
      const which: "30m" | "1h" = kind === "30" ? "30m" : "1h";
      const body = buildCheckpointMessage(which, cur.symbol, cur.refPrice, endPrice, cur.sparkReturnPct, won);

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

      for (const uid of subs) {
        try {
          await sendAlertNotification(client, uid, body);
          notifiedPushes += 1;
        } catch (e) {
          console.error("[sparkFollowUpTick] notify", cur.symbol, uid, e);
        }
      }
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
