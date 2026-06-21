/** Client-safe candle reversal stats types (no Node.js / Redis). */

import type { MarketSentimentSnapshot } from "@/lib/marketSentiment";
import type { PumpCycleSwingLowSource } from "@/lib/pumpCycleSwingLow";
import { computePumpCycleTrendVelocity } from "@/lib/pumpCycleSwingLow";
import { statsEmaSlopePctLabel } from "@/lib/statsEmaSlope";
import type { StrategyProfitByPlanMap } from "@/lib/statsStrategyProfitClient";
import type { StatsTpSlExitReason } from "@/lib/tpSlStrategySimulate";

export type CandleReversalSignalBarTf = "1d" | "1h";

export type CandleReversalTradeSide = "short" | "long";

export type CandleReversalModel =
  | "inverted_doji"
  | "marubozu"
  | "longest_red_body"
  | "longest_green_body";

export type CandleReversalOutcome = "pending" | "win" | "loss" | "flat";

/** bump เมื่อเปลี่ยนวิธีคำนวณ Max ROI — บังคับ follow-up แถวเก่า */
export const STATS_MAX_ROI_15M_VERSION = 1;

export type CandleReversalStatsRow = {
  id: string;
  symbol: string;
  signalBarTf: CandleReversalSignalBarTf;
  tradeSide: CandleReversalTradeSide;
  model: CandleReversalModel;
  alertedAtIso: string;
  alertedAtMs: number;
  signalBarOpenSec: number;
  entryPrice: number;
  retestPrice: number;
  slPrice: number;
  /** Quote volume 24h USDT (Binance perp) ณ เวลาแจ้ง */
  quoteVol24hUsdt?: number | null;
  /** version 1 = ดึงต่อ symbol (Binance quoteVolume · fallback MEXC amount24) */
  quoteVol24hV?: number;
  /** Market cap USD (CoinGecko) ณ เวลาแจ้ง */
  marketCapUsd?: number | null;
  /** EMA(12) 1h — slope % ย้อนหลัง 7 วัน (168 แท่ง) */
  ema1hSlopePct7d?: number | null;
  /** EMA(12) 4h — slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  ema4hSlopePct7d?: number | null;
  /** EMA(12) 1d — slope % ย้อนหลัง 7 แท่ง */
  ema1dSlopePct7d?: number | null;
  /** BTC — EMA(12) 4h slope % ย้อนหลัง 7 วัน */
  btcEma4hSlopePct7d?: number | null;
  /** BTC — EMA(12) 1d slope % ย้อนหลัง 7 แท่ง */
  btcEma1dSlopePct7d?: number | null;
  /** (close − EMA20) / EMA20 × 100 บน 1h ของคู่สัญญาณ */
  priceVsEma20_1hPct?: number | null;
  /** EMA20 1h — slope % ย้อนหลัง 7 วัน (168 แท่ง) */
  ema20_1hSlopePct7d?: number | null;
  /** BTC — EMA20 4h slope % ย้อนหลัง 7 วัน (42 แท่ง) */
  btcEma20_4hSlopePct7d?: number | null;
  /** 2 = EMA20 slope+dist คำนวณ ณ alertedAtMs */
  ema20DistV?: number;
  /** PSAR 4h — ทิศ SAR (up/down) */
  psar4hTrend?: "up" | "down" | null;
  /** PSAR 4h — (close − SAR) / close × 100 */
  psar4hDistPct?: number | null;
  /** 1 = PSAR คำนวณ ณ alertedAtMs */
  psar4hV?: number;
  /** 2 = BTC EMA คำนวณ ณ alertedAtMs */
  btcEmaSlopesV?: number;
  /** Wilder ATR(14) บน 1d ÷ close × 100 */
  atrPct14d?: number | null;
  /** Short: ไส้บน ÷ ช่วงแท่ง (%) · Long: ไส้ล่าง */
  wickRatioPct: number | null;
  /** Short เท่านั้น — ไส้ล่าง ÷ ช่วงแท่ง (%) */
  lowerWickRatioPct?: number | null;
  bodyPct: number | null;
  /** อันดับ high ในรอบ lookbackBars (1 = สูงสุด) */
  highRankInLookback: number | null;
  /** อันดับ low ในรอบ lookbackBars (1 = ต่ำสุด) */
  lowRankInLookback: number | null;
  /** อันดับ “ความยาวแท่ง” (high-low) ในรอบ lookbackBars (1 = ยาวสุด) */
  rangeRankInLookback: number | null;
  /** Len percentile 0–100 จาก rangeRank + lookbackBars (100 = ยาวสุดในรอบ) */
  lenPercentilePct?: number | null;
  /** อันดับ volume ในรอบ lookbackBars (1 = สูงสุด) */
  volRankInLookback: number | null;
  /** Vol แท่งสัญญาณ ÷ SMA(volume) ณ แท่งปิด */
  signalVolVsSma?: number | null;
  lookbackBars: number | null;
  rangeScore: number | null;
  wickScore: number | null;
  afterInvertedDoji: boolean;
  /** Snapshot market sentiment (Market Pulse) ณ เวลาแจ้ง */
  marketSentiment?: MarketSentimentSnapshot | null;
  /** Swing low 1H — จุดเริ่มรอบปั๊ม (open time sec) */
  swingLowOpenSec?: number | null;
  /** Swing low 1H — ราคา Low */
  swingLowPrice?: number | null;
  /** ชั่วโมงจาก Swing Low ถึง anchor close */
  ageOfTrendHours?: number | null;
  /** ((entry − swingLow) / swingLow) × 100 */
  trendGainPct?: number | null;
  swingLowSource?: PumpCycleSwingLowSource | null;
  /** 1 = pump-cycle swing low คำนวณแล้ว */
  pumpCycleSwingLowV?: number;
  /** แท่ง Day1 เขียว (close>open) ติดกันก่อนแท่งสัญญาณ — ไม่นับแท่งสัญญาณ */
  greenDaysBeforeSignal?: number | null;
  /** เขียวตามวันปฏิทิน BKK (เพื่อให้ตรงกับกราฟผู้ใช้) */
  greenDaysBeforeSignalBkk?: number | null;
  /** 1H signal — checkpoint จากปิดแท่ง 15m (แบบ Snowball) */
  price4h: number | null;
  pct4h: number | null;
  price12h: number | null;
  pct12h: number | null;
  price24h: number | null;
  pct24h: number | null;
  price48h: number | null;
  pct48h: number | null;
  /** 1D signal — checkpoint จากปิดแท่ง Day */
  price1d: number | null;
  pct1d: number | null;
  price3d: number | null;
  pct3d: number | null;
  price7d: number | null;
  pct7d: number | null;
  maxRoiPct: number | null;
  /** 1 = Max ROI จากแท่ง 15m (ทิศวัดผลเดียวกับกำไรกลยุทธ์) */
  maxRoi15mV?: number;
  durationToMfeHours: number | null;
  maxDrawdownPct: number | null;
  /** Max adverse จาก entry ตลอดช่วง follow-up (ไม่ตัดที่ MFE) */
  followUpMaxAdversePct: number | null;
  /** กำไร % ตามกลยุทธ์ TP1/TP2 (จำลองบน 15m) — 48h ใน strategyProfitPct · 24h ใน strategyProfitPct24h */
  strategyProfitPct?: number | null;
  strategyExitReason?: StatsTpSlExitReason | null;
  strategyProfitPct24h?: number | null;
  strategyExitReason24h?: StatsTpSlExitReason | null;
  /** กำไรกลยุทธ์ฝั่ง Long (fade) — ตาราง Short 1H · ทิศแนะนำ 🟢 Long */
  strategyProfitPctLong?: number | null;
  strategyExitReasonLong?: StatsTpSlExitReason | null;
  strategyProfitPctLong24h?: number | null;
  strategyExitReasonLong24h?: StatsTpSlExitReason | null;
  /** cache ตามชุด TP/SL (key = tp1-tp1p-tp2-maxH) */
  strategyProfitByPlan?: StrategyProfitByPlanMap | null;
  outcome: CandleReversalOutcome;
  /** ฝั่งตรงข้ามที่เคย conflict (บันทึกตอนแจ้ง) — แสดง badge ถาวร */
  conflictWith?: string | null;
};

export type CandleReversalStatsApiPayload = {
  rows: CandleReversalStatsRow[];
  /** true เมื่อ Telegram user อยู่ใน KOJI_ADMIN_IDS */
  isAdmin?: boolean;
  /** สรุปกลยุทธ์ของผู้ดู (จาก Settings) */
  viewerTpSlPlanSummary?: string;
  /** ค่า TP/SL ของผู้ดู (สำหรับ breakdown ในเซลล์) */
  viewerTpSlPlan?: import("@/lib/tpSlStrategySimulate").StatsTpSlPlan;
  /** margin USDT จาก Settings — คำนวณ P/L เป็น $ ในตาราง */
  viewerStrategyMarginUsdt?: number | null;
  viewerStrategyLeverage?: number | null;
  /** เปิดใน Settings → Dynamic leverage (Long → SHORT) */
  viewerStrategyLongDynamicLeverageEnabled?: boolean;
  /** เปิดกฎปิด @12h ในกลยุทธ์ Reversal (default เปิด) */
  viewerReversalTp12hCloseEnabled?: boolean;
  /** ทิศที่เล่น — ตาราง Reversal Short 1H */
  viewerReversalStatsPlayShortEnabled?: boolean;
  viewerReversalStatsPlayLongEnabled?: boolean;
  /** @deprecated — ใช้ viewerReversalStatsPlayShort/LongEnabled */
  viewerReversalStatsPlaySide?: import("@/lib/reversalMatrixFilters").ReversalStatsPlaySide;
};

export function candleReversalSignalBarTfLabel(tf: CandleReversalSignalBarTf): string {
  return tf.toUpperCase();
}

export function candleReversalStatsAnchorCloseSec(
  row: Pick<CandleReversalStatsRow, "signalBarOpenSec" | "signalBarTf">,
): number {
  const dur = row.signalBarTf === "1h" ? 3600 : 24 * 3600;
  return row.signalBarOpenSec + dur;
}

/** ชื่อเต็ม (Telegram / ข้อความยาว) */
export function candleReversalModelLabel(model: CandleReversalModel): string {
  if (model === "inverted_doji") return "โดจิกลับหัว";
  if (model === "longest_red_body") return "แท่งแดงทุบยาว";
  if (model === "longest_green_body") return "แท่งเขียวทุบยาว";
  return "แท่งแดงทุบ";
}

/** ตัวย่อในตารางสถิติ — สอดคล้องสรุปสแกน reversal */
export function candleReversalModelShortLabel(model: CandleReversalModel): string {
  if (model === "inverted_doji") return "โดจิ";
  if (model === "longest_red_body") return "แดงยาว";
  if (model === "longest_green_body") return "เขียวยาว";
  return "ทุบ";
}

export function candleReversalTradeSideLabel(side: CandleReversalTradeSide): string {
  return side === "long" ? "Long" : "Short";
}

/** ทิศวัดผล follow-up — Long 1H fade SHORT ใช้ short แม้ tradeSide เป็น long */
export function reversalStatsMeasureSide(
  row: Pick<CandleReversalStatsRow, "signalBarTf" | "tradeSide">,
): CandleReversalTradeSide {
  const tf = row.signalBarTf ?? "1d";
  const signal = row.tradeSide ?? "short";
  if (tf === "1h" && signal === "long") return "short";
  return signal;
}

export function candleReversalWickRatioPctLabel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

/** Short: ไส้บน + ไส้ล่าง · Long: แสดงไส้ล่าง (wickRatioPct) เท่านั้น */
export function candleReversalWickCellsLabel(
  row: Pick<CandleReversalStatsRow, "tradeSide" | "wickRatioPct" | "lowerWickRatioPct">,
): string {
  const side = row.tradeSide ?? "short";
  if (side === "long") {
    return candleReversalWickRatioPctLabel(row.wickRatioPct);
  }
  const upper = candleReversalWickRatioPctLabel(row.wickRatioPct);
  const lower = candleReversalWickRatioPctLabel(row.lowerWickRatioPct);
  if (upper === "—" && lower === "—") return "—";
  return `บน ${upper} · ล่าง ${lower}`;
}

/** คำอธิบายตัวย่อโมเดล (header / footnote) */
export const CANDLE_REVERSAL_MODEL_SHORT_LEGEND =
  "โดจิ=โดจิกลับหัว · ทุบ=แท่งแดงทุบ · แดงยาว=แท่งแดงทุบยาว · เขียวยาว=แท่งเขียวทุบยาว";

export function candleReversalOutcomeLabel(o: CandleReversalOutcome): string {
  if (o === "pending") return "Pending";
  if (o === "win") return "Win";
  if (o === "loss") return "Loss";
  return "Flat";
}

export function candleReversalVolScoreLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export function candleReversalSignalVolVsSmaLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return "—";
  return `${v.toFixed(2)}×`;
}

/** อันดับในรอบ lookback — เช่น 2/24 */
export function candleReversalLookbackRankCell(
  rank: number | null | undefined,
  lookbackBars: number | null | undefined,
): string {
  if (rank == null || lookbackBars == null || !Number.isFinite(rank) || !Number.isFinite(lookbackBars)) {
    return "—";
  }
  return `${Math.floor(rank)}/${Math.floor(lookbackBars)}`;
}

/** อันดับ low ในรอบ lookback — เช่น 1/24 */
export function candleReversalLowLookbackRankCell(
  rank: number | null | undefined,
  lookbackBars: number | null | undefined,
): string {
  return candleReversalLookbackRankCell(rank, lookbackBars);
}

export function candleReversalDayOfWeekBkk(alertedAtIso: string, alertedAtMs?: number | null): string {
  const ms =
    alertedAtMs != null && Number.isFinite(alertedAtMs)
      ? alertedAtMs
      : Date.parse(alertedAtIso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", weekday: "short" });
}

export type CandleReversalStatsSortKey =
  | "symbol"
  | "tf"
  | "side"
  | "model"
  | "greenDays"
  | "day"
  | "time"
  | "entry"
  | "swingLowTime"
  | "swingLowPrice"
  | "ageOfTrend"
  | "trendGain"
  | "trendVelocity"
  | "swingLowSource"
  | "vol24"
  | "mcap"
  | "ema1h"
  | "ema20_1hDist"
  | "ema4h"
  | "ema1d"
  | "btcEma4h"
  | "btcEma1d"
  | "psar4h"
  | "psar4hDist"
  | "atr14d"
  | "retest"
  | "sl"
  | "wickPct"
  | "lowerWickPct"
  | "bodyPct"
  | "rangeRank"
  | "lenPct"
  | "volRank"
  | "volVsSma"
  | "highRank"
  | "lowRank"
  | "range"
  | "wick"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "roi"
  | "dd"
  | "followUpAdverse"
  | "outcome";

export type CandleReversalStatsSortDir = "asc" | "desc";

export type CandleReversalStatsSort = {
  key: CandleReversalStatsSortKey;
  dir: CandleReversalStatsSortDir;
};

export const CANDLE_REVERSAL_STATS_DEFAULT_SORT: CandleReversalStatsSort = {
  key: "time",
  dir: "desc",
};

const MODEL_SORT_ORDER: Record<CandleReversalModel, number> = {
  inverted_doji: 0,
  marubozu: 1,
  longest_red_body: 2,
  longest_green_body: 3,
};

const OUTCOME_SORT_ORDER: Record<CandleReversalOutcome, number> = {
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

function reversalHorizonPct(row: CandleReversalStatsRow, idx: 0 | 1 | 2 | 3): number | null {
  const tf = row.signalBarTf ?? "1d";
  if (tf === "1h") {
    if (idx === 0) return row.pct4h;
    if (idx === 1) return row.pct12h;
    if (idx === 2) return row.pct24h;
    return row.pct48h;
  }
  return idx === 0 ? row.pct1d : idx === 1 ? row.pct3d : row.pct7d;
}

function compareCandleReversalStatsRows(
  a: CandleReversalStatsRow,
  b: CandleReversalStatsRow,
  key: CandleReversalStatsSortKey,
): number {
  switch (key) {
    case "symbol":
      return cmpStr(a.symbol, b.symbol);
    case "tf":
      return cmpStr(a.signalBarTf ?? "1d", b.signalBarTf ?? "1d");
    case "side":
      return cmpStr(a.tradeSide ?? "short", b.tradeSide ?? "short");
    case "model":
      return (
        (MODEL_SORT_ORDER[a.model] ?? 99) - (MODEL_SORT_ORDER[b.model] ?? 99) ||
        cmpStr(a.model, b.model)
      );
    case "greenDays":
      return cmpNumNullLast(a.greenDaysBeforeSignal, b.greenDaysBeforeSignal);
    case "day": {
      const da = candleReversalDayOfWeekBkk(a.alertedAtIso, a.alertedAtMs);
      const db = candleReversalDayOfWeekBkk(b.alertedAtIso, b.alertedAtMs);
      return cmpStr(da, db) || cmpNumNullLast(a.alertedAtMs, b.alertedAtMs);
    }
    case "time":
      return cmpNumNullLast(a.alertedAtMs, b.alertedAtMs);
    case "entry":
      return cmpNumNullLast(a.entryPrice, b.entryPrice);
    case "swingLowTime":
      return cmpNumNullLast(a.swingLowOpenSec, b.swingLowOpenSec);
    case "swingLowPrice":
      return cmpNumNullLast(a.swingLowPrice, b.swingLowPrice);
    case "ageOfTrend":
      return cmpNumNullLast(a.ageOfTrendHours, b.ageOfTrendHours);
    case "trendGain":
      return cmpNumNullLast(a.trendGainPct, b.trendGainPct);
    case "trendVelocity":
      return cmpNumNullLast(
        computePumpCycleTrendVelocity(a.trendGainPct, a.ageOfTrendHours),
        computePumpCycleTrendVelocity(b.trendGainPct, b.ageOfTrendHours),
      );
    case "swingLowSource":
      return cmpStr(a.swingLowSource ?? "", b.swingLowSource ?? "");
    case "vol24":
      return cmpNumNullLast(a.quoteVol24hUsdt, b.quoteVol24hUsdt);
    case "mcap":
      return cmpNumNullLast(a.marketCapUsd, b.marketCapUsd);
    case "ema1h":
      return cmpNumNullLast(a.ema20_1hSlopePct7d, b.ema20_1hSlopePct7d);
    case "ema20_1hDist":
      return cmpNumNullLast(a.priceVsEma20_1hPct, b.priceVsEma20_1hPct);
    case "ema4h":
      return cmpNumNullLast(a.ema4hSlopePct7d, b.ema4hSlopePct7d);
    case "ema1d":
      return cmpNumNullLast(a.ema1dSlopePct7d, b.ema1dSlopePct7d);
    case "btcEma4h":
      return cmpNumNullLast(a.btcEma20_4hSlopePct7d, b.btcEma20_4hSlopePct7d);
    case "btcEma1d":
      return cmpNumNullLast(a.btcEma1dSlopePct7d, b.btcEma1dSlopePct7d);
    case "psar4h": {
      const order = (t: CandleReversalStatsRow["psar4hTrend"]) =>
        t === "up" ? 0 : t === "down" ? 1 : 2;
      return order(a.psar4hTrend) - order(b.psar4hTrend);
    }
    case "psar4hDist":
      return cmpNumNullLast(a.psar4hDistPct, b.psar4hDistPct);
    case "atr14d":
      return cmpNumNullLast(a.atrPct14d, b.atrPct14d);
    case "retest":
      return cmpNumNullLast(a.retestPrice, b.retestPrice);
    case "sl":
      return cmpNumNullLast(a.slPrice, b.slPrice);
    case "wickPct":
      return cmpNumNullLast(a.wickRatioPct, b.wickRatioPct);
    case "lowerWickPct":
      return cmpNumNullLast(a.lowerWickRatioPct, b.lowerWickRatioPct);
    case "bodyPct":
      return cmpNumNullLast(a.bodyPct, b.bodyPct);
    case "rangeRank":
      return cmpNumNullLast(a.rangeRankInLookback, b.rangeRankInLookback);
    case "lenPct":
      return cmpNumNullLast(a.lenPercentilePct, b.lenPercentilePct);
    case "volRank":
      return cmpNumNullLast(a.volRankInLookback, b.volRankInLookback);
    case "volVsSma":
      return cmpNumNullLast(a.signalVolVsSma, b.signalVolVsSma);
    case "highRank":
      return cmpNumNullLast(a.highRankInLookback, b.highRankInLookback);
    case "lowRank":
      return cmpNumNullLast(a.lowRankInLookback, b.lowRankInLookback);
    case "range":
      return cmpNumNullLast(a.rangeScore, b.rangeScore);
    case "wick":
      return cmpNumNullLast(a.wickScore, b.wickScore);
    case "h1":
      return cmpNumNullLast(reversalHorizonPct(a, 0), reversalHorizonPct(b, 0));
    case "h2":
      return cmpNumNullLast(reversalHorizonPct(a, 1), reversalHorizonPct(b, 1));
    case "h3":
      return cmpNumNullLast(reversalHorizonPct(a, 2), reversalHorizonPct(b, 2));
    case "h4":
      return cmpNumNullLast(reversalHorizonPct(a, 3), reversalHorizonPct(b, 3));
    case "roi":
      return cmpNumNullLast(a.maxRoiPct, b.maxRoiPct);
    case "dd":
      return cmpNumNullLast(a.maxDrawdownPct, b.maxDrawdownPct);
    case "followUpAdverse":
      return cmpNumNullLast(a.followUpMaxAdversePct, b.followUpMaxAdversePct);
    case "outcome": {
      const oa = OUTCOME_SORT_ORDER[a.outcome] ?? 99;
      const ob = OUTCOME_SORT_ORDER[b.outcome] ?? 99;
      return oa - ob || cmpStr(candleReversalOutcomeLabel(a.outcome), candleReversalOutcomeLabel(b.outcome));
    }
    default:
      return 0;
  }
}

export function sortCandleReversalStatsRows(
  rows: CandleReversalStatsRow[],
  sort: CandleReversalStatsSort,
): CandleReversalStatsRow[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const c = compareCandleReversalStatsRows(a, b, sort.key);
    return c * mul;
  });
}

export function candleReversalGreenDaysLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v < 0) return "—";
  return `${Math.floor(v)} วัน`;
}

export function candleReversalEma1hSlopeLabel(pct: CandleReversalStatsRow["ema20_1hSlopePct7d"]): string {
  return statsEmaSlopePctLabel(pct);
}

export function candleReversalPriceVsEma20_1hLabel(
  pct: CandleReversalStatsRow["priceVsEma20_1hPct"],
): string {
  return statsEmaSlopePctLabel(pct);
}

export function candleReversalEma4hSlopeLabel(pct: CandleReversalStatsRow["ema4hSlopePct7d"]): string {
  return statsEmaSlopePctLabel(pct);
}

export function candleReversalEma1dSlopeLabel(pct: CandleReversalStatsRow["ema1dSlopePct7d"]): string {
  return statsEmaSlopePctLabel(pct);
}

export function candleReversalEmaSlopeCsvLabel(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  return pct.toFixed(4);
}

export function candleReversalStatsSortDefaultDir(key: CandleReversalStatsSortKey): CandleReversalStatsSortDir {
  if (key === "symbol" || key === "tf" || key === "side" || key === "model" || key === "day" || key === "outcome" || key === "swingLowSource") {
    return "asc";
  }
  return "desc";
}

/** เกณฑ์ default — ใช้ฝั่ง client คำนวณ per-horizon winrate (sync กับ CANDLE_REVERSAL_STATS_WIN_MIN_PCT / LOSS_MAX_PCT) */
/**
 * เกณฑ์ default สำหรับ horizon winrate (UI summary) — ต้องตรงกับ server-side outcome rule
 * Win = pct >= +2% · Loss = pct <= -2% · ที่เหลือเป็น flat
 * Server-side override: `CANDLE_REVERSAL_STATS_WIN_MIN_PCT` / `CANDLE_REVERSAL_STATS_LOSS_MAX_PCT`
 */
export const CANDLE_REVERSAL_STATS_WIN_MIN_PCT_DEFAULT = 2;
export const CANDLE_REVERSAL_STATS_LOSS_MAX_PCT_DEFAULT = -2;

export type CandleReversalHorizonWinrate = {
  /** จำนวน row ที่มีค่า pct ครบ — wins + losses + flats */
  done: number;
  /** จำนวน row ที่ pct >= WIN_MIN_PCT — ตาม measure side (Long 1H = fade SHORT) */
  wins: number;
  /** จำนวน row ที่ pct <= LOSS_MAX_PCT */
  losses: number;
  /** done - wins - losses */
  flats: number;
  /** wins + losses — decisive trades (ไม่นับ flat band ±2%) */
  decisive: number;
  /** wins / decisive × 100 — null ถ้า decisive = 0 (ไม่นับ flat) */
  winratePct: number | null;
};

function pctToOutcomeWithDefaults(pct: number | null | undefined): "win" | "loss" | "flat" | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= CANDLE_REVERSAL_STATS_WIN_MIN_PCT_DEFAULT) return "win";
  if (pct <= CANDLE_REVERSAL_STATS_LOSS_MAX_PCT_DEFAULT) return "loss";
  return "flat";
}

/** คำนวณ winrate จาก pct horizon (12h / 24h / 48h ฯลฯ) — ใช้เกณฑ์ default */
export function candleReversalHorizonWinrate(
  rows: CandleReversalStatsRow[],
  pctKey: keyof Pick<CandleReversalStatsRow, "pct4h" | "pct12h" | "pct24h" | "pct48h" | "pct1d" | "pct3d" | "pct7d">,
): CandleReversalHorizonWinrate {
  let wins = 0;
  let losses = 0;
  let done = 0;
  for (const r of rows) {
    const o = pctToOutcomeWithDefaults(r[pctKey]);
    if (o == null) continue;
    done += 1;
    if (o === "win") wins += 1;
    else if (o === "loss") losses += 1;
  }
  const flats = done - wins - losses;
  const decisive = wins + losses;
  const winratePct = decisive > 0 ? (wins / decisive) * 100 : null;
  return { done, wins, losses, flats, decisive, winratePct };
}

/**
 * สรุป winrate ราย horizon เป็นข้อความสั้น "WR 12h 50.0% (5/10) · 24h … · 48h …"
 * ตัวเลขในวงเล็บคือ wins/decisive (ไม่นับ flat) — ถ้ามี flat ในรายการนั้นจะต่อท้ายด้วย "+Nf"
 */
export function candleReversalHorizonWinrateSummary(
  rows: CandleReversalStatsRow[],
  horizons: ReadonlyArray<{
    label: string;
    pctKey: keyof Pick<CandleReversalStatsRow, "pct4h" | "pct12h" | "pct24h" | "pct48h" | "pct1d" | "pct3d" | "pct7d">;
  }>,
): string {
  const parts = horizons.map((h) => {
    const w = candleReversalHorizonWinrate(rows, h.pctKey);
    if (w.decisive === 0) {
      if (w.flats > 0) return `${h.label}: — (0/0 +${w.flats}f)`;
      return `${h.label}: —`;
    }
    const flatTag = w.flats > 0 ? ` +${w.flats}f` : "";
    return `${h.label}: ${w.winratePct!.toFixed(1)}% (${w.wins}/${w.decisive}${flatTag})`;
  });
  return parts.join(" · ");
}
