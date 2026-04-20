import axios from "axios";
import { resolveContractSymbol } from "./coinMap";
import { fetchMarketPulseData, MarketPulseFetchError } from "./marketPulseFetch";
import { computeEmaLast } from "./emaUtils";
import { rsiWilder } from "./indicatorMath";
import {
  fetchContractTickerSingle,
  fetchMaxOrderContractsForSymbol,
  fetchPerp15mClosesForChecklist,
  fetchPerp1hClosesForChecklist,
  fetchPerp4hClosesForChecklist,
  fetchPerp1dClosesForChecklist,
  fetchPerpHourlyClosesForNearHigh,
  fetchSpot24hrQuoteVolumeUsdt,
  fetchSpotPriceSingle,
  perpSymbolToSpotSymbol,
} from "./mexcMarkets";
import type { ParsedMarketCheck, ParsedPositionChecklist, PositionDirection } from "./positionChecklistLineCommands";

function envNum(name: string, def: number): number {
  const v = process.env[name]?.trim();
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function isBangkokWeekend(now: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
  }).format(now);
  return wd === "Sat" || wd === "Sun";
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

async function fetchCoinGeckoMarketCapUsd(baseSymbol: string): Promise<number | null> {
  const sym = baseSymbol.trim().toUpperCase();
  if (!sym) return null;
  try {
    const { data } = await axios.get<Array<{ market_cap?: number | null }>>(
      "https://api.coingecko.com/api/v3/coins/markets",
      {
        params: { vs_currency: "usd", symbols: sym },
        timeout: 12_000,
      }
    );
    if (!Array.isArray(data) || data.length === 0) return null;
    let best: number | null = null;
    for (const row of data) {
      const mc = row.market_cap;
      if (typeof mc === "number" && Number.isFinite(mc) && mc > 0) {
        if (best == null || mc > best) best = mc;
      }
    }
    return best;
  } catch {
    return null;
  }
}

function nearHighFromMaxClose(lastPrice: number, maxClose: number, nearPct: number): boolean {
  if (maxClose <= 0 || lastPrice <= 0) return false;
  const distPct = ((maxClose - lastPrice) / maxClose) * 100;
  return distPct <= nearPct;
}

function fundingPct(rate: number): number {
  return rate * 100;
}

function fundingIntensityLabel(pct: number): string {
  const a = Math.abs(pct);
  if (a >= 0.75) return pct < 0 ? "(High Negative!) ⚠️" : "(High Positive!) ⚠️";
  if (a >= 0.25) return pct < 0 ? "(Elevated negative)" : "(Elevated positive)";
  return "";
}

function classifyFngShort(fng: number, maxForShort: number): { emoji: string; label: string } {
  if (fng <= maxForShort) return { emoji: "✅", label: `Pass (F&G ${fng} — OK for short)` };
  if (fng <= 55) return { emoji: "⚠️", label: `Neutral / tilt (${fng})` };
  return { emoji: "⚠️", label: `Greed zone (${fng}) — against short` };
}

function classifyFngLong(fng: number, minForLong: number): { emoji: string; label: string } {
  if (fng >= minForLong) return { emoji: "✅", label: `Pass (F&G ${fng} — OK for long)` };
  if (fng >= 45) return { emoji: "⚠️", label: `Neutral (${fng})` };
  return { emoji: "⚠️", label: `Fear-heavy (${fng}) — weak for long` };
}

/**
 * Mcap / max position notional (USDT) — ยิ่ง ratio สูง ยิ่งเสี่ยง (สภาพคล่องเทียบขนาดเหรียญต่ำ)
 * สอดคล้อง checkLiquidityHealth: SAFE ≤ watch · WATCH (watch, high] · HIGH (high, extreme] · TERMINATE > extreme
 */
type LiqCapTier = "safe" | "watch" | "high" | "extreme";

function classifyLiquidityCapRatio(
  mcapUsd: number | null,
  maxNotionalUsd: number | null,
  thWatch: number,
  thHigh: number,
  thExtreme: number
): { tier: LiqCapTier; ratio: number | null } {
  if (
    mcapUsd == null ||
    !Number.isFinite(mcapUsd) ||
    mcapUsd <= 0 ||
    maxNotionalUsd == null ||
    !Number.isFinite(maxNotionalUsd) ||
    maxNotionalUsd <= 0
  ) {
    return { tier: "safe", ratio: null };
  }
  const ratio = mcapUsd / maxNotionalUsd;
  if (ratio > thExtreme) return { tier: "extreme", ratio };
  if (ratio > thHigh) return { tier: "high", ratio };
  if (ratio > thWatch) return { tier: "watch", ratio };
  return { tier: "safe", ratio };
}

/**
 * Spot/Perp volume ratio (Fut÷Spot) — ใช้เฉพาะข้อมูล **MEXC** คู่เดียวกับสัญญา checklist
 *
 * - **ตัวเศษ (Fut):** `ticker.amount24` จาก perp (USDT notional 24h)
 * - **ตัวส่วน (Spot):** `quoteVolume` จาก spot 24h ticker ของ `perpSymbolToSpotSymbol`
 * - **R = Fut ÷ Spot**
 *
 * **กลุ่มพิเศษ (ปรับขอบเขตด้วย env POSITION_CHECK_SPOT_FUT_VOL_*_SAFE_MAX / *_CAUTION_MAX):**
 * - **Blue-chip (BTC, ETH):** Tier1 R≤SAFE_MAX (ดีฟอลต์ 150) · Tier2 R ช่วงถัดไปจนถึง CAUTION_MAX (151–300) · Tier3 R>CAUTION_MAX
 * - **Major alt (ZEC, SOL, ADA, NEAR):** Tier1 R≤80 · Tier2 81–150 · Tier3 R>150
 *
 * **เหรียญอื่น — เกณฑ์เดิม (env POSITION_CHECK_SPOT_FUT_VOL_T*_MIN):**
 * Tier1 R<T2_MIN · Tier2 T2_MIN≤R<T3_MIN · Tier3 T3_MIN≤R<T4_MIN · Tier4 R≥T4_MIN
 */
type SpotFutVolTier = 1 | 2 | 3 | 4 | "unknown";

type SpotFutVolBand = "default" | "blue_chip" | "major_alt";

const SPOT_FUT_VOL_BLUE_CHIP_BASES = new Set(["BTC", "ETH"]);
const SPOT_FUT_VOL_MAJOR_ALT_BASES = new Set(["ZEC", "SOL", "ADA", "NEAR"]);

function classifySpotFutVolRatio(
  futAmount24Usdt: number | null,
  spotQuoteVol24Usdt: number | null,
  t2Min: number,
  t3Min: number,
  t4Min: number
): { tier: SpotFutVolTier; ratio: number | null } {
  if (
    futAmount24Usdt == null ||
    !Number.isFinite(futAmount24Usdt) ||
    futAmount24Usdt <= 0 ||
    spotQuoteVol24Usdt == null ||
    !Number.isFinite(spotQuoteVol24Usdt) ||
    spotQuoteVol24Usdt <= 0
  ) {
    return { tier: "unknown", ratio: null };
  }
  const R = futAmount24Usdt / spotQuoteVol24Usdt;
  if (!Number.isFinite(R) || R <= 0) return { tier: "unknown", ratio: null };
  if (R >= t4Min) return { tier: 4, ratio: R };
  if (R >= t3Min) return { tier: 3, ratio: R };
  if (R >= t2Min) return { tier: 2, ratio: R };
  return { tier: 1, ratio: R };
}

type SpotFutVolClass = {
  tier: SpotFutVolTier;
  ratio: number | null;
  band: SpotFutVolBand;
  /** ใช้โชว์ข้อความ — blue_chip / major_alt เท่านั้น */
  safeMax: number | null;
  cautionMax: number | null;
};

function classifySpotFutVolRatioForBase(
  base: string,
  futAmount24Usdt: number | null,
  spotQuoteVol24Usdt: number | null,
  defaultT2Min: number,
  defaultT3Min: number,
  defaultT4Min: number,
  blueSafeMax: number,
  blueCautionMax: number,
  majorSafeMax: number,
  majorCautionMax: number
): SpotFutVolClass {
  if (
    futAmount24Usdt == null ||
    !Number.isFinite(futAmount24Usdt) ||
    futAmount24Usdt <= 0 ||
    spotQuoteVol24Usdt == null ||
    !Number.isFinite(spotQuoteVol24Usdt) ||
    spotQuoteVol24Usdt <= 0
  ) {
    return { tier: "unknown", ratio: null, band: "default", safeMax: null, cautionMax: null };
  }
  const R = futAmount24Usdt / spotQuoteVol24Usdt;
  if (!Number.isFinite(R) || R <= 0) {
    return { tier: "unknown", ratio: null, band: "default", safeMax: null, cautionMax: null };
  }

  const b = base.trim().toUpperCase();
  const blueLo = Math.min(blueSafeMax, blueCautionMax);
  const blueHi = Math.max(blueSafeMax, blueCautionMax);
  const majLo = Math.min(majorSafeMax, majorCautionMax);
  const majHi = Math.max(majorSafeMax, majorCautionMax);

  if (SPOT_FUT_VOL_BLUE_CHIP_BASES.has(b)) {
    if (R > blueHi) return { tier: 3, ratio: R, band: "blue_chip", safeMax: blueLo, cautionMax: blueHi };
    if (R > blueLo) return { tier: 2, ratio: R, band: "blue_chip", safeMax: blueLo, cautionMax: blueHi };
    return { tier: 1, ratio: R, band: "blue_chip", safeMax: blueLo, cautionMax: blueHi };
  }
  if (SPOT_FUT_VOL_MAJOR_ALT_BASES.has(b)) {
    if (R > majHi) return { tier: 3, ratio: R, band: "major_alt", safeMax: majLo, cautionMax: majHi };
    if (R > majLo) return { tier: 2, ratio: R, band: "major_alt", safeMax: majLo, cautionMax: majHi };
    return { tier: 1, ratio: R, band: "major_alt", safeMax: majLo, cautionMax: majHi };
  }

  const d = classifySpotFutVolRatio(
    futAmount24Usdt,
    spotQuoteVol24Usdt,
    defaultT2Min,
    defaultT3Min,
    defaultT4Min
  );
  return { ...d, band: "default", safeMax: null, cautionMax: null };
}

type ChecklistMarketCore = {
  contractSymbol: string;
  base: string;
  futPx: number;
  amount24: number | null;
  spotQuoteVol24: number | null;
  spotPx: number | null;
  spotSym: string;
  mcapUsd: number | null;
  maxOrderContracts: number | null;
  closes15m: number[] | null;
  ema6: number | null;
  ema12: number | null;
  ema6_1h: number | null;
  ema12_1h: number | null;
  ema6_4h: number | null;
  ema12_4h: number | null;
  ema6_1d: number | null;
  ema12_1d: number | null;
  funding: number;
  basisPct: number | null;
  maxNotionalUsd: number | null;
  liqCapClass: ReturnType<typeof classifyLiquidityCapRatio>;
  spotFutVolClass: ReturnType<typeof classifySpotFutVolRatioForBase>;
  klineHigh: Awaited<ReturnType<typeof fetchPerpHourlyClosesForNearHigh>>;
  weekend: boolean;
  pulseResult: Awaited<ReturnType<typeof fetchMarketPulseData>> | { error: unknown };
};

async function loadChecklistMarketCore(
  contractSymbol: string,
  base: string
): Promise<{ ok: false; message: string } | { ok: true; core: ChecklistMarketCore }> {
  const liqCapThWatch = envNum("POSITION_CHECK_LIQ_CAP_RATIO_WATCH", 50_000);
  const liqCapThHigh = envNum("POSITION_CHECK_LIQ_CAP_RATIO_HIGH", 150_000);
  const liqCapThExtreme = envNum("POSITION_CHECK_LIQ_CAP_RATIO_EXTREME", 500_000);
  const spotFutT2Min = envNum("POSITION_CHECK_SPOT_FUT_VOL_T2_MIN", 11);
  const spotFutT3Min = envNum("POSITION_CHECK_SPOT_FUT_VOL_T3_MIN", 41);
  const spotFutT4Min = envNum("POSITION_CHECK_SPOT_FUT_VOL_T4_MIN", 81);
  const spotFutBlueSafeMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_BLUE_SAFE_MAX", 150);
  const spotFutBlueCautionMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_BLUE_CAUTION_MAX", 300);
  const spotFutMajorSafeMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_MAJOR_SAFE_MAX", 80);
  const spotFutMajorCautionMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_MAJOR_CAUTION_MAX", 150);

  const [ticker, klineHigh, mcapUsd, pulseResult, maxOrderContracts, closes15m, closes1h, closes4h, closes1d] =
    await Promise.all([
      fetchContractTickerSingle(contractSymbol),
      fetchPerpHourlyClosesForNearHigh(contractSymbol),
      fetchCoinGeckoMarketCapUsd(base),
      fetchMarketPulseData().catch((e: unknown) => ({ error: e })),
      fetchMaxOrderContractsForSymbol(contractSymbol),
      fetchPerp15mClosesForChecklist(contractSymbol),
      fetchPerp1hClosesForChecklist(contractSymbol),
      fetchPerp4hClosesForChecklist(contractSymbol),
      fetchPerp1dClosesForChecklist(contractSymbol),
    ]);

  if (!ticker?.lastPrice || typeof ticker.lastPrice !== "number" || ticker.lastPrice <= 0) {
    return { ok: false, message: `ดึงข้อมูลสัญญา ${contractSymbol} ไม่สำเร็จ — ลองใหม่ภายหลัง` };
  }

  const spotSym = perpSymbolToSpotSymbol(contractSymbol);
  const [spotPx, spotQuoteVol24] = await Promise.all([
    fetchSpotPriceSingle(spotSym),
    fetchSpot24hrQuoteVolumeUsdt(spotSym),
  ]);
  const futPx = ticker.lastPrice;
  let basisPct: number | null = null;
  if (spotPx != null && spotPx > 0) {
    basisPct = ((futPx - spotPx) / spotPx) * 100;
  }

  const amount24 =
    typeof ticker.amount24 === "number" && !Number.isNaN(ticker.amount24) ? ticker.amount24 : null;
  const funding = typeof ticker.fundingRate === "number" && !Number.isNaN(ticker.fundingRate) ? ticker.fundingRate : 0;

  const maxNotionalUsd =
    maxOrderContracts != null && maxOrderContracts > 0 ? maxOrderContracts * futPx : null;
  const liqCapClass = classifyLiquidityCapRatio(
    mcapUsd,
    maxNotionalUsd,
    liqCapThWatch,
    liqCapThHigh,
    liqCapThExtreme,
  );

  const spotFutVolClass = classifySpotFutVolRatioForBase(
    base,
    amount24,
    spotQuoteVol24,
    spotFutT2Min,
    spotFutT3Min,
    spotFutT4Min,
    spotFutBlueSafeMax,
    spotFutBlueCautionMax,
    spotFutMajorSafeMax,
    spotFutMajorCautionMax,
  );

  const ema6 = closes15m ? computeEmaLast(closes15m, 6) : null;
  const ema12 = closes15m ? computeEmaLast(closes15m, 12) : null;
  const ema6_1h = closes1h ? computeEmaLast(closes1h, 6) : null;
  const ema12_1h = closes1h ? computeEmaLast(closes1h, 12) : null;
  const ema6_4h = closes4h ? computeEmaLast(closes4h, 6) : null;
  const ema12_4h = closes4h ? computeEmaLast(closes4h, 12) : null;
  const ema6_1d = closes1d ? computeEmaLast(closes1d, 6) : null;
  const ema12_1d = closes1d ? computeEmaLast(closes1d, 12) : null;

  return {
    ok: true,
    core: {
      contractSymbol,
      base,
      futPx,
      amount24,
      spotQuoteVol24,
      spotPx,
      spotSym,
      mcapUsd,
      maxOrderContracts,
      closes15m,
      ema6,
      ema12,
      ema6_1h,
      ema12_1h,
      ema6_4h,
      ema12_4h,
      ema6_1d,
      ema12_1d,
      funding,
      basisPct,
      maxNotionalUsd,
      liqCapClass,
      spotFutVolClass,
      klineHigh,
      weekend: isBangkokWeekend(new Date()),
      pulseResult,
    },
  };
}

export async function buildPositionChecklistMessage(
  parsed: ParsedPositionChecklist
): Promise<string> {
  const resolved = resolveContractSymbol(parsed.rawSymbol);
  if (!resolved) {
    return "ไม่รู้จักคู่นี้ — ลองเช่น btc, eth หรือ BTC_USDT";
  }

  const contractSymbol = resolved.contractSymbol;
  const base = resolved.label;
  const dir = parsed.direction;
  const lev = parsed.leverage;

  const fngMaxShort = envNum("POSITION_CHECK_FNG_MAX_FOR_SHORT", 45);
  const nearHighPct = envNum("POSITION_CHECK_NEAR_HIGH_PCT", 0.15);
  const minVolAdvisory = envNum("POSITION_CHECK_MIN_VOL_USDT", 10_000_000);
  const minMcapAdvisory = envNum("POSITION_CHECK_MIN_MARKET_CAP_USD", 50_000_000);

  const scoreLiqVol = envNum("KOJI_SCORE_LIQ_MIN_VOL_USDT", 1_000_000);
  const scoreLiqMcap = envNum("KOJI_SCORE_LIQ_MIN_MCAP_USD", 10_000_000);
  const sentGreedTh = envNum("KOJI_SCORE_SENT_GREED_THRESHOLD", 50);
  const basisAbsPct = envNum("KOJI_SCORE_BASIS_ABS_PCT", 1);
  const maxLevCfg = envNum("KOJI_SCORE_MAX_LEVERAGE", 3);
  const emaPricePen = envNum("POSITION_CHECK_EMA_PRICE_PENALTY", 15);
  const emaAlignPen = envNum("POSITION_CHECK_EMA_ALIGN_PENALTY", 10);
  const liqCapThWatch = envNum("POSITION_CHECK_LIQ_CAP_RATIO_WATCH", 50_000);
  const liqCapThHigh = envNum("POSITION_CHECK_LIQ_CAP_RATIO_HIGH", 150_000);
  const liqCapThExtreme = envNum("POSITION_CHECK_LIQ_CAP_RATIO_EXTREME", 500_000);
  const liqCapPenWatch = envNum("POSITION_CHECK_LIQ_CAP_PENALTY_WATCH", 10);
  const liqCapPenHigh = envNum("POSITION_CHECK_LIQ_CAP_PENALTY_HIGH", 20);
  const liqCapPenExtreme = envNum("POSITION_CHECK_LIQ_CAP_PENALTY_EXTREME", 30);

  const spotFutT2Min = envNum("POSITION_CHECK_SPOT_FUT_VOL_T2_MIN", 11);
  const spotFutT3Min = envNum("POSITION_CHECK_SPOT_FUT_VOL_T3_MIN", 41);
  const spotFutT4Min = envNum("POSITION_CHECK_SPOT_FUT_VOL_T4_MIN", 81);
  const spotFutBlueSafeMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_BLUE_SAFE_MAX", 150);
  const spotFutBlueCautionMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_BLUE_CAUTION_MAX", 300);
  const spotFutMajorSafeMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_MAJOR_SAFE_MAX", 80);
  const spotFutMajorCautionMax = envNum("POSITION_CHECK_SPOT_FUT_VOL_MAJOR_CAUTION_MAX", 150);
  const spotFutPenT2 = envNum("POSITION_CHECK_SPOT_FUT_VOL_PENALTY_T2", 8);
  const spotFutPenT3 = envNum("POSITION_CHECK_SPOT_FUT_VOL_PENALTY_T3", 18);
  const spotFutPenT4 = envNum("POSITION_CHECK_SPOT_FUT_VOL_PENALTY_T4", 35);

  const loaded = await loadChecklistMarketCore(contractSymbol, base);
  if (!loaded.ok) return loaded.message;
  const {
    futPx,
    amount24,
    spotQuoteVol24,
    spotPx,
    spotSym,
    mcapUsd,
    maxOrderContracts,
    closes15m,
    ema6,
    ema12,
    funding,
    basisPct,
    maxNotionalUsd,
    liqCapClass,
    spotFutVolClass,
    klineHigh,
    weekend,
    pulseResult,
  } = loaded.core;

  let nearHigh = false;
  if (klineHigh && klineHigh.maxClose > 0) {
    nearHigh = nearHighFromMaxClose(futPx, klineHigh.maxClose, nearHighPct);
  }

  let fngVal: number | null = null;
  let fngCls: string | null = null;
  if (pulseResult && !("error" in pulseResult)) {
    fngVal = pulseResult.fng.value;
    fngCls = pulseResult.fng.valueClassification;
  }

  type Pen = {
    key: string;
    points: number;
    deductionLine: string;
  };
  const penalties: Pen[] = [];

  if (weekend && dir === "short") {
    penalties.push({
      key: "weekend",
      points: 20,
      deductionLine: `❌ Weekend short (BKK): −20`,
    });
  }

  if (nearHigh && (lev == null || lev > maxLevCfg)) {
    penalties.push({
      key: "newHigh",
      points: 25,
      deductionLine: `❌ Near 48h high (ATH window) + lev >${maxLevCfg}x (or unset): −25`,
    });
  }

  const liqBadVol = amount24 == null || amount24 < scoreLiqVol;
  const liqBadCap = mcapUsd != null && mcapUsd < scoreLiqMcap;
  if (liqBadVol || liqBadCap) {
    penalties.push({
      key: "liquidity",
      points: 25,
      deductionLine: `❌ Low Vol/Cap (score threshold): −25`,
    });
  }

  if (fngVal != null) {
    if (dir === "short" && fngVal > sentGreedTh) {
      penalties.push({
        key: "sentiment",
        points: 15,
        deductionLine: `❌ F&G ${fngVal} (Shorting against trend): −15`,
      });
    }
    if (dir === "long" && fngVal < sentGreedTh) {
      penalties.push({
        key: "sentiment",
        points: 15,
        deductionLine: `❌ F&G ${fngVal} (Long vs weak sentiment): −15`,
      });
    }
  }

  if (basisPct != null && Math.abs(basisPct) > basisAbsPct) {
    penalties.push({
      key: "basis",
      points: 15,
      deductionLine: `❌ |Spot−Perp| gap > ${basisAbsPct}%: −15`,
    });
  }

  if (liqCapClass.tier === "extreme" && liqCapClass.ratio != null) {
    const rStr = Math.round(liqCapClass.ratio).toLocaleString("en-US");
    penalties.push({
      key: "liqCapRatio",
      points: liqCapPenExtreme,
      deductionLine: `❌ Liquidity–Cap ${rStr}:1 (TERMINATE / Fake Market Cap · RAVE trap): −${liqCapPenExtreme}`,
    });
  } else if (liqCapClass.tier === "high" && liqCapClass.ratio != null) {
    const rStr = Math.round(liqCapClass.ratio).toLocaleString("en-US");
    penalties.push({
      key: "liqCapRatio",
      points: liqCapPenHigh,
      deductionLine: `❌ Liquidity–Cap ${rStr}:1 (HIGH_RISK / Low real liquidity): −${liqCapPenHigh}`,
    });
  } else if (liqCapClass.tier === "watch" && liqCapClass.ratio != null) {
    const rStr = Math.round(liqCapClass.ratio).toLocaleString("en-US");
    penalties.push({
      key: "liqCapRatio",
      points: liqCapPenWatch,
      deductionLine: `❌ Liquidity–Cap ${rStr}:1 (WATCH / Medium risk liquidity gap): −${liqCapPenWatch}`,
    });
  }

  if (spotFutVolClass.tier === 4 && spotFutVolClass.ratio != null) {
    const rDisp = spotFutVolClass.ratio >= 100 ? spotFutVolClass.ratio.toFixed(0) : spotFutVolClass.ratio.toFixed(1);
    penalties.push({
      key: "spotFutVolRatio",
      points: spotFutPenT4,
      deductionLine: `❌ Spot/Perp vol R=${rDisp} (Tier 4 Casino/RAVE · TERMINATE): −${spotFutPenT4}`,
    });
  } else if (spotFutVolClass.tier === 3 && spotFutVolClass.ratio != null) {
    const rDisp = spotFutVolClass.ratio >= 100 ? spotFutVolClass.ratio.toFixed(0) : spotFutVolClass.ratio.toFixed(1);
    const spotFutVolTag =
      spotFutVolClass.band === "blue_chip"
        ? "Blue-chip Tier 3 (Risk · Fut÷Spot สูง)"
        : spotFutVolClass.band === "major_alt"
          ? "Major alt Tier 3 (Risk · Fut÷Spot สูง)"
          : "Tier 3 Manipulation / High squeeze risk";
    penalties.push({
      key: "spotFutVolRatio",
      points: spotFutPenT3,
      deductionLine: `❌ Spot/Perp vol R=${rDisp} (${spotFutVolTag}): −${spotFutPenT3}`,
    });
  } else if (spotFutVolClass.tier === 2 && spotFutVolClass.ratio != null) {
    const rDisp = spotFutVolClass.ratio >= 100 ? spotFutVolClass.ratio.toFixed(0) : spotFutVolClass.ratio.toFixed(1);
    const { band, safeMax, cautionMax } = spotFutVolClass;
    const spotFutVolTag =
      band === "blue_chip" && safeMax != null && cautionMax != null
        ? `Blue-chip Tier 2 (Caution · ${safeMax + 1}–${cautionMax})`
        : band === "major_alt" && safeMax != null && cautionMax != null
          ? `Major alt Tier 2 (Caution · ${safeMax + 1}–${cautionMax})`
          : "Tier 2 Speculator · ลดเลเวอเรจ";
    penalties.push({
      key: "spotFutVolRatio",
      points: spotFutPenT2,
      deductionLine: `❌ Spot/Perp vol R=${rDisp} (${spotFutVolTag}): −${spotFutPenT2}`,
    });
  }

  /** EMA 15m: short ต้อง last < EMA12 และ EMA6 < EMA12 — long สลับทิศ */
  if (ema12 != null && ema6 != null) {
    if (dir === "short") {
      if (futPx >= ema12) {
        penalties.push({
          key: "ema15",
          points: emaPricePen,
          deductionLine: `❌ SHORT: last ≥ EMA12 (15m) — ต้องการราคาต่ำกว่า EMA12: −${emaPricePen}`,
        });
      }
      if (ema6 >= ema12) {
        penalties.push({
          key: "emaAlign",
          points: emaAlignPen,
          deductionLine: `❌ SHORT: EMA6 ≥ EMA12 (15m) — ควร EMA6 < EMA12: −${emaAlignPen}`,
        });
      }
    } else {
      if (futPx <= ema12) {
        penalties.push({
          key: "ema15",
          points: emaPricePen,
          deductionLine: `❌ LONG: last ≤ EMA12 (15m) — ต้องการราคาเหนือ EMA12: −${emaPricePen}`,
        });
      }
      if (ema6 <= ema12) {
        penalties.push({
          key: "emaAlign",
          points: emaAlignPen,
          deductionLine: `❌ LONG: EMA6 ≤ EMA12 (15m) — ควร EMA6 > EMA12: −${emaAlignPen}`,
        });
      }
    }
  }

  const totalPen = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, 100 - totalPen);

  const dirEmoji = dir === "short" ? "📉" : "📈";
  const headerTitle = `🛡️ การประเมินความเสี่ยง: [${dir.toUpperCase()}] ${base} / USDT ${dirEmoji}`;
  /** หัวข้อย่อยใน snapshot — emoji อ่านชัดกว่า bullet • ในหลายฟอนต์/แอป */
  const listBullet = "🔹";

  const statusOrder = [
    "liqCapRatio",
    "spotFutVolRatio",
    "sentiment",
    "liquidity",
    "newHigh",
    "ema15",
    "emaAlign",
    "weekend",
    "basis",
  ] as const;
  const statusReason = (() => {
    for (const k of statusOrder) {
      const hit = penalties.find((p) => p.key === k);
      if (hit) {
        if (k === "liqCapRatio") return "Liquidity–Cap ratio";
        if (k === "spotFutVolRatio") return "Spot/Perp volume (Fut÷Spot)";
        if (k === "sentiment") return "Market Sentiment";
        if (k === "liquidity") return "Liquidity";
        if (k === "newHigh") return "ATH Guard (48h)";
        if (k === "ema15") return "EMA12 (15m) vs price";
        if (k === "emaAlign") return "EMA6/12 (15m)";
        if (k === "weekend") return "Weekend";
        if (k === "basis") return "Spot–Perp Gap";
      }
    }
    return null;
  })();

  const terminateVisual =
    liqCapClass.tier === "extreme" || spotFutVolClass.tier === 4;

  let statusLine: string;
  if (score >= 85) {
    statusLine = "สถานะ: ✅ OK";
  } else if (score >= 60) {
    statusLine = statusReason
      ? `สถานะ: ⚠️ WARNING (${statusReason})`
      : "สถานะ: ⚠️ WARNING";
  } else if (terminateVisual) {
    statusLine = statusReason
      ? `สถานะ: ⛔ TERMINATE (${statusReason})`
      : "สถานะ: ⛔ TERMINATE";
  } else {
    statusLine = statusReason
      ? `สถานะ: 🔴 RISK (${statusReason})`
      : "สถานะ: 🔴 HIGH RISK";
  }

  const weekendRuleBad = dir === "short" && weekend;
  const weekendLine = weekendRuleBad
    ? `Weekend: ⚠️ Sat–Sun (BKK) — risky for SHORT`
    : `Weekend: ✅ Pass (weekday or long OK)`;

  const athLine = nearHigh
    ? `ATH Guard (48h): ⚠️ ราคาใกล้ยอดสูงสุดในช่วง ~48 ชม. — ระวังเป็นพิเศษ · เลเวอเรจ ≤${maxLevCfg}x แนะนำ`
    : `ATH Guard (48h): ✅ ยังไม่แนบยอดสูงสุด ~48 ชม. (เทียบจาก kline 1h)`;

  let ema15mLine: string;
  if (ema6 != null && ema12 != null) {
    const e6 = ema6.toFixed(4);
    const e12 = ema12.toFixed(4);
    const lp = futPx.toFixed(4);
    if (dir === "short") {
      const pxOk = futPx < ema12;
      const alignOk = ema6 < ema12;
      ema15mLine = [
        `Trend filter (15m / EMA): Last=${lp} · EMA6=${e6} · EMA12=${e12}`,
        `SHORT: ราคา < EMA12 → ${pxOk ? "✅" : "⚠️ ไม่เข้าเกณฑ์ (แจ้งใน Deductions)"} · EMA6 < EMA12 → ${alignOk ? "✅" : "⚠️ ไม่เข้าเกณฑ์"}`,
      ].join("\n");
    } else {
      const pxOk = futPx > ema12;
      const alignOk = ema6 > ema12;
      ema15mLine = [
        `Trend filter (15m / EMA): Last=${lp} · EMA6=${e6} · EMA12=${e12}`,
        `LONG: ราคา > EMA12 → ${pxOk ? "✅" : "⚠️ ไม่เข้าเกณฑ์ (แจ้งใน Deductions)"} · EMA6 > EMA12 → ${alignOk ? "✅" : "⚠️ ไม่เข้าเกณฑ์"}`,
      ].join("\n");
    }
  } else {
    ema15mLine = `Trend filter (15m / EMA): ❓ ไม่มีข้อมูล kline 15m เพียงพอ (หรือดึงไม่สำเร็จ) — ข้ามกฎ EMA`;
  }

  let sentimentRuleLine: string;
  if (fngVal != null) {
    const cls = fngCls?.trim() ?? "";
    if (dir === "short") {
      const c = classifyFngShort(fngVal, fngMaxShort);
      sentimentRuleLine = `Market Sentiment: ${c.emoji} ${c.label}${cls ? ` — ${cls}` : ""}`;
    } else {
      const c = classifyFngLong(fngVal, sentGreedTh);
      sentimentRuleLine = `Market Sentiment: ${c.emoji} ${c.label}${cls ? ` — ${cls}` : ""}`;
    }
  } else {
    const err =
      pulseResult && "error" in pulseResult
        ? pulseResult.error instanceof MarketPulseFetchError
          ? pulseResult.error.message
          : String(pulseResult.error)
        : "unknown";
    sentimentRuleLine = `Market Sentiment: ❓ No F&G (${err.slice(0, 80)})`;
  }

  const liqCapRuleLine = (() => {
    if (liqCapClass.ratio == null) {
      return `Liquidity–Cap ratio (mcap / max pos USDT): ❓ N/A — ต้องมี Market Cap (CoinGecko) และ max order จากสัญญา`;
    }
    const rStr = Math.round(liqCapClass.ratio).toLocaleString("en-US");
    const notionalStr = maxNotionalUsd != null ? formatUsd(maxNotionalUsd) : "—";
    if (liqCapClass.tier === "extreme") {
      return `Liquidity–Cap ratio: 🔴 TERMINATE — ${rStr}:1 — Fake Market Cap (RAVE trap) · mcap / max pos USDT · max ~${notionalStr} @ last`;
    }
    if (liqCapClass.tier === "high") {
      return `Liquidity–Cap ratio: ⚠️ HIGH_RISK — ${rStr}:1 — Low real liquidity (เจ้ามือคุม/ลากลม) · max ~${notionalStr} @ last`;
    }
    if (liqCapClass.tier === "watch") {
      return `Liquidity–Cap ratio: 👀 WATCH — ${rStr}:1 — Medium risk liquidity gap (${liqCapThWatch.toLocaleString("en-US")}–${liqCapThHigh.toLocaleString("en-US")}) · max ~${notionalStr} @ last`;
    }
    return `Liquidity–Cap ratio: ✅ SAFE_TO_TRADE — ${rStr}:1 (เหรียญหลัก/พื้นฐานดี · < ${liqCapThWatch.toLocaleString("en-US")}:1) · max ~${notionalStr} @ last`;
  })();

  const spotFutAmtSuffix =
    amount24 != null && spotQuoteVol24 != null && spotQuoteVol24 > 0
      ? ` — Spot ${formatUsd(spotQuoteVol24)} / Fut ${formatUsd(amount24)}`
      : "";

  const spotFutVolRuleLine = (() => {
    if (spotFutVolClass.tier === "unknown" || spotFutVolClass.ratio == null) {
      const perpOk = amount24 != null && amount24 > 0;
      const spotOk = spotQuoteVol24 != null && spotQuoteVol24 > 0;
      return `Vol Ratio (Fut÷Spot 24h USDT): ❓ ไม่มี R — perp 24h: ${perpOk ? "มี" : "ไม่มี"} · spot quote 24h: ${spotOk ? "มี" : "ไม่มี"} (${spotSym})`;
    }
    const R = spotFutVolClass.ratio;
    const rDisp = R >= 100 ? R.toFixed(0) : R.toFixed(1);
    const { band, safeMax, cautionMax } = spotFutVolClass;

    if (band === "blue_chip" && safeMax != null && cautionMax != null) {
      if (spotFutVolClass.tier === 3) {
        return [
          `Vol Ratio (Fut÷Spot): 🔴 Tier 3 [R=${rDisp}]${spotFutAmtSuffix} (Blue-chip · R>${cautionMax}) — Risk`,
          `สถานะ: ลดขนาดหรือเลเวอเรจ — Fut÷Spot สูงเกินกรอบคู่หลัก`,
        ].join("\n");
      }
      if (spotFutVolClass.tier === 2) {
        return [
          `Vol Ratio (Fut÷Spot): 🟡 Tier 2 [R=${rDisp}]${spotFutAmtSuffix} (Blue-chip · ${safeMax + 1}–${cautionMax}) — Caution`,
          `สถานะ: Watch — พิจารณาลดเลเวอเรจ`,
        ].join("\n");
      }
      return [
        `Vol Ratio (Fut÷Spot): ✅ Tier 1 [R=${rDisp}]${spotFutAmtSuffix} (Blue-chip · R≤${safeMax}) — Safe`,
        `สถานะ: กรอบ Blue-chip — สภาพคล่องหนา เทียบสปอตในเกณฑ์ปลอดภัย`,
      ].join("\n");
    }

    if (band === "major_alt" && safeMax != null && cautionMax != null) {
      if (spotFutVolClass.tier === 3) {
        return [
          `Vol Ratio (Fut÷Spot): 🔴 Tier 3 [R=${rDisp}]${spotFutAmtSuffix} (Major alt · R>${cautionMax}) — Risk`,
          `สถานะ: ลดขนาดหรือเลเวอเรจ — สัดส่วนฟิวเจอร์หนาเกินกรอบเหรียญกลุ่มนี้`,
        ].join("\n");
      }
      if (spotFutVolClass.tier === 2) {
        return [
          `Vol Ratio (Fut÷Spot): 🟡 Tier 2 [R=${rDisp}]${spotFutAmtSuffix} (Major alt · ${safeMax + 1}–${cautionMax}) — Caution`,
          `สถานะ: Watch — พิจารณาลดเลเวอเรจ`,
        ].join("\n");
      }
      return [
        `Vol Ratio (Fut÷Spot): ✅ Tier 1 [R=${rDisp}]${spotFutAmtSuffix} (Major alt · R≤${safeMax}) — Safe`,
        `สถานะ: กรอบ Major alt — Fut÷Spot อยู่ในเกณฑ์ปลอดภัย`,
      ].join("\n");
    }

    if (spotFutVolClass.tier === 4) {
      return [
        `Vol Ratio (Fut÷Spot): ☠️ Tier 4 [R=${rDisp}]${spotFutAmtSuffix} (≥${spotFutT4Min}) — Casino/RAVE`,
        `สถานะ: TERMINATE — เก็งฟิวเจอร์เทียบของถือจริงสูงผิดปกติ · ควรเลี่ยงคู่นี้`,
      ].join("\n");
    }
    if (spotFutVolClass.tier === 3) {
      const fundHint =
        dir === "short" && funding < 0 ? " · Short + funding ติดลบ: เสี่ยง squeeze" : "";
      return [
        `Vol Ratio (Fut÷Spot): 🔴 Tier 3 [R=${rDisp}]${spotFutAmtSuffix} (${spotFutT3Min}≤R<${spotFutT4Min}) — Manipulation`,
        `สถานะ: ความผันสูง · แพทเทิร์นกราฟเสี่ยงใช้ไม่ค่อยได้${fundHint}`,
      ].join("\n");
    }
    if (spotFutVolClass.tier === 2) {
      return [
        `Vol Ratio (Fut÷Spot): 🟡 Tier 2 [R=${rDisp}]${spotFutAmtSuffix} (${spotFutT2Min}≤R<${spotFutT3Min}) — Speculator`,
        `สถานะ: Watch — พิจารณาลดเลเวอเรจ (เช่น 10x→5x) กันสะบัดกิน SL`,
      ].join("\n");
    }
    return [
      `Vol Ratio (Fut÷Spot): ✅ Tier 1 [R=${rDisp}]${spotFutAmtSuffix} (R<${spotFutT2Min}) — Fair game`,
      `สถานะ: Volume Health ดี — supply/demand อ่านง่ายเมื่อ R ต่ำ`,
    ].join("\n");
  })();

  const volLine =
    amount24 != null
      ? `Vol 24h: ${formatUsd(amount24)} USDT${amount24 < minVolAdvisory ? " ⚠️ (below soft min)" : ""}`
      : `Vol 24h: ❓ N/A`;

  const maxOrderLine =
    maxOrderContracts != null && maxOrderContracts > 0
      ? `Max order size: ${maxOrderContracts.toLocaleString("en-US")} contracts (~${formatUsd(maxOrderContracts * futPx)} USDT @ last)`
      : "Max order size: —";

  const capLine =
    mcapUsd != null
      ? `Market Cap: ~$${formatUsd(mcapUsd)}${mcapUsd < minMcapAdvisory ? " ⚠️ (below soft min)" : ""}`
      : `Market Cap: ❓ N/A (CoinGecko)`;

  const fundPct = fundingPct(funding);
  const fundExtra = fundingIntensityLabel(fundPct);
  const fundingLine = `Funding Rate: ${fundPct >= 0 ? "+" : ""}${fundPct.toFixed(4)}% ${fundExtra}`.trim();

  const basisLine =
    basisPct != null
      ? `Basis: ${basisPct >= 0 ? "+" : ""}${basisPct.toFixed(4)}%${Math.abs(basisPct) > basisAbsPct ? " ⚠️" : ""}`
      : `Basis: ❓ No spot pair on MEXC`;

  /** แปลงหลายบรรทัดเป็น bullet หลัก + บรรทัดรองขยับเข้า */
  function bulletBlock(text: string, indentSub = "  ▸ "): string {
    const parts = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (parts.length === 0) return "";
    return parts.map((l, i) => (i === 0 ? `${listBullet} ${l}` : `${indentSub}${l}`)).join("\n");
  }

  const spotFutVolBlock = bulletBlock(spotFutVolRuleLine);
  const emaBlock = bulletBlock(ema15mLine);

  const maxOrderShort =
    maxOrderContracts != null && maxOrderContracts > 0
      ? `Max order: ~${formatUsd(maxOrderContracts * futPx)} USDT @ last (${maxOrderContracts.toLocaleString("en-US")} contracts)`
      : maxOrderLine;

  const criticalSection = [
    "สภาพคล่อง",
    "",
    `${listBullet} ${liqCapRuleLine}`,
    spotFutVolBlock,
    `${listBullet} ${maxOrderShort}`,
  ].join("\n");

  const trendSection = [
    "📈 เทรนด์ & Sentiment",
    "",
    `${listBullet} ${sentimentRuleLine}`,
    emaBlock,
    `${listBullet} ${weekendLine}`,
    `${listBullet} ${athLine}`,
  ].join("\n");

  const deductionsBlock =
    penalties.length === 0
      ? `${listBullet} หักคะแนน: ไม่มี (✅)`
      : [`${listBullet} หักคะแนน:`, ...penalties.map((p) => `  ◦ ${p.deductionLine}`)].join("\n");

  const scoreSection = ["📊 Koji Score", "", `${listBullet} คะแนน: ${score}/100`, "", deductionsBlock].join("\n");

  const metricsSection = [
    "⛓️ ตัวเลขตลาด & On-chain",
    "",
    `${listBullet} ${volLine}`,
    `${listBullet} ${capLine}`,
    `${listBullet} ${fundingLine}`,
    `${listBullet} ${basisLine}`,
  ].join("\n");

  const verdictLine = (() => {
    if (score < 40 && dir === "short" && (liqCapClass.tier === "extreme" || spotFutVolClass.tier === 4)) {
      return [
        "",
        "⛔ คำเตือนสรุป",
        `${listBullet} ห้าม Short ง่ายๆ ในสภาพนี้: สภาพคล่อง Spot เทียบ Futures ต่ำผิดปกติ — เจ้ามือใช้เงินน้อยลากกินพอร์ตได้ง่าย (คำแนะอัตโนมัติ ไม่ใช่คำสั่งล็อก)`,
      ].join("\n");
    }
    return "";
  })();

  const lines: string[] = [
    headerTitle,
    "",
    `${listBullet} ${statusLine}`,
    "",
    criticalSection,
    "",
    trendSection,
    "",
    scoreSection,
    verdictLine,
    "",
    metricsSection,
    "",
    "—",
    "Not financial advice · automated snapshot",
  ];

  return lines.filter((x) => x !== "").join("\n");
}

const MARKET_CHECK_DIV = "------------------------------";

function rsiStrengthLabel(rsi: number): string {
  if (rsi >= 70) return "(Overbought)";
  if (rsi >= 55) return "(Bullish bias)";
  if (rsi >= 45) return "(Neutral)";
  if (rsi >= 30) return "(Slightly Weak)";
  return "(Oversold)";
}

function spotFutTierFace(tier: SpotFutVolTier): string {
  if (tier === "unknown") return "❓";
  if (tier === 1) return "✅";
  if (tier === 2) return "⚠️";
  return "🔴";
}

function spotFutRatioHealth(tier: SpotFutVolTier): string {
  if (tier === "unknown") return "N/A";
  if (tier === 1) return "Healthy";
  if (tier === 2) return "Mixed / Caution";
  return "Stressed";
}

function volTierTitle(spot: ReturnType<typeof classifySpotFutVolRatioForBase>): string {
  if (spot.tier === "unknown") return "Unknown";
  const band =
    spot.band === "blue_chip" ? "Blue-chip" : spot.band === "major_alt" ? "Major alt" : "Standard";
  return `Tier ${spot.tier} (${band})`;
}

function fundingBiasLabel(pct: number): string {
  const a = Math.abs(pct);
  if (pct < -0.05) return "(Strong Short Bias)";
  if (pct < -0.01) return "(Short Bias)";
  if (pct < 0) return "(Slightly Short Bias)";
  if (pct > 0.05) return "(Strong Long Bias)";
  if (pct > 0.01) return "(Long Bias)";
  if (pct > 0) return "(Slightly Long Bias)";
  return "(Neutral)";
}

type CheckEmaMomentumTf = "15m" | "1hr" | "4hr" | "1d";

type EmaMomentumSnapshot = {
  trendLabel: "BEARISH" | "BULLISH" | "MIXED" | "NEUTRAL";
  trendIcon: string;
  priceVsEma12: string;
  emaCrossLine: string;
  summary: string;
};

function snapshotMarketCheckMomentum(
  futPx: number,
  ema6: number | null,
  ema12: number | null,
  tf: CheckEmaMomentumTf
): EmaMomentumSnapshot {
  let trendLabel: EmaMomentumSnapshot["trendLabel"] = "NEUTRAL";
  let trendIcon = "➖";
  let priceVsEma12 = "(ข้อมูล EMA ไม่พร้อม)";
  let emaCrossLine = "[ — ]";

  if (ema6 != null && ema12 != null) {
    emaCrossLine =
      ema6 < ema12
        ? "[ Dead Cross ] (6 < 12)"
        : ema6 > ema12
          ? "[ Golden Cross ] (6 > 12)"
          : "[ Flat ] (6 = 12)";
    if (futPx < ema12) {
      priceVsEma12 = "(Under EMA12)";
      trendLabel = ema6 <= ema12 ? "BEARISH" : "MIXED";
      trendIcon = ema6 <= ema12 ? "📉" : "⚖️";
    } else if (futPx > ema12) {
      priceVsEma12 = "(Over EMA12)";
      trendLabel = ema6 >= ema12 ? "BULLISH" : "MIXED";
      trendIcon = ema6 >= ema12 ? "📈" : "⚖️";
    } else {
      priceVsEma12 = "(At EMA12)";
    }
  }

  const scope =
    tf === "15m"
      ? "ระยะสั้น (15m)"
      : tf === "1hr"
        ? "ระยะ 1 ชม."
        : tf === "4hr"
          ? "ระยะ 4 ชม."
          : "ภาพรายวัน (1D)";
  let summary = "สรุป: รอข้อมูล EMA";
  if (ema6 != null && ema12 != null) {
    if (trendLabel === "BEARISH") summary = `สรุป (${scope}): เสียทรงขาขึ้น — แรงซื้อยังไม่กลับมา`;
    else if (trendLabel === "BULLISH") summary = `สรุป (${scope}): โมเมนตัมขาขึ้น — แรงซื้อนำ`;
    else if (trendLabel === "MIXED") summary = `สรุป (${scope}): ยังไม่ชัด — รอยืนยันทิศ`;
    else summary = `สรุป (${scope}): ราคาแนบ EMA — รอทิศชัด`;
  }

  return { trendLabel, trendIcon, priceVsEma12, emaCrossLine, summary };
}

/** เทียบ Trend กับเป้า Long / Short ของคำสั่ง — dailyLayer = แท่งรายวัน (1D) */
function lineVsDirectionTarget(
  dir: PositionDirection,
  snap: EmaMomentumSnapshot,
  dailyLayer?: boolean
): string {
  const { trendLabel } = snap;
  const target = dir === "long" ? "Long" : "Short";
  if (trendLabel === "BULLISH") {
    if (dir === "long")
      return dailyLayer
        ? `🔹 vs เป้า ${target}: ✅ แนวรายวันหนุน long`
        : `🔹 vs เป้า ${target}: ✅ โครงสร้างหนุน long`;
    return dailyLayer
      ? `🔹 vs เป้า ${target}: ⚠️ รายวันสวน short — ระวัง squeeze ระยะสั้น`
      : `🔹 vs เป้า ${target}: ⚠️ ทิศสั้นสวน short — ระวัง squeeze`;
  }
  if (trendLabel === "BEARISH") {
    if (dir === "short")
      return dailyLayer
        ? `🔹 vs เป้า ${target}: ✅ แนวรายวันหนุน short`
        : `🔹 vs เป้า ${target}: ✅ โครงสร้างหนุน short`;
    return dailyLayer
      ? `🔹 vs เป้า ${target}: ⚠️ รายวันยังกด long — ดูสัญญาณ intraday ประกอบ`
      : `🔹 vs เป้า ${target}: ⚠️ ทิศสั้นสวน long — รอ rebound / ยืนเหนือ EMA`;
  }
  if (trendLabel === "MIXED") return `🔹 vs เป้า ${target}: ➖ ยังไม่ชัด — ไม่จับทิศชัด`;
  return `🔹 vs เป้า ${target}: ➖ แนบ EMA / พักตัว`;
}

function linesMarketCheckMomentumTf(
  tfLabel: CheckEmaMomentumTf,
  futPx: number,
  ema6: number | null,
  ema12: number | null,
  rsiLine: string | null,
  dir: PositionDirection
): string[] {
  const snap = snapshotMarketCheckMomentum(futPx, ema6, ema12, tfLabel);
  const header =
    tfLabel === "15m"
      ? "📊 MOMENTUM (15m · EMA6/12 · RSI)"
      : tfLabel === "1hr"
        ? "📊 MOMENTUM (1hr · EMA6/12)"
        : tfLabel === "4hr"
          ? "📊 MOMENTUM (4hr · EMA6/12)"
          : "📊 MOMENTUM (1D · EMA6/12 · macro)";

  if (ema6 == null || ema12 == null) {
    const miss =
      tfLabel === "15m"
        ? "ไม่มีข้อมูล kline 15m เพียงพอ"
        : tfLabel === "1hr"
          ? "ไม่มีข้อมูล kline 1hr เพียงพอ"
          : tfLabel === "4hr"
            ? "ไม่มีข้อมูล kline 4hr เพียงพอ"
            : "ไม่มีข้อมูล kline รายวัน (1D) เพียงพอ";
    return [header, `🔹 Trend:    [ — ] (${miss})`];
  }

  const out = [
    header,
    `🔹 Trend:    [ ${snap.trendLabel} ] ${snap.trendIcon}`,
    `🔹 Price:    [ ${futPx.toFixed(1)} ] ${snap.priceVsEma12}`,
    `🔹 EMA Cross: ${snap.emaCrossLine}`,
  ];
  if (rsiLine) out.push(rsiLine);
  out.push(lineVsDirectionTarget(dir, snap, tfLabel === "1d"));
  out.push(`▸ ${snap.summary}`);
  return out;
}

function tfQuickVsTargetEmoji(dir: PositionDirection, t: EmaMomentumSnapshot["trendLabel"]): string {
  if (dir === "long") {
    if (t === "BULLISH") return "✅";
    if (t === "BEARISH") return "⚠️";
    return "➖";
  }
  if (t === "BEARISH") return "✅";
  if (t === "BULLISH") return "⚠️";
  return "➖";
}

function buildMarketCheckVerdictBody(
  dir: PositionDirection,
  liqDeep: boolean,
  s15: EmaMomentumSnapshot,
  s1h: EmaMomentumSnapshot,
  s4h: EmaMomentumSnapshot,
  s1d: EmaMomentumSnapshot
): string {
  const t15 = s15.trendLabel;
  const t1h = s1h.trendLabel;
  const t4 = s4h.trendLabel;
  const td = s1d.trendLabel;

  const bullishCount = [t15, t1h, t4, td].filter((x) => x === "BULLISH").length;
  const bearishCount = [t15, t1h, t4, td].filter((x) => x === "BEARISH").length;

  if (dir === "long") {
    if (liqDeep && t15 === "BEARISH" && (t1h === "BULLISH" || t4 === "BULLISH" || td === "BULLISH")) {
      return '"Wait for Rebound - สภาพคล่องดีมากแต่ 15m ยังกด · 1hr/4hr/1D บางส่วนยังหนุน long\nแนะนำรอราคายืนเหนือ EMA12 (15m) หรือสอดคล้องทุก TF ก่อน"';
    }
    if (liqDeep && bullishCount >= 2 && t4 === "BULLISH" && t15 === "BULLISH") {
      return '"Trend aligned long — สั้นและใหญ่ (15m·4hr) หนุน; คุมสเกลและจุดตัดขาทุน"';
    }
    if (liqDeep && bullishCount >= 2 && t15 === "BULLISH") {
      return '"Trend aligned long — สภาพคล่องดี; โครงสร้างหลาย TF หนุน long"';
    }
    if (liqDeep && t15 === "BEARISH") {
      return '"Wait for Rebound - สภาพคล่องดีมากแต่เทรนด์ 15m ยังกดตัว \nแนะนำให้รอราคาข้ามยืนเหนือ EMA12 ก่อนพิจารณาเข้าเล่น"';
    }
    if (liqDeep && t15 === "BULLISH" && bearishCount >= 2) {
      return '"สั้นหนุน long แต่ 1hr/4hr/1D บางส่วนยังกด — ระวัง mean reversion / ลดไม้"';
    }
    if (liqDeep && t15 === "BULLISH") {
      return '"Trend aligned long — สภาพคล่องดี; คุมสเกลตามแผนและจุดตัดขาทุน"';
    }
    return '"สรุปภาพรวมด้านบน — ใช้เป็นแนวทาง ไม่ใช่คำแนะนำลงทุน"';
  }

  // short
  if (liqDeep && t15 === "BULLISH" && (t1h === "BEARISH" || t4 === "BEARISH" || td === "BEARISH")) {
    return '"Fade strength - สภาพคล่องลึกแต่ 15m ยังแรง · ใหญ่/รายวันบางส่วนเริ่มกด\nรอ breakdown / ยืนใต้ EMA ชัดก่อนพิจารณา short"';
  }
  if (liqDeep && bearishCount >= 2 && t4 === "BEARISH" && t15 === "BEARISH") {
    return '"Trend aligned short — สั้นและใหญ่หนุน short; ระวัง overshoot / funding"';
  }
  if (liqDeep && bearishCount >= 2 && t15 === "BEARISH") {
    return '"Trend aligned short — สภาพคล่องดี; โครงสร้างหลาย TF หนุน short"';
  }
  if (liqDeep && t15 === "BULLISH") {
    return '"Fade strength - สภาพคล่องลึกแต่เทรนด์สั้นยังหนุน\nรอ breakdown / ยืนใต้ EMA12 ชัดก่อนพิจารณา short"';
  }
  if (liqDeep && t15 === "BEARISH" && bullishCount >= 2) {
    return '"สั้นหนุน short แต่ 1hr/4hr/1D บางส่วนยังแรง — ระวัง rebound"';
  }
  if (liqDeep && t15 === "BEARISH") {
    return '"Trend aligned short — สภาพคล่องดี; ระวัง overshoot / funding"';
  }
  return '"สรุปภาพรวมด้านบน — ใช้เป็นแนวทาง ไม่ใช่คำแนะนำลงทุน"';
}

/**
 * คำสั่ง `check btc` · `check eth long` · `check sol short` — สภาพคล่อง + โมเมนตัม 15m/1hr/4hr/1D (เทียบ long/short) + on-chain
 */
export async function buildMarketCheckMessage(parsed: ParsedMarketCheck): Promise<string> {
  const resolved = resolveContractSymbol(parsed.rawSymbol);
  if (!resolved) {
    return "ไม่รู้จักคู่นี้ — ลองเช่น check btc · check eth long · check BTC_USDT short";
  }
  const { contractSymbol, label: base } = resolved;
  const dir = parsed.direction;

  const loaded = await loadChecklistMarketCore(contractSymbol, base);
  if (!loaded.ok) return loaded.message;
  const c = loaded.core;
  const {
    futPx,
    ema6,
    ema12,
    ema6_1h,
    ema12_1h,
    ema6_4h,
    ema12_4h,
    ema6_1d,
    ema12_1d,
    funding,
    closes15m,
    liqCapClass,
    spotFutVolClass,
    weekend,
    pulseResult,
  } = c;

  const rsiPeriod = envNum("MARKET_CHECK_RSI_PERIOD", 14);

  let rsiLast: number | null = null;
  if (closes15m && closes15m.length > rsiPeriod + 1) {
    const rsiArr = rsiWilder(closes15m, rsiPeriod);
    const v = rsiArr[closes15m.length - 1];
    if (typeof v === "number" && Number.isFinite(v)) rsiLast = v;
  }

  const snap15 = snapshotMarketCheckMomentum(futPx, ema6, ema12, "15m");
  const snap1h = snapshotMarketCheckMomentum(futPx, ema6_1h, ema12_1h, "1hr");
  const snap4h = snapshotMarketCheckMomentum(futPx, ema6_4h, ema12_4h, "4hr");
  const snap1d = snapshotMarketCheckMomentum(futPx, ema6_1d, ema12_1d, "1d");

  const R = spotFutVolClass.ratio;
  const rDisp =
    R != null && Number.isFinite(R) ? (R >= 100 ? R.toFixed(0) : R.toFixed(1)) : "—";
  const tierBracket = `[ ${volTierTitle(spotFutVolClass)} ] ${spotFutTierFace(spotFutVolClass.tier)}`;
  const ratioBracket = R != null && Number.isFinite(R) ? `[ 1 : ${rDisp} ] (${spotFutRatioHealth(spotFutVolClass.tier)})` : "[ — ] (N/A)";

  let lcapBracket = "[ N/A ] (ไม่มี mcap / max order)";
  if (liqCapClass.ratio != null && Number.isFinite(liqCapClass.ratio)) {
    const rRounded = Math.round(liqCapClass.ratio).toLocaleString("en-US");
    const note =
      liqCapClass.tier === "safe"
        ? "(Very Deep)"
        : liqCapClass.tier === "watch"
          ? "(Moderate)"
          : liqCapClass.tier === "high"
            ? "(Tight)"
            : "(Extreme)";
    lcapBracket = `[ 1 : ${rRounded} ] ${note}`;
  }

  const volSummary =
    spotFutVolClass.tier === 1 && liqCapClass.tier === "safe"
      ? "สรุป: สภาพคล่องมหาศาล เล่นได้ทุกขนาดไม้ ไม่มีความเสี่ยงเรื่องกรง"
      : spotFutVolClass.tier !== "unknown" && typeof spotFutVolClass.tier === "number" && spotFutVolClass.tier >= 3
        ? "สรุป: Fut÷Spot หรือ L-Cap อยู่ในโซนเสี่ยง — ลดไม้ / ระวังสวน"
        : "สรุป: สภาพคล่องอยู่ในเกณฑ์รับได้ — ดูทิศ 15m / 1hr / 4hr / 1D ประกอบ";

  const fp = fundingPct(funding);
  const fundBracket = `[ ${fp >= 0 ? "+" : ""}${fp.toFixed(4)}% ] ${fundingBiasLabel(fp)}`;

  let fngBracket = "[ — ]";
  if (pulseResult && !("error" in pulseResult)) {
    const v = pulseResult.fng.value;
    const cls = pulseResult.fng.valueClassification?.trim();
    const zone =
      cls && cls.length > 0
        ? cls
        : v >= 60
          ? "Greed"
          : v >= 45
            ? "Neutral"
            : "Fear-heavy";
    fngBracket = `[ ${v} (${zone}) ]`;
  }

  const weekendBracket = weekend ? "[ ⚠️ BKK weekend ]" : "[ ✅ Pass ]";

  const liqDeep = liqCapClass.tier === "safe" && spotFutVolClass.tier === 1;
  const verdictBody = buildMarketCheckVerdictBody(dir, liqDeep, snap15, snap1h, snap4h, snap1d);

  const rsiLine =
    rsiLast != null
      ? `🔹 RSI:      [ ${rsiLast.toFixed(1)} ] ${rsiStrengthLabel(rsiLast)}`
      : "🔹 RSI:      [ — ] (ไม่มีข้อมูล 15m พอสำหรับ RSI)";

  const momentumSection = [
    ...linesMarketCheckMomentumTf("15m", futPx, ema6, ema12, rsiLine, dir),
    "",
    ...linesMarketCheckMomentumTf("1hr", futPx, ema6_1h, ema12_1h, null, dir),
    "",
    ...linesMarketCheckMomentumTf("4hr", futPx, ema6_4h, ema12_4h, null, dir),
    "",
    ...linesMarketCheckMomentumTf("1d", futPx, ema6_1d, ema12_1d, null, dir),
  ];

  const quickVsLine = `🎯 Quick vs เป้า ${dir === "short" ? "SHORT" : "LONG"}: 15m ${tfQuickVsTargetEmoji(
    dir,
    snap15.trendLabel
  )} · 1hr ${tfQuickVsTargetEmoji(dir, snap1h.trendLabel)} · 4hr ${tfQuickVsTargetEmoji(
    dir,
    snap4h.trendLabel
  )} · 1D ${tfQuickVsTargetEmoji(dir, snap1d.trendLabel)}  (✅=หนุนเป้า · ⚠️=สวน · ➖=ไม่ชัด)`;

  const dirEmoji = dir === "short" ? "📉" : "📈";
  const dirLabel = dir === "short" ? "SHORT" : "LONG";
  const lines = [
    `🔍 MARKET CHECK: ${base} / USDT · เป้า: ${dirLabel} ${dirEmoji}`,
    MARKET_CHECK_DIV,
    "🛡️ VOLUME INTEGRITY",
    `🔹 Tier:     ${tierBracket}`,
    `🔹 Ratio:    ${ratioBracket}`,
    `🔹 L-Cap:    ${lcapBracket}`,
    `▸ ${volSummary}`,
    "",
    ...momentumSection,
    "",
    quickVsLine,
    "",
    "⛓️ ON-CHAIN & SENTIMENT",
    `🔹 Funding:  ${fundBracket}`,
    `🔹 F&G Index: ${fngBracket}`,
    `🔹 Weekend:  ${weekendBracket}`,
    "",
    MARKET_CHECK_DIV,
    "📊 KOJI VERDICT:",
    verdictBody,
    MARKET_CHECK_DIV,
    "Not financial advice · automated snapshot",
  ];

  return lines.join("\n");
}
