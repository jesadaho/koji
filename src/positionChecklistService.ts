import axios from "axios";
import { resolveContractSymbol } from "./coinMap";
import { fetchMarketPulseData, MarketPulseFetchError } from "./marketPulseFetch";
import {
  fetchContractTickerSingle,
  fetchMaxOrderContractsForSymbol,
  fetchPerpHourlyClosesForNearHigh,
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

  const [ticker, klineHigh, mcapUsd, pulseResult, maxOrderContracts] = await Promise.all([
    fetchContractTickerSingle(contractSymbol),
    fetchPerpHourlyClosesForNearHigh(contractSymbol),
    fetchCoinGeckoMarketCapUsd(base),
    fetchMarketPulseData().catch((e: unknown) => ({ error: e })),
    fetchMaxOrderContractsForSymbol(contractSymbol),
  ]);

  if (!ticker?.lastPrice || typeof ticker.lastPrice !== "number" || ticker.lastPrice <= 0) {
    return `ดึงข้อมูลสัญญา ${contractSymbol} ไม่สำเร็จ — ลองใหม่ภายหลัง`;
  }

  const spotSym = perpSymbolToSpotSymbol(contractSymbol);
  const spotPx = await fetchSpotPriceSingle(spotSym);
  const futPx = ticker.lastPrice;
  let basisPct: number | null = null;
  if (spotPx != null && spotPx > 0) {
    basisPct = ((futPx - spotPx) / spotPx) * 100;
  }

  const amount24 =
    typeof ticker.amount24 === "number" && !Number.isNaN(ticker.amount24) ? ticker.amount24 : null;
  const funding = typeof ticker.fundingRate === "number" && !Number.isNaN(ticker.fundingRate) ? ticker.fundingRate : 0;

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

  const totalPen = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, 100 - totalPen);

  const dirEmoji = dir === "short" ? "📉" : "📈";
  const header = `[${dir.toUpperCase()}] ${base} / USDT ${dirEmoji}`;

  const statusOrder = ["sentiment", "liquidity", "newHigh", "weekend", "basis"] as const;
  const statusReason = (() => {
    for (const k of statusOrder) {
      const hit = penalties.find((p) => p.key === k);
      if (hit) {
        if (k === "sentiment") return "Market Sentiment";
        if (k === "liquidity") return "Liquidity";
        if (k === "newHigh") return "ATH Guard (48h)";
        if (k === "weekend") return "Weekend";
        if (k === "basis") return "Spot–Perp Gap";
      }
    }
    return null;
  })();

  let statusLine: string;
  if (score >= 85) {
    statusLine = "Status: ✅ OK";
  } else if (score >= 60) {
    statusLine = statusReason
      ? `Status: ⚠️ WARNING (${statusReason})`
      : "Status: ⚠️ WARNING";
  } else {
    statusLine = statusReason
      ? `Status: 🔴 RISK (${statusReason})`
      : "Status: 🔴 HIGH RISK";
  }

  const weekendRuleBad = dir === "short" && weekend;
  const weekendLine = weekendRuleBad
    ? `Weekend: ⚠️ Sat–Sun (BKK) — risky for SHORT`
    : `Weekend: ✅ Pass (weekday or long OK)`;

  const athLine = nearHigh
    ? `ATH Guard (48h): ⚠️ ราคาใกล้ยอดสูงสุดในช่วง ~48 ชม. — ระวังเป็นพิเศษ · เลเวอเรจ ≤${maxLevCfg}x แนะนำ`
    : `ATH Guard (48h): ✅ ยังไม่แนบยอดสูงสุด ~48 ชม. (เทียบจาก kline 1h)`;

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

  const lines: string[] = [
    header,
    "",
    statusLine,
    "",
    "🛡️ Trade Rules Check",
    "",
    weekendLine,
    athLine,
    sentimentRuleLine,
    "",
    `📊 Koji Score: ${score}/100`,
    "",
    "Deductions:",
    penalties.length === 0 ? "✅ No deductions" : penalties.map((p) => p.deductionLine).join("\n"),
    "",
    "⛓️ On-Chain & Market Metrics",
    "",
    volLine,
    maxOrderLine,
    capLine,
    fundingLine,
    basisLine,
    "",
    "—",
    "Not financial advice · automated snapshot",
  ];

  return lines.join("\n");
}
