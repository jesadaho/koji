import { computeEmaLast } from "./emaUtils";
import {
  fetchAllOpenPositions,
  fetchContractDetailPublic,
  fetchFuturesAccountAssetList,
  getContractLastPricePublic,
  type MexcCredentials,
  type OpenPositionRow,
} from "./mexcFuturesClient";
import { fetchPerp15mClosesForChecklist, fetchPerp15mHlcForSar } from "./mexcMarkets";
import { geminiSummarizePortfolioFromTextResult } from "./geminiSummary";

function numFromUnknown(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatPctSigned(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function formatBkkNow(): string {
  const d = new Date();
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart} (BKK)`;
}

function portfolioInterSymbolDelayMs(): number {
  const n = Number(process.env.MEXC_TICKER_INTER_SYMBOL_DELAY_MS?.trim());
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? Math.floor(n) : 50;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function portfolioAiSummaryEnabled(): boolean {
  const v = process.env.PORTFOLIO_AI_SUMMARY_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

/** Display MEXC marginRatio: small decimals become %, larger values treated as already %-like */
export function formatMarginRatioDisplay(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return "—";
  if (r >= 0 && r <= 1) return `${(r * 100).toFixed(2)}%`;
  return `${r.toFixed(2)}%`;
}

function contractSymbolToLabel(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const m = s.match(/^(.+)_USDT$/);
  return m ? `${m[1]}/USDT` : symbol;
}

function isLongPosition(p: OpenPositionRow): boolean {
  return p.positionType === 1;
}

/** Exported for sanity checks and tests */
export function describeSwingStructureFromCloses(closes: number[]): string {
  if (closes.length < 5) return "— (แท่งไม่พอ)";
  const tail = closes.slice(-24);
  const pivotsH: number[] = [];
  const pivotsL: number[] = [];
  for (let i = 1; i < tail.length - 1; i++) {
    const c = tail[i]!;
    if (c > tail[i - 1]! && c > tail[i + 1]!) pivotsH.push(c);
    if (c < tail[i - 1]! && c < tail[i + 1]!) pivotsL.push(c);
  }
  const hh = pivotsH.slice(-2);
  const ll = pivotsL.slice(-2);
  const parts: string[] = [];
  if (hh.length >= 2) {
    if (hh[1]! > hh[0]!) parts.push("Higher high");
    else if (hh[1]! < hh[0]!) parts.push("Lower high");
  }
  if (ll.length >= 2) {
    if (ll[1]! > ll[0]!) parts.push("Higher low");
    else if (ll[1]! < ll[0]!) parts.push("Lower low");
  }
  if (parts.length === 0) return "Range / ไม่ชัด (heuristic)";
  return `${parts.join(" · ")} (heuristic)`;
}

type PsarResult = {
  sar: number;
  trend: "up" | "down";
  flipped: boolean;
};

/**
 * Parabolic SAR (classic) using high/low arrays (old→new).
 * step=0.02 max=0.2 เป็นค่ามาตรฐานทั่วไป
 */
export function computeParabolicSarLast(
  high: number[],
  low: number[],
  step = 0.02,
  maxAf = 0.2
): PsarResult | null {
  const n = Math.min(high.length, low.length);
  if (n < 5) return null;
  const h = high.slice(-n);
  const l = low.slice(-n);
  const valid =
    h.every((x) => Number.isFinite(x) && x > 0) && l.every((x) => Number.isFinite(x) && x > 0);
  if (!valid) return null;

  // initial trend from first 2 bars
  let trend: "up" | "down" = h[1]! >= h[0]! ? "up" : "down";
  let ep = trend === "up" ? Math.max(h[0]!, h[1]!) : Math.min(l[0]!, l[1]!);
  let sar = trend === "up" ? Math.min(l[0]!, l[1]!) : Math.max(h[0]!, h[1]!);
  let af = step;

  let flipped = false;
  for (let i = 2; i < n; i++) {
    flipped = false;
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (trend === "up") {
      // SAR cannot be above prior lows (classic clamp)
      sar = Math.min(sar, l[i - 1]!, l[i - 2]!);
      // flip
      if (l[i]! <= sar) {
        trend = "down";
        flipped = true;
        sar = ep; // on flip, SAR becomes prior EP
        ep = l[i]!;
        af = step;
      } else {
        // update EP + AF
        if (h[i]! > ep) {
          ep = h[i]!;
          af = Math.min(maxAf, af + step);
        }
      }
    } else {
      // downtrend clamp
      sar = Math.max(sar, h[i - 1]!, h[i - 2]!);
      if (h[i]! >= sar) {
        trend = "up";
        flipped = true;
        sar = ep;
        ep = h[i]!;
        af = step;
      } else {
        if (l[i]! < ep) {
          ep = l[i]!;
          af = Math.min(maxAf, af + step);
        }
      }
    }
  }

  return { sar, trend, flipped };
}

function describeEma12Proxy(long: boolean, mark: number, ema12: number | null): { line: string; distPct: number | null } {
  if (ema12 == null || !(mark > 0)) {
    return { line: "EMA12: —", distPct: null };
  }
  const dist = ((mark - ema12) / mark) * 100;
  if (long) {
    if (mark >= ema12) {
      return {
        line: `เหนือ EMA12 (support proxy) · ห่างจาก EMA12 ${formatPctSigned(dist)}`,
        distPct: dist,
      };
    }
    return {
      line: `ใต้ EMA12 (resistance proxy) · ห่างจาก EMA12 ${formatPctSigned(dist)}`,
      distPct: dist,
    };
  }
  if (mark <= ema12) {
    return {
      line: `ใต้ EMA12 (resistance proxy) · ห่างจาก EMA12 ${formatPctSigned(-dist)}`,
      distPct: -dist,
    };
  }
  return {
    line: `เหนือ EMA12 (สวนทางงานสั้น ๆ ได้) · ห่างจาก EMA12 ${formatPctSigned(-dist)}`,
    distPct: -dist,
  };
}

function ema12StatusCompact(
  long: boolean,
  mark: number | null,
  ema12: number | null
): { status: "Above" | "Below" | "—"; distPct: number | null } {
  if (mark == null || !(mark > 0) || ema12 == null || !(ema12 > 0)) return { status: "—", distPct: null };
  const distAbs = (Math.abs(ema12 - mark) / mark) * 100;
  if (long) return { status: mark >= ema12 ? "Above" : "Below", distPct: distAbs };
  return { status: mark <= ema12 ? "Below" : "Above", distPct: distAbs };
}

type PositionMetrics = {
  row: OpenPositionRow;
  symbol: string;
  label: string;
  long: boolean;
  mark: number | null;
  avg: number | null;
  contractSize: number | null;
  unrealized: number | null;
  pnlPctOnMargin: number | null;
  liqDistPct: number | null;
  marginUsdt: number | null;
  marginPctEquity: number | null;
  ema12: number | null;
  ema6: number | null;
  emaLine: string;
  psar: number | null;
  psarTrend: "up" | "down" | null;
  psarFlipped: boolean | null;
  psarDistPct: number | null;
  structureLine: string;
  concerns: string[];
};

function computeLiqDistancePct(p: OpenPositionRow, mark: number): number | null {
  const liq = numFromUnknown(p.liquidatePrice);
  if (liq == null || !(liq > 0) || !(mark > 0)) return null;
  const isolated = p.openType === 1;
  if (!isolated) return null;
  if (isLongPosition(p)) {
    if (liq >= mark) return null;
    return ((mark - liq) / mark) * 100;
  }
  if (liq <= mark) return null;
  return ((liq - mark) / mark) * 100;
}

function splitForTelegram(body: string, maxLen = 4096): string[] {
  if (body.length <= maxLen) return [body];
  const lines = body.split("\n");
  const out: string[] = [];
  let buf = "";
  const pushBuf = () => {
    const t = buf.trimEnd();
    if (t) out.push(t);
    buf = "";
  };
  for (const line of lines) {
    const candidate = buf ? `${buf}\n${line}` : line;
    if (candidate.length > maxLen) {
      pushBuf();
      if (line.length > maxLen) {
        let rest = line;
        while (rest.length > maxLen) {
          out.push(rest.slice(0, maxLen));
          rest = rest.slice(maxLen);
        }
        buf = rest;
      } else {
        buf = line;
      }
    } else {
      buf = candidate;
    }
  }
  pushBuf();
  return out.length ? out : [body.slice(0, maxLen)];
}

async function buildPositionMetrics(
  p: OpenPositionRow,
  leadDelayMs: number,
  equity: number | null
): Promise<PositionMetrics> {
  if (leadDelayMs > 0) await sleep(leadDelayMs);

  const symbol = p.symbol.trim();
  const label = contractSymbolToLabel(symbol);
  const long = isLongPosition(p);
  const concerns: string[] = [];

  const [detail, markPx, closes, hlcSar] = await Promise.all([
    fetchContractDetailPublic(symbol),
    getContractLastPricePublic(symbol),
    fetchPerp15mClosesForChecklist(symbol),
    fetchPerp15mHlcForSar(symbol),
  ]);

  const cs = detail?.contractSize != null ? Number(detail.contractSize) : NaN;
  const contractSize = Number.isFinite(cs) && cs > 0 ? cs : null;

  const mark = markPx != null && markPx > 0 ? markPx : null;
  const avgRaw = numFromUnknown(p.holdAvgPrice) ?? numFromUnknown(p.openAvgPrice);
  const avg = avgRaw != null && avgRaw > 0 ? avgRaw : null;
  const vol = Number(p.holdVol);
  const volOk = Number.isFinite(vol) && vol > 0;

  let unrealized: number | null = null;
  if (mark != null && avg != null && volOk && contractSize != null) {
    const dir = long ? 1 : -1;
    unrealized = dir * (mark - avg) * vol * contractSize;
  }

  const im = numFromUnknown(p.im) ?? numFromUnknown(p.oim);
  const marginUsdt = im != null && Number.isFinite(im) && im > 0 ? im : null;
  const marginPctEquity =
    marginUsdt != null && equity != null && Number.isFinite(equity) && equity > 0
      ? (marginUsdt / equity) * 100
      : null;

  let pnlPctOnMargin: number | null = null;
  if (unrealized != null && im != null && im > 0) {
    pnlPctOnMargin = (unrealized / im) * 100;
  } else if (unrealized != null && mark != null && volOk && contractSize != null) {
    const notional = vol * contractSize * mark;
    if (notional > 0) pnlPctOnMargin = (unrealized / notional) * 100;
  }

  const liqDistPct = mark != null ? computeLiqDistancePct(p, mark) : null;
  if (liqDistPct != null && liqDistPct < 5) {
    concerns.push(`ใกล้ราคา liquidation (~${liqDistPct.toFixed(2)}% ตามมาร์ก)`);
  }

  const ema12 = closes ? computeEmaLast(closes, 12) : null;
  const ema6 = closes ? computeEmaLast(closes, 6) : null;
  const emaDesc = describeEma12Proxy(long, mark ?? avg ?? 1, ema12);
  if (mark != null && ema12 != null) {
    if (long && mark < ema12) concerns.push("ราคาใต้ EMA12 — งาน long กดแรง (proxy)");
    if (!long && mark > ema12) concerns.push("ราคาเหนือ EMA12 — งาน short กดแรง (proxy)");
  }

  let psar: number | null = null;
  let psarTrend: "up" | "down" | null = null;
  let psarFlipped: boolean | null = null;
  let psarDistPct: number | null = null;
  if (hlcSar) {
    const r = computeParabolicSarLast(hlcSar.high, hlcSar.low);
    if (r) {
      psar = Number.isFinite(r.sar) && r.sar > 0 ? r.sar : null;
      psarTrend = r.trend;
      psarFlipped = r.flipped;
      if (psar != null && mark != null && mark > 0) {
        psarDistPct = (Math.abs(mark - psar) / mark) * 100;
      }
      if (psar != null && mark != null) {
        const bullish = mark > psar;
        if (long && !bullish) concerns.push("PSAR เป็นขาลง/ราคาใต้ SAR — งาน long เสี่ยงโดนกด");
        if (!long && bullish) concerns.push("PSAR เป็นขาขึ้น/ราคาเหนือ SAR — งาน short เสี่ยงโดน squeeze");
      }
      if (psarFlipped) concerns.push("PSAR เพิ่ง flip (แท่งล่าสุด) — ระวัง whipsaw");
    }
  }

  const structureLine = closes ? describeSwingStructureFromCloses(closes) : "—";

  return {
    row: p,
    symbol,
    label,
    long,
    mark,
    avg,
    contractSize,
    unrealized,
    pnlPctOnMargin,
    liqDistPct,
    marginUsdt,
    marginPctEquity,
    ema12,
    ema6,
    emaLine: emaDesc.line,
    psar,
    psarTrend,
    psarFlipped,
    psarDistPct,
    structureLine,
    concerns,
  };
}

function formatPositionBlock(m: PositionMetrics): string {
  const side = m.long ? "LONG" : "SHORT";
  const icon = m.unrealized != null && m.unrealized >= 0 ? "🟢" : "🔴";
  const symCompact = m.label.replace("/", "");
  const pnlPart = m.pnlPctOnMargin != null ? formatPctSigned(m.pnlPctOnMargin) : "—";
  const head = `${icon} ${side} ${symCompact} | ${pnlPart}`;

  const pricePart =
    m.mark != null ? `${formatPriceCompact(m.mark)}` : "—";
  const entryPart = m.avg != null ? ` (Entry: ${formatPriceCompact(m.avg)})` : "";
  const marginPart =
    m.marginUsdt != null
      ? `Margin: ${formatUsd(m.marginUsdt)}${m.marginPctEquity != null ? ` (${m.marginPctEquity.toFixed(2)}%)` : ""}`
      : "Margin: —";

  const emaCompact = ema12StatusCompact(m.long, m.mark, m.ema12);
  const emaLine =
    emaCompact.status === "—"
      ? "EMA12: —"
      : `EMA12: ${emaCompact.status === "Below" ? "✅ Below" : "✅ Above"} (Dist: +${(emaCompact.distPct ?? 0).toFixed(2)}%)`;

  const struct = m.structureLine.replace(" (heuristic)", "");
  const isBear = struct.includes("Lower high") || struct.includes("Lower low");
  const isBull = struct.includes("Higher high") || struct.includes("Higher low");
  const structShort = (() => {
    if (isBear) {
      // bearish structure is good for SHORT, bad for LONG
      return m.long ? "🔴 Bearish (LH/LL)" : "🟢 Bearish (LH/LL)";
    }
    if (isBull) {
      // bullish structure is good for LONG, bad for SHORT
      return m.long ? "🟢 Bullish (HH/HL)" : "🔴 Bullish (HH/HL)";
    }
    return "🟡 Range";
  })();

  const liq = m.row.openType === 1 && m.liqDistPct != null ? `${m.liqDistPct.toFixed(2)}%` : "—";
  const mr = formatMarginRatioDisplay(numFromUnknown(m.row.marginRatio));

  const lines: string[] = [
    head,
    `Price: ${pricePart}${entryPart} · ${marginPart}${m.row.leverage != null ? ` · Lev: ${m.row.leverage}x` : ""}`,
    `${emaLine}`,
    `Structure: ${structShort}`,
    `Risk: Liq: ${liq} | MarginRatio: ${mr}`,
  ];

  const structureAdverse = (m.long && isBear) || (!m.long && isBull);
  const concern = structureAdverse ? "โครงสร้างสวนทางกับ position (structure adverse)" : m.concerns[0];
  if (concern) lines.push(`⚠️ Concern: ${concern.slice(0, 220)}`);

  return lines.join("\n");
}

function formatPriceCompact(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "—";
  if (p < 1) return p.toFixed(6);
  if (p < 100) return p.toFixed(4);
  if (p < 1000) return p.toFixed(2);
  return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * สรุปพอร์ตฟิวเจอร์ MEXC + context EMA15m (proxy) ต่อ position
 * คืนหลายข้อความถ้ายาวเกิน Telegram 4096
 */
export async function buildTelegramPortfolioStatusMessages(creds: MexcCredentials): Promise<string[]> {
  const [assetsRes, posRes] = await Promise.all([
    fetchFuturesAccountAssetList(creds),
    fetchAllOpenPositions(creds),
  ]);

  if (!assetsRes.ok) {
    return [
      `❌ อ่านทรัพย์สินฟิวเจอร์ไม่สำเร็จ\nรหัส: ${assetsRes.code ?? "?"}\n${assetsRes.message.slice(0, 600)}`,
    ];
  }
  if (!posRes.ok) {
    return [
      `❌ อ่าน open positions ไม่สำเร็จ\nรหัส: ${posRes.code ?? "?"}\n${posRes.message.slice(0, 600)}`,
    ];
  }

  const usdt = assetsRes.rows.find((r) => String(r.currency ?? "").toUpperCase() === "USDT");
  const equity = numFromUnknown(usdt?.equity);
  const available = numFromUnknown(usdt?.availableBalance);
  const unrealizedWallet = numFromUnknown(usdt?.unrealized);
  const positionMargin = numFromUnknown(usdt?.positionMargin);

  const actives = posRes.rows.filter((p) => p.state === 1 && Number(p.holdVol) > 0);
  const delayMs = portfolioInterSymbolDelayMs();

  const metricsList: PositionMetrics[] = [];
  for (let i = 0; i < actives.length; i++) {
    const m = await buildPositionMetrics(actives[i]!, i === 0 ? 0 : delayMs, equity);
    metricsList.push(m);
  }

  let sumUnrealized = 0;
  let anyUnreal = false;
  for (const m of metricsList) {
    if (m.unrealized != null) {
      sumUnrealized += m.unrealized;
      anyUnreal = true;
    }
  }

  const floatingUsd = unrealizedWallet != null ? unrealizedWallet : anyUnreal ? sumUnrealized : null;
  const floatingPct =
    floatingUsd != null && equity != null && equity > 0 ? (floatingUsd / equity) * 100 : null;

  const marginUsePct =
    positionMargin != null && equity != null && equity > 0 ? (positionMargin / equity) * 100 : null;

  let maxPosMarginRatio: number | null = null;
  for (const m of metricsList) {
    const r = numFromUnknown(m.row.marginRatio);
    if (r != null && Number.isFinite(r)) {
      maxPosMarginRatio = maxPosMarginRatio == null ? r : Math.max(maxPosMarginRatio, r);
    }
  }

  metricsList.sort((a, b) => {
    const ax = a.unrealized != null ? Math.abs(a.unrealized) : 0;
    const bx = b.unrealized != null ? Math.abs(b.unrealized) : 0;
    return bx - ax;
  });

  const headerLines = [
    "🛡️ PORTFOLIO HEALTH",
    `⏱ ${formatBkkNow()}`,
    "(i) EMA / structure = proxy จากแท่ง 15m — ไม่ใช่เส้น Trendline ใน TradingView",
    "",
    `💰 Balance (equity): ${formatUsd(equity)}`,
    `💵 Available: ${formatUsd(available)}`,
    `📉 Floating PnL: ${floatingUsd != null ? `${formatUsd(floatingUsd)} (${formatPctSigned(floatingPct)})` : "—"}`,
    marginUsePct != null ? `⚡ Margin use (posMargin/equity): ${formatPctSigned(marginUsePct)}` : "⚡ Margin use: —",
    `⚡ Max position margin ratio: ${formatMarginRatioDisplay(maxPosMarginRatio)}`,
    "",
    `Open positions: ${actives.length}`,
  ];

  if (actives.length === 0) {
    const base = headerLines.join("\n");
    if (!portfolioAiSummaryEnabled()) return splitForTelegram(base);
    const ai = await geminiSummarizePortfolioFromTextResult({ text: base, maxLines: 5 });
    const body = ai.ok
      ? `${base}\n\nAI Summary\n${ai.text}`
      : `${base}\n\nAI Summary\n(⚠️ ${ai.error}${ai.status != null ? `, status=${ai.status}` : ""})`;
    return splitForTelegram(body);
  }

  const blocks = metricsList.map(formatPositionBlock);
  const base = [...headerLines, "", "Positions:", "", blocks.join("\n\n")].join("\n");
  if (!portfolioAiSummaryEnabled()) return splitForTelegram(base);
  const ai = await geminiSummarizePortfolioFromTextResult({ text: base, maxLines: 6 });
  const body = ai.ok
    ? `${base}\n\nAI Summary\n${ai.text}`
    : `${base}\n\nAI Summary\n(⚠️ ${ai.error}${ai.status != null ? `, status=${ai.status}` : ""})`;
  return splitForTelegram(body);
}
