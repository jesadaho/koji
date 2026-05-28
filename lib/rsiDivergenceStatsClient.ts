/** Client-safe RSI divergence stats types (no Node.js / Redis). */

import {
  snowballStatsMarketCapUsdLabel,
  snowballStatsQuoteVol24hLabel,
} from "@/lib/snowballStatsClient";
import type { MarketSentimentSnapshot } from "@/lib/marketSentiment";

export type RsiDivergenceTf = "1h" | "4h";

export type RsiDivergenceKind = "bullish" | "bearish";

export type RsiDivergenceTrigger = "rsi_ma_cross" | "price_break_prev";

export type RsiDivergenceStatsOutcome = "pending" | "win" | "loss" | "flat";

export type RsiDivergenceStatsRow = {
  id: string;
  symbol: string;
  tf: RsiDivergenceTf;
  kind: RsiDivergenceKind;
  trigger: RsiDivergenceTrigger;
  alertedAtIso: string;
  alertedAtMs: number;
  /** open time (sec) ของแท่ง confirm/ปิดล่าสุดที่ส่งสัญญาณ */
  signalBarOpenSec: number;
  /** ค่า close แท่ง confirm — ใช้เป็น entry */
  entryPrice: number;
  /** ระดับอ้างอิงระหว่าง W1↔W2: bullish = สูงสุด (resistance), bearish = ต่ำสุด (support) */
  refLevel: number;
  priceW1: number;
  priceW2: number;
  rsiW1: number;
  rsiW2: number;
  /** ระยะห่าง (แท่ง) ระหว่าง wave1 ↔ wave2 */
  barsBetween: number;
  /** |rsiW2 − rsiW1| */
  rsiDelta: number;
  /** True ถ้า rsiDelta ≥ INDICATOR_PUBLIC_DIV_STRONG_RSI_DELTA */
  strong: boolean;
  /** Binance USDT-M quote vol 24h ณ เวลาแจ้ง */
  quoteVol24hUsdt: number | null;
  /** Market cap USD (CoinGecko) ณ เวลาแจ้ง */
  marketCapUsd: number | null;
  /** Snapshot market sentiment (Market Pulse) ณ เวลาแจ้ง */
  marketSentiment?: MarketSentimentSnapshot | null;
  /** Follow-up close บนแท่ง 1d — ผลสุดท้ายอ่านที่ 7d */
  price1d: number | null;
  pct1d: number | null;
  price3d: number | null;
  pct3d: number | null;
  price7d: number | null;
  pct7d: number | null;
  maxRoiPct: number | null;
  durationToMfeHours: number | null;
  maxDrawdownPct: number | null;
  outcome: RsiDivergenceStatsOutcome;
};

export type RsiDivergenceStatsApiPayload = {
  rows: RsiDivergenceStatsRow[];
  /** true เมื่อ Telegram user อยู่ใน KOJI_ADMIN_IDS */
  isAdmin?: boolean;
};

export function rsiDivergenceTfLabel(tf: RsiDivergenceTf): string {
  return tf.toUpperCase();
}

export function rsiDivergenceKindLabel(kind: RsiDivergenceKind): string {
  return kind === "bearish" ? "Bear" : "Bull";
}

/** Emoji + ตัวย่อ สำหรับตาราง */
export function rsiDivergenceKindBadge(kind: RsiDivergenceKind): string {
  return kind === "bearish" ? "🔴 Bear" : "🟢 Bull";
}

export function rsiDivergenceTriggerLabel(t: RsiDivergenceTrigger): string {
  return t === "price_break_prev" ? "Price break" : "RSI cross";
}

export function rsiDivergenceTriggerShort(t: RsiDivergenceTrigger): string {
  return t === "price_break_prev" ? "PB" : "X";
}

export function rsiDivergenceOutcomeLabel(o: RsiDivergenceStatsOutcome): string {
  if (o === "pending") return "Pending";
  if (o === "win") return "Win";
  if (o === "loss") return "Loss";
  return "Flat";
}

export function rsiDivergenceDayOfWeekBkk(alertedAtIso: string, alertedAtMs?: number | null): string {
  const ms =
    alertedAtMs != null && Number.isFinite(alertedAtMs) ? alertedAtMs : Date.parse(alertedAtIso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "short" });
}

/** Re-export label helpers จาก Snowball ให้ใช้รูปแบบ B/M/K เดียวกัน */
export { snowballStatsQuoteVol24hLabel, snowballStatsMarketCapUsdLabel };

export type RsiDivergenceStatsSortKey =
  | "symbol"
  | "tf"
  | "kind"
  | "trigger"
  | "day"
  | "time"
  | "entry"
  | "ref"
  | "rsiW1"
  | "rsiW2"
  | "rsiDelta"
  | "vol24h"
  | "mcap"
  | "h1"
  | "h2"
  | "h3"
  | "roi"
  | "dd"
  | "outcome";

export type RsiDivergenceStatsSortDir = "asc" | "desc";

export type RsiDivergenceStatsSort = {
  key: RsiDivergenceStatsSortKey;
  dir: RsiDivergenceStatsSortDir;
};

export const RSI_DIVERGENCE_STATS_DEFAULT_SORT: RsiDivergenceStatsSort = {
  key: "time",
  dir: "desc",
};

const OUTCOME_SORT_ORDER: Record<RsiDivergenceStatsOutcome, number> = {
  win: 0,
  pending: 1,
  flat: 2,
  loss: 3,
};

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function cmpNumNullLast(a: number | null | undefined, b: number | null | undefined): number {
  const fa = a != null && Number.isFinite(a);
  const fb = b != null && Number.isFinite(b);
  if (!fa && !fb) return 0;
  if (!fa) return 1;
  if (!fb) return -1;
  return a! - b!;
}

function compareRsiDivergenceStatsRows(
  a: RsiDivergenceStatsRow,
  b: RsiDivergenceStatsRow,
  key: RsiDivergenceStatsSortKey,
): number {
  switch (key) {
    case "symbol":
      return cmpStr(a.symbol, b.symbol);
    case "tf":
      return cmpStr(a.tf, b.tf);
    case "kind":
      return cmpStr(a.kind, b.kind);
    case "trigger":
      return cmpStr(a.trigger, b.trigger);
    case "day": {
      const da = rsiDivergenceDayOfWeekBkk(a.alertedAtIso, a.alertedAtMs);
      const db = rsiDivergenceDayOfWeekBkk(b.alertedAtIso, b.alertedAtMs);
      return cmpStr(da, db) || cmpNumNullLast(a.alertedAtMs, b.alertedAtMs);
    }
    case "time":
      return cmpNumNullLast(a.alertedAtMs, b.alertedAtMs);
    case "entry":
      return cmpNumNullLast(a.entryPrice, b.entryPrice);
    case "ref":
      return cmpNumNullLast(a.refLevel, b.refLevel);
    case "rsiW1":
      return cmpNumNullLast(a.rsiW1, b.rsiW1);
    case "rsiW2":
      return cmpNumNullLast(a.rsiW2, b.rsiW2);
    case "rsiDelta":
      return cmpNumNullLast(a.rsiDelta, b.rsiDelta);
    case "vol24h":
      return cmpNumNullLast(a.quoteVol24hUsdt, b.quoteVol24hUsdt);
    case "mcap":
      return cmpNumNullLast(a.marketCapUsd, b.marketCapUsd);
    case "h1":
      return cmpNumNullLast(a.pct1d, b.pct1d);
    case "h2":
      return cmpNumNullLast(a.pct3d, b.pct3d);
    case "h3":
      return cmpNumNullLast(a.pct7d, b.pct7d);
    case "roi":
      return cmpNumNullLast(a.maxRoiPct, b.maxRoiPct);
    case "dd":
      return cmpNumNullLast(a.maxDrawdownPct, b.maxDrawdownPct);
    case "outcome": {
      const oa = OUTCOME_SORT_ORDER[a.outcome] ?? 99;
      const ob = OUTCOME_SORT_ORDER[b.outcome] ?? 99;
      return (
        oa - ob || cmpStr(rsiDivergenceOutcomeLabel(a.outcome), rsiDivergenceOutcomeLabel(b.outcome))
      );
    }
    default:
      return 0;
  }
}

export function sortRsiDivergenceStatsRows(
  rows: RsiDivergenceStatsRow[],
  sort: RsiDivergenceStatsSort,
): RsiDivergenceStatsRow[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const c = compareRsiDivergenceStatsRows(a, b, sort.key);
    return c * mul;
  });
}

export function rsiDivergenceStatsSortDefaultDir(
  key: RsiDivergenceStatsSortKey,
): RsiDivergenceStatsSortDir {
  if (key === "symbol" || key === "tf" || key === "kind" || key === "trigger" || key === "day" || key === "outcome") {
    return "asc";
  }
  return "desc";
}
