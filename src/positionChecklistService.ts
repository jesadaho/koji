import axios from "axios";
import { resolveContractSymbol } from "./coinMap";
import { fetchMarketPulseData, MarketPulseFetchError } from "./marketPulseFetch";
import {
  fetchContractTickerSingle,
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
  if (a >= 0.75) {
    return pct < 0
      ? "(High Negative!) ⚠️ — ฟันดิงงวดนี้ติดลบแรง ฝั่งชอตได้รับ / ลองจ่าย"
      : "(High Positive!) ⚠️ — ฟันดิงบวกแรง ฝั่งลองจ่าย / ชอตได้รับ";
  }
  if (a >= 0.25) {
    return pct < 0 ? "(Elevated negative) — ฟันดิงติดลบพอสังเกต" : "(Elevated positive) — ฟันดิงบวกพอสังเกต";
  }
  return "";
}

function classifyFngShort(
  fng: number,
  maxForShort: number
): { emoji: string; label: string; th: string } {
  if (fng <= maxForShort) {
    return {
      emoji: "✅",
      label: `Pass (F&G ${fng} — OK for short)`,
      th: "โซนกลัว / กลาง — พอไปทางชอตได้",
    };
  }
  if (fng <= 55) {
    return {
      emoji: "⚠️",
      label: `Neutral / tilt (${fng})`,
      th: "กลางๆ — ชอตยังทำได้แต่ไม่ ideal",
    };
  }
  return {
    emoji: "⚠️",
    label: `Greed zone (${fng}) — against short`,
    th: "ตลาดโล่งเกิน — ชอตสวนแรงซื้อ เสี่ยงสูง",
  };
}

function classifyFngLong(fng: number, minForLong: number): { emoji: string; label: string; th: string } {
  if (fng >= minForLong) {
    return {
      emoji: "✅",
      label: `Pass (F&G ${fng} — OK for long)`,
      th: "โซนโล่งพอ — ไปทางลองได้",
    };
  }
  if (fng >= 45) {
    return {
      emoji: "⚠️",
      label: `Neutral (${fng})`,
      th: "กลางๆ — ลองยังไม่ชัด",
    };
  }
  return {
    emoji: "⚠️",
    label: `Fear-heavy (${fng}) — weak for long`,
    th: "ตลาดกลัว — ลองสวนแรงขาย ยากกว่า",
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

  const [ticker, klineHigh, mcapUsd, pulseResult] = await Promise.all([
    fetchContractTickerSingle(contractSymbol),
    fetchPerpHourlyClosesForNearHigh(contractSymbol),
    fetchCoinGeckoMarketCapUsd(base),
    fetchMarketPulseData().catch((e: unknown) => ({ error: e })),
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
      deductionLine:
        `❌ Weekend short (BKK): −20\n` +
        `   ↳ สุดสัปดาห์ (เวลาไทย) วอลลุ่มหลอกบ่อย — ชอตเสี่ยงถูกลาก`,
    });
  }

  if (nearHigh && (lev == null || lev > maxLevCfg)) {
    penalties.push({
      key: "newHigh",
      points: 25,
      deductionLine:
        `❌ Near 1h high + lev >${maxLevCfg}x (or unset): −25\n` +
        `   ↳ ราคาแนบยอดช่วง 1 ชม. + เลเวอเรจเกิน/ไม่ระบุ — จุดไล่สต็อปบ่อย`,
    });
  }

  const liqBadVol = amount24 == null || amount24 < scoreLiqVol;
  const liqBadCap = mcapUsd != null && mcapUsd < scoreLiqMcap;
  if (liqBadVol || liqBadCap) {
    penalties.push({
      key: "liquidity",
      points: 25,
      deductionLine:
        `❌ Low Vol/Cap (score threshold): −25\n` +
        `   ↳ มูลค่าซื้อขาย 24h หรือมาร์เก็ตแคปต่ำ — สเปรดกว้าง โดนลากง่าย`,
    });
  }

  if (fngVal != null) {
    if (dir === "short" && fngVal > sentGreedTh) {
      penalties.push({
        key: "sentiment",
        points: 15,
        deductionLine:
          `❌ F&G ${fngVal} (Shorting against trend): −15\n` +
          `   ↳ ตลาดโล่ง (Greed) — ชอตสวนกระแสซื้อ`,
      });
    }
    if (dir === "long" && fngVal < sentGreedTh) {
      penalties.push({
        key: "sentiment",
        points: 15,
        deductionLine:
          `❌ F&G ${fngVal} (Long vs weak sentiment): −15\n` +
          `   ↳ ตลาดกลัว — ลองสวนกระแสขาย`,
      });
    }
  }

  if (basisPct != null && Math.abs(basisPct) > basisAbsPct) {
    penalties.push({
      key: "basis",
      points: 15,
      deductionLine:
        `❌ |Spot−Perp| gap > ${basisAbsPct}%: −15\n` +
        `   ↳ ส่วนต่าง spot กับ perp กว้าง — เสี่ยงสะบัด / เจ้าไล่ราคา`,
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
        if (k === "newHigh") return "New High / Leverage";
        if (k === "weekend") return "Weekend";
        if (k === "basis") return "Spot–Perp Gap";
      }
    }
    return null;
  })();

  const statusReasonTh = (() => {
    if (!statusReason) return null;
    if (statusReason === "Market Sentiment") return "อารมณ์ตลาด (Fear & Greed)";
    if (statusReason === "Liquidity") return "สภาพคล่อง (Vol / มาร์เก็ตแคป)";
    if (statusReason === "New High / Leverage") return "ใกล้ยอดช่วงสั้น / เลเวอเรจ";
    if (statusReason === "Weekend") return "สุดสัปดาห์ (เวลาไทย)";
    return "ส่วนต่าง Spot กับ Perp";
  })();

  let statusLine: string;
  if (score >= 85) {
    statusLine = "Status: ✅ OK\n↳ สรุป: เงื่อนไขหลักผ่านเกณฑ์ที่ตั้งไว้โดยรวม";
  } else if (score >= 60) {
    statusLine = statusReason
      ? `Status: ⚠️ WARNING (${statusReason})\n↳ สาเหตุหลัก: ${statusReasonTh ?? statusReason} — ควรทบทวนก่อนเข้า`
      : "Status: ⚠️ WARNING\n↳ มีจุดเสี่ยงหลายอย่าง — อ่านหักคะแนนด้านล่าง";
  } else {
    statusLine = statusReason
      ? `Status: 🔴 RISK (${statusReason})\n↳ สาเหตุหลัก: ${statusReasonTh ?? statusReason} — เสี่ยงสูง ควรระมัดระวัง`
      : "Status: 🔴 HIGH RISK\n↳ คะแนนต่ำ — ตรวจรายการหักคะแนนทั้งหมด";
  }

  const weekendRuleBad = dir === "short" && weekend;
  const weekendLine = weekendRuleBad
    ? `Weekend: ⚠️ Sat–Sun (BKK) — risky for SHORT\n   ↳ เสาร์–อาทิตย์ (เวลาไทย) วอลลุ่มหลอกบ่อย ชอตเสี่ยงถูกลาก`
    : `Weekend: ✅ Pass (weekday or long OK)\n   ↳ ไม่ใช่สุดสัปดาห์ หรือเป็นฝั่งลอง — กฎสุดสัปดาห์ไม่กดชอต`;

  const athLine = nearHigh
    ? `New High Guard: ⚠️ Near local 1h high — use ≤${maxLevCfg}x lev\n   ↳ ราคาแนบยอดช่วง 1 ชม.ล่าสุด — เล่นเลเวอเรจสูงเสี่ยงโดนไล่สต็อป`
    : `New High Guard: ✅ Pass (not hugging 1h range top)\n   ↳ ยังไม่แนบขอบบนของช่วง 1 ชม.ล่าสุด (ประมาณจาก kline)`;

  let sentimentRuleLine: string;
  if (fngVal != null) {
    const cls = fngCls?.trim() ?? "";
    if (dir === "short") {
      const c = classifyFngShort(fngVal, fngMaxShort);
      sentimentRuleLine =
        `Market Sentiment: ${c.emoji} ${c.label}${cls ? ` — ${cls}` : ""}\n` +
        `   ↳ ${c.th}`;
    } else {
      const c = classifyFngLong(fngVal, sentGreedTh);
      sentimentRuleLine =
        `Market Sentiment: ${c.emoji} ${c.label}${cls ? ` — ${cls}` : ""}\n` +
        `   ↳ ${c.th}`;
    }
  } else {
    const err =
      pulseResult && "error" in pulseResult
        ? pulseResult.error instanceof MarketPulseFetchError
          ? pulseResult.error.message
          : String(pulseResult.error)
        : "unknown";
    sentimentRuleLine =
      `Market Sentiment: ❓ No F&G (${err.slice(0, 80)})\n` +
      `   ↳ ดึงดัชนี Fear & Greed ไม่ได้ — ไม่หักคะแนนฝั่ง sentiment แต่ควรเช็คเอง`;
  }

  const volLine =
    amount24 != null
      ? `Vol 24h: ${formatUsd(amount24)} USDT${amount24 < minVolAdvisory ? " ⚠️ (below soft min)" : ""}\n` +
        `   ↳ มูลค่าซื้อขายสัญญา 24 ชม. (USDT) — ต่ำกว่าเกณฑ์เตือน = บางทีสเปรดกว้าง`
      : `Vol 24h: ❓ N/A\n   ↳ ไม่มี amount24 จาก ticker — ระวังสภาพคล่อง`;

  const capLine =
    mcapUsd != null
      ? `Market Cap: ~$${formatUsd(mcapUsd)}${mcapUsd < minMcapAdvisory ? " ⚠️ (below soft min)" : ""}\n` +
        `   ↳ มาร์เก็ตแคปเหรียญฐาน (โดยประมาณจาก CoinGecko)`
      : `Market Cap: ❓ N/A (CoinGecko)\n   ↳ หา market cap ไม่เจอ — ใช้ Vol ประกอบแทน`;

  const fundPct = fundingPct(funding);
  const fundExtra = fundingIntensityLabel(fundPct);
  const fundingLine =
    `Funding Rate: ${fundPct >= 0 ? "+" : ""}${fundPct.toFixed(4)}% ${fundExtra}`.trim() +
    `\n   ↳ อัตราชำระรอบละครั้ง — บวก = ฝั่งลองจ่าย / ชอตรับ (โดยทั่วไป)`;

  const basisLine =
    basisPct != null
      ? `Basis: ${basisPct >= 0 ? "+" : ""}${basisPct.toFixed(4)}%${Math.abs(basisPct) > basisAbsPct ? " ⚠️" : ""}\n` +
        `   ↳ (ราคา perp − spot) / spot — กว้างเกินไปเสี่ยงสะบัด / arb`
      : `Basis: ❓ No spot pair on MEXC\n   ↳ ไม่มีคู่ spot — คำนวณ basis ไม่ได้`;

  const lines: string[] = [
    header,
    dir === "short" ? "↳ ทิศทาง: เปิดสั้น (Short)" : "↳ ทิศทาง: เปิดยาว (Long)",
    "",
    statusLine,
    "",
    "🛡️ Trade Rules Check",
    "↳ เช็ควันเวลา (ไทย) · ใกล้ยอดช่วงสั้น · อารมณ์ตลาด — ก่อนกดออเดอร์",
    "",
    weekendLine,
    athLine,
    sentimentRuleLine,
    "",
    `📊 Koji Score: ${score}/100`,
    "↳ คะแนน 100 หักตามเกณฑ์ด้านล่าง (ยิ่งต่ำ = จุดเสี่ยงมากขึ้น)",
    "",
    "Deductions (หักคะแนน):",
    penalties.length === 0
      ? "✅ No deductions — ไม่โดนหักตามเกณฑ์ชุดนี้"
      : penalties.map((p) => p.deductionLine).join("\n\n"),
    "",
    "⛓️ On-Chain & Market Metrics",
    "↳ ตัวเลขตลาดจริง — ใช้ประกอบการตัดสินใจ",
    "",
    volLine,
    capLine,
    fundingLine,
    basisLine,
    "",
    "—",
    "ข้อมูลอัตโนมัติ ไม่ใช่คำแนะนำลงทุน — Not financial advice",
  ];

  return lines.join("\n");
}
