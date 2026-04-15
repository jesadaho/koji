import type { Client } from "@line/bot-sdk";
import { sendAlertNotification } from "./alertNotify";
import { fetchSimplePrices } from "./cryptoService";
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
  const label = which === "30m" ? "T+30m" : "T+1h";
  const pctStr = `${sparkReturnPct >= 0 ? "+" : ""}${sparkReturnPct.toFixed(1)}%`;
  return [
    `📍 Koji Spark follow-up (${label})`,
    `[${base}]/USDT · Spark ${pctStr}`,
    `อ้างอิง (ปิดแท่ง 5m): ${formatPriceUsd(refPrice)}`,
    `ราคาปัจจุบัน: ${endPrice != null ? formatPriceUsd(endPrice) : "—"}`,
    `ผล: ${outcomeLabel(won, sparkUp)}`,
  ].join("\n");
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

  const nextPending: SparkFollowUpPending[] = [];

  for (const p of state.pending) {
    let cur: SparkFollowUpPending = { ...p };

    const runCheckpoint = async (kind: "30" | "60"): Promise<void> => {
      const quotes = await fetchSimplePrices([cur.symbol]);
      const q = quotes[cur.symbol];
      const endPrice = q?.usd != null && Number.isFinite(q.usd) ? q.usd : null;
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

    if (!cur.sent30 && nowSec >= cur.due30Sec) {
      await runCheckpoint("30");
    }

    if (!cur.sent60 && nowSec >= cur.due60Sec) {
      await runCheckpoint("60");
    }

    if (cur.sent30 && cur.sent60) {
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
