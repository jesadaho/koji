import type { Client } from "@line/bot-sdk";
import { listAllSpotFutBasisRows, type SpotFutBasisRow } from "./mexcMarkets";
import { formatPrice } from "./marketsFormat";
import { sendAlertNotification } from "./alertNotify";
import { loadSystemChangeSubscribers } from "./systemChangeSubscribersStore";
import {
  loadSpotFutBasisAlertState,
  saveSpotFutBasisAlertState,
  type SpotFutBasisAlertState,
  type SpotFutBasisTier,
} from "./spotFutBasisAlertStateStore";

function warningMinPct(): number {
  const n = Number(process.env.SPOT_FUT_BASIS_WARNING_MIN?.trim());
  return Number.isFinite(n) && n > 0 ? n : 1.0;
}

/** ขอบบนของ Warning — abs มากกว่าค่านี้ = Extreme (ต้องมากกว่า warningMin) */
function extremeThresholdPct(): number {
  const w = warningMinPct();
  const n = Number(process.env.SPOT_FUT_BASIS_EXTREME_MIN?.trim());
  const defaultAbove = Math.max(2.0, w + 1.0);
  if (!Number.isFinite(n) || n <= 0) return defaultAbove;
  return n > w ? n : defaultAbove;
}

function renotifyDeltaPct(): number {
  const n = Number(process.env.SPOT_FUT_BASIS_RENOTIFY_DELTA?.trim());
  return Number.isFinite(n) && n > 0 ? n : 2;
}

/** ใช้ |basis| — Normal &lt; warningMin; Warning [warningMin, extremeThreshold]; Extreme &gt; extremeThreshold */
function basisTierFromAbs(abs: number): "normal" | SpotFutBasisTier {
  const w = warningMinPct();
  const e = extremeThresholdPct();
  if (abs < w) return "normal";
  if (abs <= e) return "warning";
  return "extreme";
}

function shortBase(symbol: string): string {
  const s = symbol.replace(/_USDT$/i, "").trim();
  return s.replace(/_/g, "") || symbol;
}

function buildSpotFutBasisMessage(row: SpotFutBasisRow, tier: SpotFutBasisTier): string {
  const base = shortBase(row.symbol);
  const fp = formatPrice(row.futPrice);
  const sp = formatPrice(row.spotPrice);
  const d = row.basisPct;
  const pctStr = `${d >= 0 ? "+" : ""}${d.toFixed(2)}%`;
  const tag = tier === "extreme" ? "(Extreme!)" : "(Warning)";

  const head =
    tier === "extreme" ? "🚨 Koji Liquidation Alert!" : "⚠️ Koji Liquidation Alert";

  return [
    head,
    `[${base}]/USDT ตรวจพบส่วนต่างราคาผิดปกติ!`,
    "",
    `🔹 Futures Price: $${fp}`,
    `🔸 Spot Price: $${sp}`,
    `⚠️ Price Diff: ${pctStr} ${tag}`,
  ].join("\n");
}

function shouldNotifyBasis(
  prev: { lastNotifiedBasisPct: number; lastTier: SpotFutBasisTier } | undefined,
  basisPct: number,
  tier: SpotFutBasisTier,
): boolean {
  if (!prev) return true;
  if (Math.abs(basisPct - prev.lastNotifiedBasisPct) >= renotifyDeltaPct()) return true;
  if (prev.lastTier === "warning" && tier === "extreme") return true;
  return false;
}

function removeSymbol(state: SpotFutBasisAlertState, sym: string): SpotFutBasisAlertState {
  if (!(sym in state)) return state;
  const next = { ...state };
  delete next[sym];
  return next;
}

/**
 * แจ้งผู้ติดตาม system conditions เมื่อ |spot–perp basis| อยู่ระดับ Warning/Extreme ตามเกณฑ์และ state
 */
export async function runSpotFutBasisAlertTick(
  client: Client,
): Promise<{ notifiedPushes: number; symbolsAlerted: number }> {
  const subscribers = await loadSystemChangeSubscribers();
  if (subscribers.length === 0) {
    return { notifiedPushes: 0, symbolsAlerted: 0 };
  }

  const rows = await listAllSpotFutBasisRows();
  let state = await loadSpotFutBasisAlertState();

  let notifiedPushes = 0;
  let symbolsAlerted = 0;

  for (const row of rows) {
    const abs = row.absBasisPct;
    const sym = row.symbol;
    const tier = basisTierFromAbs(abs);

    if (tier === "normal") {
      state = removeSymbol(state, sym);
      continue;
    }

    const prev = state[sym];
    if (!shouldNotifyBasis(prev, row.basisPct, tier)) {
      continue;
    }

    const body = buildSpotFutBasisMessage(row, tier);
    let anyOk = false;
    for (const uid of subscribers) {
      try {
        await sendAlertNotification(client, uid, body);
        notifiedPushes += 1;
        anyOk = true;
      } catch (e) {
        console.error("[spotFutBasisAlertTick] notify", sym, uid, e);
      }
    }

    if (anyOk) {
      symbolsAlerted += 1;
      state = {
        ...state,
        [sym]: { lastNotifiedBasisPct: row.basisPct, lastTier: tier },
      };
    }
  }

  await saveSpotFutBasisAlertState(state);
  return { notifiedPushes, symbolsAlerted };
}
