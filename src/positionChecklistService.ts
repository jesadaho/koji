import axios from "axios";
import { resolveContractSymbol } from "./coinMap";
import { fetchMarketPulseData, MarketPulseFetchError } from "./marketPulseFetch";
import { computeEmaLast } from "./emaUtils";
import {
  fetchContractTickerSingle,
  fetchMaxOrderContractsForSymbol,
  fetchPerp15mClosesForChecklist,
  fetchPerpHourlyClosesForNearHigh,
  fetchSpot24hrQuoteVolumeUsdt,
  fetchSpotPriceSingle,
  perpSymbolToSpotSymbol,
} from "./mexcMarkets";
import type { ParsedPositionChecklist } from "./positionChecklistLineCommands";

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

/** R = Futures amount24 ÷ Spot quote turnover 24h (USDT) — ยิ่งสูงยิ่งเสี่ยง (เก็งกำไรเกินถือจริง) */
type SpotFutVolTier = 1 | 2 | 3 | 4 | "unknown";

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
  const spotFutPenT2 = envNum("POSITION_CHECK_SPOT_FUT_VOL_PENALTY_T2", 8);
  const spotFutPenT3 = envNum("POSITION_CHECK_SPOT_FUT_VOL_PENALTY_T3", 18);
  const spotFutPenT4 = envNum("POSITION_CHECK_SPOT_FUT_VOL_PENALTY_T4", 35);

  const [ticker, klineHigh, mcapUsd, pulseResult, maxOrderContracts, closes15m] = await Promise.all([
    fetchContractTickerSingle(contractSymbol),
    fetchPerpHourlyClosesForNearHigh(contractSymbol),
    fetchCoinGeckoMarketCapUsd(base),
    fetchMarketPulseData().catch((e: unknown) => ({ error: e })),
    fetchMaxOrderContractsForSymbol(contractSymbol),
    fetchPerp15mClosesForChecklist(contractSymbol),
  ]);

  if (!ticker?.lastPrice || typeof ticker.lastPrice !== "number" || ticker.lastPrice <= 0) {
    return `ดึงข้อมูลสัญญา ${contractSymbol} ไม่สำเร็จ — ลองใหม่ภายหลัง`;
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

  const spotFutVolClass = classifySpotFutVolRatio(
    amount24,
    spotQuoteVol24,
    spotFutT2Min,
    spotFutT3Min,
    spotFutT4Min,
  );

  const ema6 = closes15m ? computeEmaLast(closes15m, 6) : null;
  const ema12 = closes15m ? computeEmaLast(closes15m, 12) : null;

  let nearHigh = false;
  if (klineHigh && klineHigh.maxClose > 0) {
    nearHigh = nearHighFromMaxClose(futPx, klineHigh.maxClose, nearHighPct);
  }

  const weekend = isBangkokWeekend(new Date());
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
    penalties.push({
      key: "spotFutVolRatio",
      points: spotFutPenT3,
      deductionLine: `❌ Spot/Perp vol R=${rDisp} (Tier 3 Manipulation / High squeeze risk): −${spotFutPenT3}`,
    });
  } else if (spotFutVolClass.tier === 2 && spotFutVolClass.ratio != null) {
    const rDisp = spotFutVolClass.ratio >= 100 ? spotFutVolClass.ratio.toFixed(0) : spotFutVolClass.ratio.toFixed(1);
    penalties.push({
      key: "spotFutVolRatio",
      points: spotFutPenT2,
      deductionLine: `❌ Spot/Perp vol R=${rDisp} (Tier 2 Speculator · ลดเลเวอเรจ): −${spotFutPenT2}`,
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
    return parts.map((l, i) => (i === 0 ? `• ${l}` : `${indentSub}${l}`)).join("\n");
  }

  const spotFutVolBlock = bulletBlock(spotFutVolRuleLine);
  const emaBlock = bulletBlock(ema15mLine);

  const maxOrderShort =
    maxOrderContracts != null && maxOrderContracts > 0
      ? `Max order: ~${formatUsd(maxOrderContracts * futPx)} USDT @ last (${maxOrderContracts.toLocaleString("en-US")} contracts)`
      : maxOrderLine;

  const criticalSection = [
    "🚨 สภาพคล่อง & ขนาดกรง (Critical)",
    "",
    `• ${liqCapRuleLine}`,
    spotFutVolBlock,
    `• ${maxOrderShort}`,
  ].join("\n");

  const trendSection = [
    "📈 เทรนด์ & Sentiment",
    "",
    `• ${sentimentRuleLine}`,
    emaBlock,
    `• ${weekendLine}`,
    `• ${athLine}`,
  ].join("\n");

  const deductionsBlock =
    penalties.length === 0
      ? "• หักคะแนน: ไม่มี (✅)"
      : ["• หักคะแนน:", ...penalties.map((p) => `  ◦ ${p.deductionLine}`)].join("\n");

  const scoreSection = ["📊 Koji Score", "", `• คะแนน: ${score}/100`, "", deductionsBlock].join("\n");

  const metricsSection = [
    "⛓️ ตัวเลขตลาด & On-chain",
    "",
    `• ${volLine}`,
    `• ${capLine}`,
    `• ${fundingLine}`,
    `• ${basisLine}`,
  ].join("\n");

  const verdictLine = (() => {
    if (score < 40 && dir === "short" && (liqCapClass.tier === "extreme" || spotFutVolClass.tier === 4)) {
      return [
        "",
        "⛔ คำเตือนสรุป",
        `• ห้าม Short ง่ายๆ ในสภาพนี้: สภาพคล่อง Spot เทียบ Futures ต่ำผิดปกติ — เจ้ามือใช้เงินน้อยลากกินพอร์ตได้ง่าย (คำแนะอัตโนมัติ ไม่ใช่คำสั่งล็อก)`,
      ].join("\n");
    }
    return "";
  })();

  const lines: string[] = [
    headerTitle,
    "",
    `• ${statusLine}`,
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
