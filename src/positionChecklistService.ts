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

function formatFundingLine(rate: number | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "Funding: —";
  const pct = rate * 100;
  return `Funding: ${pct >= 0 ? "+" : ""}${pct.toFixed(4)}% (per รอบ)`;
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

  type Pen = { key: string; points: number; note: string };
  const penalties: Pen[] = [];

  if (weekend && dir === "short") {
    penalties.push({ key: "weekend", points: 20, note: "สุดสัปดาห์ (short)" });
  }

  if (nearHigh && (lev == null || lev > maxLevCfg)) {
    penalties.push({ key: "newHigh", points: 25, note: "ใกล้ New High + เลเวอเรจสูง/ไม่ระบุ" });
  }

  const liqBadVol = amount24 == null || amount24 < scoreLiqVol;
  const liqBadCap = mcapUsd != null && mcapUsd < scoreLiqMcap;
  if (liqBadVol || liqBadCap) {
    penalties.push({
      key: "liquidity",
      points: 25,
      note: `สภาพคล่อง (Vol/Cap ต่ำเกณฑ์คะแนน)`,
    });
  }

  if (fngVal != null) {
    if (dir === "short" && fngVal > sentGreedTh) {
      penalties.push({ key: "sentiment", points: 15, note: `F&G สูง (${fngVal}) — short สวนกระแส` });
    }
    if (dir === "long" && fngVal < sentGreedTh) {
      penalties.push({ key: "sentiment", points: 15, note: `F&G ต่ำ (${fngVal}) — long ไม่สอดคล้อง` });
    }
  }

  if (basisPct != null && Math.abs(basisPct) > basisAbsPct) {
    penalties.push({
      key: "basis",
      points: 15,
      note: `|Spot−Perp| > ${basisAbsPct}%`,
    });
  }

  const totalPen = penalties.reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, 100 - totalPen);

  const lines: string[] = [];
  lines.push(`Checklist: ${dir.toUpperCase()} ${contractSymbol}`);
  lines.push("");

  lines.push("— กฎ —");
  if (dir === "short" && weekend) {
    lines.push("• Weekend: เสาร์–อาทิตย์ (ไทย) — ระวังวอลลุ่มหลอก");
  } else if (weekend && dir === "long") {
    lines.push("• Weekend: สุดสัปดาห์ — ระวังความผันผัน");
  } else {
    lines.push("• Weekend: ไม่ใช่สุดสัปดาห์ (จันทร์–ศุกร์ ไทย)");
  }

  if (nearHigh) {
    lines.push(`• New High Guard: ราคาใกล้ยอด 1h ล่าสุด (~${nearHighPct}% จาก high) — แนะนำเลเวอเรจ ≤ ${maxLevCfg}x`);
  } else {
    lines.push("• New High Guard: ไม่ใกล้จุดสูงช่วง 1h ล่าสุด (ประมาณการจาก kline)");
  }

  if (fngVal != null) {
    const cls = fngCls?.trim() || "?";
    const warnShort = dir === "short" && fngVal > fngMaxShort;
    lines.push(
      `• Sentiment: F&G ${fngVal} (${cls})${warnShort ? " — เตือน: short ในช่วงไม่ Fear ตามเกณฑ์" : ""}`
    );
  } else {
    const err =
      pulseResult && "error" in pulseResult
        ? pulseResult.error instanceof MarketPulseFetchError
          ? pulseResult.error.message
          : String(pulseResult.error)
        : "ไม่ทราบสาเหตุ";
    lines.push(`• Sentiment: ดึง F&G ไม่สำเร็จ (${err.slice(0, 120)})`);
  }

  if (amount24 != null) {
    const softVol = amount24 < minVolAdvisory;
    lines.push(
      `• Vol 24h (สัญญา): ${formatUsd(amount24)} USDT${softVol ? ` — เตือน: ต่ำกว่า ${formatUsd(minVolAdvisory)}` : ""}`
    );
  } else {
    lines.push("• Vol 24h: ไม่มีข้อมูล amount24");
  }

  if (mcapUsd != null) {
    const softCap = mcapUsd < minMcapAdvisory;
    lines.push(
      `• Market cap (${base}): ~$${formatUsd(mcapUsd)}${softCap ? ` — เตือน: ต่ำกว่า $${formatUsd(minMcapAdvisory)}` : ""}`
    );
  } else {
    lines.push(`• Market cap (${base}): ไม่มีข้อมูล (CoinGecko)`);
  }

  lines.push("");
  lines.push(`📊 Koji Score: ${score}/100`);
  if (penalties.length === 0) {
    lines.push("(ไม่มีหักคะแนนตามเกณฑ์ชุดนี้)");
  } else {
    for (const p of penalties) {
      lines.push(`  − ${p.note}: −${p.points}`);
    }
  }

  lines.push("");
  lines.push("— Metrics —");
  lines.push(formatFundingLine(funding));
  if (basisPct != null) {
    lines.push(`Basis (perp−spot)/spot: ${basisPct >= 0 ? "+" : ""}${basisPct.toFixed(4)}%`);
  } else {
    lines.push("Basis: ไม่มีราคา spot คู่นี้บน MEXC — คำนวณไม่ได้");
  }

  lines.push("");
  lines.push("ข้อมูลอัตโนมัติ ไม่ใช่คำแนะนำลงทุน — ใช้วิจารณญาณของคุณ");

  return lines.join("\n");
}
